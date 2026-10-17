-- Fase 2 de la cadena de proveedores de IA: el superadmin puede apagar proveedores y poner un tope diario por proveedor,
-- y se ve cuánto ha usado cada uno hoy. Los topes por proveedor son «blandos» (los aplica la cadena en TypeScript antes de
-- llamar); el tope global duro sigue en ss_reserve_image_quota.

-- Ajustes nuevos: ai_providers_off (lista de proveedores apagados) y ai_provider_limits (tope diario por proveedor).
create or replace function ss_settings_get(p jsonb) returns jsonb language sql stable as $$
  select jsonb_build_object('signups_open', true, 'game_ttl_hours', null, 'ai_enabled', true,
                            'quota_per_game', null, 'quota_per_day', null,
                            'ai_providers_off', '[]'::jsonb, 'ai_provider_limits', '{}'::jsonb)
         || coalesce((select jsonb_object_agg(key, value) from app_settings), '{}'::jsonb);
$$;

create or replace function ss_settings_set(p jsonb) returns jsonb language plpgsql as $$
declare v_key text := p->>'key'; v_val jsonb := p->'value'; v_old jsonb; v_el jsonb; v_k text; v_v jsonb;
  v_known text[] := array['cloudflare','pollinations','openai'];
begin
  if v_key in ('signups_open','ai_enabled') then
    if jsonb_typeof(v_val) <> 'boolean' then perform ss_err('invalid_input'); end if;
  elsif v_key = 'game_ttl_hours' then
    if jsonb_typeof(v_val) <> 'null' and (jsonb_typeof(v_val) <> 'number' or (v_val#>>'{}')::numeric <> floor((v_val#>>'{}')::numeric)
       or (v_val#>>'{}')::int < 1 or (v_val#>>'{}')::int > 2160) then perform ss_err('invalid_input'); end if;
  elsif v_key in ('quota_per_game','quota_per_day') then
    if jsonb_typeof(v_val) <> 'null' and (jsonb_typeof(v_val) <> 'number' or (v_val#>>'{}')::numeric <> floor((v_val#>>'{}')::numeric)
       or (v_val#>>'{}')::int < 1 or (v_val#>>'{}')::int > 100000) then perform ss_err('invalid_input'); end if;
  elsif v_key = 'ai_providers_off' then
    if jsonb_typeof(v_val) <> 'array' then perform ss_err('invalid_input'); end if;
    for v_el in select * from jsonb_array_elements(v_val) loop
      if jsonb_typeof(v_el) <> 'string' or not ((v_el#>>'{}') = any (v_known)) then perform ss_err('invalid_input'); end if;
    end loop;
  elsif v_key = 'ai_provider_limits' then
    if jsonb_typeof(v_val) <> 'object' then perform ss_err('invalid_input'); end if;
    for v_k, v_v in select * from jsonb_each(v_val) loop
      if not (v_k = any (v_known)) or jsonb_typeof(v_v) <> 'number' or (v_v#>>'{}')::numeric <> floor((v_v#>>'{}')::numeric)
         or (v_v#>>'{}')::int < 1 or (v_v#>>'{}')::int > 100000 then perform ss_err('invalid_input'); end if;
    end loop;
  else
    perform ss_err('invalid_input');
  end if;
  v_old := ss_settings_get('{}'::jsonb)->v_key;
  insert into app_settings (key, value) values (v_key, v_val)
  on conflict (key) do update set value = excluded.value, updated_at = now();
  perform ss_audit(p->>'actor', 'setting_changed', 'setting', v_key, jsonb_build_object('old', v_old, 'new', v_val));
  return ss_settings_get('{}'::jsonb);
end $$;

-- Usos de hoy (día UTC) por proveedor, para el panel y para los topes por proveedor.
create or replace function ss_provider_usage(p jsonb) returns jsonb language sql stable as $$
  select coalesce(jsonb_object_agg(provider, n), '{}'::jsonb)
  from (select provider, count(*)::int as n from image_usage
        where (created_at at time zone 'utc')::date = (now() at time zone 'utc')::date group by provider) t;
$$;

-- Cuando una cadena responde con un proveedor distinto del que reservó la cuota, el uso se atribuye al que respondió.
create or replace function ss_set_usage_provider(p jsonb) returns jsonb language plpgsql as $$
declare v_id bigint;
begin
  select id into v_id from image_usage where job_id = (p->>'job_id')::uuid order by created_at desc, id desc limit 1;
  if v_id is not null then update image_usage set provider = coalesce(p->>'provider', provider) where id = v_id; end if;
  return jsonb_build_object('ok', true, 'updated', v_id is not null);
end $$;
