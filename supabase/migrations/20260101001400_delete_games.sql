-- =============================================================================
-- Borrado de partidas: manual (anfitrión) y automático por inactividad.
-- Las tablas hijas se eliminan en cascada (jugadores, elementos, subastas, pujas, compras, versiones de imagen,
-- trabajos, eventos, claves de idempotencia y uso de cuota). Los ARCHIVOS de Storage los borra el servidor
-- después (games/<id>/…). Ejecutar DESPUÉS de 20260101001200_image_mode.sql.
-- =============================================================================

-- Borra una partida en orden de dependencias (varias FK no tienen ON DELETE CASCADE entre tablas hijas).
create or replace function ss_wipe_game(p_game uuid) returns void language plpgsql as $$
begin
  update games set current_auction_id = null where id = p_game;
  delete from image_jobs where game_id = p_game;
  update players set current_image_version_id = null, initial_image_version_id = null where game_id = p_game;
  delete from image_versions where game_id = p_game;
  delete from bids where auction_id in (select id from auctions where game_id = p_game);
  delete from purchases where game_id = p_game;
  update auctions set current_bidder_id = null, winner_id = null where game_id = p_game;
  delete from auctions where game_id = p_game;
  delete from players where game_id = p_game;
  delete from games where id = p_game; -- el resto (elementos, eventos, claves, cuota) cae en cascada
end $$;

-- Borrado por el anfitrión (comprueba propiedad). Devuelve el id para limpiar Storage.
create or replace function ss_delete_game(p jsonb) returns jsonb language plpgsql as $$
declare g games;
begin
  g := ss_lock_game(p->>'room_code', (p->>'host_id')::uuid);
  perform ss_wipe_game(g.id);
  return jsonb_build_object('ok', true, 'game_id', g.id);
end $$;

-- Partidas sin actividad desde hace más de N horas (updated_at cambia con cada acción de la partida).
create or replace function ss_expired_games(p jsonb) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'room_code', e.room_code)), '[]'::jsonb)
  from (select id, room_code from games
        where updated_at < now() - make_interval(hours => coalesce((p->>'hours')::int, 12))
        order by updated_at limit coalesce((p->>'limit')::int, 20)) e;
$$;

-- Borra UNA partida caducada, volviendo a comprobar con el bloqueo (otra petición pudo reactivarla).
create or replace function ss_purge_expired_game(p jsonb) returns jsonb language plpgsql as $$
declare g games;
begin
  select * into g from games where id = (p->>'game_id')::uuid for update skip locked;
  if not found then return jsonb_build_object('deleted', false); end if;
  if g.updated_at >= now() - make_interval(hours => coalesce((p->>'hours')::int, 12)) then
    return jsonb_build_object('deleted', false);
  end if;
  perform ss_wipe_game(g.id);
  return jsonb_build_object('deleted', true, 'game_id', g.id);
end $$;

-- Fecha de la última actividad (para mostrar «se borrará el …» en el panel).
create or replace function ss_game_activity(p jsonb) returns jsonb language sql stable as $$
  select jsonb_build_object('updated_at', (select updated_at from games where room_code = upper(coalesce(p->>'room_code', ''))));
$$;
