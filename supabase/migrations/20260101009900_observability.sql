-- Observabilidad propia (errores y métricas de uso), sin servicios externos: todo vive en la base de datos y se lee en /admin/observabilidad.
-- Privacidad: NO se guardan tokens, cookies, cuerpos de petición, IP ni datos de jugadores. Ver docs/OBSERVABILIDAD.md.

-- ---------------------------------------------------------------------------
-- Errores agrupados por huella (una fila por grupo) + contador por hora (ventanas de 24 h / 7 d)
-- ---------------------------------------------------------------------------
create table app_errors (
  fingerprint text primary key,
  source      text not null check (source in ('server','client','job','cron')),
  route       text not null default '',
  code        text not null default 'internal',
  message     text not null default '',
  stack       text not null default '',
  room_code   text,
  release     text not null default '',
  env         text not null default '',
  severity    text not null default 'high' check (severity in ('high','low')),
  status      text not null default 'new' check (status in ('new','seen','resolved')),
  total       bigint not null default 1,
  first_at    timestamptz not null default now(),
  last_at     timestamptz not null default now(),
  reopened_at timestamptz
);
create index app_errors_last_idx on app_errors (last_at desc);

create table app_error_hourly (
  fingerprint text not null references app_errors(fingerprint) on delete cascade,
  hour        timestamptz not null,
  n           int not null default 0,
  primary key (fingerprint, hour)
);
create index app_error_hourly_hour_idx on app_error_hourly (hour);

-- Contadores diarios agregados (sin datos personales): día UTC + nombre de métrica.
create table usage_metrics (
  day    date not null,
  metric text not null check (metric ~ '^[a-z0-9_.:-]{1,80}$'),
  value  bigint not null default 0,
  primary key (day, metric)
);

-- ---------------------------------------------------------------------------
-- Utilidades
-- ---------------------------------------------------------------------------
-- Segunda barrera de saneado (la primera es redactSecrets en TypeScript): correos, IPv4, JWT, cabeceras Bearer, consultas de URL.
create or replace function ss_obs_clean(t text, n int) returns text language sql immutable as $$
  select left(
    regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(coalesce(t, ''),
      '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[correo]', 'g'),
      '\m\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\M', '[ip]', 'g'),
      'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}', '[redactado]', 'g'),
      'Bearer\s+[A-Za-z0-9._~+/=-]{8,}', 'Bearer [redactado]', 'gi'),
      '\?[^\s"'')]{1,}', '?…', 'g'),
    greatest(n, 0))
$$;

-- Configuración (viven en app_settings, que ss_settings_get ya devuelve entera).
create or replace function ss_obs_cfg(p jsonb) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'retention_days', coalesce((select (value#>>'{}')::int from app_settings where key = 'obs_retention_days' and jsonb_typeof(value) = 'number'), 30),
    'alert_email',    coalesce((select (value#>>'{}')::boolean from app_settings where key = 'obs_alert_email' and jsonb_typeof(value) = 'boolean'), false),
    'max_groups', 500)
$$;

create or replace function ss_obs_setting_set(p jsonb) returns jsonb language plpgsql as $$
declare v_key text := p->>'key'; v_val jsonb := p->'value'; v_old jsonb;
begin
  if v_key = 'obs_alert_email' then
    if jsonb_typeof(v_val) <> 'boolean' then perform ss_err('invalid_input'); end if;
  elsif v_key = 'obs_retention_days' then
    if jsonb_typeof(v_val) <> 'number' or (v_val#>>'{}')::numeric <> floor((v_val#>>'{}')::numeric)
       or (v_val#>>'{}')::int < 1 or (v_val#>>'{}')::int > 365 then perform ss_err('invalid_input'); end if;
  else
    perform ss_err('invalid_input');
  end if;
  v_old := ss_obs_cfg('{}'::jsonb)->(case v_key when 'obs_alert_email' then 'alert_email' else 'retention_days' end);
  insert into app_settings (key, value) values (v_key, v_val)
  on conflict (key) do update set value = excluded.value, updated_at = now();
  perform ss_audit(p->>'actor', 'setting_changed', 'setting', v_key, jsonb_build_object('old', v_old, 'new', v_val));
  return ss_obs_cfg('{}'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- Registro de un error. Devuelve {fingerprint, is_new, reopened, severity}. Nunca debe llamarse dentro de una transacción de juego.
-- p: source, route, code, message, stack, room_code, release, env, severity
-- ---------------------------------------------------------------------------
create or replace function ss_obs_error_record(p jsonb) returns jsonb language plpgsql as $$
declare
  v_source text := coalesce(nullif(p->>'source', ''), 'server');
  v_route text := ss_obs_clean(p->>'route', 120);
  v_code text := regexp_replace(left(coalesce(nullif(p->>'code', ''), 'internal'), 60), '[^A-Za-z0-9_.:-]', '_', 'g');
  v_msg text := ss_obs_clean(p->>'message', 400);
  v_stack text := ss_obs_clean(p->>'stack', 1500);
  v_norm text; v_fp text; v_sev text; v_room text; v_cfg jsonb := ss_obs_cfg('{}'::jsonb);
  v_old app_errors; v_new boolean := false; v_reopened boolean := false; v_over int;
begin
  if v_source not in ('server','client','job','cron') then v_source := 'server'; end if;
  v_sev := case when coalesce(p->>'severity', '') in ('high','low') then p->>'severity' when v_source = 'client' then 'low' else 'high' end;
  v_room := nullif(upper(left(regexp_replace(coalesce(p->>'room_code', ''), '[^A-Za-z0-9]', '', 'g'), 12)), '');
  -- Huella: el mensaje sin números, UUID ni hexadecimales largos, para que "la misma" avería agrupe aunque cambien los datos.
  v_norm := lower(left(regexp_replace(regexp_replace(regexp_replace(split_part(v_msg, E'\n', 1),
    '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '<id>', 'gi'), '\m[0-9a-f]{12,}\M', '<hex>', 'gi'), '\d+', '<n>', 'g'), 200));
  v_fp := md5(v_source || '|' || v_route || '|' || v_code || '|' || v_norm);

  select * into v_old from app_errors where fingerprint = v_fp for update;
  if not found then
    insert into app_errors (fingerprint, source, route, code, message, stack, room_code, release, env, severity)
    values (v_fp, v_source, v_route, v_code, v_msg, v_stack, v_room, left(coalesce(p->>'release', ''), 40), left(coalesce(p->>'env', ''), 20), v_sev)
    on conflict (fingerprint) do nothing;
    v_new := true;
    -- Tope duro de grupos: se descartan primero los resueltos y luego los menos recientes.
    select count(*) - (v_cfg->>'max_groups')::int into v_over from app_errors;
    if v_over > 0 then
      delete from app_errors where fingerprint in (
        select fingerprint from app_errors where fingerprint <> v_fp
         order by (status = 'resolved') desc, last_at asc limit v_over);
    end if;
  else
    v_reopened := v_old.status = 'resolved';
    update app_errors set total = total + 1, last_at = now(), room_code = coalesce(v_room, room_code),
           status = case when status = 'resolved' then 'new' else status end,
           reopened_at = case when status = 'resolved' then now() else reopened_at end
     where fingerprint = v_fp;
  end if;
  insert into app_error_hourly (fingerprint, hour, n) values (v_fp, date_trunc('hour', now()), 1)
  on conflict (fingerprint, hour) do update set n = app_error_hourly.n + 1;
  return jsonb_build_object('fingerprint', v_fp, 'is_new', v_new, 'reopened', v_reopened, 'severity', coalesce(v_old.severity, v_sev));
end $$;

-- ---------------------------------------------------------------------------
-- Contadores: p = {"metrics": {"req.play.2xx": 12, ...}}. Upsert por lotes sobre el día UTC actual.
-- ---------------------------------------------------------------------------
create or replace function ss_obs_incr(p jsonb) returns jsonb language plpgsql as $$
declare v_n int := 0; k text; v jsonb;
begin
  if jsonb_typeof(p->'metrics') <> 'object' then return jsonb_build_object('ok', false); end if;
  for k, v in select * from jsonb_each(p->'metrics') loop
    exit when v_n >= 200;
    continue when k !~ '^[a-z0-9_.:-]{1,80}$' or jsonb_typeof(v) <> 'number' or (v#>>'{}')::numeric < 0 or (v#>>'{}')::numeric > 1000000;
    insert into usage_metrics (day, metric, value) values ((now() at time zone 'utc')::date, k, (v#>>'{}')::numeric::bigint)
    on conflict (day, metric) do update set value = usage_metrics.value + excluded.value;
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'n', v_n);
end $$;

-- ---------------------------------------------------------------------------
-- Métricas de juego derivadas de lo que la base ya registra (game_events, partidas, reacciones). Idempotente: nunca baja un valor
-- (los eventos de partidas caducadas se borran, pero el contador del día ya guardado se conserva). p = {"days": 2}
-- ---------------------------------------------------------------------------
create or replace function ss_obs_rollup(p jsonb) returns jsonb language plpgsql as $$
declare v_days int := least(greatest(coalesce((p->>'days')::int, 2), 1), 60); v_from date := (now() at time zone 'utc')::date - (least(greatest(coalesce((p->>'days')::int, 2), 1), 60) - 1);
begin
  insert into usage_metrics (day, metric, value)
  select day, metric, n from (
    select (e.created_at at time zone 'utc')::date as day,
           case when e.event_type = 'game_created' then 'game.created'
                when e.event_type = 'game_start' then 'game.started'
                when e.event_type like 'game_finish%' then 'game.finished'
                when e.event_type = 'player_joined' then 'player.joined'
                when e.event_type = 'auction_announced' then 'auction.announced'
                when e.event_type = 'auction_awarded' then 'auction.awarded'
                when e.event_type = 'auction_cleared' then 'auction.cancelled'
                when e.event_type = 'auction_unsold' then 'auction.unsold'
                when e.event_type = 'bid_placed' then 'bid.placed'
                when e.event_type = 'bid_yielded' then 'bid.yielded' end as metric,
           count(*)::bigint as n
      from game_events e
     where (e.created_at at time zone 'utc')::date >= v_from
     group by 1, 2
  ) x where metric is not null
  on conflict (day, metric) do update set value = greatest(usage_metrics.value, excluded.value);

  insert into usage_metrics (day, metric, value)
  select (g.created_at at time zone 'utc')::date, 'game.created', count(*)::bigint from games g
   where (g.created_at at time zone 'utc')::date >= v_from group by 1
  on conflict (day, metric) do update set value = greatest(usage_metrics.value, excluded.value);

  insert into usage_metrics (day, metric, value)
  select (r.created_at at time zone 'utc')::date, 'reaction.sent', count(*)::bigint from game_reactions r
   where (r.created_at at time zone 'utc')::date >= v_from group by 1
  on conflict (day, metric) do update set value = greatest(usage_metrics.value, excluded.value);
  return jsonb_build_object('ok', true, 'from', v_from);
end $$;

-- ---------------------------------------------------------------------------
-- Purga: retención configurable + tope de filas. Devuelve lo borrado.
-- ---------------------------------------------------------------------------
create or replace function ss_obs_purge(p jsonb) returns jsonb language plpgsql as $$
declare v_days int := (ss_obs_cfg('{}'::jsonb)->>'retention_days')::int; v_a int; v_b int; v_c int; v_d int;
begin
  delete from app_errors where last_at < now() - make_interval(days => v_days);
  get diagnostics v_a = row_count;
  delete from app_error_hourly where hour < now() - make_interval(days => v_days);
  get diagnostics v_b = row_count;
  -- Tope duro de las filas por hora (por si hubiera muchísimos grupos activos): se conserva lo más reciente.
  delete from app_error_hourly where ctid in (select ctid from app_error_hourly order by hour desc offset 20000);
  get diagnostics v_c = row_count;
  delete from usage_metrics where day < (now() at time zone 'utc')::date - 400;
  get diagnostics v_d = row_count;
  return jsonb_build_object('errors', v_a, 'hourly', v_b + v_c, 'metrics', v_d, 'retention_days', v_days);
end $$;

-- ---------------------------------------------------------------------------
-- Lecturas del panel
-- ---------------------------------------------------------------------------
-- Percentil aproximado (cota superior del cubo) a partir de {"50": n, "100": n, ... "max": n}.
create or replace function ss_obs_percentile(p_buckets jsonb, p_q numeric) returns int language plpgsql immutable as $$
declare v_total numeric := 0; v_cum numeric := 0; r record;
begin
  select coalesce(sum(value::numeric), 0) into v_total from jsonb_each_text(p_buckets);
  if v_total = 0 then return null; end if;
  for r in select key, value::numeric as n from jsonb_each_text(p_buckets) order by case when key = 'max' then 1000000 else key::int end loop
    v_cum := v_cum + r.n;
    if v_cum >= p_q * v_total then return case when r.key = 'max' then 5001 else r.key::int end; end if;
  end loop;
  return 5001;
end $$;

create or replace function ss_obs_overview(p jsonb) returns jsonb language plpgsql stable as $$
declare
  v_today date := (now() at time zone 'utc')::date; v_from date := (now() at time zone 'utc')::date - 6;
  v_e24 bigint; v_e7 bigint; v_g_open int; v_g_new int; v_req bigint; v_5xx bigint; v_429 bigint; v_fam jsonb; v_series jsonb;
  v_last_h bigint; v_avg_h numeric; v_alerts jsonb := '[]'::jsonb; v_newhigh jsonb; v_cfg jsonb := ss_obs_cfg('{}'::jsonb);
begin
  select coalesce(sum(n) filter (where hour >= now() - interval '24 hours'), 0), coalesce(sum(n) filter (where hour >= now() - interval '7 days'), 0)
    into v_e24, v_e7 from app_error_hourly;
  select count(*) filter (where status <> 'resolved'), count(*) filter (where status = 'new') into v_g_open, v_g_new from app_errors;

  select coalesce(sum(value), 0), coalesce(sum(value) filter (where metric like '%.5xx'), 0), coalesce(sum(value) filter (where metric like '%.429'), 0)
    into v_req, v_5xx, v_429 from usage_metrics where day >= v_from and metric like 'req.%';

  select coalesce(jsonb_agg(f order by (f->>'total')::bigint desc), '[]'::jsonb) into v_fam from (
    select jsonb_build_object('family', fam, 'total', sum(case when kind = 'req' then value else 0 end),
        's2xx', sum(case when kind = 'req' and cls = '2xx' then value else 0 end),
        's4xx', sum(case when kind = 'req' and cls = '4xx' then value else 0 end),
        's429', sum(case when kind = 'req' and cls = '429' then value else 0 end),
        's5xx', sum(case when kind = 'req' and cls = '5xx' then value else 0 end),
        'p50', ss_obs_percentile(coalesce(jsonb_object_agg(cls, value) filter (where kind = 'lat'), '{}'::jsonb), 0.5),
        'p95', ss_obs_percentile(coalesce(jsonb_object_agg(cls, value) filter (where kind = 'lat'), '{}'::jsonb), 0.95)) as f
    from (select split_part(metric, '.', 1) as kind, split_part(metric, '.', 2) as fam, split_part(metric, '.', 3) as cls, sum(value) as value
            from usage_metrics where day >= v_from and (metric like 'req.%' or metric like 'lat.%') group by 1, 2, 3) t
    group by fam) g;

  select coalesce(jsonb_agg(jsonb_build_object('day', to_char(day, 'YYYY-MM-DD'), 'metric', metric, 'value', value) order by day, metric), '[]'::jsonb) into v_series
    from usage_metrics where day >= v_today - 29 and metric !~ '^(req|lat|derr)\.';

  -- Alertas: pico de errores (última hora frente a la media horaria de las 24 h anteriores) y errores graves nuevos.
  select coalesce(sum(n) filter (where hour >= date_trunc('hour', now())), 0),
         coalesce(sum(n) filter (where hour < date_trunc('hour', now()) and hour >= now() - interval '25 hours'), 0) / 24.0
    into v_last_h, v_avg_h from app_error_hourly h join app_errors e using (fingerprint) where e.severity = 'high';
  if v_last_h >= 10 and v_last_h >= 3 * greatest(v_avg_h, 1) then
    v_alerts := v_alerts || jsonb_build_object('kind', 'spike', 'errors_last_hour', v_last_h, 'avg_per_hour', round(v_avg_h, 1));
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('fingerprint', fingerprint, 'route', route, 'code', code, 'first_at', first_at) order by first_at desc), '[]'::jsonb) into v_newhigh
    from (select * from app_errors where severity = 'high' and status = 'new' and (first_at >= now() - interval '24 hours' or reopened_at >= now() - interval '24 hours') order by first_at desc limit 10) n;
  if jsonb_array_length(v_newhigh) > 0 then v_alerts := v_alerts || jsonb_build_object('kind', 'new_error', 'errors', v_newhigh); end if;

  return jsonb_build_object('errors_24h', v_e24, 'errors_7d', v_e7, 'groups_open', v_g_open, 'groups_new', v_g_new,
    'requests_7d', v_req, 'status_5xx_7d', v_5xx, 'status_429_7d', v_429,
    'rate_5xx', case when v_req > 0 then round(v_5xx::numeric / v_req, 5) else 0 end,
    'families', v_fam, 'series', v_series, 'alerts', v_alerts, 'config', v_cfg,
    'domain_errors', (select coalesce(jsonb_agg(jsonb_build_object('code', substr(metric, 6), 'n', n) order by n desc), '[]'::jsonb)
                        from (select metric, sum(value) n from usage_metrics where day >= v_from and metric like 'derr.%' group by metric order by 2 desc limit 15) d));
end $$;

-- Lista de grupos con filtros. p: status ('new'|'seen'|'resolved'|'open'), source, severity, q, limit
create or replace function ss_obs_error_list(p jsonb) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('fingerprint', e.fingerprint, 'source', e.source, 'route', e.route, 'code', e.code,
      'message', e.message, 'stack', e.stack, 'room_code', e.room_code, 'release', e.release, 'env', e.env, 'severity', e.severity,
      'status', e.status, 'total', e.total, 'first_at', e.first_at, 'last_at', e.last_at,
      'count_24h', coalesce(h.c24, 0), 'count_7d', coalesce(h.c7, 0)) order by e.last_at desc), '[]'::jsonb)
  from (
    select * from app_errors a
     where (coalesce(p->>'status', '') = '' or (p->>'status' = 'open' and a.status <> 'resolved') or a.status = p->>'status')
       and (coalesce(p->>'source', '') = '' or a.source = p->>'source')
       and (coalesce(p->>'severity', '') = '' or a.severity = p->>'severity')
       and (coalesce(p->>'q', '') = '' or lower(a.route || ' ' || a.code || ' ' || a.message) like '%' || lower(p->>'q') || '%')
     order by a.last_at desc limit least(greatest(coalesce((p->>'limit')::int, 100), 1), 500)
  ) e
  left join lateral (select sum(n) filter (where hour >= now() - interval '24 hours') c24, sum(n) filter (where hour >= now() - interval '7 days') c7
                       from app_error_hourly x where x.fingerprint = e.fingerprint) h on true
$$;

-- Marca un grupo como visto/resuelto/nuevo (auditado).
create or replace function ss_obs_error_set_status(p jsonb) returns jsonb language plpgsql as $$
declare v_st text := p->>'status'; v_n int;
begin
  if v_st not in ('new','seen','resolved') then perform ss_err('invalid_input'); end if;
  if p->>'fingerprint' = '*' then
    -- Acción en bloque: solo «visto» / «resuelto» sobre los grupos abiertos.
    if v_st = 'new' then perform ss_err('invalid_input'); end if;
    update app_errors set status = v_st where status <> 'resolved' and status <> v_st;
  else
    update app_errors set status = v_st where fingerprint = p->>'fingerprint';
  end if;
  get diagnostics v_n = row_count;
  if v_n = 0 and p->>'fingerprint' <> '*' then perform ss_err('invalid_input'); end if;
  perform ss_audit(p->>'actor', 'error_status', 'app_error', left(p->>'fingerprint', 40), jsonb_build_object('status', v_st, 'groups', v_n));
  return jsonb_build_object('ok', true, 'groups', v_n);
end $$;

-- Reserva atómica del derecho a enviar un correo-resumen: solo si el interruptor está activo y han pasado ≥ min_hours desde el último.
create or replace function ss_obs_alert_claim(p jsonb) returns jsonb language plpgsql as $$
declare v_min int := least(greatest(coalesce((p->>'min_hours')::int, 6), 1), 168); v_last timestamptz;
begin
  if not (ss_obs_cfg('{}'::jsonb)->>'alert_email')::boolean then return jsonb_build_object('send', false, 'reason', 'disabled'); end if;
  perform pg_advisory_xact_lock(hashtext('ss_obs_alert'));
  select (value#>>'{}')::timestamptz into v_last from app_settings where key = 'obs_alert_last_at';
  if v_last is not null and v_last > now() - make_interval(hours => v_min) then return jsonb_build_object('send', false, 'reason', 'rate_limited'); end if;
  insert into app_settings (key, value) values ('obs_alert_last_at', to_jsonb(now()::text))
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return jsonb_build_object('send', true);
end $$;
