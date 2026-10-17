-- Regenerar la versión ACTUAL de un jugador (para probar otro modelo o prompt sobre la misma compra, sin volver a comprar).
-- La versión actual debe ser una edición completada con una versión padre aprobada. El trabajo de esa compra (hay uno solo por compra)
-- se vuelve a encolar partiendo de la versión padre; al terminar se añade una versión NUEVA (la anterior se conserva en el historial)
-- y pasa a ser la actual. Nunca toca saldos, compras ni cobros. Tope: 10 regeneraciones por compra.
create or replace function ss_regenerate_image(p jsonb) returns jsonb language plpgsql as $$
declare g games; pl players; v image_versions; parent image_versions; j image_jobs;
begin
  g := ss_lock_game(p->>'room_code', (p->>'host_id')::uuid);
  select * into pl from players where id = (p->>'player_id')::uuid and game_id = g.id for update;
  if not found then perform ss_err('player_not_found'); end if;
  select * into v from image_versions where id = (p->>'version_id')::uuid and player_id = pl.id;
  if not found then perform ss_err('version_not_found'); end if;
  -- Ya hay una regeneración en curso para esa compra: no se duplica (la actual ya es la versión anterior).
  if v.source_purchase_id is not null and exists (select 1 from image_jobs where purchase_id = v.source_purchase_id and kind = 'edit' and status in ('queued', 'running')) then
    return jsonb_build_object('ok', true, 'replay', true);
  end if;
  if v.origin <> 'edit' or v.generation_status <> 'completed' or v.source_purchase_id is null or v.parent_version_id is null
     or pl.current_image_version_id is distinct from v.id then
    perform ss_err('version_not_regenerable');
  end if;
  select * into parent from image_versions where id = v.parent_version_id;
  if parent.id is null or parent.generation_status <> 'completed' or not parent.is_approved or parent.storage_path is null then
    perform ss_err('version_not_regenerable');
  end if;
  select * into j from image_jobs where purchase_id = v.source_purchase_id and kind = 'edit' and player_id = pl.id for update;
  if not found then perform ss_err('version_not_regenerable'); end if;
  if (select count(*) from game_events where game_id = g.id and event_type = 'image_regenerated' and payload->>'job_id' = j.id::text) >= 10 then
    perform ss_err('retry_limit');
  end if;
  -- La base del nuevo intento es la versión anterior: pasa a ser la actual y el trabajo se vuelve a encolar.
  update players set current_image_version_id = parent.id where id = pl.id;
  update image_jobs set status = 'queued', attempts = 0, error_message = null, run_after = now(), base_image_version_id = parent.id,
         result_version_id = null, locked_by = null, locked_until = null, finished_at = null, updated_at = now()
   where id = j.id;
  perform ss_log(g.id, g.host_id, 'image_regenerated', jsonb_build_object('job_id', j.id, 'player_id', pl.id, 'version_id', v.id, 'parent_version_id', parent.id));
  perform ss_touch(g.id);
  return jsonb_build_object('ok', true, 'job_id', j.id);
end $$;
