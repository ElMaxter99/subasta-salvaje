-- =============================================================================
-- Reglas de partida y subasta automática (ejecutar DESPUÉS de 20260101002500_security_item_images.sql):
--   · máximo de rondas (por defecto, los elementos del catálogo): al agotarse la partida termina sola;
--   · pujas solo en euros enteros (por defecto; se puede desactivar para pujar 1,50 €…);
--   · no se puede empezar sin imagen inicial (obligatoria);
--   · «Subasta automática»: anuncia por orden los elementos disponibles, adjudica sola y espera un tiempo configurable
--     entre subastas (con avance de seguridad si nadie puja).
-- =============================================================================

alter table games add column max_rounds integer check (max_rounds is null or max_rounds between 1 and 500);
alter table games add column integer_bids boolean not null default true;
alter table games add column auto_run_enabled boolean not null default false;
alter table games add column auto_run_gap_seconds integer not null default 10 check (auto_run_gap_seconds between 3 and 300);
alter table games add column auto_run_idle_seconds integer not null default 60 check (auto_run_idle_seconds between 10 and 600);
alter table games add column auto_run_since timestamptz;
alter table games add column auto_run_skips integer not null default 0;

-- Termina la partida (lo usan «finalizar», el límite de rondas y la subasta automática).
create or replace function ss_finish_game_internal(g games) returns void language plpgsql as $$
declare a auctions;
begin
  -- Una subasta viva se cancela sin tocar saldos.
  select * into a from auctions where id = g.current_auction_id and status in ('open','closed') for update;
  if found then
    update auctions set status = 'cancelled', closed_at = now() where id = a.id;
    update auction_items set status = 'available' where id = a.auction_item_id;
    update games set current_auction_id = null where id = g.id;
  end if;
  update games set status = 'finished', finished_at = now(), auto_run_enabled = false where id = g.id;
  -- Partida sin móviles: no hay galería que votar, así que no queda ninguna identidad.
  if g.play_mode <> 'mobile' then update players set token_hash = null where game_id = g.id; end if;
end $$;

create or replace function ss_bid_internal(g games, p jsonb, p_player uuid, p_source text) returns jsonb language plpgsql as $$
declare
  a auctions; pl players; replay jsonb; v_amount int; v_key text; v_bid uuid; res jsonb;
begin
  v_key := p->>'idempotency_key';
  replay := ss_idem_get(g.id, v_key, 'place_bid');
  if replay is not null then return replay || jsonb_build_object('replay', true); end if;

  v_amount := (p->>'amount_cents')::int;
  if v_amount is null or v_amount <= 0 then perform ss_err('invalid_amount'); end if;
  -- Solo euros enteros (por defecto): 1, 2, 3… €. Desactivado en la partida permite 1,50 €, etc.
  if g.integer_bids and v_amount % 100 <> 0 then perform ss_err('bid_not_whole'); end if;
  if g.status = 'paused' then perform ss_err('game_paused'); end if;
  if g.status <> 'active' then perform ss_err('game_not_active'); end if;

  select * into a from auctions where id = (p->>'auction_id')::uuid and game_id = g.id for update;
  if not found then perform ss_err('auction_not_found'); end if;
  if a.status <> 'open' then perform ss_err('auction_closed'); end if;

  select * into pl from players where id = p_player and game_id = g.id for update;
  if not found then perform ss_err('player_not_found'); end if;

  if v_amount > pl.balance_cents then perform ss_err('insufficient_balance'); end if;
  if v_amount < g.min_bid_cents then perform ss_err('bid_below_minimum'); end if;
  if v_amount <= a.current_bid_cents then perform ss_err('bid_too_low'); end if;
  -- Un jugador no puja contra sí mismo desde el móvil (evita subir la puja por error).
  if p_source = 'player' and a.current_bidder_id = pl.id then perform ss_err('already_leading'); end if;

  insert into bids (auction_id, player_id, amount_cents, created_by_host_id, source)
  values (a.id, pl.id, v_amount, g.host_id, p_source) returning id into v_bid;
  update auctions set current_bid_cents = v_amount, current_bidder_id = pl.id where id = a.id;

  perform ss_log(g.id, case when p_source = 'host' then g.host_id else null end, 'bid_placed',
    jsonb_build_object('bid_id', v_bid, 'auction_id', a.id, 'player_id', pl.id, 'amount_cents', v_amount, 'source', p_source));
  res := jsonb_build_object('ok', true, 'bid_id', v_bid);
  -- Adjudicación AUTOMÁTICA instantánea: si nadie más puede superar la puja, se adjudica ya.
  if g.auto_award_enabled and not exists (
       select 1 from players where game_id = g.id and id <> pl.id and balance_cents > v_amount) then
    select * into a from auctions where id = a.id;
    res := res || ss_award_core(g, a, 'auto') || jsonb_build_object('auto_awarded', true, 'auto_reason', 'nobody_can_outbid');
  else
    perform ss_touch(g.id);
  end if;
  perform ss_idem_put(g.id, v_key, 'place_bid', res);
  return res;
end $$;

create or replace function ss_award_core(g games, a auctions, p_source text) returns jsonb language plpgsql as $$
declare pl players; pur purchases; v_job uuid; v_charge int; v_outcome text;
begin
  if g.status = 'paused' then perform ss_err('game_paused'); end if;
  if g.status <> 'active' then perform ss_err('game_not_active'); end if;
  if a.status not in ('open','closed') then perform ss_err('auction_closed'); end if;
  if a.current_bidder_id is null then perform ss_err('no_bids'); end if;

  select * into pl from players where id = a.current_bidder_id and game_id = g.id for update;
  if not found then perform ss_err('player_not_found'); end if;
  if pl.balance_cents < a.current_bid_cents then perform ss_err('insufficient_balance'); end if;

  v_charge := a.current_bid_cents;
  if a.wild_event = 'double' then
    if random() < 0.5 then
      v_outcome := 'half';
      v_charge := case when g.integer_bids then (a.current_bid_cents / 200) * 100 else a.current_bid_cents / 2 end;
    else
      v_outcome := 'double';
      v_charge := least(a.current_bid_cents * 2, pl.balance_cents);
    end if;
    update auctions set wild_note = jsonb_build_object('outcome', v_outcome, 'bid_cents', a.current_bid_cents, 'charged_cents', v_charge) where id = a.id;
  end if;

  update auctions set status = 'awarded', winner_id = pl.id, final_price_cents = a.current_bid_cents,
         closed_at = coalesce(closed_at, now()) where id = a.id;
  update players set balance_cents = balance_cents - v_charge where id = pl.id;
  insert into purchases (game_id, player_id, auction_id, auction_item_id, price_cents)
  values (g.id, pl.id, a.id, a.auction_item_id, v_charge) returning * into pur;
  update auction_items set status = 'sold' where id = a.auction_item_id;
  insert into image_jobs (game_id, kind, player_id, purchase_id, base_image_version_id)
  values (g.id, 'edit', pl.id, pur.id, pl.current_image_version_id) returning id into v_job;
  update games set auto_run_skips = 0 where id = g.id;

  perform ss_log(g.id, case when p_source = 'host' then g.host_id else null end, 'auction_awarded',
    jsonb_build_object('auction_id', a.id, 'purchase_id', pur.id, 'player_id', pl.id,
                       'price_cents', v_charge, 'bid_cents', a.current_bid_cents, 'wild_event', a.wild_event,
                       'wild_outcome', v_outcome, 'job_id', v_job, 'source', p_source));
  perform ss_touch(g.id);
  return jsonb_build_object('ok', true, 'purchase_id', pur.id, 'job_id', v_job, 'source', p_source,
                            'charged_cents', v_charge, 'wild_outcome', v_outcome);
end $$;

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
    -- Imagen inicial OBLIGATORIA: todos los jugadores deben tener la casa de partida (subida, de la galería o generada).
    if exists (select 1 from players where game_id = g.id and current_image_version_id is null) then perform ss_err('initial_image_required'); end if;
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
    perform ss_finish_game_internal(g);
  else
    perform ss_err('invalid_action');
  end if;

  perform ss_log(g.id, g.host_id, 'game_' || v_action, '{}'::jsonb);
  perform ss_touch(g.id);
  return jsonb_build_object('ok', true);
end $$;

create or replace function ss_announce(p jsonb) returns jsonb language plpgsql as $$
declare g games; it auction_items; a_id uuid; v_round int; v_wild text := nullif(p->>'wild_event', '');
begin
  g := ss_lock_game(p->>'room_code', (p->>'host_id')::uuid);
  if g.status = 'paused' then perform ss_err('game_paused'); end if;
  if g.status <> 'active' then perform ss_err('game_not_active'); end if;
  if v_wild is not null and v_wild not in ('blind','double','none') then perform ss_err('invalid_input'); end if;
  -- Rondas agotadas: en vez de anunciar se termina la partida («sí o sí»).
  if g.max_rounds is not null and (select count(*) from auctions where game_id = g.id and status = 'awarded') >= g.max_rounds then
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
declare g games; v_rounds int; v_done int;
begin
  g := ss_lock_game(p->>'room_code', (p->>'host_id')::uuid);
  if g.status = 'finished' then perform ss_err('game_finished'); end if;
  select count(*) into v_done from auctions where game_id = g.id and status = 'awarded';
  if p ? 'max_rounds' then
    -- null/ausente = todos los elementos del catálogo
    v_rounds := coalesce(nullif(p->>'max_rounds', '')::int, (select count(*) from auction_items where game_id = g.id));
    if v_rounds < 1 or v_rounds > 500 then perform ss_err('invalid_input'); end if;
    if v_rounds < v_done then perform ss_err('rounds_below_played'); end if;
    update games set max_rounds = v_rounds where id = g.id;
  end if;
  if p ? 'integer_bids' then
    update games set integer_bids = (p->>'integer_bids')::boolean where id = g.id;
  end if;
  perform ss_log(g.id, g.host_id, 'rules_changed', jsonb_build_object('max_rounds', p->>'max_rounds', 'integer_bids', p->>'integer_bids'));
  perform ss_touch(g.id);
  return jsonb_build_object('ok', true);
end $$;

-- Subasta automática: activa/desactiva, pausa entre subastas y espera máxima sin pujas. Al activarla se enciende también la
-- adjudicación automática con el tiempo indicado o, si no se indica, el último configurado (20 s de serie).
create or replace function ss_set_auto_run(p jsonb) returns jsonb language plpgsql as $$
declare g games; v_gap int := coalesce((p->>'gap_seconds')::int, 10); v_idle int := coalesce((p->>'idle_seconds')::int, 60);
        v_on boolean := coalesce((p->>'enabled')::boolean, false); v_award int;
begin
  g := ss_lock_game(p->>'room_code', (p->>'host_id')::uuid);
  if g.status = 'finished' then perform ss_err('game_finished'); end if;
  if v_gap < 3 or v_gap > 300 or v_idle < 10 or v_idle > 600 then perform ss_err('invalid_input'); end if;
  v_award := coalesce((p->>'auto_award_seconds')::int, g.auto_award_seconds);
  if v_award < 3 or v_award > 300 then perform ss_err('invalid_input'); end if;
  update games set auto_run_enabled = v_on, auto_run_gap_seconds = v_gap, auto_run_idle_seconds = v_idle, auto_run_skips = 0,
         auto_run_since = case when v_on then now() else auto_run_since end,
         auto_award_enabled = case when v_on then true else auto_award_enabled end,
         auto_award_seconds = case when v_on then v_award else auto_award_seconds end
   where id = g.id;
  if v_on then
    update auctions set timer_reset_at = clock_timestamp() where id = g.current_auction_id and status = 'open';
  end if;
  perform ss_log(g.id, g.host_id, case when v_on then 'auto_run_started' else 'auto_run_stopped' end,
                 jsonb_build_object('gap_seconds', v_gap, 'idle_seconds', v_idle, 'auto_award_seconds', v_award));
  perform ss_touch(g.id);
  return jsonb_build_object('ok', true);
end $$;

-- Avance automático (lo dispara quien lee el estado: TV, móviles, panel). Idempotente y seguro en paralelo:
--  1. rondas agotadas -> la partida termina sola (pasada una pausa para ver la última adjudicación);
--  2. subasta automática: sin subasta viva y pasada la pausa se anuncia el siguiente elemento (o se termina si no quedan);
--  3. subasta abierta sin ninguna puja durante `idle` s -> se cancela, el elemento pasa al final y se sigue; si se da una vuelta
--     entera sin que nadie puje, la subasta automática se detiene sola.
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
      update auction_items set status = 'available',
             sort_order = coalesce((select max(sort_order) from auction_items where game_id = g.id), 0) + 1 where id = a.auction_item_id;
      update games set current_auction_id = null, auto_run_skips = auto_run_skips + 1 where id = g.id;
      select count(*) into v_avail from auction_items where game_id = g.id and status = 'available';
      perform ss_log(g.id, null, 'auto_run_skipped', jsonb_build_object('auction_id', a.id, 'item_id', a.auction_item_id));
      if g.auto_run_skips + 1 >= v_avail then
        update games set auto_run_enabled = false where id = g.id;
        perform ss_log(g.id, null, 'auto_run_stopped', jsonb_build_object('reason', 'nobody_bids'));
      end if;
      perform ss_touch(g.id);
      return jsonb_build_object('changed', true, 'action', 'skipped');
    end if;
    return jsonb_build_object('changed', false);
  end if;

  v_anchor := greatest(coalesce((select max(closed_at) from auctions where game_id = g.id and status in ('awarded','cancelled')), '-infinity'::timestamptz),
                       coalesce(g.auto_run_since, '-infinity'::timestamptz));
  if now() < v_anchor + make_interval(secs => g.auto_run_gap_seconds) then return jsonb_build_object('changed', false); end if;

  select * into it from auction_items where game_id = g.id and status = 'available' order by sort_order, created_at limit 1;
  if not found then
    perform ss_finish_game_internal(g);
    perform ss_log(g.id, null, 'game_finish_rounds', jsonb_build_object('reason', 'items_exhausted'));
    perform ss_touch(g.id);
    return jsonb_build_object('changed', true, 'action', 'finished');
  end if;
  perform ss_announce(jsonb_build_object('room_code', g.room_code, 'host_id', g.host_id, 'item_id', it.id));
  return jsonb_build_object('changed', true, 'action', 'announced');
end $$;

-- Estado: la función anterior pasa a ser ss_get_state_prev y se le añaden las reglas y la cuenta atrás de la siguiente subasta.
alter function ss_get_state(jsonb) rename to ss_get_state_prev;

create or replace function ss_get_state(p jsonb) returns jsonb language plpgsql stable as $$
declare g games; res jsonb; v_live boolean; v_done int; v_total int; v_next timestamptz; v_anchor timestamptz;
begin
  res := ss_get_state_prev(p);
  select * into g from games where room_code = upper(coalesce(p->>'room_code', ''));
  select count(*) into v_done from auctions where game_id = g.id and status = 'awarded';
  v_total := coalesce(g.max_rounds, (select count(*) from auction_items where game_id = g.id));
  v_live := exists (select 1 from auctions where game_id = g.id and status in ('open','closed'));
  if g.auto_run_enabled and g.status = 'active' and not v_live and v_done < v_total then
    v_anchor := greatest(coalesce((select max(closed_at) from auctions where game_id = g.id and status in ('awarded','cancelled')), '-infinity'::timestamptz),
                         coalesce(g.auto_run_since, '-infinity'::timestamptz));
    v_next := v_anchor + make_interval(secs => g.auto_run_gap_seconds);
  end if;
  res := jsonb_set(res, '{game}', (res->'game') || jsonb_build_object(
    'max_rounds', g.max_rounds, 'total_rounds', v_total, 'integer_bids', g.integer_bids,
    'auto_run_enabled', g.auto_run_enabled, 'auto_run_gap_seconds', g.auto_run_gap_seconds, 'auto_run_idle_seconds', g.auto_run_idle_seconds,
    'auto_run_next_at', v_next));
  return res;
end $$;
