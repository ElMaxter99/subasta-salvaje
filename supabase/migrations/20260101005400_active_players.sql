-- Jugadores que nunca entran (modo móviles): no cuentan para la adjudicación automática ni salen en el resultado final.
--  · «Activo» = en modo móviles, tiene el móvil identificado ahora; en modo anfitrión, todos.
--  · «Ha entrado» = alguna vez se identificó su móvil (joined_at). En modo anfitrión siempre es verdadero.
alter table players add column if not exists joined_at timestamptz;
update players set joined_at = coalesce(created_at, now())
 where joined_at is null and (token_hash is not null or exists (select 1 from purchases pu where pu.player_id = players.id));

create or replace function ss_players_joined() returns trigger language plpgsql as $$
begin
  if new.token_hash is not null and new.joined_at is null then new.joined_at := now(); end if;
  return new;
end $$;
drop trigger if exists players_joined on players;
create trigger players_joined before insert or update of token_hash on players for each row execute function ss_players_joined();

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
  -- «Pueden superarla» = los OTROS jugadores ACTIVOS con saldo: en modo móviles solo cuentan los que están dentro (móvil identificado);
  -- uno que nunca entró, o se salió, no puede pujar y no debe impedir la adjudicación automática.
  if g.auto_award_enabled and not exists (
       select 1 from players p2 where p2.game_id = g.id and p2.id <> pl.id and p2.balance_cents > v_amount
          and (g.play_mode <> 'mobile' or p2.token_hash is not null)) then
    select * into a from auctions where id = a.id;
    res := res || ss_award_core(g, a, 'auto') || jsonb_build_object('auto_awarded', true, 'auto_reason', 'nobody_can_outbid');
  else
    perform ss_touch(g.id);
  end if;
  perform ss_idem_put(g.id, v_key, 'place_bid', res);
  return res;
end $$;

-- La instantánea indica por jugador si «ha entrado» (para ocultar en el resultado final a quien nunca se unió).
alter function ss_get_state(jsonb) rename to ss_get_state_pre_joined;
create or replace function ss_get_state(p jsonb) returns jsonb language plpgsql stable as $$
declare r jsonb;
begin
  r := ss_get_state_pre_joined(p);
  if r ? 'players' and jsonb_typeof(r->'players') = 'array' then
    r := jsonb_set(r, '{players}', coalesce((
      select jsonb_agg(t.e || jsonb_build_object('joined',
               coalesce(r->'game'->>'play_mode', 'host') <> 'mobile'
               or coalesce((select pl.joined_at is not null from players pl where pl.id = (t.e->>'id')::uuid), false)) order by t.ord)
      from jsonb_array_elements(r->'players') with ordinality as t(e, ord)), '[]'::jsonb));
  end if;
  return r;
end $$;
