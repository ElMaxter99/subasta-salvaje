-- =============================================================================
-- Subasta Salvaje · esquema núcleo (PostgreSQL portable)
--
-- Toda la lógica de dinero, adjudicación y trabajos de imagen vive aquí, en
-- funciones SQL transaccionales (ss_*). Es la ÚNICA implementación autoritativa:
--   · Supabase (producción)  -> se invoca con supabase.rpc('ss_*', { p: {...} })
--   · Modo demo / tests      -> se ejecuta el mismo SQL sobre PGlite (Postgres WASM)
--
-- Convenciones:
--   · Importes siempre en céntimos enteros.
--   · Errores de dominio: RAISE EXCEPTION 'ERR:<codigo>' (SQLSTATE P0001).
--   · Cada función mutante bloquea la fila de la partida (FOR UPDATE), de modo que
--     las operaciones de una misma partida se serializan y son idempotentes.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------
create table games (
  id                  uuid primary key default gen_random_uuid(),
  room_code           text not null unique check (room_code ~ '^[A-Z0-9]{4,12}$'),
  host_id             uuid not null,
  name                text not null check (char_length(name) between 1 and 80),
  status              text not null default 'lobby' check (status in ('lobby','active','paused','finished')),
  theme               text not null default 'house' check (char_length(theme) between 1 and 120),
  initial_budget_cents integer not null default 2000 check (initial_budget_cents >= 0 and initial_budget_cents <= 100000000),
  min_bid_cents       integer not null default 100 check (min_bid_cents > 0),
  ranking_rule        text not null default 'none' check (ranking_rule in ('none','balance','items','votes')),
  current_auction_id  uuid,
  version             bigint not null default 1,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  finished_at         timestamptz
);
create index games_host_idx on games (host_id, created_at desc);

create table players (
  id                        uuid primary key default gen_random_uuid(),
  game_id                   uuid not null references games(id) on delete cascade,
  name                      text not null check (char_length(name) between 1 and 40),
  color                     text not null default '#a78bfa' check (color ~ '^#[0-9a-fA-F]{6}$'),
  sort_order                integer not null default 0,
  balance_cents             integer not null check (balance_cents >= 0),
  votes                     integer not null default 0 check (votes >= 0),
  current_image_version_id  uuid,
  initial_image_version_id  uuid,
  created_at                timestamptz not null default now()
);
create unique index players_game_name_uq on players (game_id, lower(name));
create index players_game_idx on players (game_id, sort_order);

create table auction_items (
  id            uuid primary key default gen_random_uuid(),
  game_id       uuid not null references games(id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 80),
  description   text not null default '' check (char_length(description) <= 500),
  emoji         text check (emoji is null or char_length(emoji) <= 8),
  image_path    text,
  sort_order    integer not null default 0,
  status        text not null default 'available' check (status in ('available','in_auction','sold')),
  created_at    timestamptz not null default now()
);
create index auction_items_game_idx on auction_items (game_id, sort_order);

create table auctions (
  id                  uuid primary key default gen_random_uuid(),
  game_id             uuid not null references games(id) on delete cascade,
  auction_item_id     uuid not null references auction_items(id),
  status              text not null default 'open' check (status in ('open','closed','awarded','cancelled')),
  round_number        integer not null default 1,
  current_bid_cents   integer not null default 0 check (current_bid_cents >= 0),
  current_bidder_id   uuid references players(id),
  winner_id           uuid references players(id),
  final_price_cents   integer check (final_price_cents is null or final_price_cents >= 0),
  opened_at           timestamptz not null default now(),
  closed_at           timestamptz,
  created_at          timestamptz not null default now()
);
-- Una sola subasta "viva" por partida.
create unique index auctions_one_live_per_game on auctions (game_id) where status in ('open','closed');
-- Un elemento solo puede adjudicarse una vez.
create unique index auctions_item_awarded_uq on auctions (auction_item_id) where status = 'awarded';

alter table games add constraint games_current_auction_fk
  foreign key (current_auction_id) references auctions(id) on delete set null;

create table bids (
  id                   uuid primary key default gen_random_uuid(),
  auction_id           uuid not null references auctions(id) on delete cascade,
  player_id            uuid not null references players(id),
  amount_cents         integer not null check (amount_cents > 0),
  -- clock_timestamp(): hora real de inserción (dentro del bloqueo), no el inicio de la transacción.
  created_at           timestamptz not null default clock_timestamp(),
  created_by_host_id   uuid not null,
  voided_at            timestamptz
);
create index bids_auction_idx on bids (auction_id, created_at desc);

create table purchases (
  id               uuid primary key default gen_random_uuid(),
  game_id          uuid not null references games(id) on delete cascade,
  player_id        uuid not null references players(id),
  auction_id       uuid not null unique references auctions(id),
  auction_item_id  uuid not null references auction_items(id),
  price_cents      integer not null check (price_cents >= 0),
  created_at       timestamptz not null default now()
);
create index purchases_player_idx on purchases (player_id, created_at);

create table image_versions (
  id                  uuid primary key default gen_random_uuid(),
  game_id             uuid not null references games(id) on delete cascade,
  player_id           uuid not null references players(id) on delete cascade,
  parent_version_id   uuid references image_versions(id),
  storage_path        text,
  source_purchase_id  uuid references purchases(id),
  origin              text not null check (origin in ('initial','uploaded','edit')),
  provider            text not null default 'unknown',
  mime_type           text,
  bytes               integer,
  prompt_used         text,
  generation_status   text not null default 'completed' check (generation_status in ('completed','failed')),
  is_approved         boolean not null default false,
  error_message       text,
  created_at          timestamptz not null default now(),
  constraint image_versions_path_chk check (generation_status <> 'completed' or storage_path is not null),
  constraint image_versions_approved_chk check (not is_approved or generation_status = 'completed')
);
create index image_versions_player_idx on image_versions (player_id, created_at desc);

alter table players add constraint players_current_image_fk
  foreign key (current_image_version_id) references image_versions(id) on delete set null;
alter table players add constraint players_initial_image_fk
  foreign key (initial_image_version_id) references image_versions(id) on delete set null;

create table image_jobs (
  id                     uuid primary key default gen_random_uuid(),
  game_id                uuid not null references games(id) on delete cascade,
  kind                   text not null check (kind in ('initial','edit','item')),
  player_id              uuid references players(id) on delete cascade,
  item_id                uuid references auction_items(id) on delete cascade,
  purchase_id            uuid references purchases(id),
  base_image_version_id  uuid references image_versions(id),
  result_version_id      uuid references image_versions(id),
  status                 text not null default 'queued' check (status in ('queued','running','completed','failed')),
  attempts               integer not null default 0,
  max_attempts           integer not null default 3,
  error_message          text,
  run_after              timestamptz not null default now(),
  locked_by              text,
  locked_until           timestamptz,
  started_at             timestamptz,
  finished_at            timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint image_jobs_target_chk check (
    (kind in ('initial','edit') and player_id is not null) or (kind = 'item' and item_id is not null)
  ),
  constraint image_jobs_edit_purchase_chk check (kind <> 'edit' or purchase_id is not null)
);
-- Una compra genera como máximo UN trabajo de edición: base de la idempotencia.
create unique index image_jobs_purchase_uq on image_jobs (purchase_id) where purchase_id is not null;
create index image_jobs_pick_idx on image_jobs (status, run_after, created_at);
create index image_jobs_game_idx on image_jobs (game_id, created_at desc);

create table game_events (
  id          bigint generated always as identity primary key,
  game_id     uuid not null references games(id) on delete cascade,
  actor_id    uuid,
  event_type  text not null,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index game_events_game_idx on game_events (game_id, id desc);

create table idempotency_keys (
  game_id     uuid not null references games(id) on delete cascade,
  key         text not null check (char_length(key) between 8 and 100),
  action      text not null,
  result      jsonb not null,
  created_at  timestamptz not null default now(),
  primary key (game_id, key)
);

-- ---------------------------------------------------------------------------
-- Utilidades internas
-- ---------------------------------------------------------------------------
create or replace function ss_err(code text) returns void language plpgsql as $$
begin
  raise exception 'ERR:%', code using errcode = 'P0001';
end $$;

create or replace function ss_gen_room_code() returns text language plpgsql as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text;
  i int;
begin
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from games where room_code = code);
  end loop;
  return code;
end $$;

-- Bloquea la partida y comprueba que `p_host` es su anfitrión.
create or replace function ss_lock_game(p_room text, p_host uuid) returns games language plpgsql as $$
declare g games;
begin
  select * into g from games where room_code = upper(coalesce(p_room, '')) for update;
  if not found then perform ss_err('game_not_found'); end if;
  if p_host is null or g.host_id <> p_host then perform ss_err('not_host'); end if;
  return g;
end $$;

create or replace function ss_touch(p_game uuid) returns void language sql as $$
  update games set version = version + 1, updated_at = now() where id = p_game;
$$;

create or replace function ss_log(p_game uuid, p_actor uuid, p_type text, p_payload jsonb default '{}'::jsonb)
returns void language sql as $$
  insert into game_events (game_id, actor_id, event_type, payload) values (p_game, p_actor, p_type, coalesce(p_payload, '{}'::jsonb));
$$;

create or replace function ss_idem_get(p_game uuid, p_key text, p_action text) returns jsonb language plpgsql as $$
declare r idempotency_keys;
begin
  if p_key is null then return null; end if;
  select * into r from idempotency_keys where game_id = p_game and key = p_key;
  if not found then return null; end if;
  -- La misma clave no puede reutilizarse para otra operación.
  if r.action <> p_action then perform ss_err('idempotency_conflict'); end if;
  return r.result;
end $$;

create or replace function ss_idem_put(p_game uuid, p_key text, p_action text, p_result jsonb) returns void language plpgsql as $$
begin
  if p_key is not null then
    insert into idempotency_keys (game_id, key, action, result) values (p_game, p_key, p_action, p_result)
    on conflict (game_id, key) do nothing;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Crear partida
-- ---------------------------------------------------------------------------
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
  insert into games (room_code, host_id, name, theme, initial_budget_cents, min_bid_cents, ranking_rule)
  values (code, (p->>'host_id')::uuid, p->>'name', coalesce(p->>'theme', 'house'), v_budget,
          coalesce((p->>'min_bid_cents')::int, 100), coalesce(p->>'ranking_rule', 'none'))
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

-- ---------------------------------------------------------------------------
-- Ajustes de la partida
-- ---------------------------------------------------------------------------
create or replace function ss_update_game(p jsonb) returns jsonb language plpgsql as $$
declare g games; v_budget int;
begin
  g := ss_lock_game(p->>'room_code', (p->>'host_id')::uuid);
  if g.status = 'finished' then perform ss_err('game_finished'); end if;

  if p ? 'initial_budget_cents' or p ? 'theme' then
    if g.status <> 'lobby' then perform ss_err('game_already_started'); end if;
  end if;
  if p ? 'min_bid_cents' and g.current_auction_id is not null
     and exists (select 1 from auctions where id = g.current_auction_id and status in ('open','closed')) then
    perform ss_err('auction_in_progress');
  end if;

  update games set
    name = coalesce(p->>'name', name),
    theme = coalesce(p->>'theme', theme),
    min_bid_cents = coalesce((p->>'min_bid_cents')::int, min_bid_cents),
    ranking_rule = coalesce(p->>'ranking_rule', ranking_rule),
    initial_budget_cents = coalesce((p->>'initial_budget_cents')::int, initial_budget_cents)
  where id = g.id;

  if p ? 'initial_budget_cents' then
    v_budget := (p->>'initial_budget_cents')::int;
    update players set balance_cents = v_budget where game_id = g.id;
  end if;

  perform ss_log(g.id, g.host_id, 'game_updated', p - 'room_code' - 'host_id');
  perform ss_touch(g.id);
  return jsonb_build_object('ok', true);
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
  else
    perform ss_err('invalid_action');
  end if;

  perform ss_log(g.id, g.host_id, 'game_' || v_action, '{}'::jsonb);
  perform ss_touch(g.id);
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- Jugadores
-- ---------------------------------------------------------------------------
create or replace function ss_player_op(p jsonb) returns jsonb language plpgsql as $$
declare
  g games; v_op text := p->>'op'; v_id uuid; v_pid uuid; i int := 0; v_ids jsonb;
begin
  g := ss_lock_game(p->>'room_code', (p->>'host_id')::uuid);

  if (v_op = 'add' or v_op = 'update') and p->>'name' is not null
     and exists (select 1 from players where game_id = g.id and lower(name) = lower(p->>'name')
                 and id is distinct from (p->>'player_id')::uuid) then
    perform ss_err('duplicate_name');
  end if;

  if v_op = 'add' then
    if g.status <> 'lobby' then perform ss_err('game_already_started'); end if;
    if (select count(*) from players where game_id = g.id) >= 12 then perform ss_err('too_many_players'); end if;
    insert into players (game_id, name, color, sort_order, balance_cents)
    values (g.id, p->>'name', coalesce(p->>'color', '#a78bfa'),
            coalesce((select max(sort_order) from players where game_id = g.id), 0) + 1, g.initial_budget_cents)
    returning id into v_id;
  elsif v_op = 'update' then
    v_id := (p->>'player_id')::uuid;
    update players set name = coalesce(p->>'name', name), color = coalesce(p->>'color', color)
    where id = v_id and game_id = g.id;
    if not found then perform ss_err('player_not_found'); end if;
  elsif v_op = 'remove' then
    if g.status <> 'lobby' then perform ss_err('game_already_started'); end if;
    v_id := (p->>'player_id')::uuid;
    delete from players where id = v_id and game_id = g.id;
    if not found then perform ss_err('player_not_found'); end if;
  elsif v_op = 'reorder' then
    if g.status <> 'lobby' then perform ss_err('game_already_started'); end if;
    v_ids := p->'ordered_ids';
    for v_pid in select (jsonb_array_elements_text(v_ids))::uuid loop
      i := i + 1;
      update players set sort_order = i where id = v_pid and game_id = g.id;
    end loop;
  else
    perform ss_err('invalid_action');
  end if;

  perform ss_log(g.id, g.host_id, 'player_' || v_op, jsonb_build_object('player_id', v_id));
  perform ss_touch(g.id);
  return jsonb_build_object('ok', true, 'player_id', v_id);
end $$;

create or replace function ss_adjust_votes(p jsonb) returns jsonb language plpgsql as $$
declare g games; v_delta int := (p->>'delta')::int;
begin
  g := ss_lock_game(p->>'room_code', (p->>'host_id')::uuid);
  if g.ranking_rule <> 'votes' then perform ss_err('voting_disabled'); end if;
  if g.status = 'lobby' then perform ss_err('game_not_started'); end if;
  update players set votes = greatest(0, votes + v_delta) where id = (p->>'player_id')::uuid and game_id = g.id;
  if not found then perform ss_err('player_not_found'); end if;
  perform ss_log(g.id, g.host_id, 'votes_adjusted', jsonb_build_object('player_id', p->>'player_id', 'delta', v_delta));
  perform ss_touch(g.id);
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- Catálogo de elementos
-- ---------------------------------------------------------------------------
create or replace function ss_item_op(p jsonb) returns jsonb language plpgsql as $$
declare
  g games; v_op text := p->>'op'; v_id uuid; v_status text; v_iid uuid; i int := 0;
begin
  g := ss_lock_game(p->>'room_code', (p->>'host_id')::uuid);
  if g.status = 'finished' then perform ss_err('game_finished'); end if;

  if v_op = 'add' then
    insert into auction_items (game_id, name, description, emoji, sort_order)
    values (g.id, p->>'name', coalesce(p->>'description', ''), p->>'emoji',
            coalesce((select max(sort_order) from auction_items where game_id = g.id), 0) + 1)
    returning id into v_id;
  elsif v_op in ('update', 'remove') then
    v_id := (p->>'item_id')::uuid;
    select status into v_status from auction_items where id = v_id and game_id = g.id for update;
    if not found then perform ss_err('item_not_found'); end if;
    if v_status <> 'available' then perform ss_err('item_locked'); end if;
    if v_op = 'remove' and exists (select 1 from auctions where auction_item_id = v_id) then perform ss_err('item_locked'); end if;
    if v_op = 'update' then
      update auction_items set
        name = coalesce(p->>'name', name),
        description = coalesce(p->>'description', description),
        emoji = case when p ? 'emoji' then p->>'emoji' else emoji end
      where id = v_id;
    else
      delete from auction_items where id = v_id;
    end if;
  elsif v_op = 'reorder' then
    for v_iid in select (jsonb_array_elements_text(p->'ordered_ids'))::uuid loop
      i := i + 1;
      update auction_items set sort_order = i where id = v_iid and game_id = g.id;
    end loop;
  else
    perform ss_err('invalid_action');
  end if;

  perform ss_log(g.id, g.host_id, 'item_' || v_op, jsonb_build_object('item_id', v_id));
  perform ss_touch(g.id);
  return jsonb_build_object('ok', true, 'item_id', v_id);
end $$;

-- ---------------------------------------------------------------------------
-- Subasta: anunciar, pujar, deshacer, cerrar, reabrir, cancelar, limpiar
-- ---------------------------------------------------------------------------
create or replace function ss_announce(p jsonb) returns jsonb language plpgsql as $$
declare g games; it auction_items; a_id uuid; v_round int;
begin
  g := ss_lock_game(p->>'room_code', (p->>'host_id')::uuid);
  if g.status = 'paused' then perform ss_err('game_paused'); end if;
  if g.status <> 'active' then perform ss_err('game_not_active'); end if;
  if exists (select 1 from auctions where game_id = g.id and status in ('open','closed')) then
    perform ss_err('auction_in_progress');
  end if;
  select * into it from auction_items where id = (p->>'item_id')::uuid and game_id = g.id for update;
  if not found then perform ss_err('item_not_found'); end if;
  if it.status <> 'available' then perform ss_err('item_not_available'); end if;

  select count(*) + 1 into v_round from auctions where game_id = g.id;
  insert into auctions (game_id, auction_item_id, round_number) values (g.id, it.id, v_round) returning id into a_id;
  update auction_items set status = 'in_auction' where id = it.id;
  update games set current_auction_id = a_id where id = g.id;

  perform ss_log(g.id, g.host_id, 'auction_announced', jsonb_build_object('auction_id', a_id, 'item_id', it.id, 'item', it.name));
  perform ss_touch(g.id);
  return jsonb_build_object('ok', true, 'auction_id', a_id);
end $$;

create or replace function ss_place_bid(p jsonb) returns jsonb language plpgsql as $$
declare
  g games; a auctions; pl players; replay jsonb; v_amount int; v_key text; v_bid uuid; res jsonb;
begin
  g := ss_lock_game(p->>'room_code', (p->>'host_id')::uuid);
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

  select * into pl from players where id = (p->>'player_id')::uuid and game_id = g.id for update;
  if not found then perform ss_err('player_not_found'); end if;

  if v_amount > pl.balance_cents then perform ss_err('insufficient_balance'); end if;
  if v_amount < g.min_bid_cents then perform ss_err('bid_below_minimum'); end if;
  if v_amount <= a.current_bid_cents then perform ss_err('bid_too_low'); end if;

  insert into bids (auction_id, player_id, amount_cents, created_by_host_id)
  values (a.id, pl.id, v_amount, g.host_id) returning id into v_bid;
  update auctions set current_bid_cents = v_amount, current_bidder_id = pl.id where id = a.id;

  perform ss_log(g.id, g.host_id, 'bid_placed',
    jsonb_build_object('bid_id', v_bid, 'auction_id', a.id, 'player_id', pl.id, 'amount_cents', v_amount));
  perform ss_touch(g.id);
  res := jsonb_build_object('ok', true, 'bid_id', v_bid);
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

-- close | reopen | cancel | clear
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
    update auctions set status = 'open', closed_at = null where id = a.id;
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

-- ---------------------------------------------------------------------------
-- ADJUDICAR: la operación crítica. Atómica, idempotente, cobra exactamente una vez.
-- ---------------------------------------------------------------------------
create or replace function ss_award(p jsonb) returns jsonb language plpgsql as $$
declare
  g games; a auctions; pl players; pur purchases; replay jsonb; v_key text; res jsonb;
  v_exp_winner uuid := (p->>'expected_winner_id')::uuid;
  v_exp_price int := (p->>'expected_price_cents')::int;
  v_job uuid;
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

  -- 2. Estado de partida y de subasta.
  if g.status = 'paused' then perform ss_err('game_paused'); end if;
  if g.status <> 'active' then perform ss_err('game_not_active'); end if;
  if a.status not in ('open','closed') then perform ss_err('auction_closed'); end if;
  if a.current_bidder_id is null then perform ss_err('no_bids'); end if;

  -- La confirmación debe corresponder con lo que el anfitrión vio.
  if a.current_bidder_id is distinct from v_exp_winner or a.current_bid_cents is distinct from v_exp_price then
    perform ss_err('stale_state');
  end if;

  -- 3. Saldo suficiente.
  select * into pl from players where id = a.current_bidder_id and game_id = g.id for update;
  if not found then perform ss_err('player_not_found'); end if;
  if pl.balance_cents < a.current_bid_cents then perform ss_err('insufficient_balance'); end if;

  -- 4. Cierre, cobro (una sola vez), compra e inventario.
  update auctions set status = 'awarded', winner_id = pl.id, final_price_cents = a.current_bid_cents,
         closed_at = coalesce(closed_at, now()) where id = a.id;
  update players set balance_cents = balance_cents - a.current_bid_cents where id = pl.id;
  insert into purchases (game_id, player_id, auction_id, auction_item_id, price_cents)
  values (g.id, pl.id, a.id, a.auction_item_id, a.current_bid_cents) returning * into pur;
  update auction_items set status = 'sold' where id = a.auction_item_id;

  -- 5. Trabajo de edición de imagen vinculado a la compra (único por compra).
  insert into image_jobs (game_id, kind, player_id, purchase_id, base_image_version_id)
  values (g.id, 'edit', pl.id, pur.id, pl.current_image_version_id) returning id into v_job;

  perform ss_log(g.id, g.host_id, 'auction_awarded',
    jsonb_build_object('auction_id', a.id, 'purchase_id', pur.id, 'player_id', pl.id,
                       'price_cents', a.current_bid_cents, 'job_id', v_job));
  perform ss_touch(g.id);
  res := jsonb_build_object('ok', true, 'purchase_id', pur.id, 'job_id', v_job);
  perform ss_idem_put(g.id, v_key, 'award', res);
  return res;
end $$;

-- ---------------------------------------------------------------------------
-- Imágenes: solicitudes del anfitrión, restauración y subida
-- ---------------------------------------------------------------------------
create or replace function ss_request_image(p jsonb) returns jsonb language plpgsql as $$
declare g games; v_kind text := p->>'kind'; v_job uuid; v_player uuid; v_item uuid;
begin
  g := ss_lock_game(p->>'room_code', (p->>'host_id')::uuid);
  if g.status = 'finished' then perform ss_err('game_finished'); end if;
  -- Tope de seguridad de coste: máximo de trabajos de imagen por partida.
  if (select count(*) from image_jobs where game_id = g.id) >= 150 then perform ss_err('image_quota_exceeded'); end if;

  if v_kind = 'initial' then
    if g.status <> 'lobby' then perform ss_err('game_already_started'); end if;
    v_player := (p->>'player_id')::uuid;
    perform 1 from players where id = v_player and game_id = g.id;
    if not found then perform ss_err('player_not_found'); end if;
    select id into v_job from image_jobs
      where player_id = v_player and kind = 'initial' and status in ('queued','running');
    if found then return jsonb_build_object('ok', true, 'job_id', v_job, 'replay', true); end if;
    insert into image_jobs (game_id, kind, player_id) values (g.id, 'initial', v_player) returning id into v_job;
  elsif v_kind = 'item' then
    v_item := (p->>'item_id')::uuid;
    perform 1 from auction_items where id = v_item and game_id = g.id;
    if not found then perform ss_err('item_not_found'); end if;
    select id into v_job from image_jobs where item_id = v_item and kind = 'item' and status in ('queued','running');
    if found then return jsonb_build_object('ok', true, 'job_id', v_job, 'replay', true); end if;
    insert into image_jobs (game_id, kind, item_id) values (g.id, 'item', v_item) returning id into v_job;
  else
    perform ss_err('invalid_action');
  end if;

  perform ss_log(g.id, g.host_id, 'image_requested', jsonb_build_object('job_id', v_job, 'kind', v_kind));
  perform ss_touch(g.id);
  return jsonb_build_object('ok', true, 'job_id', v_job);
end $$;

-- Reintento manual. NUNCA toca saldo ni compras: sólo reinicia el trabajo.
create or replace function ss_retry_image_job(p jsonb) returns jsonb language plpgsql as $$
declare g games; j image_jobs;
begin
  g := ss_lock_game(p->>'room_code', (p->>'host_id')::uuid);
  select * into j from image_jobs where id = (p->>'job_id')::uuid and game_id = g.id for update;
  if not found then perform ss_err('job_not_found'); end if;
  if j.status in ('queued','running') then return jsonb_build_object('ok', true, 'replay', true); end if;
  if j.status = 'completed' then perform ss_err('job_already_completed'); end if;
  -- Tope de reintentos manuales por trabajo (evita gasto ilimitado de IA).
  if (select count(*) from game_events where game_id = g.id and event_type = 'image_retry'
        and payload->>'job_id' = j.id::text) >= 5 then
    perform ss_err('retry_limit');
  end if;
  update image_jobs set status = 'queued', attempts = 0, error_message = null, run_after = now(),
         locked_by = null, locked_until = null, finished_at = null, updated_at = now()
  where id = j.id;
  perform ss_log(g.id, g.host_id, 'image_retry', jsonb_build_object('job_id', j.id));
  perform ss_touch(g.id);
  return jsonb_build_object('ok', true, 'job_id', j.id);
end $$;

create or replace function ss_restore_version(p jsonb) returns jsonb language plpgsql as $$
declare g games; v image_versions; pl players;
begin
  g := ss_lock_game(p->>'room_code', (p->>'host_id')::uuid);
  select * into pl from players where id = (p->>'player_id')::uuid and game_id = g.id for update;
  if not found then perform ss_err('player_not_found'); end if;
  select * into v from image_versions where id = (p->>'version_id')::uuid and player_id = pl.id;
  if not found then perform ss_err('version_not_found'); end if;
  if v.generation_status <> 'completed' or not v.is_approved or v.storage_path is null then
    perform ss_err('version_not_restorable');
  end if;
  if pl.current_image_version_id is not distinct from v.id then
    return jsonb_build_object('ok', true, 'replay', true);
  end if;
  -- Sólo cambia el puntero: no se borra nada ni se tocan saldos ni compras.
  update players set current_image_version_id = v.id where id = pl.id;
  perform ss_log(g.id, g.host_id, 'image_restored',
    jsonb_build_object('player_id', pl.id, 'version_id', v.id, 'previous_version_id', pl.current_image_version_id));
  perform ss_touch(g.id);
  return jsonb_build_object('ok', true);
end $$;

-- Imagen inicial subida por el anfitrión (sólo antes de empezar).
create or replace function ss_add_uploaded_version(p jsonb) returns jsonb language plpgsql as $$
declare g games; pl players; v_id uuid;
begin
  g := ss_lock_game(p->>'room_code', (p->>'host_id')::uuid);
  if g.status <> 'lobby' then perform ss_err('game_already_started'); end if;
  select * into pl from players where id = (p->>'player_id')::uuid and game_id = g.id for update;
  if not found then perform ss_err('player_not_found'); end if;
  insert into image_versions (game_id, player_id, parent_version_id, storage_path, origin, provider, mime_type, bytes, is_approved)
  values (g.id, pl.id, null, p->>'storage_path', 'uploaded', 'upload', p->>'mime_type', (p->>'bytes')::int, true)
  returning id into v_id;
  update players set current_image_version_id = v_id where id = pl.id;
  perform ss_log(g.id, g.host_id, 'image_uploaded', jsonb_build_object('player_id', pl.id, 'version_id', v_id));
  perform ss_touch(g.id);
  return jsonb_build_object('ok', true, 'version_id', v_id);
end $$;

-- ---------------------------------------------------------------------------
-- Cola de trabajos de imagen (worker)
-- ---------------------------------------------------------------------------

-- Reclama atómicamente el siguiente trabajo elegible. Devuelve null si no hay y
-- {"retry": true} si el candidato desapareció mientras se bloqueaba la partida.
-- Reglas:
--   · Como máximo UN bloqueo de partida por llamada (evita deadlocks entre workers).
--   · Sólo un trabajo en curso por jugador (cada edición parte de la imagen anterior).
--   · Las ediciones de un jugador se procesan en orden de compra.
--   · Un trabajo "running" con lease caducado se recupera; si agotó los intentos se marca fallido.
create or replace function ss_claim_image_job(p jsonb) returns jsonb language plpgsql as $$
declare
  v_worker text := coalesce(p->>'worker_id', 'worker');
  v_lease int := coalesce((p->>'lease_seconds')::int, 300);
  v_candidate record;
  g games;
  j image_jobs;
  v_base image_versions;
  v_player players;
  v_item auction_items;
  v_msg text := 'El worker no terminó el trabajo';
begin
  select c.id, c.game_id into v_candidate
  from image_jobs c
  where ((c.status = 'queued' and c.run_after <= now()) or (c.status = 'running' and c.locked_until < now()))
    and (p->>'game_id' is null or c.game_id = (p->>'game_id')::uuid)
    and not exists (
      select 1 from image_jobs r
      where r.player_id = c.player_id and r.id <> c.id and r.status = 'running' and r.locked_until >= now())
    and not exists (
      select 1 from image_jobs o
      where c.kind = 'edit' and o.kind = 'edit' and o.player_id = c.player_id and o.id <> c.id
        and o.status in ('queued','running') and o.created_at < c.created_at)
  order by c.created_at, c.id
  limit 1;
  if not found then return null; end if;

  -- Orden de bloqueo coherente con el resto: primero la partida, luego el trabajo.
  select * into g from games where id = v_candidate.game_id for update;
  select * into j from image_jobs where id = v_candidate.id
    and ((status = 'queued' and run_after <= now()) or (status = 'running' and locked_until < now()))
    for update skip locked;
  if not found then return jsonb_build_object('retry', true); end if;

  -- Lease caducado con todos los intentos gastados: fallo terminal (con versión fallida y evento).
  if j.status = 'running' and j.attempts >= j.max_attempts then
    update image_jobs set status = 'failed', error_message = v_msg, finished_at = now(),
           locked_by = null, locked_until = null, updated_at = now() where id = j.id;
    if j.kind in ('initial','edit') then
      insert into image_versions (game_id, player_id, parent_version_id, source_purchase_id, origin, provider,
                                  generation_status, is_approved, error_message)
      values (j.game_id, j.player_id, case when j.kind = 'edit' then j.base_image_version_id else null end,
              j.purchase_id, case when j.kind = 'initial' then 'initial' else 'edit' end, 'unknown', 'failed', false, v_msg);
    end if;
    perform ss_log(g.id, null, 'image_failed', jsonb_build_object('job_id', j.id, 'terminal', true, 'error', v_msg));
    perform ss_touch(g.id);
    return jsonb_build_object('retry', true);
  end if;

  select * into v_base from image_versions where false;
  select * into v_player from players where false;
  update image_jobs set status = 'running', attempts = attempts + 1, locked_by = v_worker,
         locked_until = now() + make_interval(secs => v_lease),
         started_at = coalesce(started_at, now()), error_message = null, updated_at = now()
  where id = j.id returning * into j;

  if j.kind in ('edit','initial') then
    select * into v_player from players where id = j.player_id;
    -- La base es SIEMPRE la imagen actual del jugador en este momento.
    update image_jobs set base_image_version_id = v_player.current_image_version_id where id = j.id
    returning * into j;
    if j.kind = 'edit' then
      if v_player.current_image_version_id is null then
        update image_jobs set status = 'failed', error_message = 'El jugador no tiene imagen base para editar',
               finished_at = now(), locked_by = null, locked_until = null, updated_at = now() where id = j.id;
        perform ss_touch(g.id);
        return jsonb_build_object('retry', true);
      end if;
      select * into v_base from image_versions where id = j.base_image_version_id;
    end if;
  end if;

  perform ss_touch(g.id);
  select * into v_item from auction_items
    where id = coalesce(j.item_id, (select auction_item_id from purchases where id = j.purchase_id));

  return jsonb_build_object(
    'job_id', j.id, 'kind', j.kind, 'attempts', j.attempts, 'max_attempts', j.max_attempts,
    'game_id', g.id, 'room_code', g.room_code, 'theme', g.theme,
    'player_id', j.player_id, 'player_name', v_player.name,
    'item_id', v_item.id, 'item_name', v_item.name, 'item_description', v_item.description,
    'purchase_id', j.purchase_id,
    'base_version_id', j.base_image_version_id, 'base_storage_path', v_base.storage_path,
    'base_mime_type', v_base.mime_type);
end $$;

create or replace function ss_complete_image_job(p jsonb) returns jsonb language plpgsql as $$
declare
  v_game uuid; g games; j image_jobs; pl players; v_id uuid; v_origin text; v_is_current boolean := false;
begin
  select game_id into v_game from image_jobs where id = (p->>'job_id')::uuid;
  if not found then perform ss_err('job_not_found'); end if;
  select * into g from games where id = v_game for update;
  select * into j from image_jobs where id = (p->>'job_id')::uuid for update;

  if j.status = 'completed' then
    return jsonb_build_object('ok', true, 'replay', true, 'room_code', g.room_code, 'version_id', j.result_version_id);
  end if;
  if j.status <> 'running' or j.locked_by is distinct from p->>'worker_id' then
    perform ss_err('lease_lost');
  end if;

  if j.kind = 'item' then
    update auction_items set image_path = p->>'storage_path' where id = j.item_id;
  else
    select * into pl from players where id = j.player_id for update;
    v_origin := case when j.kind = 'initial' then 'initial' else 'edit' end;
    insert into image_versions (game_id, player_id, parent_version_id, storage_path, source_purchase_id, origin,
                                provider, mime_type, bytes, prompt_used, generation_status, is_approved)
    values (j.game_id, j.player_id, case when j.kind = 'edit' then j.base_image_version_id else null end,
            p->>'storage_path', j.purchase_id, v_origin, coalesce(p->>'provider', 'unknown'),
            p->>'mime_type', (p->>'bytes')::int, p->>'prompt', 'completed', true)
    returning id into v_id;

    -- Sólo se promociona a "actual" si nadie ha cambiado la imagen actual mientras tanto
    -- (p. ej. una restauración): una actualización atrasada nunca pisa una más reciente.
    v_is_current := pl.current_image_version_id is not distinct from j.base_image_version_id;
    if j.kind = 'initial' then
      v_is_current := v_is_current and (g.status = 'lobby' or pl.current_image_version_id is null);
    end if;
    if v_is_current then
      update players set current_image_version_id = v_id,
             -- Si la partida ya empezó sin imagen inicial, esta pasa a ser el punto de partida.
             initial_image_version_id = case when j.kind = 'initial' and g.status <> 'lobby'
                                              then coalesce(initial_image_version_id, v_id) else initial_image_version_id end
      where id = pl.id;
    end if;
  end if;

  update image_jobs set status = 'completed', result_version_id = v_id, finished_at = now(),
         locked_by = null, locked_until = null, error_message = null, updated_at = now() where id = j.id;
  perform ss_log(g.id, null, 'image_completed',
    jsonb_build_object('job_id', j.id, 'version_id', v_id, 'is_current', v_is_current, 'kind', j.kind));
  perform ss_touch(g.id);
  return jsonb_build_object('ok', true, 'room_code', g.room_code, 'version_id', v_id, 'is_current', v_is_current);
end $$;

create or replace function ss_fail_image_job(p jsonb) returns jsonb language plpgsql as $$
declare
  v_game uuid; g games; j image_jobs; v_msg text := left(coalesce(p->>'error', 'Error desconocido'), 1000);
  v_retryable boolean := coalesce((p->>'retryable')::boolean, true); v_terminal boolean;
begin
  select game_id into v_game from image_jobs where id = (p->>'job_id')::uuid;
  if not found then perform ss_err('job_not_found'); end if;
  select * into g from games where id = v_game for update;
  select * into j from image_jobs where id = (p->>'job_id')::uuid for update;
  if j.status <> 'running' or j.locked_by is distinct from p->>'worker_id' then
    return jsonb_build_object('ok', true, 'ignored', true, 'room_code', g.room_code);
  end if;

  v_terminal := (not v_retryable) or j.attempts >= j.max_attempts;
  if v_terminal then
    update image_jobs set status = 'failed', error_message = v_msg, finished_at = now(),
           locked_by = null, locked_until = null, updated_at = now() where id = j.id;
    -- Se deja constancia en el historial, sin tocar la imagen actual ni el saldo.
    if j.kind in ('initial','edit') then
      insert into image_versions (game_id, player_id, parent_version_id, source_purchase_id, origin, provider,
                                  prompt_used, generation_status, is_approved, error_message)
      values (j.game_id, j.player_id, case when j.kind = 'edit' then j.base_image_version_id else null end,
              j.purchase_id, case when j.kind = 'initial' then 'initial' else 'edit' end,
              coalesce(p->>'provider', 'unknown'), p->>'prompt', 'failed', false, v_msg);
    end if;
  else
    update image_jobs set status = 'queued', error_message = v_msg, locked_by = null, locked_until = null,
           run_after = now() + make_interval(secs => 15 * j.attempts), updated_at = now() where id = j.id;
  end if;
  perform ss_log(g.id, null, 'image_failed',
    jsonb_build_object('job_id', j.id, 'terminal', v_terminal, 'attempts', j.attempts, 'error', v_msg));
  perform ss_touch(g.id);
  return jsonb_build_object('ok', true, 'terminal', v_terminal, 'room_code', g.room_code);
end $$;

create or replace function ss_pending_job_count(p jsonb) returns jsonb language sql as $$
  select jsonb_build_object('count', count(*))
  from image_jobs
  where (status = 'queued' and run_after <= now()) or (status = 'running' and locked_until < now());
$$;

-- ---------------------------------------------------------------------------
-- Lectura: instantánea completa de la partida
--   view = 'public' -> sin datos sensibles (pantalla de TV, resultados)
--   view = 'host'   -> añade trabajos, versiones, eventos (requiere host_id)
-- ---------------------------------------------------------------------------
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
      'ranking_rule', g.ranking_rule, 'current_auction_id', g.current_auction_id,
      'created_at', g.created_at, 'finished_at', g.finished_at,
      'total_rounds', (select count(*) from auction_items where game_id = g.id),
      'rounds_completed', (select count(*) from auctions where game_id = g.id and status = 'awarded')),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pl.id, 'name', pl.name, 'color', pl.color, 'sort_order', pl.sort_order,
        'balance_cents', pl.balance_cents, 'votes', pl.votes,
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

create or replace function ss_list_games(p jsonb) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'room_code', g.room_code, 'name', g.name, 'status', g.status, 'theme', g.theme,
    'created_at', g.created_at, 'players', (select count(*) from players where game_id = g.id))
    order by g.created_at desc), '[]'::jsonb)
  from (select * from games where host_id = (p->>'host_id')::uuid order by created_at desc limit 30) g;
$$;
