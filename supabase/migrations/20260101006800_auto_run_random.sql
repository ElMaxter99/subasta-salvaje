-- Subasta automática con ORDEN ALEATORIO opcional: en vez de seguir el orden del catálogo, el servidor elige al azar entre los elementos
-- disponibles. Se guarda en games.auto_run_random y se expone en la instantánea (game.auto_run_random).
alter table games add column if not exists auto_run_random boolean not null default false;

create or replace function ss_set_auto_run(p jsonb) returns jsonb language plpgsql as $$
declare g games; v_gap int := coalesce((p->>'gap_seconds')::int, 10); v_idle int := coalesce((p->>'idle_seconds')::int, 60);
        v_on boolean := coalesce((p->>'enabled')::boolean, false); v_award int; v_rand boolean;
begin
  g := ss_lock_game(p->>'room_code', (p->>'host_id')::uuid);
  if g.status = 'finished' then perform ss_err('game_finished'); end if;
  if v_gap < 3 or v_gap > 300 or v_idle < 10 or v_idle > 600 then perform ss_err('invalid_input'); end if;
  v_award := coalesce((p->>'auto_award_seconds')::int, g.auto_award_seconds);
  v_rand := coalesce((p->>'random')::boolean, g.auto_run_random);
  if v_award < 3 or v_award > 300 then perform ss_err('invalid_input'); end if;
  update games set auto_run_enabled = v_on, auto_run_gap_seconds = v_gap, auto_run_idle_seconds = v_idle, auto_run_skips = 0, auto_run_random = v_rand,
         auto_run_since = case when v_on then now() else auto_run_since end,
         auto_award_enabled = case when v_on then true else auto_award_enabled end,
         auto_award_seconds = case when v_on then v_award else auto_award_seconds end
   where id = g.id;
  if v_on then
    update auctions set timer_reset_at = clock_timestamp() where id = g.current_auction_id and status = 'open';
  end if;
  perform ss_log(g.id, g.host_id, case when v_on then 'auto_run_started' else 'auto_run_stopped' end,
                 jsonb_build_object('gap_seconds', v_gap, 'idle_seconds', v_idle, 'auto_award_seconds', v_award, 'random', v_rand));
  perform ss_touch(g.id);
  return jsonb_build_object('ok', true);
end $$;

create or replace function ss_auto_run_tick(p jsonb) returns jsonb language plpgsql as $$
declare
  g games; a auctions; it auction_items; v_awarded int; v_anchor timestamptz; v_avail int; v_last_award timestamptz;
begin
  g := ss_lock_game_public(p->>'room_code');
  if g.status <> 'active' then return jsonb_build_object('changed', false); end if;
  select count(*) into v_awarded from auctions where game_id = g.id and status = 'awarded';
  select * into a from auctions where game_id = g.id and status in ('open','closed') limit 1;
  select max(closed_at) into v_last_award from auctions where game_id = g.id and status = 'awarded';

  if a.id is null and g.max_rounds is not null and v_awarded >= g.max_rounds and now() >= coalesce(v_last_award, now()) + interval '8 seconds' then
    perform ss_finish_game_internal(g);
    perform ss_log(g.id, null, 'game_finish_rounds', jsonb_build_object('max_rounds', g.max_rounds));
    perform ss_touch(g.id);
    return jsonb_build_object('changed', true, 'action', 'finished');
  end if;

  if not g.auto_run_enabled then return jsonb_build_object('changed', false); end if;

  if a.id is not null then
    if a.status = 'open' and a.current_bidder_id is null and now() >= a.opened_at + make_interval(secs => g.auto_run_idle_seconds) then
      update auctions set status = 'cancelled', closed_at = now() where id = a.id;
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

alter function ss_get_state(jsonb) rename to ss_get_state_pre_autorandom;

create or replace function ss_get_state(p jsonb) returns jsonb language plpgsql stable as $$
declare res jsonb; g games;
begin
  res := ss_get_state_pre_autorandom(p);
  select * into g from games where room_code = upper(coalesce(p->>'room_code', ''));
  return jsonb_set(res, '{game}', (res->'game') || jsonb_build_object('auto_run_random', g.auto_run_random));
end $$;
