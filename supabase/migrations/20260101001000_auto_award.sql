-- =============================================================================
-- Adjudicación AUTOMÁTICA configurable (para que el anfitrión pueda jugar sin pulsar «Adjudicar» siempre):
--   · por tiempo: N segundos desde la última puja (el reloj se reinicia con cada puja, al deshacer o reabrir);
--   · instantánea: en cuanto nadie más puede superar la puja actual (saldos insuficientes).
-- Toda la contabilidad pasa por UN núcleo (ss_award_core) compartido con la adjudicación manual: se cobra
-- una sola vez, se crea una compra y un trabajo de imagen, igual que siempre.
-- Ejecutar DESPUÉS de 20260101000800_join_policy_quota.sql.
-- =============================================================================

alter table games    add column auto_award_enabled boolean not null default false;
alter table games    add column auto_award_seconds integer not null default 20 check (auto_award_seconds between 3 and 300);
alter table auctions add column timer_reset_at timestamptz not null default '-infinity';

create or replace function ss_set_auto_award(p jsonb) returns jsonb language plpgsql as $$
declare g games; v_secs int := coalesce((p->>'seconds')::int, 20);
begin
  g := ss_lock_game(p->>'room_code', (p->>'host_id')::uuid);
  if g.status = 'finished' then perform ss_err('game_finished'); end if;
  if v_secs < 3 or v_secs > 300 then perform ss_err('invalid_input'); end if;
  update games set auto_award_enabled = coalesce((p->>'enabled')::boolean, false), auto_award_seconds = v_secs where id = g.id;
  -- Cambiar la configuración reinicia la cuenta atrás de la subasta en curso.
  update auctions set timer_reset_at = clock_timestamp() where id = g.current_auction_id and status = 'open';
  perform ss_log(g.id, g.host_id, 'auto_award_changed', jsonb_build_object('enabled', p->>'enabled', 'seconds', v_secs));
  perform ss_touch(g.id);
  return jsonb_build_object('ok', true);
end $$;

create or replace function ss_award_core(g games, a auctions, p_source text) returns jsonb language plpgsql as $$
declare pl players; pur purchases; v_job uuid;
begin
  if g.status = 'paused' then perform ss_err('game_paused'); end if;
  if g.status <> 'active' then perform ss_err('game_not_active'); end if;
  if a.status not in ('open','closed') then perform ss_err('auction_closed'); end if;
  if a.current_bidder_id is null then perform ss_err('no_bids'); end if;

  select * into pl from players where id = a.current_bidder_id and game_id = g.id for update;
  if not found then perform ss_err('player_not_found'); end if;
  if pl.balance_cents < a.current_bid_cents then perform ss_err('insufficient_balance'); end if;

  update auctions set status = 'awarded', winner_id = pl.id, final_price_cents = a.current_bid_cents,
         closed_at = coalesce(closed_at, now()) where id = a.id;
  update players set balance_cents = balance_cents - a.current_bid_cents where id = pl.id;
  insert into purchases (game_id, player_id, auction_id, auction_item_id, price_cents)
  values (g.id, pl.id, a.id, a.auction_item_id, a.current_bid_cents) returning * into pur;
  update auction_items set status = 'sold' where id = a.auction_item_id;
  insert into image_jobs (game_id, kind, player_id, purchase_id, base_image_version_id)
  values (g.id, 'edit', pl.id, pur.id, pl.current_image_version_id) returning id into v_job;

  perform ss_log(g.id, case when p_source = 'host' then g.host_id else null end, 'auction_awarded',
    jsonb_build_object('auction_id', a.id, 'purchase_id', pur.id, 'player_id', pl.id,
                       'price_cents', a.current_bid_cents, 'job_id', v_job, 'source', p_source));
  perform ss_touch(g.id);
  return jsonb_build_object('ok', true, 'purchase_id', pur.id, 'job_id', v_job, 'source', p_source);
end $$;

create or replace function ss_award(p jsonb) returns jsonb language plpgsql as $$
declare
  g games; a auctions; pur purchases; replay jsonb; v_key text; res jsonb;
  v_exp_winner uuid := (p->>'expected_winner_id')::uuid;
  v_exp_price int := (p->>'expected_price_cents')::int;
begin
  if v_exp_winner is null or v_exp_price is null then perform ss_err('invalid_input'); end if;
  -- 1. Serializa todo lo que ocurra en esta partida.
  g := ss_lock_game(p->>'room_code', (p->>'host_id')::uuid);
  v_key := p->>'idempotency_key';
  replay := ss_idem_get(g.id, v_key, 'award');
  if replay is not null then return replay || jsonb_build_object('replay', true); end if;

  select * into a from auctions where id = (p->>'auction_id')::uuid and game_id = g.id for update;
  if not found then perform ss_err('auction_not_found'); end if;

  -- Reintento con otra clave (doble clic tras recargar, etc.): no se vuelve a cobrar.
  if a.status = 'awarded' then
    if a.winner_id = v_exp_winner and a.final_price_cents = v_exp_price then
      select * into pur from purchases where auction_id = a.id;
      return jsonb_build_object('ok', true, 'replay', true, 'purchase_id', pur.id);
    end if;
    perform ss_err('auction_already_awarded');
  end if;

  -- La confirmación debe corresponder con lo que el anfitrión vio.
  if a.status in ('open','closed') and (a.current_bidder_id is distinct from v_exp_winner or a.current_bid_cents is distinct from v_exp_price) then
    if a.current_bidder_id is null then perform ss_err('no_bids'); end if;
    perform ss_err('stale_state');
  end if;
  res := ss_award_core(g, a, 'host');
  perform ss_idem_put(g.id, v_key, 'award', res);
  return res;
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

create or replace function ss_undo_bid(p jsonb) returns jsonb language plpgsql as $$
declare g games; a auctions; last_bid bids; target bids; prev bids;
begin
  g := ss_lock_game(p->>'room_code', (p->>'host_id')::uuid);
  select * into a from auctions where id = (p->>'auction_id')::uuid and game_id = g.id for update;
  if not found then perform ss_err('auction_not_found'); end if;

  select * into target from bids where id = (p->>'bid_id')::uuid and auction_id = a.id;
  if not found then perform ss_err('bid_not_found'); end if;
  -- Idempotente: si ya estaba anulada, no se hace nada más.
  if target.voided_at is not null then return jsonb_build_object('ok', true, 'replay', true); end if;

  if a.status <> 'open' then perform ss_err('auction_closed'); end if;
  select * into last_bid from bids where auction_id = a.id and voided_at is null order by amount_cents desc, created_at desc, id desc limit 1;
  if last_bid.id is distinct from target.id then perform ss_err('stale_state'); end if;

  update bids set voided_at = now() where id = target.id;
  update auctions set timer_reset_at = clock_timestamp() where id = a.id;
  select * into prev from bids where auction_id = a.id and voided_at is null order by amount_cents desc, id desc limit 1;
  if found then
    update auctions set current_bid_cents = prev.amount_cents, current_bidder_id = prev.player_id where id = a.id;
  else
    update auctions set current_bid_cents = 0, current_bidder_id = null where id = a.id;
  end if;

  perform ss_log(g.id, g.host_id, 'bid_undone', jsonb_build_object('bid_id', target.id, 'auction_id', a.id));
  perform ss_touch(g.id);
  return jsonb_build_object('ok', true);
end $$;

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
    update auctions set status = 'cancelled', closed_at = now() where id = a.id;
    update auction_items set status = 'available' where id = a.auction_item_id;
    update games set current_auction_id = null where id = g.id and current_auction_id = a.id;
  else
    perform ss_err('invalid_action');
  end if;

  perform ss_log(g.id, g.host_id, 'auction_' || v_action, jsonb_build_object('auction_id', a.id));
  perform ss_touch(g.id);
  return jsonb_build_object('ok', true);
end $$;

-- Adjudicación por tiempo. Pública (sin sesión): sólo hace lo que las reglas ya permiten y es idempotente.
-- Un chequeo SIN bloqueo evita tomar el bloqueo de la partida salvo que la cuenta atrás haya vencido.
create or replace function ss_auto_award(p jsonb) returns jsonb language plpgsql as $$
declare g games; a auctions; v_due timestamptz; v_res jsonb;
begin
  select * into g from games where room_code = upper(coalesce(p->>'room_code', ''));
  if not found or not g.auto_award_enabled or g.status <> 'active' or g.current_auction_id is null then
    return jsonb_build_object('awarded', false);
  end if;
  select greatest(coalesce((select max(b.created_at) from bids b where b.auction_id = a0.id and b.voided_at is null), a0.opened_at), a0.timer_reset_at)
         + make_interval(secs => g.auto_award_seconds)
    into v_due from auctions a0 where a0.id = g.current_auction_id and a0.status = 'open' and a0.current_bidder_id is not null;
  if v_due is null or v_due > clock_timestamp() then return jsonb_build_object('awarded', false); end if;

  g := ss_lock_game_public(p->>'room_code');
  select * into a from auctions where id = g.current_auction_id for update;
  -- Revalida con el bloqueo tomado (otra petición pudo adjudicar o llegar una puja nueva).
  if not g.auto_award_enabled or g.status <> 'active' or a.status <> 'open' or a.current_bidder_id is null then
    return jsonb_build_object('awarded', false);
  end if;
  if greatest(coalesce((select max(b.created_at) from bids b where b.auction_id = a.id and b.voided_at is null), a.opened_at), a.timer_reset_at)
       + make_interval(secs => g.auto_award_seconds) > clock_timestamp() then
    return jsonb_build_object('awarded', false);
  end if;
  v_res := ss_award_core(g, a, 'auto');
  return v_res || jsonb_build_object('awarded', true, 'auto_reason', 'timeout');
end $$;

create or replace function ss_get_state(p jsonb) returns jsonb language plpgsql stable as $$
declare
  g games;
  v_host boolean := coalesce(p->>'view', 'public') = 'host';
  res jsonb;
begin
  select * into g from games where room_code = upper(coalesce(p->>'room_code', ''));
  if not found then perform ss_err('game_not_found'); end if;
  if v_host and (p->>'host_id' is null or g.host_id <> (p->>'host_id')::uuid) then
    perform ss_err('not_host');
  end if;

  res := jsonb_build_object(
    'version', g.version,
    'server_time', clock_timestamp(),
    'game', jsonb_build_object(
      'id', g.id, 'room_code', g.room_code, 'name', g.name, 'status', g.status, 'theme', g.theme,
      'initial_budget_cents', g.initial_budget_cents, 'min_bid_cents', g.min_bid_cents,
      'ranking_rule', g.ranking_rule, 'play_mode', g.play_mode, 'join_policy', g.join_policy,
      'auto_award_enabled', g.auto_award_enabled, 'auto_award_seconds', g.auto_award_seconds, 'current_auction_id', g.current_auction_id,
      'created_at', g.created_at, 'finished_at', g.finished_at,
      'total_rounds', (select count(*) from auction_items where game_id = g.id),
      'rounds_completed', (select count(*) from auctions where game_id = g.id and status = 'awarded')),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pl.id, 'name', pl.name, 'color', pl.color, 'sort_order', pl.sort_order,
        'balance_cents', pl.balance_cents, 'votes', pl.votes, 'claimed', (pl.token_hash is not null),
        'current_image_version_id', pl.current_image_version_id,
        'current_image', (select jsonb_build_object('id', v.id, 'storage_path', v.storage_path,
                              'provider', v.provider, 'created_at', v.created_at)
                          from image_versions v where v.id = pl.current_image_version_id),
        'initial_image', (select jsonb_build_object('id', v.id, 'storage_path', v.storage_path,
                              'provider', v.provider, 'created_at', v.created_at)
                          from image_versions v where v.id = pl.initial_image_version_id),
        'purchases', coalesce((
          select jsonb_agg(jsonb_build_object('purchase_id', pu.id, 'item_id', it.id, 'name', it.name,
                                              'emoji', it.emoji, 'price_cents', pu.price_cents, 'created_at', pu.created_at)
                           order by pu.created_at, pu.id)
          from purchases pu join auction_items it on it.id = pu.auction_item_id where pu.player_id = pl.id), '[]'::jsonb),
        'generating', coalesce((
          select jsonb_agg(jsonb_build_object('job_id', jb.id, 'kind', jb.kind, 'status', jb.status,
                                              'item_name', it.name) order by jb.created_at)
          from image_jobs jb
          left join purchases pu on pu.id = jb.purchase_id
          left join auction_items it on it.id = pu.auction_item_id
          where jb.player_id = pl.id and jb.status in ('queued','running')), '[]'::jsonb)
      ) order by pl.sort_order, pl.created_at)
      from players pl where pl.game_id = g.id), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('id', it.id, 'name', it.name, 'description', it.description,
                                           'emoji', it.emoji, 'image_path', it.image_path,
                                           'sort_order', it.sort_order, 'status', it.status)
                       order by it.sort_order, it.created_at)
      from auction_items it where it.game_id = g.id), '[]'::jsonb),
    'auction', (
      select jsonb_build_object(
        'id', a.id, 'status', a.status, 'round_number', a.round_number,
        'current_bid_cents', a.current_bid_cents, 'current_bidder_id', a.current_bidder_id,
        'winner_id', a.winner_id, 'final_price_cents', a.final_price_cents,
        'opened_at', a.opened_at, 'closed_at', a.closed_at,
        'auto_award_at', case when g.auto_award_enabled and a.status = 'open' and a.current_bidder_id is not null then
          greatest(coalesce((select max(b2.created_at) from bids b2 where b2.auction_id = a.id and b2.voided_at is null), a.opened_at), a.timer_reset_at) + make_interval(secs => g.auto_award_seconds) end,
        'item', jsonb_build_object('id', it.id, 'name', it.name, 'description', it.description,
                                   'emoji', it.emoji, 'image_path', it.image_path),
        'bids', coalesce((
          select jsonb_agg(jsonb_build_object('id', b.id, 'player_id', b.player_id,
                                              'amount_cents', b.amount_cents, 'created_at', b.created_at)
                           order by b.amount_cents desc, b.id desc)
          from (select * from bids where auction_id = a.id and voided_at is null
                order by amount_cents desc, id desc limit 15) b), '[]'::jsonb))
      from auctions a join auction_items it on it.id = a.auction_item_id where a.id = g.current_auction_id),
    'last_award', (
      select jsonb_build_object('purchase_id', pu.id, 'player_id', pu.player_id, 'item_name', it.name,
                                'emoji', it.emoji, 'price_cents', pu.price_cents, 'created_at', pu.created_at)
      from purchases pu join auction_items it on it.id = pu.auction_item_id
      where pu.game_id = g.id order by pu.created_at desc, pu.id desc limit 1),
    'stats', jsonb_build_object(
      'purchases_count', (select count(*) from purchases where game_id = g.id),
      'total_spent_cents', coalesce((select sum(price_cents) from purchases where game_id = g.id), 0),
      'bids_count', (select count(*) from bids b join auctions a on a.id = b.auction_id
                     where a.game_id = g.id and b.voided_at is null),
      'cancelled_auctions', (select count(*) from auctions where game_id = g.id and status = 'cancelled'))
  );

  if v_host then
    res := res || jsonb_build_object(
      'host_id', g.host_id,
      'jobs', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', jb.id, 'kind', jb.kind, 'status', jb.status, 'attempts', jb.attempts, 'max_attempts', jb.max_attempts,
          'error_message', jb.error_message, 'player_id', jb.player_id, 'player_name', pl.name,
          'item_id', coalesce(jb.item_id, it.id), 'item_name', it.name, 'purchase_id', jb.purchase_id,
          'result_version_id', jb.result_version_id, 'run_after', jb.run_after,
          'created_at', jb.created_at, 'started_at', jb.started_at, 'finished_at', jb.finished_at)
          order by jb.created_at desc)
        from (select * from image_jobs where game_id = g.id order by created_at desc limit 60) jb
        left join players pl on pl.id = jb.player_id
        left join purchases pu on pu.id = jb.purchase_id
        left join auction_items it on it.id = coalesce(jb.item_id, pu.auction_item_id)), '[]'::jsonb),
      'versions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', v.id, 'player_id', v.player_id, 'parent_version_id', v.parent_version_id,
          'storage_path', v.storage_path, 'source_purchase_id', v.source_purchase_id,
          'item_name', it.name, 'origin', v.origin, 'provider', v.provider,
          'prompt_used', v.prompt_used, 'generation_status', v.generation_status,
          'is_approved', v.is_approved, 'error_message', v.error_message, 'created_at', v.created_at)
          order by v.created_at asc, v.id)
        from image_versions v
        left join purchases pu on pu.id = v.source_purchase_id
        left join auction_items it on it.id = pu.auction_item_id
        where v.game_id = g.id), '[]'::jsonb),
      'events', coalesce((
        select jsonb_agg(jsonb_build_object('id', e.id, 'event_type', e.event_type, 'payload', e.payload,
                                            'created_at', e.created_at) order by e.id desc)
        from (select * from game_events where game_id = g.id order by id desc limit 40) e), '[]'::jsonb)
    );
  end if;
  return res;
end $$;

