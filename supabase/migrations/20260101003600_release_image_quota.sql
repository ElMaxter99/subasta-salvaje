-- Devuelve la unidad de cuota reservada por un trabajo cuando el proveedor NO llegó a gastar nada (sin conexión, credenciales
-- rechazadas, cuota del proveedor agotada, entrada preparada mal…). Así los fallos que no consumen no agotan el contador local.
-- Borra como mucho UNA fila (la más reciente) de image_usage del trabajo; es idempotente si no hay ninguna.
create or replace function ss_release_image_quota(p jsonb) returns jsonb language plpgsql as $$
declare v_id bigint;
begin
  perform pg_advisory_xact_lock(hashtext('ss_image_quota'));
  select id into v_id from image_usage where job_id = (p->>'job_id')::uuid order by created_at desc, id desc limit 1;
  if v_id is not null then delete from image_usage where id = v_id; end if;
  return jsonb_build_object('ok', true, 'released', v_id is not null);
end $$;
