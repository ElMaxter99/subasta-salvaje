-- «Ceder la puja»: desde el móvil, un jugador marca que NO va a seguir pujando por el elemento en curso. Es irrevocable en esa subasta
-- (no puede volver a pujar por él) y agiliza la partida: cuando todos los demás jugadores conectados han cedido y alguien lleva la puja,
-- con la adjudicación automática activada se adjudica al instante (siempre por ss_award_core: cobro único); si nadie había pujado y todos
-- ceden, con la subasta automática el elemento se da por perdido sin esperar al reloj. Sin automáticas, el panel avisa al anfitrión.
-- Ejecutar DESPUÉS de 20260101009001_security_merge_fixups.sql. No cambia saldos por sí mismo.
create table auction_yields (
  auction_id uuid not null references auctions(id) on delete cascade,
  player_id  uuid not null references players(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  primary key (auction_id, player_id)
);

-- ¿Queda algún jugador conectado, distinto del líder, que pueda pujar más y no haya cedido?
create or replace function ss_yield_pending(g games, a auctions) returns boolean language sql stable as $$
  select exists (
    select 1 from players p
    where p.game_id = g.id and p.token_hash is not null and p.id is distinct from a.current_bidder_id
      and p.balance_cents > a.current_bid_cents and p.balance_cents >= g.min_bid_cents
      and not exists (select 1 from auction_yields y where y.auction_id = a.id and y.player_id = p.id));
$$;

create or replace function ss_yield_bid(p jsonb) returns jsonb language plpgsql as $$
declare g games; pl players; a auctions; res jsonb := jsonb_build_object('ok', true);
begin
  g := ss_lock_game_public(p->>'room_code');
  if g.play_mode <> 'mobile' then perform ss_err('mobile_disabled'); end if;
  select * into pl from players where game_id = g.id and token_hash = p->>'token_hash' and p->>'token_hash' is not null;
  if not found then perform ss_err('not_player'); end if;
  if g.status = 'paused' then perform ss_err('game_paused'); end if;
  if g.status <> 'active' then perform ss_err('game_not_active'); end if;
  select * into a from auctions where id = (p->>'auction_id')::uuid and game_id = g.id for update;
  if not found then perform ss_err('auction_not_found'); end if;
  if a.status <> 'open' then perform ss_err('auction_closed'); end if;
  if a.wild_event = 'sealed' then perform ss_err('yield_not_allowed'); end if;
  if a.current_bidder_id = pl.id then perform ss_err('yield_leader'); end if;
  if exists (select 1 from auction_yields where auction_id = a.id and player_id = pl.id) then
    return res || jsonb_build_object('replay', true);
  end if;
  insert into auction_yields (auction_id, player_id) values (a.id, pl.id);
  perform ss_log(g.id, null, 'bid_yielded', jsonb_build_object('auction_id', a.id, 'player_id', pl.id));

  if not ss_yield_pending(g, a) then
    if a.current_bidder_id is not null then
      if g.auto_award_enabled then
        res := res || ss_award_core(g, a, 'auto') || jsonb_build_object('auto_awarded', true, 'auto_reason', 'all_yielded');
        return res;
      end if;
    elsif g.auto_run_enabled then
      -- Nadie pujó y todos han cedido: se da por perdido (igual que al agotarse el tiempo sin pujas).
      update auctions set status = 'cancelled', closed_at = now(), counted = true where id = a.id;
      update auction_items set status = 'lost' where id = a.auction_item_id;
      update games set current_auction_id = null, auto_run_skips = auto_run_skips + 1 where id = g.id;
      perform ss_log(g.id, null, 'auction_unsold', jsonb_build_object('auction_id', a.id, 'item_id', a.auction_item_id, 'reason', 'all_yielded'));
      res := res || jsonb_build_object('unsold', true);
    end if;
  end if;
  perform ss_touch(g.id);
  return res;
end $$;

-- Quien ha cedido no puede volver a pujar por ese elemento (desde el móvil; el anfitrión sí puede registrar pujas a mano).
alter function ss_player_bid(jsonb) rename to ss_player_bid_pre_yield;
create or replace function ss_player_bid(p jsonb) returns jsonb language plpgsql as $$
begin
  if exists (
    select 1 from auction_yields y join players pl on pl.id = y.player_id
    join games g on g.id = pl.game_id
    where y.auction_id = (p->>'auction_id')::uuid and g.room_code = upper(coalesce(p->>'room_code', ''))
      and pl.token_hash = p->>'token_hash' and p->>'token_hash' is not null) then
    perform ss_err('already_yielded');
  end if;
  return ss_player_bid_pre_yield(p);
end $$;

-- La instantánea añade a la subasta en curso: `yielded` (quiénes han cedido) y `all_yielded` (nadie más puede seguir pujando).
alter function ss_get_state(jsonb) rename to ss_get_state_pre_yield;
create or replace function ss_get_state(p jsonb) returns jsonb language plpgsql stable as $$
declare res jsonb; g games; a auctions;
begin
  res := ss_get_state_pre_yield(p);
  if res->'auction' is null or jsonb_typeof(res->'auction') <> 'object' then return res; end if;
  select * into g from games where room_code = upper(coalesce(p->>'room_code', ''));
  select * into a from auctions where id = (res->'auction'->>'id')::uuid;
  if not found or a.status <> 'open' then return res; end if;
  return jsonb_set(res, '{auction}', (res->'auction') || jsonb_build_object(
    'yielded', coalesce((select jsonb_agg(y.player_id order by y.created_at) from auction_yields y where y.auction_id = a.id), '[]'::jsonb),
    'all_yielded', g.play_mode = 'mobile' and a.wild_event is distinct from 'sealed'
                   and exists (select 1 from auction_yields y where y.auction_id = a.id) and not ss_yield_pending(g, a)));
end $$;
