-- Unión de ramas: la migración 8100 (reglas) redefinió ss_announce a partir de una versión anterior a la 7600 y perdió la comprobación de
-- «todos sin saldo». Se restaura aquí sobre la versión de 8100 (que añade los eventos relámpago y sobre cerrado).
create or replace function ss_announce(p jsonb) returns jsonb language plpgsql as $$
declare g games; it auction_items; a_id uuid; v_round int; v_wild text := nullif(p->>'wild_event', '');
begin
  g := ss_lock_game(p->>'room_code', (p->>'host_id')::uuid);
  if g.status = 'paused' then perform ss_err('game_paused'); end if;
  if g.status <> 'active' then perform ss_err('game_not_active'); end if;
  if v_wild is not null and v_wild not in ('blind','double','flash','sealed','none') then perform ss_err('invalid_input'); end if;
  -- Rondas agotadas: en vez de anunciar se termina la partida («sí o sí»).
  if g.max_rounds is not null and ss_rounds_done(g.id) >= g.max_rounds then
    perform ss_finish_game_internal(g);
    perform ss_log(g.id, g.host_id, 'game_finish_rounds', jsonb_build_object('max_rounds', g.max_rounds));
    perform ss_touch(g.id);
    return jsonb_build_object('ok', true, 'finished', true, 'reason', 'rounds_completed');
  end if;
  -- Nadie puede pujar ya (todos sin saldo): en vez de anunciar se termina la partida (regla de la migración 7600, que 8100 había pisado).
  if ss_all_broke(g) then
    perform ss_finish_game_internal(g);
    update games set finish_reason = 'all_broke' where id = g.id;
    perform ss_log(g.id, g.host_id, 'game_finish_all_broke', jsonb_build_object('min_bid_cents', g.min_bid_cents));
    perform ss_touch(g.id);
    return jsonb_build_object('ok', true, 'finished', true, 'reason', 'all_broke');
  end if;
  if exists (select 1 from auctions where game_id = g.id and status in ('open','closed')) then
    perform ss_err('auction_in_progress');
  end if;
  select * into it from auction_items where id = (p->>'item_id')::uuid and game_id = g.id for update;
  if not found then perform ss_err('item_not_found'); end if;
  if it.status <> 'available' then perform ss_err('item_not_available'); end if;

  -- Sin evento indicado: sorteo según la probabilidad configurada (0 = nunca). «none» = subasta normal.
  if v_wild is null and g.wild_chance_pct > 0 and random() * 100 < g.wild_chance_pct then
    v_wild := (array['blind','double'])[1 + floor(random() * 2)::int];
  end if;
  if v_wild = 'none' then v_wild := null; end if;

  select count(*) + 1 into v_round from auctions where game_id = g.id;
  insert into auctions (game_id, auction_item_id, round_number, wild_event, auto_seconds_override)
  values (g.id, it.id, v_round, v_wild, case when v_wild = 'flash' then 8 end) returning id into a_id;
  update auction_items set status = 'in_auction' where id = it.id;
  update games set current_auction_id = a_id where id = g.id;

  perform ss_log(g.id, g.host_id, 'auction_announced', jsonb_build_object('auction_id', a_id, 'item_id', it.id, 'item', it.name, 'wild_event', v_wild));
  perform ss_touch(g.id);
  return jsonb_build_object('ok', true, 'auction_id', a_id, 'wild_event', v_wild);
end $$;
