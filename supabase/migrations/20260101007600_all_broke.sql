-- Fin de partida por falta de saldo: si TODOS los jugadores (en modo móviles, los que han entrado alguna vez) se han quedado sin saldo para pujar
-- siquiera la puja mínima, la partida termina aunque queden rondas. Se guarda el motivo (games.finish_reason = 'all_broke') para que la TV,
-- el panel y los móviles lo expliquen. Comprobación: ss_auto_run_tick (lo mueve cualquier lectura, con la pausa de 8 s para ver la última adjudicación) y ss_announce.
alter table games add column if not exists finish_reason text check (finish_reason is null or finish_reason in ('all_broke'));

-- «Reiniciar partida» (vuelta a la sala de espera) borra el motivo de fin; un disparador evita tocar ss_reset_game.
create or replace function ss_clear_finish_reason() returns trigger language plpgsql as $$
begin
  if new.status = 'lobby' and old.status is distinct from 'lobby' then new.finish_reason := null; end if;
  return new;
end $$;
drop trigger if exists games_clear_finish_reason on games;
create trigger games_clear_finish_reason before update of status on games for each row execute function ss_clear_finish_reason();

create or replace function ss_all_broke(g games) returns boolean language sql stable as $$
  select exists (select 1 from players p where p.game_id = g.id and (g.play_mode <> 'mobile' or p.joined_at is not null))
     and not exists (select 1 from players p where p.game_id = g.id and (g.play_mode <> 'mobile' or p.joined_at is not null) and p.balance_cents >= g.min_bid_cents);
$$;

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

  -- Todos los jugadores se han quedado sin saldo (nadie puede pujar ni el mínimo): la partida termina aunque queden rondas.
  if (a.id is null or (a.status = 'open' and a.current_bidder_id is null)) and ss_all_broke(g)
     and now() >= coalesce(v_last_award, now()) + interval '8 seconds' then
    perform ss_finish_game_internal(g);
    update games set finish_reason = 'all_broke' where id = g.id;
    perform ss_log(g.id, null, 'game_finish_all_broke', jsonb_build_object('min_bid_cents', g.min_bid_cents));
    perform ss_touch(g.id);
    return jsonb_build_object('changed', true, 'action', 'finished', 'reason', 'all_broke');
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
  update auctions set picked_random = coalesce(g.auto_run_random, false) where id = (select current_auction_id from games where id = g.id);
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
  -- Nadie puede pujar ya (todos sin saldo): en vez de anunciar se termina la partida.
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
  insert into auctions (game_id, auction_item_id, round_number, wild_event) values (g.id, it.id, v_round, v_wild) returning id into a_id;
  update auction_items set status = 'in_auction' where id = it.id;
  update games set current_auction_id = a_id where id = g.id;

  perform ss_log(g.id, g.host_id, 'auction_announced', jsonb_build_object('auction_id', a_id, 'item_id', it.id, 'item', it.name, 'wild_event', v_wild));
  perform ss_touch(g.id);
  return jsonb_build_object('ok', true, 'auction_id', a_id, 'wild_event', v_wild);
end $$;

alter function ss_get_state(jsonb) rename to ss_get_state_pre_allbroke;

create or replace function ss_get_state(p jsonb) returns jsonb language plpgsql stable as $$
declare res jsonb; g games;
begin
  res := ss_get_state_pre_allbroke(p);
  select * into g from games where room_code = upper(coalesce(p->>'room_code', ''));
  return jsonb_set(res, '{game}', (res->'game') || jsonb_build_object('finish_reason', g.finish_reason));
end $$;
