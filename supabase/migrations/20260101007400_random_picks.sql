-- Subastas «sorteadas»: las anunciadas con «Anunciar uno al azar» o por la subasta automática en modo aleatorio llevan picked_random = true,
-- y la instantánea lo expone en auction.random para que la TV y el panel suenen como un sorteo (dado) y lo indiquen.
alter table auctions add column if not exists picked_random boolean not null default false;

-- Anunciar un elemento DISPONIBLE al azar (el aleatorio lo decide el servidor) y marcar la subasta como «sorteada».
create or replace function ss_announce_random(p jsonb) returns jsonb language plpgsql as $$
declare g games; v_item uuid; r jsonb;
begin
  g := ss_lock_game(p->>'room_code', (p->>'host_id')::uuid);
  select id into v_item from auction_items where game_id = g.id and status = 'available' order by random() limit 1;
  if v_item is null then perform ss_err('no_items_left'); end if;
  r := ss_announce(p || jsonb_build_object('item_id', v_item));
  update auctions set picked_random = true where id = (select current_auction_id from games where id = g.id) and status = 'open';
  return r;
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
  update auctions set picked_random = coalesce(g.auto_run_random, false) where id = (select current_auction_id from games where id = g.id);
  return jsonb_build_object('changed', true, 'action', 'announced');
end $$;

alter function ss_get_state(jsonb) rename to ss_get_state_pre_random;

create or replace function ss_get_state(p jsonb) returns jsonb language plpgsql stable as $$
declare res jsonb; v_rand boolean;
begin
  res := ss_get_state_pre_random(p);
  if res->'auction' is not null and jsonb_typeof(res->'auction') = 'object' and (res->'auction'->>'id') is not null then
    select picked_random into v_rand from auctions where id = (res->'auction'->>'id')::uuid;
    res := jsonb_set(res, '{auction}', (res->'auction') || jsonb_build_object('random', coalesce(v_rand, false)));
  end if;
  return res;
end $$;
