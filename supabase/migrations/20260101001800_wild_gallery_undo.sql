-- =============================================================================
-- Tres funciones nuevas (ejecutar DESPUÉS de 20260101001600_initial_image_scopes.sql):
--   1. Deshacer la última adjudicación (devuelve el saldo, libera el objeto y retira su edición de imagen).
--   2. Eventos sorpresa: subastas «a ciegas» y «doble o mitad» (por subasta o por probabilidad) e «impuesto al más rico».
--   3. Galería final con votación desde los móviles (un voto por jugador, no se puede votar a uno mismo).
-- ss_get_state se EXTIENDE con un envoltorio (la función anterior pasa a llamarse ss_get_state_base).
-- =============================================================================

alter table games    add column wild_chance_pct   integer not null default 0 check (wild_chance_pct between 0 and 100);
alter table games    add column gallery_closed_at timestamptz;
alter table auctions add column wild_event text check (wild_event in ('blind','double'));
alter table auctions add column wild_note  jsonb;

create table gallery_votes (
  game_id    uuid not null references games(id) on delete cascade,
  voter_id   uuid not null references players(id) on delete cascade,
  target_id  uuid not null references players(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (game_id, voter_id),
  check (voter_id <> target_id)
);
create index gallery_votes_target_idx on gallery_votes (game_id, target_id);

-- ---------------------------------------------------------------------------
-- Eventos sorpresa: ajustes y anuncio con evento
-- ---------------------------------------------------------------------------
create or replace function ss_set_wild(p jsonb) returns jsonb language plpgsql as $$
declare g games; v_pct int := coalesce((p->>'chance_pct')::int, 0);
begin
  g := ss_lock_game(p->>'room_code', (p->>'host_id')::uuid);
  if g.status = 'finished' then perform ss_err('game_finished'); end if;
  if v_pct < 0 or v_pct > 100 then perform ss_err('invalid_input'); end if;
  update games set wild_chance_pct = v_pct where id = g.id;
  perform ss_log(g.id, g.host_id, 'wild_settings_changed', jsonb_build_object('chance_pct', v_pct));
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

-- Adjudicación: igual que antes, pero «doble o mitad» sortea cuánto se cobra (la mitad o el doble de la puja,
-- el doble limitado al saldo del ganador). purchases.price_cents guarda lo REALMENTE cobrado.
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
      v_charge := a.current_bid_cents / 2;
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

  perform ss_log(g.id, case when p_source = 'host' then g.host_id else null end, 'auction_awarded',
    jsonb_build_object('auction_id', a.id, 'purchase_id', pur.id, 'player_id', pl.id,
                       'price_cents', v_charge, 'bid_cents', a.current_bid_cents, 'wild_event', a.wild_event,
                       'wild_outcome', v_outcome, 'job_id', v_job, 'source', p_source));
  perform ss_touch(g.id);
  return jsonb_build_object('ok', true, 'purchase_id', pur.id, 'job_id', v_job, 'source', p_source,
                            'charged_cents', v_charge, 'wild_outcome', v_outcome);
end $$;

-- Impuesto al más rico: quien tenga más saldo paga el 20 % (redondeado a la baja) y se reparte a partes iguales entre
-- el resto. Sólo entre subastas (con una puja abierta cambiarían los saldos bajo los pies de los jugadores).
create or replace function ss_wild_tax(p jsonb) returns jsonb language plpgsql as $$
declare
  g games; replay jsonb; v_key text := p->>'idempotency_key';
  v_max int; v_pool int := 0; v_n int; v_share int; v_change int; v_first uuid; r record;
  v_payers jsonb := '[]'::jsonb; v_amt int; res jsonb;
begin
  g := ss_lock_game(p->>'room_code', (p->>'host_id')::uuid);
  replay := ss_idem_get(g.id, v_key, 'wild_tax');
  if replay is not null then return replay || jsonb_build_object('replay', true); end if;
  if g.status = 'paused' then perform ss_err('game_paused'); end if;
  if g.status <> 'active' then perform ss_err('game_not_active'); end if;
  if exists (select 1 from auctions where game_id = g.id and status in ('open','closed')) then perform ss_err('auction_in_progress'); end if;

  select max(balance_cents) into v_max from players where game_id = g.id;
  select count(*) into v_n from players where game_id = g.id and balance_cents < v_max;
  if v_max is null or v_n = 0 then perform ss_err('tax_no_recipients'); end if;
  v_pool := (select coalesce(sum(balance_cents * 20 / 100), 0) from players where game_id = g.id and balance_cents = v_max);
  v_share := v_pool / v_n;
  if v_share = 0 then perform ss_err('nothing_to_tax'); end if;
  v_change := v_pool - v_share * v_n; -- céntimos que no se pueden repartir: se quedan con el primer pagador

  for r in select id, name, balance_cents from players where game_id = g.id and balance_cents = v_max order by sort_order, created_at, id loop
    v_amt := r.balance_cents * 20 / 100;
    if v_first is null then v_first := r.id; v_amt := v_amt - v_change; end if;
    update players set balance_cents = balance_cents - v_amt where id = r.id;
    v_payers := v_payers || jsonb_build_object('player_id', r.id, 'name', r.name, 'amount_cents', v_amt);
  end loop;
  update players set balance_cents = balance_cents + v_share where game_id = g.id and balance_cents < v_max and id <> all (select (x->>'player_id')::uuid from jsonb_array_elements(v_payers) x);

  perform ss_log(g.id, g.host_id, 'wild_tax', jsonb_build_object('rate_pct', 20, 'payers', v_payers, 'share_cents', v_share, 'recipients', v_n));
  perform ss_touch(g.id);
  res := jsonb_build_object('ok', true, 'payers', v_payers, 'share_cents', v_share, 'recipients', v_n);
  perform ss_idem_put(g.id, v_key, 'wild_tax', res);
  return res;
end $$;

-- ---------------------------------------------------------------------------
-- Deshacer la última adjudicación
-- ---------------------------------------------------------------------------
create or replace function ss_undo_award(p jsonb) returns jsonb language plpgsql as $$
declare
  g games; pur purchases; a auctions; job image_jobs; ver image_versions; replay jsonb; res jsonb;
  v_key text := p->>'idempotency_key';
begin
  g := ss_lock_game(p->>'room_code', (p->>'host_id')::uuid);
  replay := ss_idem_get(g.id, v_key, 'undo_award');
  if replay is not null then return replay || jsonb_build_object('replay', true); end if;
  if g.status not in ('active','paused') then perform ss_err('game_not_active'); end if;

  select * into pur from purchases where id = (p->>'purchase_id')::uuid and game_id = g.id for update;
  if not found then perform ss_err('purchase_not_found'); end if;
  -- Sólo la ÚLTIMA compra de la partida: así las imágenes de cada jugador siguen siendo una cadena coherente.
  if exists (select 1 from purchases where game_id = g.id and (created_at, id) > (pur.created_at, pur.id)) then
    perform ss_err('not_last_purchase');
  end if;

  select * into job from image_jobs where purchase_id = pur.id for update;
  if found and job.status = 'running' then perform ss_err('image_job_running'); end if;
  if found and job.result_version_id is not null then
    select * into ver from image_versions where id = job.result_version_id;
    if found then
      update players set current_image_version_id = ver.parent_version_id
       where id = pur.player_id and current_image_version_id = ver.id;
    end if;
  end if;
  -- La versión creada por esta compra se conserva en el historial, pero ya sin vínculo con ella.
  update image_versions set source_purchase_id = null where source_purchase_id = pur.id;
  delete from image_jobs where purchase_id = pur.id;

  select * into a from auctions where id = pur.auction_id for update;
  update players set balance_cents = balance_cents + pur.price_cents where id = pur.player_id;
  update auction_items set status = 'available' where id = pur.auction_item_id;
  update auctions set status = 'cancelled', winner_id = null, final_price_cents = null where id = a.id;
  update games set current_auction_id = null where id = g.id and current_auction_id = a.id;
  delete from purchases where id = pur.id;

  perform ss_log(g.id, g.host_id, 'award_undone', jsonb_build_object(
    'purchase_id', pur.id, 'player_id', pur.player_id, 'item_id', pur.auction_item_id,
    'refunded_cents', pur.price_cents, 'reason', left(coalesce(p->>'reason', ''), 200)));
  perform ss_touch(g.id);
  res := jsonb_build_object('ok', true, 'refunded_cents', pur.price_cents, 'player_id', pur.player_id, 'item_id', pur.auction_item_id);
  perform ss_idem_put(g.id, v_key, 'undo_award', res);
  return res;
end $$;

-- ---------------------------------------------------------------------------
-- Galería final y votación
-- ---------------------------------------------------------------------------
create or replace function ss_gallery_vote(p jsonb) returns jsonb language plpgsql as $$
declare g games; pl players; tg players;
begin
  g := ss_lock_game_public(p->>'room_code');
  if g.play_mode <> 'mobile' then perform ss_err('mobile_disabled'); end if;
  if g.status <> 'finished' then perform ss_err('gallery_not_open'); end if;
  if g.gallery_closed_at is not null then perform ss_err('gallery_closed'); end if;
  select * into pl from players where game_id = g.id and token_hash = p->>'token_hash' and p->>'token_hash' is not null;
  if not found then perform ss_err('not_player'); end if;
  select * into tg from players where id = (p->>'target_id')::uuid and game_id = g.id;
  if not found then perform ss_err('player_not_found'); end if;
  if tg.id = pl.id then perform ss_err('cannot_vote_self'); end if;
  insert into gallery_votes (game_id, voter_id, target_id) values (g.id, pl.id, tg.id)
  on conflict (game_id, voter_id) do update set target_id = excluded.target_id, created_at = now();
  perform ss_touch(g.id);
  return jsonb_build_object('ok', true);
end $$;

-- El anfitrión cierra la votación (revela el resultado). Los móviles conservan su identidad para ver el resultado,
-- pero con la partida terminada ya no pueden pujar ni votar; el token desaparece con la partida (borrado a las 12 h).
create or replace function ss_gallery_set(p jsonb) returns jsonb language plpgsql as $$
declare g games;
begin
  g := ss_lock_game(p->>'room_code', (p->>'host_id')::uuid);
  if g.status <> 'finished' then perform ss_err('gallery_not_open'); end if;
  if g.gallery_closed_at is not null then return jsonb_build_object('ok', true, 'replay', true); end if;
  update games set gallery_closed_at = now() where id = g.id;
  perform ss_log(g.id, g.host_id, 'gallery_closed', '{}'::jsonb);
  perform ss_touch(g.id);
  return jsonb_build_object('ok', true);
end $$;

-- Terminar la partida: igual que antes, pero en partidas con móviles se conserva su identidad (la necesitan para votar
-- la galería y ver el resultado). Con la partida finalizada esa identidad sólo permite votar mientras la galería esté abierta.
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
    select * into a from auctions where id = g.current_auction_id and status in ('open','closed') for update;
    if found then
      update auctions set status = 'cancelled', closed_at = now() where id = a.id;
      update auction_items set status = 'available' where id = a.auction_item_id;
      update games set current_auction_id = null where id = g.id;
    end if;
    update games set status = 'finished', finished_at = now() where id = g.id;
    -- Partida sin móviles: no hay galería que votar, así que no queda ninguna identidad.
    if g.play_mode <> 'mobile' then update players set token_hash = null where game_id = g.id; end if;
  else
    perform ss_err('invalid_action');
  end if;

  perform ss_log(g.id, g.host_id, 'game_' || v_action, '{}'::jsonb);
  perform ss_touch(g.id);
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- Estado: la función anterior se conserva como base y se le añaden eventos y galería.
-- ---------------------------------------------------------------------------
alter function ss_get_state(jsonb) rename to ss_get_state_base;

create or replace function ss_get_state(p jsonb) returns jsonb language plpgsql stable as $$
declare
  g games; a auctions; res jsonb;
  v_host boolean := coalesce(p->>'view', 'public') = 'host';
  v_hide boolean := false;
begin
  res := ss_get_state_base(p);
  select * into g from games where room_code = upper(coalesce(p->>'room_code', ''));
  res := jsonb_set(res, '{game}', (res->'game') || jsonb_build_object('wild_chance_pct', g.wild_chance_pct));

  if g.current_auction_id is not null and jsonb_typeof(res->'auction') = 'object' then
    select * into a from auctions where id = g.current_auction_id;
    -- Puja a ciegas: en las vistas públicas se oculta importe, líder y pujas mientras la subasta sigue abierta.
    v_hide := a.wild_event = 'blind' and a.status in ('open','closed') and not v_host;
    res := jsonb_set(res, '{auction}', (res->'auction') || jsonb_build_object(
      'wild_event', a.wild_event,
      'wild_note', case when a.status = 'awarded' then a.wild_note end,
      'hidden', v_hide));
    if v_hide then
      res := jsonb_set(res, '{auction}', (res->'auction') || jsonb_build_object(
        'current_bid_cents', 0, 'current_bidder_id', null, 'bids', '[]'::jsonb, 'auto_award_at', null,
        'bids_count', (select count(*) from bids where auction_id = a.id and voided_at is null)));
    end if;
  end if;

  res := res || jsonb_build_object(
    'gallery', jsonb_build_object(
      'enabled', g.status = 'finished',
      'open', g.status = 'finished' and g.gallery_closed_at is null,
      'closed', g.gallery_closed_at is not null,
      'voters', coalesce((select jsonb_agg(voter_id) from gallery_votes where game_id = g.id), '[]'::jsonb),
      'results', case when g.gallery_closed_at is not null or v_host then (
        select coalesce(jsonb_agg(jsonb_build_object('player_id', t.id, 'votes', t.n) order by t.n desc, t.sort_order), '[]'::jsonb)
        from (select pl.id, pl.sort_order, (select count(*) from gallery_votes gv where gv.game_id = g.id and gv.target_id = pl.id) as n
              from players pl where pl.game_id = g.id) t) end),
    'wild_tax', (select jsonb_build_object('id', e.id, 'created_at', e.created_at, 'payload', e.payload)
                 from game_events e where e.game_id = g.id and e.event_type = 'wild_tax' order by e.id desc limit 1));
  return res;
end $$;
