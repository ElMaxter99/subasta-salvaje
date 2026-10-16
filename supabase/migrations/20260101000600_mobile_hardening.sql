-- Endurecimiento del modo móviles (revisión de seguridad): los tokens de jugador caducan al finalizar la partida.
-- Ejecutar DESPUÉS de 20260101000400_mobile_players.sql.

create or replace function ss_game_status(p jsonb) returns jsonb language plpgsql as $$
declare g games; v_action text := p->>'action'; n_players int; n_items int; a auctions;
begin
  g := ss_lock_game(p->>'room_code', (p->>'host_id')::uuid);

  if v_action = 'start' then
    if g.status <> 'lobby' then perform ss_err('game_already_started'); end if;
    select count(*) into n_players from players where game_id = g.id;
    select count(*) into n_items from auction_items where game_id = g.id;
    if n_players < 2 then perform ss_err('not_enough_players'); end if;
    if n_items < 1 then perform ss_err('no_items'); end if;
    update players set initial_image_version_id = current_image_version_id where game_id = g.id;
    update games set status = 'active' where id = g.id;
  elsif v_action = 'pause' then
    if g.status <> 'active' then perform ss_err('invalid_game_state'); end if;
    update games set status = 'paused' where id = g.id;
  elsif v_action = 'resume' then
    if g.status <> 'paused' then perform ss_err('invalid_game_state'); end if;
    update games set status = 'active' where id = g.id;
  elsif v_action = 'finish' then
    if g.status = 'lobby' then perform ss_err('game_not_started'); end if;
    if g.status = 'finished' then
      return jsonb_build_object('ok', true, 'replay', true);
    end if;
    -- Una subasta viva se cancela sin tocar saldos.
    select * into a from auctions where id = g.current_auction_id and status in ('open','closed') for update;
    if found then
      update auctions set status = 'cancelled', closed_at = now() where id = a.id;
      update auction_items set status = 'available' where id = a.auction_item_id;
      update games set current_auction_id = null where id = g.id;
    end if;
    update games set status = 'finished', finished_at = now() where id = g.id;
    -- Al terminar, los móviles pierden su identidad (los tokens no deben valer para siempre).
    update players set token_hash = null where game_id = g.id;
  else
    perform ss_err('invalid_action');
  end if;

  perform ss_log(g.id, g.host_id, 'game_' || v_action, '{}'::jsonb);
  perform ss_touch(g.id);
  return jsonb_build_object('ok', true);
end $$;
