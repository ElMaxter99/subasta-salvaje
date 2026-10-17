-- Reiniciar una partida: la deja como al entrar a la sala de espera, antes de empezar.
-- Borra subastas, pujas, compras, votos de la galería, eventos y TODAS las versiones de imagen generadas por compras (ediciones);
-- cada jugador vuelve a su imagen inicial y a su presupuesto inicial. Se conservan jugadores (y su unión por móvil), catálogo (con las imágenes
-- de los elementos), ajustes de la partida, imágenes iniciales y el consumo de IA ya contabilizado (image_usage: no se devuelve cuota).
-- Devuelve las rutas de Storage de las versiones borradas para que el servidor borre los archivos.
create or replace function ss_reset_game(p jsonb) returns jsonb language plpgsql as $$
declare g games; v_paths jsonb; v_keep uuid[];
begin
  g := ss_lock_game(p->>'room_code', (p->>'host_id')::uuid);
  select coalesce(array_agg(initial_image_version_id), '{}') into v_keep from players where game_id = g.id and initial_image_version_id is not null;

  -- Archivos a borrar: versiones que no son la imagen inicial de un jugador.
  select coalesce(jsonb_agg(storage_path), '[]'::jsonb) into v_paths
    from image_versions where game_id = g.id and storage_path is not null and not (id = any (v_keep));

  update games set current_auction_id = null where id = g.id;
  delete from gallery_votes where game_id = g.id;
  delete from image_jobs where game_id = g.id and kind = 'edit';
  -- Trabajos que quedan (casa inicial, imagen de elemento) no deben apuntar a versiones que se van a borrar.
  update image_jobs set result_version_id = null where game_id = g.id and result_version_id is not null and not (result_version_id = any (v_keep));
  update image_jobs set base_image_version_id = null where game_id = g.id and base_image_version_id is not null and not (base_image_version_id = any (v_keep));
  update image_versions set parent_version_id = null where game_id = g.id and id = any (v_keep) and parent_version_id is not null;
  update players set current_image_version_id = initial_image_version_id, balance_cents = g.initial_budget_cents, votes = 0 where game_id = g.id;
  delete from image_versions where game_id = g.id and not (id = any (v_keep));
  delete from bids where auction_id in (select id from auctions where game_id = g.id);
  delete from purchases where game_id = g.id;
  delete from auctions where game_id = g.id;
  update auction_items set status = 'available' where game_id = g.id;
  delete from idempotency_keys where game_id = g.id;
  delete from game_events where game_id = g.id;
  update games set status = 'lobby', finished_at = null, gallery_closed_at = null, auto_run_since = null, auto_run_skips = 0 where id = g.id;
  perform ss_log(g.id, g.host_id, 'game_reset', '{}'::jsonb);
  perform ss_touch(g.id);
  return jsonb_build_object('ok', true, 'storage_paths', v_paths);
end $$;
