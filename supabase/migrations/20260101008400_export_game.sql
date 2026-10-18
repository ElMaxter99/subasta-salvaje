-- Exportación completa de una partida (derecho de acceso a datos del anfitrión). SOLO LECTURA: sin bloqueos ni efectos.
-- p: { room_code, host_id }. Errores: game_not_found, not_host. Nunca devuelve hashes de token de jugador ni ids de anfitrión.
create or replace function ss_export_game(p jsonb) returns jsonb language plpgsql stable as $$
declare g games;
begin
  select * into g from games where room_code = upper(coalesce(p->>'room_code', ''));
  if not found then raise exception 'ERR:game_not_found'; end if;
  if nullif(p->>'host_id', '') is null or g.host_id <> (p->>'host_id')::uuid then raise exception 'ERR:not_host'; end if;
  return jsonb_build_object(
    'game', to_jsonb(g) - 'host_id',
    'players', coalesce((select jsonb_agg(to_jsonb(x) - 'token_hash' order by x.sort_order, x.created_at) from players x where x.game_id = g.id), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(to_jsonb(x) order by x.sort_order, x.created_at) from auction_items x where x.game_id = g.id), '[]'::jsonb),
    'auctions', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from auctions x where x.game_id = g.id), '[]'::jsonb),
    'bids', coalesce((select jsonb_agg(to_jsonb(b) - 'created_by_host_id' order by b.created_at)
                      from bids b join auctions a on a.id = b.auction_id where a.game_id = g.id), '[]'::jsonb),
    'purchases', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from purchases x where x.game_id = g.id), '[]'::jsonb),
    'image_versions', coalesce((select jsonb_agg(to_jsonb(x) - 'error_message' order by x.created_at) from image_versions x where x.game_id = g.id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(to_jsonb(e) - 'actor_id' order by e.id)
                        from (select * from game_events where game_id = g.id order by id desc limit 5000) e), '[]'::jsonb)
  );
end $$;
