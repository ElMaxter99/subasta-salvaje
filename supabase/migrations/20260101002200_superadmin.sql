-- =============================================================================
-- Panel de superadmin: ajustes de la aplicación editables en caliente, perfiles de anfitrión (bloqueo / acceso a la IA),
-- invitaciones (registro cerrado), auditoría y estadísticas de uso/peso. Todo con funciones `ss_admin_*`/`ss_settings_*`
-- (solo service_role). Ejecutar DESPUÉS de 20260101002000_shared_base_image.sql.
-- =============================================================================

create table app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

create table host_profiles (
  user_id      uuid primary key,
  email        text,
  status       text not null default 'active' check (status in ('active','blocked')),
  ai_enabled   boolean not null default true,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create unique index host_profiles_email_uq on host_profiles (lower(email)) where email is not null;

create table host_invites (
  email      text primary key check (email = lower(email) and char_length(email) between 3 and 200),
  invited_at timestamptz not null default now(),
  used_at    timestamptz,
  used_by    uuid
);

create table admin_audit (
  id          bigint generated always as identity primary key,
  actor       text not null,
  action      text not null,
  target_type text,
  target_id   text,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index admin_audit_idx on admin_audit (id desc);

-- El uso de IA debe sobrevivir al borrado de la partida (estadísticas y contador diario: borrar una partida no puede
-- «devolver» cuota ni borrar el historial de gasto). Se desvincula de games y se anota el anfitrión.
alter table image_usage add column host_id uuid;
update image_usage u set host_id = g.host_id from games g where g.id = u.game_id;
alter table image_usage drop constraint image_usage_game_id_fkey;
create index image_usage_host_idx on image_usage (host_id);

create or replace function ss_reserve_image_quota(p jsonb) returns jsonb language plpgsql as $$
declare
  v_game uuid; v_host uuid; v_game_used int; v_day_used int;
  v_game_limit int := (p->>'game_limit')::int; v_day_limit int := (p->>'day_limit')::int;
begin
  select j.game_id, g.host_id into v_game, v_host from image_jobs j join games g on g.id = j.game_id where j.id = (p->>'job_id')::uuid;
  if not found then perform ss_err('job_not_found'); end if;
  perform pg_advisory_xact_lock(hashtext('ss_image_quota'));
  select count(*) into v_game_used from image_usage where game_id = v_game;
  select count(*) into v_day_used from image_usage where (created_at at time zone 'utc')::date = (now() at time zone 'utc')::date;
  if v_game_limit is not null and v_game_used >= v_game_limit then
    return jsonb_build_object('ok', false, 'reason', 'game', 'used', v_game_used, 'limit', v_game_limit);
  end if;
  if v_day_limit is not null and v_day_used >= v_day_limit then
    return jsonb_build_object('ok', false, 'reason', 'day', 'used', v_day_used, 'limit', v_day_limit);
  end if;
  insert into image_usage (game_id, host_id, job_id, provider) values (v_game, v_host, (p->>'job_id')::uuid, coalesce(p->>'provider', 'unknown'));
  return jsonb_build_object('ok', true, 'game_used', v_game_used + 1, 'day_used', v_day_used + 1);
end $$;

create or replace function ss_audit(p_actor text, p_action text, p_type text, p_target text, p_payload jsonb default '{}') returns void language sql as $$
  insert into admin_audit (actor, action, target_type, target_id, payload)
  values (coalesce(nullif(p_actor, ''), 'desconocido'), p_action, p_type, p_target, coalesce(p_payload, '{}'::jsonb));
$$;

-- ---------------------------------------------------------------------------
-- Ajustes (valores por defecto aquí; las variables de entorno solo son un respaldo en TypeScript)
-- ---------------------------------------------------------------------------
create or replace function ss_settings_get(p jsonb) returns jsonb language sql stable as $$
  select jsonb_build_object('signups_open', true, 'game_ttl_hours', null, 'ai_enabled', true,
                            'quota_per_game', null, 'quota_per_day', null)
         || coalesce((select jsonb_object_agg(key, value) from app_settings), '{}'::jsonb);
$$;

create or replace function ss_settings_set(p jsonb) returns jsonb language plpgsql as $$
declare v_key text := p->>'key'; v_val jsonb := p->'value'; v_old jsonb;
begin
  if v_key in ('signups_open','ai_enabled') then
    if jsonb_typeof(v_val) <> 'boolean' then perform ss_err('invalid_input'); end if;
  elsif v_key = 'game_ttl_hours' then
    -- null = valor por defecto (variable GAME_TTL_HOURS o 168 h = 7 días)
    if jsonb_typeof(v_val) <> 'null' and (jsonb_typeof(v_val) <> 'number' or (v_val#>>'{}')::numeric <> floor((v_val#>>'{}')::numeric)
       or (v_val#>>'{}')::int < 1 or (v_val#>>'{}')::int > 2160) then perform ss_err('invalid_input'); end if;
  elsif v_key in ('quota_per_game','quota_per_day') then
    if jsonb_typeof(v_val) <> 'null' and (jsonb_typeof(v_val) <> 'number' or (v_val#>>'{}')::numeric <> floor((v_val#>>'{}')::numeric)
       or (v_val#>>'{}')::int < 1 or (v_val#>>'{}')::int > 100000) then perform ss_err('invalid_input'); end if;
  else
    perform ss_err('invalid_input');
  end if;
  v_old := ss_settings_get('{}'::jsonb)->v_key;
  insert into app_settings (key, value) values (v_key, v_val)
  on conflict (key) do update set value = excluded.value, updated_at = now();
  perform ss_audit(p->>'actor', 'setting_changed', 'setting', v_key, jsonb_build_object('old', v_old, 'new', v_val));
  return ss_settings_get('{}'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- Acceso de anfitriones: crea el perfil al primer acceso si el registro está abierto o hay invitación;
-- bloquea a los bloqueados y a quien llegue con el registro cerrado y sin invitación.
-- Quien ya tenía partidas antes de existir esta función conserva el acceso (se le crea el perfil).
-- ---------------------------------------------------------------------------
create or replace function ss_host_access(p jsonb) returns jsonb language plpgsql as $$
declare
  v_uid uuid := (p->>'user_id')::uuid; v_email text := nullif(lower(trim(coalesce(p->>'email', ''))), '');
  hp host_profiles; v_open boolean := coalesce((ss_settings_get('{}'::jsonb)->>'signups_open')::boolean, true);
  v_invited boolean;
begin
  select * into hp from host_profiles where user_id = v_uid for update;
  if found then
    if hp.status = 'blocked' then return jsonb_build_object('allowed', false, 'reason', 'blocked'); end if;
    update host_profiles set last_seen_at = now(), email = coalesce(v_email, email) where user_id = v_uid;
    return jsonb_build_object('allowed', true, 'ai_enabled', hp.ai_enabled);
  end if;
  v_invited := v_email is not null and exists (select 1 from host_invites where email = v_email);
  if not (v_open or v_invited or exists (select 1 from games where host_id = v_uid)) then
    return jsonb_build_object('allowed', false, 'reason', 'closed');
  end if;
  -- El correo ya estaba asociado a otro perfil (cambió de id): se libera el correo antiguo para no chocar con el índice único.
  update host_profiles set email = null where lower(email) = v_email and user_id <> v_uid;
  insert into host_profiles (user_id, email) values (v_uid, v_email);
  if v_invited then update host_invites set used_at = now(), used_by = v_uid where email = v_email and used_at is null; end if;
  return jsonb_build_object('allowed', true, 'ai_enabled', true, 'created', true);
end $$;

create or replace function ss_host_ai_allowed(p jsonb) returns jsonb language sql stable as $$
  select jsonb_build_object('allowed', coalesce((select ai_enabled from host_profiles where user_id = (p->>'host_id')::uuid), true));
$$;

-- ---------------------------------------------------------------------------
-- Lecturas del panel
-- ---------------------------------------------------------------------------
create or replace function ss_admin_overview(p jsonb) returns jsonb language plpgsql stable as $$
declare
  v_bucket_bytes bigint; v_bucket_objects bigint;
begin
  if to_regclass('storage.objects') is not null then
    execute $q$select coalesce(sum((metadata->>'size')::bigint), 0), count(*) from storage.objects$q$ into v_bucket_bytes, v_bucket_objects;
  end if;
  return jsonb_build_object(
    'db_bytes', pg_database_size(current_database()),
    'tables', coalesce((
      select jsonb_agg(jsonb_build_object('name', t.relname, 'bytes', t.b, 'rows', t.r) order by t.b desc)
      from (select c.relname, pg_total_relation_size(c.oid) as b, greatest(c.reltuples, 0)::bigint as r
            from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r') t), '[]'::jsonb),
    'counts', jsonb_build_object(
      'hosts', (select count(*) from host_profiles),
      'blocked_hosts', (select count(*) from host_profiles where status = 'blocked'),
      'games', (select count(*) from games),
      'games_active', (select count(*) from games where status in ('active','paused')),
      'players', (select count(*) from players),
      'image_versions', (select count(*) from image_versions),
      'jobs_pending', (select count(*) from image_jobs where status in ('queued','running')),
      'jobs_failed', (select count(*) from image_jobs where status = 'failed'),
      'events', (select count(*) from game_events)),
    'storage', jsonb_build_object(
      -- «seguidos» = archivos distintos registrados en image_versions (los compartidos solo se cuentan una vez)
      'tracked_bytes', (select coalesce(sum(b), 0) from (select distinct storage_path, coalesce(bytes, 0) as b from image_versions where storage_path is not null) s),
      'tracked_files', (select count(distinct storage_path) from image_versions where storage_path is not null),
      'bucket_bytes', v_bucket_bytes,
      'bucket_objects', v_bucket_objects),
    'ai', jsonb_build_object(
      'today', (select count(*) from image_usage where (created_at at time zone 'utc')::date = (now() at time zone 'utc')::date),
      'month', (select count(*) from image_usage where date_trunc('month', created_at) = date_trunc('month', now())),
      'total', (select count(*) from image_usage),
      'per_day', coalesce((
        select jsonb_agg(jsonb_build_object('day', d.day, 'count', coalesce(u.n, 0)) order by d.day)
        from (select generate_series((now() at time zone 'utc')::date - 13, (now() at time zone 'utc')::date, interval '1 day')::date as day) d
        left join (select (created_at at time zone 'utc')::date as day, count(*) as n from image_usage group by 1) u on u.day = d.day), '[]'::jsonb),
      'by_provider', coalesce((select jsonb_agg(jsonb_build_object('provider', provider, 'count', n) order by n desc)
                               from (select provider, count(*) as n from image_usage group by provider) x), '[]'::jsonb),
      'top_hosts', coalesce((
        select jsonb_agg(jsonb_build_object('host_id', t.host_id, 'email', t.email, 'count', t.n) order by t.n desc)
        from (select u.host_id, hp.email, count(*) as n
              from image_usage u left join host_profiles hp on hp.user_id = u.host_id
              group by u.host_id, hp.email order by n desc limit 10) t), '[]'::jsonb)));
end $$;

create or replace function ss_admin_users(p jsonb) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'users', coalesce((
      select jsonb_agg(u order by (u->>'created_at') desc nulls last) from (
        select jsonb_build_object(
          'user_id', x.uid, 'email', x.email, 'status', coalesce(x.status, 'active'), 'ai_enabled', coalesce(x.ai_enabled, true),
          'profile', x.has_profile, 'created_at', x.created_at, 'last_seen_at', x.last_seen_at,
          'games', (select count(*) from games g where g.host_id = x.uid),
          'games_active', (select count(*) from games g where g.host_id = x.uid and g.status in ('active','paused','lobby')),
          'ai_used', (select count(*) from image_usage iu where iu.host_id = x.uid),
          'bytes', (select coalesce(sum(b), 0) from (select distinct v.storage_path, coalesce(v.bytes, 0) as b
                    from image_versions v join games g on g.id = v.game_id where g.host_id = x.uid and v.storage_path is not null) s)) as u
        from (
          select hp.user_id as uid, hp.email, hp.status, hp.ai_enabled, true as has_profile, hp.created_at, hp.last_seen_at from host_profiles hp
          union all
          select distinct g.host_id, null::text, null::text, null::boolean, false, null::timestamptz, null::timestamptz from games g
            where not exists (select 1 from host_profiles hp where hp.user_id = g.host_id)
        ) x) q), '[]'::jsonb),
    'invites', coalesce((select jsonb_agg(jsonb_build_object('email', email, 'invited_at', invited_at, 'used_at', used_at) order by invited_at desc) from host_invites), '[]'::jsonb));
$$;

create or replace function ss_admin_games(p jsonb) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(r order by (r->>'updated_at') desc), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', g.id, 'room_code', g.room_code, 'name', g.name, 'status', g.status, 'play_mode', g.play_mode, 'image_mode', g.image_mode,
      'host_id', g.host_id, 'host_email', hp.email, 'created_at', g.created_at, 'updated_at', g.updated_at,
      'players', (select count(*) from players pl where pl.game_id = g.id),
      'versions', (select count(*) from image_versions v where v.game_id = g.id),
      'ai_used', (select count(*) from image_usage u where u.game_id = g.id),
      'bytes', (select coalesce(sum(b), 0) from (select distinct v.storage_path, coalesce(v.bytes, 0) as b from image_versions v where v.game_id = g.id and v.storage_path is not null) s)) as r
    from games g left join host_profiles hp on hp.user_id = g.host_id
    order by g.updated_at desc limit coalesce((p->>'limit')::int, 200)) q;
$$;

create or replace function ss_admin_audit_list(p jsonb) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'actor', actor, 'action', action, 'target_type', target_type,
                                               'target_id', target_id, 'payload', payload, 'created_at', created_at) order by id desc), '[]'::jsonb)
  from (select * from admin_audit order by id desc limit coalesce((p->>'limit')::int, 200)) a;
$$;

-- ---------------------------------------------------------------------------
-- Acciones del panel (todas con auditoría)
-- ---------------------------------------------------------------------------
create or replace function ss_admin_set_user(p jsonb) returns jsonb language plpgsql as $$
declare v_uid uuid := (p->>'user_id')::uuid; hp host_profiles; v_status text := p->>'status'; v_ai boolean := (p->>'ai_enabled')::boolean;
begin
  if v_status is not null and v_status not in ('active','blocked') then perform ss_err('invalid_input'); end if;
  insert into host_profiles (user_id, email) values (v_uid, nullif(lower(trim(coalesce(p->>'email', ''))), ''))
  on conflict (user_id) do nothing;
  update host_profiles set status = coalesce(v_status, status), ai_enabled = coalesce(v_ai, ai_enabled)
  where user_id = v_uid returning * into hp;
  -- Sin acceso a la IA: sus partidas en modo IA pasan al modo pegatinas (gratis); las ya generadas se conservan.
  if v_ai is false then
    update games set image_mode = 'stickers' where host_id = v_uid and image_mode = 'ai' and status <> 'finished';
  end if;
  perform ss_audit(p->>'actor', 'user_updated', 'user', v_uid::text, jsonb_build_object('email', hp.email, 'status', v_status, 'ai_enabled', v_ai));
  return jsonb_build_object('ok', true);
end $$;

create or replace function ss_admin_invite(p jsonb) returns jsonb language plpgsql as $$
declare v_email text := lower(trim(coalesce(p->>'email', ''))); v_op text := p->>'op';
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 200 then perform ss_err('invalid_input'); end if;
  if v_op = 'add' then
    insert into host_invites (email) values (v_email) on conflict (email) do nothing;
  elsif v_op = 'remove' then
    delete from host_invites where email = v_email;
  else
    perform ss_err('invalid_action');
  end if;
  perform ss_audit(p->>'actor', 'invite_' || v_op, 'invite', v_email, '{}');
  return jsonb_build_object('ok', true);
end $$;

-- Borra al usuario y TODO lo suyo (partidas, jugadores, pujas, imágenes, trabajos). Devuelve los ids de partida
-- para que el servidor borre sus archivos de Storage y la cuenta de Supabase Auth.
create or replace function ss_admin_delete_user(p jsonb) returns jsonb language plpgsql as $$
declare v_uid uuid := (p->>'user_id')::uuid; v_ids uuid[]; v_gid uuid; v_email text;
begin
  select email into v_email from host_profiles where user_id = v_uid;
  select coalesce(array_agg(id), '{}') into v_ids from games where host_id = v_uid;
  foreach v_gid in array v_ids loop perform ss_wipe_game(v_gid); end loop;
  delete from host_profiles where user_id = v_uid;
  perform ss_audit(p->>'actor', 'user_deleted', 'user', v_uid::text, jsonb_build_object('email', v_email, 'games', coalesce(array_length(v_ids, 1), 0)));
  return jsonb_build_object('ok', true, 'game_ids', to_jsonb(v_ids));
end $$;

create or replace function ss_admin_delete_game(p jsonb) returns jsonb language plpgsql as $$
declare g games;
begin
  select * into g from games where room_code = upper(coalesce(p->>'room_code', '')) for update;
  if not found then perform ss_err('game_not_found'); end if;
  perform ss_wipe_game(g.id);
  perform ss_audit(p->>'actor', 'game_deleted', 'game', g.room_code, jsonb_build_object('name', g.name, 'host_id', g.host_id));
  return jsonb_build_object('ok', true, 'game_id', g.id, 'room_code', g.room_code);
end $$;

-- Anotación de auditoría para acciones que se ejecutan fuera de SQL (p. ej. purga manual).
create or replace function ss_admin_log(p jsonb) returns jsonb language plpgsql as $$
begin
  perform ss_audit(p->>'actor', p->>'action', p->>'target_type', p->>'target_id', coalesce(p->'payload', '{}'));
  return jsonb_build_object('ok', true);
end $$;
