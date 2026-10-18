-- Estadísticas por jugador al terminar la partida (solo lectura): pujas, puja más alta, subastas en las que pujó, elementos ganados, gasto y
-- veces que cedió la puja. La instantánea las incluye únicamente con la partida terminada (`player_stats`); nunca modifica nada.
-- Ejecutar DESPUÉS de 20260101009101_security_yield_bid.sql.
create or replace function ss_player_stats(g games) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'player_id', pl.id,
    'bids_count', (select count(*) from bids b join auctions a on a.id = b.auction_id where a.game_id = g.id and b.player_id = pl.id and b.voided_at is null),
    'max_bid_cents', coalesce((select max(b.amount_cents) from bids b join auctions a on a.id = b.auction_id where a.game_id = g.id and b.player_id = pl.id and b.voided_at is null), 0),
    'auctions_bid', (select count(distinct b.auction_id) from bids b join auctions a on a.id = b.auction_id where a.game_id = g.id and b.player_id = pl.id and b.voided_at is null),
    'wins', (select count(*) from purchases pu where pu.game_id = g.id and pu.player_id = pl.id),
    'spent_cents', coalesce((select sum(pu.price_cents) from purchases pu where pu.game_id = g.id and pu.player_id = pl.id), 0),
    'yields_count', (select count(*) from auction_yields y join auctions a on a.id = y.auction_id where a.game_id = g.id and y.player_id = pl.id)
  ) order by pl.sort_order), '[]'::jsonb)
  from players pl where pl.game_id = g.id;
$$;

alter function ss_get_state(jsonb) rename to ss_get_state_pre_stats;
create or replace function ss_get_state(p jsonb) returns jsonb language plpgsql stable as $$
declare res jsonb; g games;
begin
  res := ss_get_state_pre_stats(p);
  select * into g from games where room_code = upper(coalesce(p->>'room_code', ''));
  if g.status = 'finished' then res := res || jsonb_build_object('player_stats', ss_player_stats(g)); end if;
  return res;
end $$;
