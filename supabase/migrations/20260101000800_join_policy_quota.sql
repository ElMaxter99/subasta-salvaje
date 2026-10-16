-- =============================================================================
-- 1) Política de altas en modo móviles: 'open' (casillas libres + nombres nuevos), 'slots' (sólo casillas
--    existentes) o 'closed' (nadie nuevo puede unirse). Los móviles ya identificados no se ven afectados.
-- 2) Quien entra con nombre nuevo hereda la imagen de partida común si todos los demás comparten la misma.
-- 3) Cuota de generaciones REALES de imagen (por partida y por día UTC) con reserva atómica.
-- Ejecutar DESPUÉS de 20260101000600_mobile_hardening.sql.
-- =============================================================================

alter table games add column join_policy text not null default 'open' check (join_policy in ('open','slots','closed'));

create or replace function ss_set_join_policy(p jsonb) returns jsonb language plpgsql as $$
declare g games;
begin
  g := ss_lock_game(p->>'room_code', (p->>'host_id')::uuid);
  if g.status = 'finished' then perform ss_err('game_finished'); end if;
  if p->>'join_policy' not in ('open','slots','closed') then perform ss_err('invalid_input'); end if;
  update games set join_policy = p->>'join_policy' where id = g.id;
  perform ss_log(g.id, g.host_id, 'join_policy_changed', jsonb_build_object('join_policy', p->>'join_policy'));
  perform ss_touch(g.id);
  return jsonb_build_object('ok', true);
end $$;

create or replace function ss_claim_player(p jsonb) returns jsonb language plpgsql as $$
declare g games; pl players;
begin
  g := ss_lock_game_public(p->>'room_code');
  if g.play_mode <> 'mobile' then perform ss_err('mobile_disabled'); end if;
  if g.status = 'finished' then perform ss_err('game_finished'); end if;
  if g.join_policy = 'closed' then perform ss_err('room_closed'); end if;
  select * into pl from players where id = (p->>'player_id')::uuid and game_id = g.id for update;
  if not found then perform ss_err('player_not_found'); end if;
  if pl.token_hash is not null then perform ss_err('player_taken'); end if;
  update players set token_hash = p->>'token_hash' where id = pl.id;
  perform ss_log(g.id, null, 'player_joined', jsonb_build_object('player_id', pl.id));
  perform ss_touch(g.id);
  return jsonb_build_object('ok', true, 'player_id', pl.id);
end $$;

create or replace function ss_join_new_player(p jsonb) returns jsonb language plpgsql as $$
declare g games; v_id uuid; v_n int; v_path text; v_mime text; v_prov text; v_ver uuid;
begin
  g := ss_lock_game_public(p->>'room_code');
  if g.play_mode <> 'mobile' then perform ss_err('mobile_disabled'); end if;
  if g.join_policy = 'closed' then perform ss_err('room_closed'); end if;
  if g.join_policy <> 'open' then perform ss_err('new_names_disabled'); end if;
  if g.status <> 'lobby' then perform ss_err('game_already_started'); end if;
  if (select count(*) from players where game_id = g.id) >= 12 then perform ss_err('too_many_players'); end if;
  if exists (select 1 from players where game_id = g.id and lower(name) = lower(p->>'name')) then perform ss_err('duplicate_name'); end if;
  insert into players (game_id, name, color, sort_order, balance_cents, token_hash)
  values (g.id, p->>'name', coalesce(p->>'color', '#a78bfa'),
          coalesce((select max(sort_order) from players where game_id = g.id), 0) + 1, g.initial_budget_cents, p->>'token_hash')
  returning id into v_id;
  -- Si todos los demás comparten la MISMA imagen actual (p. ej. la imagen de partida común), el nuevo la hereda.
  select count(distinct v.storage_path), min(v.storage_path), min(v.mime_type), min(v.provider)
    into v_n, v_path, v_mime, v_prov
  from players pl join image_versions v on v.id = pl.current_image_version_id
  where pl.game_id = g.id and pl.id <> v_id;
  if v_n = 1 and (select count(*) from players where game_id = g.id and id <> v_id and current_image_version_id is null) = 0 then
    insert into image_versions (game_id, player_id, storage_path, origin, provider, mime_type, is_approved)
    values (g.id, v_id, v_path, 'uploaded', coalesce(v_prov, 'upload'), v_mime, true) returning id into v_ver;
    update players set current_image_version_id = v_ver where id = v_id;
  end if;
  perform ss_log(g.id, null, 'player_joined', jsonb_build_object('player_id', v_id, 'new', true));
  perform ss_touch(g.id);
  return jsonb_build_object('ok', true, 'player_id', v_id);
end $$;


-- ---------------------------------------------------------------------------
-- Cuota de generaciones reales (los proveedores de pago/cuota limitada). El proveedor `demo` no cuenta.
-- ---------------------------------------------------------------------------
create table image_usage (
  id          bigint generated always as identity primary key,
  game_id     uuid not null references games(id) on delete cascade,
  job_id      uuid,
  provider    text not null,
  created_at  timestamptz not null default now()
);
create index image_usage_day_idx on image_usage (created_at);
create index image_usage_game_idx on image_usage (game_id);

-- Reserva atómica de UNA llamada al proveedor. Un bloqueo asesor serializa el contador diario global.
create or replace function ss_reserve_image_quota(p jsonb) returns jsonb language plpgsql as $$
declare
  v_game uuid; v_game_used int; v_day_used int;
  v_game_limit int := (p->>'game_limit')::int; v_day_limit int := (p->>'day_limit')::int;
begin
  select game_id into v_game from image_jobs where id = (p->>'job_id')::uuid;
  if not found then perform ss_err('job_not_found'); end if;
  perform pg_advisory_xact_lock(hashtext('ss_image_quota'));
  select count(*) into v_game_used from image_usage where game_id = v_game;
  select count(*) into v_day_used from image_usage where (created_at at time zone 'utc')::date = (now() at time zone 'utc')::date;
  if v_game_limit is not null and v_game_used >= v_game_limit then
    return jsonb_build_object('ok', false, 'reason', 'game', 'used', v_game_used, 'limit', v_game_limit);
  end if;
  if v_day_limit is not null and v_day_used >= v_day_limit then
    return jsonb_build_object('ok', false, 'reason', 'day', 'used', v_day_used, 'limit', v_day_limit);
  end if;
  insert into image_usage (game_id, job_id, provider) values (v_game, (p->>'job_id')::uuid, coalesce(p->>'provider', 'unknown'));
  return jsonb_build_object('ok', true, 'game_used', v_game_used + 1, 'day_used', v_day_used + 1);
end $$;

create or replace function ss_image_usage(p jsonb) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'game_used', (select count(*) from image_usage u join games g on g.id = u.game_id where g.room_code = upper(coalesce(p->>'room_code', ''))),
    'day_used', (select count(*) from image_usage where (created_at at time zone 'utc')::date = (now() at time zone 'utc')::date));
$$;

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
    'game', jsonb_build_object(
      'id', g.id, 'room_code', g.room_code, 'name', g.name, 'status', g.status, 'theme', g.theme,
      'initial_budget_cents', g.initial_budget_cents, 'min_bid_cents', g.min_bid_cents,
      'ranking_rule', g.ranking_rule, 'play_mode', g.play_mode, 'join_policy', g.join_policy, 'current_auction_id', g.current_auction_id,
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

