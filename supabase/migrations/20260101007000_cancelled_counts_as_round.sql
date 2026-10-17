-- Una subasta CANCELADA (por el anfitrión o porque nadie pujó en la subasta automática) cuenta como ronda terminada, para que la partida
-- pueda acabar de forma natural al agotar las rondas. Las canceladas por «deshacer adjudicación» NO cuentan (esa ronda vuelve a jugarse).
alter table auctions add column if not exists counted boolean not null default false;

create or replace function ss_rounds_done(p_game uuid) returns int language sql stable as $$
  select count(*)::int from auctions where game_id = p_game and (status = 'awarded' or (status = 'cancelled' and counted));
$$;

create or replace function ss_auction_state(p jsonb) returns jsonb language plpgsql as $$
declare g games; a auctions; v_action text := p->>'action';
begin
  g := ss_lock_game(p->>'room_code', (p->>'host_id')::uuid);

  if v_action = 'clear' then
    if g.current_auction_id is null then return jsonb_build_object('ok', true, 'replay', true); end if;
    select * into a from auctions where id = g.current_auction_id;
    if a.status in ('open','closed') then perform ss_err('auction_in_progress'); end if;
    update games set current_auction_id = null where id = g.id;
    perform ss_log(g.id, g.host_id, 'auction_cleared', jsonb_build_object('auction_id', a.id));
    perform ss_touch(g.id);
    return jsonb_build_object('ok', true);
  end if;

  select * into a from auctions where id = (p->>'auction_id')::uuid and game_id = g.id for update;
  if not found then perform ss_err('auction_not_found'); end if;

  if v_action = 'close' then
    if a.status = 'closed' then return jsonb_build_object('ok', true, 'replay', true); end if;
    if a.status <> 'open' then perform ss_err('auction_closed'); end if;
    update auctions set status = 'closed', closed_at = now() where id = a.id;
  elsif v_action = 'reopen' then
    if a.status = 'open' then return jsonb_build_object('ok', true, 'replay', true); end if;
    if a.status <> 'closed' then perform ss_err('auction_closed'); end if;
    update auctions set status = 'open', closed_at = null, timer_reset_at = clock_timestamp() where id = a.id;
  elsif v_action = 'cancel' then
    if a.status = 'cancelled' then return jsonb_build_object('ok', true, 'replay', true); end if;
    if a.status not in ('open','closed') then perform ss_err('auction_closed'); end if;
    update auctions set status = 'cancelled', closed_at = now(), counted = true where id = a.id;
    -- Sin ninguna puja válida el elemento se da por PERDIDO (nadie lo quiere): no vuelve a salir en otra ronda. Con pujas, vuelve al catálogo.
    if exists (select 1 from bids where auction_id = a.id and voided_at is null) then
      update auction_items set status = 'available' where id = a.auction_item_id;
    else
      update auction_items set status = 'lost' where id = a.auction_item_id;
      perform ss_log(g.id, g.host_id, 'auction_unsold', jsonb_build_object('auction_id', a.id, 'item_id', a.auction_item_id));
    end if;
    update games set current_auction_id = null where id = g.id and current_auction_id = a.id;
  else
    perform ss_err('invalid_action');
  end if;

  perform ss_log(g.id, g.host_id, 'auction_' || v_action, jsonb_build_object('auction_id', a.id));
  perform ss_touch(g.id);
  return jsonb_build_object('ok', true);
end $$;

create or replace function ss_auto_run_tick(p jsonb) returns jsonb language plpgsql as $$
declare
  g games; a auctions; it auction_items; v_awarded int; v_anchor timestamptz; v_avail int; v_last_award timestamptz;
begin
  g := ss_lock_game_public(p->>'room_code');
  if g.status <> 'active' then return jsonb_build_object('changed', false); end if;
  v_awarded := ss_rounds_done(g.id);
  select * into a from auctions where game_id = g.id and status in ('open','closed') limit 1;
  select max(closed_at) into v_last_award from auctions where game_id = g.id and (status = 'awarded' or (status = 'cancelled' and counted));

  if a.id is null and g.max_rounds is not null and v_awarded >= g.max_rounds and now() >= coalesce(v_last_award, now()) + interval '8 seconds' then
    perform ss_finish_game_internal(g);
    perform ss_log(g.id, null, 'game_finish_rounds', jsonb_build_object('max_rounds', g.max_rounds));
    perform ss_touch(g.id);
    return jsonb_build_object('changed', true, 'action', 'finished');
  end if;

  if not g.auto_run_enabled then return jsonb_build_object('changed', false); end if;

  if a.id is not null then
    if a.status = 'open' and a.current_bidder_id is null and now() >= a.opened_at + make_interval(secs => g.auto_run_idle_seconds) then
      update auctions set status = 'cancelled', closed_at = now(), counted = true where id = a.id;
      -- Nadie pujó en el tiempo de espera: el elemento se da por PERDIDO y no vuelve a salir. Cuando no quedan elementos disponibles,
      -- el siguiente ciclo termina la partida (items_exhausted).
      update auction_items set status = 'lost' where id = a.auction_item_id;
      update games set current_auction_id = null, auto_run_skips = auto_run_skips + 1 where id = g.id;
      perform ss_log(g.id, null, 'auction_unsold', jsonb_build_object('auction_id', a.id, 'item_id', a.auction_item_id, 'reason', 'idle'));
      perform ss_touch(g.id);
      return jsonb_build_object('changed', true, 'action', 'skipped');
    end if;
    return jsonb_build_object('changed', false);
  end if;

  v_anchor := greatest(coalesce((select max(closed_at) from auctions where game_id = g.id and status in ('awarded','cancelled')), '-infinity'::timestamptz),
                       coalesce(g.auto_run_since, '-infinity'::timestamptz));
  if now() < v_anchor + make_interval(secs => g.auto_run_gap_seconds) then return jsonb_build_object('changed', false); end if;

  select * into it from auction_items where game_id = g.id and status = 'available' order by (case when g.auto_run_random then random() end), sort_order, created_at limit 1;
  if not found then
    perform ss_finish_game_internal(g);
    perform ss_log(g.id, null, 'game_finish_rounds', jsonb_build_object('reason', 'items_exhausted'));
    perform ss_touch(g.id);
    return jsonb_build_object('changed', true, 'action', 'finished');
  end if;
  perform ss_announce(jsonb_build_object('room_code', g.room_code, 'host_id', g.host_id, 'item_id', it.id));
  return jsonb_build_object('changed', true, 'action', 'announced');
end $$;

create or replace function ss_announce(p jsonb) returns jsonb language plpgsql as $$
declare g games; it auction_items; a_id uuid; v_round int; v_wild text := nullif(p->>'wild_event', '');
begin
  g := ss_lock_game(p->>'room_code', (p->>'host_id')::uuid);
  if g.status = 'paused' then perform ss_err('game_paused'); end if;
  if g.status <> 'active' then perform ss_err('game_not_active'); end if;
  if v_wild is not null and v_wild not in ('blind','double','none') then perform ss_err('invalid_input'); end if;
  -- Rondas agotadas: en vez de anunciar se termina la partida («sí o sí»).
  if g.max_rounds is not null and ss_rounds_done(g.id) >= g.max_rounds then
    perform ss_finish_game_internal(g);
    perform ss_log(g.id, g.host_id, 'game_finish_rounds', jsonb_build_object('max_rounds', g.max_rounds));
    perform ss_touch(g.id);
    return jsonb_build_object('ok', true, 'finished', true, 'reason', 'rounds_completed');
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
  insert into auctions (game_id, auction_item_id, round_number, wild_event) values (g.id, it.id, v_round, v_wild) returning id into a_id;
  update auction_items set status = 'in_auction' where id = it.id;
  update games set current_auction_id = a_id where id = g.id;

  perform ss_log(g.id, g.host_id, 'auction_announced', jsonb_build_object('auction_id', a_id, 'item_id', it.id, 'item', it.name, 'wild_event', v_wild));
  perform ss_touch(g.id);
  return jsonb_build_object('ok', true, 'auction_id', a_id, 'wild_event', v_wild);
end $$;

create or replace function ss_set_game_rules(p jsonb) returns jsonb language plpgsql as $$
declare g games; v_rounds int; v_done int; v_max int; v_items int;
begin
  g := ss_lock_game(p->>'room_code', (p->>'host_id')::uuid);
  if g.status = 'finished' then perform ss_err('game_finished'); end if;
  v_done := ss_rounds_done(g.id);
  select count(*) into v_items from auction_items where game_id = g.id;
  if p ? 'max_rounds' then
    -- null/ausente = todos los elementos del catálogo
    v_rounds := coalesce(nullif(p->>'max_rounds', '')::int, v_items);
    if v_rounds < 1 or v_rounds > 500 then perform ss_err('invalid_input'); end if;
    if v_rounds > v_items then perform ss_err('rounds_above_catalog'); end if;
    if v_rounds < v_done then perform ss_err('rounds_below_played'); end if;
    update games set max_rounds = v_rounds where id = g.id;
  end if;
  if p ? 'max_players' then
    v_max := (p->>'max_players')::int;
    if v_max < 1 or v_max > ss_max_players_cap() then perform ss_err('invalid_input'); end if;
    if v_max < (select count(*) from players where game_id = g.id) then perform ss_err('max_players_below_current'); end if;
    update games set max_players = v_max where id = g.id;
  end if;
  if p ? 'integer_bids' then
    update games set integer_bids = (p->>'integer_bids')::boolean where id = g.id;
  end if;
  perform ss_log(g.id, g.host_id, 'rules_changed', jsonb_build_object('max_rounds', p->>'max_rounds', 'integer_bids', p->>'integer_bids', 'max_players', p->>'max_players'));
  perform ss_touch(g.id);
  return jsonb_build_object('ok', true);
end $$;

-- Estado: rondas jugadas = adjudicadas + canceladas que cuentan; sin cuenta atrás de «siguiente subasta» si ya no quedan rondas.
alter function ss_get_state(jsonb) rename to ss_get_state_pre_roundsdone;

create or replace function ss_get_state(p jsonb) returns jsonb language plpgsql stable as $$
declare res jsonb; g games; v_done int; v_total int;
begin
  res := ss_get_state_pre_roundsdone(p);
  select * into g from games where room_code = upper(coalesce(p->>'room_code', ''));
  v_done := ss_rounds_done(g.id);
  v_total := (res->'game'->>'total_rounds')::int;
  res := jsonb_set(res, '{game}', (res->'game') || jsonb_build_object('rounds_completed', v_done));
  if v_total is not null and v_done >= v_total then
    res := jsonb_set(res, '{game}', (res->'game') || jsonb_build_object('auto_run_next_at', null));
  end if;
  return res;
end $$;
