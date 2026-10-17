-- Generaciones de IA fuera de una partida (imagen de un producto del catálogo general, desde el superadmin).
-- Cuentan en el mismo contador diario que las de las partidas (image_usage) y respetan el mismo tope global.
alter table image_usage alter column game_id drop not null;

create or replace function ss_reserve_admin_image_quota(p jsonb) returns jsonb language plpgsql as $$
declare v_day_used int; v_day_limit int := (p->>'day_limit')::int;
begin
  perform pg_advisory_xact_lock(hashtext('ss_image_quota'));
  select count(*) into v_day_used from image_usage where (created_at at time zone 'utc')::date = (now() at time zone 'utc')::date;
  if v_day_limit is not null and v_day_used >= v_day_limit then
    return jsonb_build_object('ok', false, 'reason', 'day', 'used', v_day_used, 'limit', v_day_limit);
  end if;
  insert into image_usage (game_id, host_id, job_id, provider) values (null, null, null, coalesce(p->>'provider', 'unknown'));
  return jsonb_build_object('ok', true, 'day_used', v_day_used + 1);
end $$;
