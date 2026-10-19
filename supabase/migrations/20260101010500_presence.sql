-- Presencia (latido) y jugadores «retirados de la TV». Ver docs/PRESENCIA-Y-RETIRADOS.md.
--   · players.last_seen_at: marca de tiempo del último latido del móvil (reloj de la BD). Es lo ÚNICO que se guarda.
--   · players.presence_online: último estado REGISTRADO en game_events (para registrar solo los cambios).
--   · players.retired_at: el anfitrión «saca» al jugador de la TV/espectador; sus compras y saldo se conservan.
-- Nada de esto cambia saldos, pujas ni adjudicaciones. Ejecutar DESPUÉS de 20260101010101_security_spectator_access.sql.
alter table players add column if not exists last_seen_at timestamptz;
alter table players add column if not exists presence_online boolean not null default false;
alter table players add column if not exists retired_at timestamptz;

-- Margen de conexión: un móvil cuenta como CONECTADO si su último latido es de hace menos de 40 s (el móvil late cada ~15 s).
create or replace function ss_presence_window() returns interval language sql immutable as $$ select interval '40 seconds' $$;

-- Quien reclama una casilla (o entra como nuevo) nace «recién conectado»: da margen hasta su primer latido.
create or replace function ss_players_presence_claim() returns trigger language plpgsql as $$
begin
  if new.token_hash is null then
    new.presence_online := false;
  elsif TG_OP = 'INSERT' then
    new.last_seen_at := clock_timestamp(); new.presence_online := true;
  elsif old.token_hash is null then
    new.last_seen_at := clock_timestamp(); new.presence_online := true;
  end if;
  return new;
end $$;
drop trigger if exists players_presence_claim on players;
create trigger players_presence_claim before insert or update of token_hash on players for each row execute function ss_players_presence_claim();

-- «Reiniciar partida» (vuelta a la sala de espera) devuelve a la TV a todos los retirados.
create or replace function ss_unretire_on_reset() returns trigger language plpgsql as $$
begin
  if new.status = 'lobby' and old.status is distinct from 'lobby' then
    update players set retired_at = null where game_id = new.id and retired_at is not null;
  end if;
  return new;
end $$;
drop trigger if exists games_unretire_on_reset on games;
create trigger games_unretire_on_reset after update of status on games for each row execute function ss_unretire_on_reset();

-- Latido del móvil. Identidad por token (como ss_send_reaction). Camino rápido (ya estaba conectado): un UPDATE de SU fila, sin bloqueo
-- de la partida y sin ss_touch (no inunda Realtime). Solo cuando CAMBIA el estado (volvió tras estar desconectado) se toma el bloqueo,
-- se registra `player_reconnected` (partida en curso o en pausa) y se avisa. `bye` = aviso de salida (pagehide): marca desconectado ya.
create or replace function ss_player_ping(p jsonb) returns jsonb language plpgsql as $$
declare g games; pl players; v_bye boolean := coalesce(p->>'bye', '') = 'true'; v_live boolean; v_n int;
begin
  select * into g from games where room_code = upper(coalesce(p->>'room_code', ''));
  if not found or g.play_mode <> 'mobile' then perform ss_err('not_player'); end if;
  select * into pl from players where game_id = g.id and token_hash = p->>'token_hash' and p->>'token_hash' is not null;
  if not found then perform ss_err('not_player'); end if;

  if not v_bye then
    update players set last_seen_at = clock_timestamp() where id = pl.id and presence_online;
    get diagnostics v_n = row_count;
    if v_n > 0 then return jsonb_build_object('ok', true, 'retired', pl.retired_at is not null, 'changed', false); end if;
  end if;

  -- Camino lento: cambia el estado de conexión.
  g := ss_lock_game_public(p->>'room_code');
  select * into pl from players where id = pl.id and game_id = g.id and token_hash = p->>'token_hash' for update;
  if not found then perform ss_err('not_player'); end if;
  v_live := g.status in ('active', 'paused');
  if v_bye then
    -- Marca de salida: se retrasa el último latido más allá del margen para que el cálculo por tiempo coincida.
    update players set presence_online = false, last_seen_at = clock_timestamp() - ss_presence_window() - interval '1 second' where id = pl.id;
    if pl.presence_online and v_live then
      perform ss_log(g.id, null, 'player_disconnected', jsonb_build_object('player_id', pl.id, 'reason', 'bye'));
      perform ss_touch(g.id);
      return jsonb_build_object('ok', true, 'retired', pl.retired_at is not null, 'changed', true);
    end if;
    return jsonb_build_object('ok', true, 'retired', pl.retired_at is not null, 'changed', false);
  end if;
  update players set last_seen_at = clock_timestamp(), presence_online = true where id = pl.id;
  if not pl.presence_online and v_live then
    perform ss_log(g.id, null, 'player_reconnected', jsonb_build_object('player_id', pl.id));
    perform ss_touch(g.id);
    return jsonb_build_object('ok', true, 'retired', pl.retired_at is not null, 'changed', true);
  end if;
  return jsonb_build_object('ok', true, 'retired', pl.retired_at is not null, 'changed', false);
end $$;

-- Barrido de desconexiones: marca como desconectados (y registra `player_disconnected`, una vez) a quienes pasaron el margen sin latir.
-- Lo mueve cualquier lectura de la partida (autoAwardTick). Comprobación SIN bloqueo; solo bloquea si hay algo que cambiar.
create or replace function ss_presence_sweep(p jsonb) returns jsonb language plpgsql as $$
declare g games; r record; v_n int := 0;
begin
  select * into g from games where room_code = upper(coalesce(p->>'room_code', ''));
  if not found or g.play_mode <> 'mobile' or g.status not in ('active', 'paused') then return jsonb_build_object('changed', false); end if;
  if not exists (select 1 from players where game_id = g.id and token_hash is not null and presence_online
                   and last_seen_at < clock_timestamp() - ss_presence_window()) then
    return jsonb_build_object('changed', false);
  end if;
  g := ss_lock_game_public(p->>'room_code');
  if g.status not in ('active', 'paused') then return jsonb_build_object('changed', false); end if;
  for r in with d as (
      update players set presence_online = false
      where game_id = g.id and token_hash is not null and presence_online and last_seen_at < clock_timestamp() - ss_presence_window()
      returning id)
    select id from d loop
    perform ss_log(g.id, null, 'player_disconnected', jsonb_build_object('player_id', r.id, 'reason', 'timeout'));
    v_n := v_n + 1;
  end loop;
  if v_n > 0 then perform ss_touch(g.id); end if;
  return jsonb_build_object('changed', v_n > 0, 'count', v_n);
end $$;

-- «Sacar de la TV» / «Volver a mostrar» (anfitrión). Idempotentes; con registro. No tocan saldos ni compras ni la subasta en curso.
create or replace function ss_player_retire(p jsonb) returns jsonb language plpgsql as $$
declare g games; pl players; a auctions;
begin
  g := ss_lock_game(p->>'room_code', (p->>'host_id')::uuid);
  select * into pl from players where id = (p->>'player_id')::uuid and game_id = g.id for update;
  if not found then perform ss_err('player_not_found'); end if;
  if pl.retired_at is not null then return jsonb_build_object('ok', true, 'replay', true); end if;
  update players set retired_at = clock_timestamp() where id = pl.id;
  select * into a from auctions where id = g.current_auction_id and status = 'open';
  perform ss_log(g.id, g.host_id, 'player_retired', jsonb_build_object('player_id', pl.id, 'leading', coalesce(a.current_bidder_id = pl.id, false)));
  perform ss_touch(g.id);
  -- Si va ganando la subasta abierta NO se cambia nada: la decide el anfitrión (cancelar / adjudicar, siempre por ss_award_core).
  return jsonb_build_object('ok', true, 'leading', coalesce(a.current_bidder_id = pl.id, false));
end $$;

create or replace function ss_player_unretire(p jsonb) returns jsonb language plpgsql as $$
declare g games; pl players;
begin
  g := ss_lock_game(p->>'room_code', (p->>'host_id')::uuid);
  select * into pl from players where id = (p->>'player_id')::uuid and game_id = g.id for update;
  if not found then perform ss_err('player_not_found'); end if;
  if pl.retired_at is null then return jsonb_build_object('ok', true, 'replay', true); end if;
  update players set retired_at = null where id = pl.id;
  perform ss_log(g.id, g.host_id, 'player_unretired', jsonb_build_object('player_id', pl.id));
  perform ss_touch(g.id);
  return jsonb_build_object('ok', true);
end $$;

-- Un retirado no puede pujar, ceder, volver a pujar ni reaccionar desde el móvil. Con identidad válida se toma el bloqueo de la partida
-- (así una retirada concurrente no se cuela); sin identidad no se bloquea nada y la función base responde `not_player`.
create or replace function ss_assert_not_retired(p jsonb) returns void language plpgsql as $$
declare v_id uuid;
begin
  select pl.id into v_id from players pl join games g on g.id = pl.game_id
   where g.room_code = upper(coalesce(p->>'room_code', '')) and pl.token_hash = p->>'token_hash' and p->>'token_hash' is not null;
  if v_id is null then return; end if;
  perform ss_lock_game_public(p->>'room_code');
  if exists (select 1 from players where id = v_id and retired_at is not null) then perform ss_err('player_retired'); end if;
end $$;

alter function ss_player_bid(jsonb) rename to ss_player_bid_pre_retire;
create or replace function ss_player_bid(p jsonb) returns jsonb language plpgsql as $$
begin
  perform ss_assert_not_retired(p);
  return ss_player_bid_pre_retire(p);
end $$;

alter function ss_yield_bid(jsonb) rename to ss_yield_bid_pre_retire;
create or replace function ss_yield_bid(p jsonb) returns jsonb language plpgsql as $$
begin
  perform ss_assert_not_retired(p);
  return ss_yield_bid_pre_retire(p);
end $$;

alter function ss_unyield_bid(jsonb) rename to ss_unyield_bid_pre_retire;
create or replace function ss_unyield_bid(p jsonb) returns jsonb language plpgsql as $$
begin
  perform ss_assert_not_retired(p);
  return ss_unyield_bid_pre_retire(p);
end $$;

alter function ss_send_reaction(jsonb) rename to ss_send_reaction_pre_retire;
create or replace function ss_send_reaction(p jsonb) returns jsonb language plpgsql as $$
begin
  perform ss_assert_not_retired(p);
  return ss_send_reaction_pre_retire(p);
end $$;

-- Un retirado NO cuenta como contendiente. Copias de las últimas versiones (ss_yield_pending: 20260101009100; ss_all_broke: 20260101007600;
-- ss_bid_internal: 20260101008100) con la única diferencia `retired_at is null`.
create or replace function ss_yield_pending(g games, a auctions) returns boolean language sql stable as $$
  select exists (
    select 1 from players p
    where p.game_id = g.id and p.token_hash is not null and p.retired_at is null and p.id is distinct from a.current_bidder_id
      and p.balance_cents > a.current_bid_cents and p.balance_cents >= g.min_bid_cents
      and not exists (select 1 from auction_yields y where y.auction_id = a.id and y.player_id = p.id));
$$;

create or replace function ss_all_broke(g games) returns boolean language sql stable as $$
  select exists (select 1 from players p where p.game_id = g.id and p.retired_at is null and (g.play_mode <> 'mobile' or p.joined_at is not null))
     and not exists (select 1 from players p where p.game_id = g.id and p.retired_at is null and (g.play_mode <> 'mobile' or p.joined_at is not null) and p.balance_cents >= g.min_bid_cents);
$$;

create or replace function ss_bid_internal(g games, p jsonb, p_player uuid, p_source text) returns jsonb language plpgsql as $$
declare
  a auctions; pl players; replay jsonb; v_amount int; v_key text; v_bid uuid; res jsonb; v_sealed boolean;
begin
  v_key := p->>'idempotency_key';
  replay := ss_idem_get(g.id, v_key, 'place_bid');
  if replay is not null then return replay || jsonb_build_object('replay', true); end if;

  v_amount := (p->>'amount_cents')::int;
  if v_amount is null or v_amount <= 0 then perform ss_err('invalid_amount'); end if;
  if g.integer_bids and v_amount % 100 <> 0 then perform ss_err('bid_not_whole'); end if;
  if g.status = 'paused' then perform ss_err('game_paused'); end if;
  if g.status <> 'active' then perform ss_err('game_not_active'); end if;

  select * into a from auctions where id = (p->>'auction_id')::uuid and game_id = g.id for update;
  if not found then perform ss_err('auction_not_found'); end if;
  if a.status <> 'open' then perform ss_err('auction_closed'); end if;
  v_sealed := coalesce(a.wild_event = 'sealed', false);

  select * into pl from players where id = p_player and game_id = g.id for update;
  if not found then perform ss_err('player_not_found'); end if;

  if v_sealed and exists (select 1 from bids where auction_id = a.id and player_id = pl.id and voided_at is null) then
    perform ss_err('sealed_already_bid');
  end if;
  if v_amount > pl.balance_cents then perform ss_err('insufficient_balance'); end if;
  if v_amount < g.min_bid_cents then perform ss_err('bid_below_minimum'); end if;
  if not v_sealed then
    if v_amount <= a.current_bid_cents then perform ss_err('bid_too_low'); end if;
    -- Un jugador no puja contra sí mismo desde el móvil (evita subir la puja por error).
    if p_source = 'player' and a.current_bidder_id = pl.id then perform ss_err('already_leading'); end if;
  end if;

  insert into bids (auction_id, player_id, amount_cents, created_by_host_id, source)
  values (a.id, pl.id, v_amount, g.host_id, p_source) returning id into v_bid;
  if (not v_sealed) or v_amount > a.current_bid_cents then
    update auctions set current_bid_cents = v_amount, current_bidder_id = pl.id where id = a.id;
  end if;

  perform ss_log(g.id, case when p_source = 'host' then g.host_id else null end, 'bid_placed',
    jsonb_build_object('bid_id', v_bid, 'auction_id', a.id, 'player_id', pl.id, 'amount_cents', v_amount, 'source', p_source));
  res := jsonb_build_object('ok', true, 'bid_id', v_bid);
  -- Adjudicación AUTOMÁTICA instantánea: si nadie más puede superar la puja, se adjudica ya (no en sobre cerrado). Los retirados no cuentan.
  if g.auto_award_enabled and not v_sealed and not exists (
       select 1 from players p2 where p2.game_id = g.id and p2.id <> pl.id and p2.balance_cents > v_amount and p2.retired_at is null
          and (g.play_mode <> 'mobile' or p2.token_hash is not null)) then
    select * into a from auctions where id = a.id;
    res := res || ss_award_core(g, a, 'auto') || jsonb_build_object('auto_awarded', true, 'auto_reason', 'nobody_can_outbid');
  else
    perform ss_touch(g.id);
  end if;
  perform ss_idem_put(g.id, v_key, 'place_bid', res);
  return res;
end $$;

-- Instantánea: por jugador `retired` (público) y, en modo móviles, `online` (público, calculado por tiempo: nunca expone la marca exacta).
-- En la vista del anfitrión, además `last_seen_ago_seconds` (segundos desde el último latido). Sin latido registrado = recién conectado.
alter function ss_get_state(jsonb) rename to ss_get_state_pre_presence;
create or replace function ss_get_state(p jsonb) returns jsonb language plpgsql stable as $$
declare r jsonb; v_host boolean := coalesce(p->>'view', 'public') = 'host'; v_mobile boolean;
begin
  r := ss_get_state_pre_presence(p);
  if r ? 'players' and jsonb_typeof(r->'players') = 'array' then
    v_mobile := coalesce(r->'game'->>'play_mode', 'host') = 'mobile';
    r := jsonb_set(r, '{players}', coalesce((
      select jsonb_agg(
               t.e || jsonb_build_object('retired', pl.retired_at is not null)
                   || case when v_mobile then jsonb_build_object('online',
                        pl.token_hash is not null and (pl.last_seen_at is null or pl.last_seen_at >= clock_timestamp() - ss_presence_window())) else '{}'::jsonb end
                   || case when v_mobile and v_host and pl.token_hash is not null then jsonb_build_object('last_seen_ago_seconds',
                        case when pl.last_seen_at is null then 0 else greatest(0, floor(extract(epoch from clock_timestamp() - pl.last_seen_at))::int) end) else '{}'::jsonb end
               order by t.ord)
      from jsonb_array_elements(r->'players') with ordinality as t(e, ord)
      left join players pl on pl.id = (t.e->>'id')::uuid), '[]'::jsonb));
  end if;
  return r;
end $$;
