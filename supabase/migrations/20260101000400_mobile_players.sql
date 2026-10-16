-- =============================================================================
-- Modo «móviles»: cada jugador se une con el código de sala desde su teléfono, se identifica
-- (reclama su casilla) y puja él mismo. El anfitrión sigue controlando anunciar/cerrar/adjudicar.
-- Ejecutar DESPUÉS de las migraciones anteriores. Portable (PGlite/Postgres/Supabase).
--
-- Identidad sin cuentas: al unirse se genera un token aleatorio que va en una cookie httpOnly del
-- navegador; en la BD sólo se guarda su hash SHA-256 (players.token_hash). Nunca se expone en
-- ss_get_state (sólo el booleano `claimed`).
-- =============================================================================

alter table games   add column play_mode  text not null default 'host' check (play_mode in ('host','mobile'));
alter table players add column token_hash text;
alter table bids    add column source     text not null default 'host' check (source in ('host','player'));
create unique index players_token_hash_uq on players (token_hash) where token_hash is not null;

create or replace function ss_create_game(p jsonb) returns jsonb language plpgsql as $$
declare
  g_id uuid;
  code text;
  pl jsonb;
  it jsonb;
  idx int := 0;
  v_budget int := coalesce((p->>'initial_budget_cents')::int, 2000);
begin
  if (p->>'host_id') is null then perform ss_err('not_host'); end if;
  if jsonb_array_length(coalesce(p->'players', '[]'::jsonb)) > 12 then perform ss_err('too_many_players'); end if;
  if (select count(distinct lower(e->>'name')) from jsonb_array_elements(coalesce(p->'players','[]'::jsonb)) e)
     <> jsonb_array_length(coalesce(p->'players','[]'::jsonb)) then perform ss_err('duplicate_name'); end if;
  code := ss_gen_room_code();
  insert into games (room_code, host_id, name, theme, initial_budget_cents, min_bid_cents, ranking_rule, play_mode)
  values (code, (p->>'host_id')::uuid, p->>'name', coalesce(p->>'theme', 'house'), v_budget,
          coalesce((p->>'min_bid_cents')::int, 100), coalesce(p->>'ranking_rule', 'none'), coalesce(p->>'play_mode', 'host'))
  returning id into g_id;

  for pl in select * from jsonb_array_elements(coalesce(p->'players', '[]'::jsonb)) loop
    idx := idx + 1;
    insert into players (game_id, name, color, sort_order, balance_cents)
    values (g_id, pl->>'name', coalesce(pl->>'color', '#a78bfa'), idx, v_budget);
  end loop;

  idx := 0;
  for it in select * from jsonb_array_elements(coalesce(p->'items', '[]'::jsonb)) loop
    idx := idx + 1;
    insert into auction_items (game_id, name, description, emoji, sort_order)
    values (g_id, it->>'name', coalesce(it->>'description', ''), it->>'emoji', idx);
  end loop;

  perform ss_log(g_id, (p->>'host_id')::uuid, 'game_created', jsonb_build_object('room_code', code));
  return jsonb_build_object('game_id', g_id, 'room_code', code);
end $$;


create or replace function ss_set_play_mode(p jsonb) returns jsonb language plpgsql as $$
declare g games;
begin
  g := ss_lock_game(p->>'room_code', (p->>'host_id')::uuid);
  if g.status = 'finished' then perform ss_err('game_finished'); end if;
  if p->>'play_mode' not in ('host','mobile') then perform ss_err('invalid_input'); end if;
  update games set play_mode = p->>'play_mode' where id = g.id;
  perform ss_log(g.id, g.host_id, 'play_mode_changed', jsonb_build_object('play_mode', p->>'play_mode'));
  perform ss_touch(g.id);
  return jsonb_build_object('ok', true);
end $$;

-- Puja: lógica ÚNICA para anfitrión y jugadores (p_source = 'host' | 'player').
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
  perform ss_touch(g.id);
  res := jsonb_build_object('ok', true, 'bid_id', v_bid);
  perform ss_idem_put(g.id, v_key, 'place_bid', res);
  return res;
end $$;

create or replace function ss_place_bid(p jsonb) returns jsonb language plpgsql as $$
declare g games;
begin
  g := ss_lock_game(p->>'room_code', (p->>'host_id')::uuid);
  return ss_bid_internal(g, p, (p->>'player_id')::uuid, 'host');
end $$;

-- Bloquea la partida SIN exigir anfitrión (las funciones de jugador se autentican con token).
create or replace function ss_lock_game_public(p_room text) returns games language plpgsql as $$
declare g games;
begin
  select * into g from games where room_code = upper(coalesce(p_room, '')) for update;
  if not found then perform ss_err('game_not_found'); end if;
  return g;
end $$;

-- Puja hecha por el propio jugador desde su móvil.
create or replace function ss_player_bid(p jsonb) returns jsonb language plpgsql as $$
declare g games; pl players;
begin
  g := ss_lock_game_public(p->>'room_code');
  if g.play_mode <> 'mobile' then perform ss_err('mobile_disabled'); end if;
  select * into pl from players where game_id = g.id and token_hash = p->>'token_hash' and p->>'token_hash' is not null;
  if not found then perform ss_err('not_player'); end if;
  return ss_bid_internal(g, p, pl.id, 'player');
end $$;

-- Quién soy: devuelve el player_id asociado a un token (o null).
create or replace function ss_identify_player(p jsonb) returns jsonb language sql stable as $$
  select jsonb_build_object('player_id', (
    select pl.id from players pl join games g on g.id = pl.game_id
    where g.room_code = upper(coalesce(p->>'room_code', '')) and pl.token_hash = p->>'token_hash' and p->>'token_hash' is not null));
$$;

-- Reclamar una casilla libre (primero en llegar).
create or replace function ss_claim_player(p jsonb) returns jsonb language plpgsql as $$
declare g games; pl players;
begin
  g := ss_lock_game_public(p->>'room_code');
  if g.play_mode <> 'mobile' then perform ss_err('mobile_disabled'); end if;
  if g.status = 'finished' then perform ss_err('game_finished'); end if;
  select * into pl from players where id = (p->>'player_id')::uuid and game_id = g.id for update;
  if not found then perform ss_err('player_not_found'); end if;
  if pl.token_hash is not null then perform ss_err('player_taken'); end if;
  update players set token_hash = p->>'token_hash' where id = pl.id;
  perform ss_log(g.id, null, 'player_joined', jsonb_build_object('player_id', pl.id));
  perform ss_touch(g.id);
  return jsonb_build_object('ok', true, 'player_id', pl.id);
end $$;

-- Unirse con un nombre nuevo (sólo en la sala de espera).
create or replace function ss_join_new_player(p jsonb) returns jsonb language plpgsql as $$
declare g games; v_id uuid;
begin
  g := ss_lock_game_public(p->>'room_code');
  if g.play_mode <> 'mobile' then perform ss_err('mobile_disabled'); end if;
  if g.status <> 'lobby' then perform ss_err('game_already_started'); end if;
  if (select count(*) from players where game_id = g.id) >= 12 then perform ss_err('too_many_players'); end if;
  if exists (select 1 from players where game_id = g.id and lower(name) = lower(p->>'name')) then perform ss_err('duplicate_name'); end if;
  insert into players (game_id, name, color, sort_order, balance_cents, token_hash)
  values (g.id, p->>'name', coalesce(p->>'color', '#a78bfa'),
          coalesce((select max(sort_order) from players where game_id = g.id), 0) + 1, g.initial_budget_cents, p->>'token_hash')
  returning id into v_id;
  perform ss_log(g.id, null, 'player_joined', jsonb_build_object('player_id', v_id, 'new', true));
  perform ss_touch(g.id);
  return jsonb_build_object('ok', true, 'player_id', v_id);
end $$;

-- El jugador libera su casilla (o el anfitrión la libera, p. ej. si perdió el móvil).
create or replace function ss_release_player(p jsonb) returns jsonb language plpgsql as $$
declare g games; v_player uuid;
begin
  if p->>'host_id' is not null then
    g := ss_lock_game(p->>'room_code', (p->>'host_id')::uuid);
    v_player := (p->>'player_id')::uuid;
  else
    g := ss_lock_game_public(p->>'room_code');
    select id into v_player from players where game_id = g.id and token_hash = p->>'token_hash' and p->>'token_hash' is not null;
    if v_player is null then return jsonb_build_object('ok', true, 'replay', true); end if;
  end if;
  update players set token_hash = null where id = v_player and game_id = g.id;
  if not found then perform ss_err('player_not_found'); end if;
  perform ss_log(g.id, null, 'player_released', jsonb_build_object('player_id', v_player));
  perform ss_touch(g.id);
  return jsonb_build_object('ok', true);
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
    'game', jsonb_build_object(
      'id', g.id, 'room_code', g.room_code, 'name', g.name, 'status', g.status, 'theme', g.theme,
      'initial_budget_cents', g.initial_budget_cents, 'min_bid_cents', g.min_bid_cents,
      'ranking_rule', g.ranking_rule, 'play_mode', g.play_mode, 'current_auction_id', g.current_auction_id,
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

