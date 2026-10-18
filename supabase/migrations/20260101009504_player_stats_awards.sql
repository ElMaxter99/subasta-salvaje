-- Más datos para los premios finales (solo lectura): envuelve ss_player_stats (20260101009400) y añade por jugador
--   · min_win_gap_cents: diferencia mínima entre su puja ganadora y la mejor puja de otro en las subastas que ganó (null si nunca hubo rival);
--   · first_bids: subastas adjudicadas en las que hizo la PRIMERA puja;
--   · comebacks: subastas ganadas tras haber sido superado antes;
--   · max_bids_one_auction: máximo de pujas suyas en una sola subasta.
alter function ss_player_stats(games) rename to ss_player_stats_pre_awards;
create or replace function ss_player_stats(g games) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(e.base || jsonb_build_object(
    'min_win_gap_cents', (
      select min(w.mine - w.other) from (
        select (select max(b.amount_cents) from bids b where b.auction_id = pu.auction_id and b.voided_at is null and b.player_id = pu.player_id) as mine,
               (select max(b.amount_cents) from bids b where b.auction_id = pu.auction_id and b.voided_at is null and b.player_id <> pu.player_id) as other
        from purchases pu where pu.game_id = g.id and pu.player_id = (e.base->>'player_id')::uuid) w
      where w.other is not null and w.mine is not null),
    'first_bids', (
      select count(*) from auctions a where a.game_id = g.id and a.status = 'awarded'
        and (select b.player_id from bids b where b.auction_id = a.id and b.voided_at is null order by b.created_at, b.id limit 1) = (e.base->>'player_id')::uuid),
    'comebacks', (
      select count(*) from purchases pu where pu.game_id = g.id and pu.player_id = (e.base->>'player_id')::uuid
        and exists (select 1 from bids y join bids o on o.auction_id = y.auction_id and o.player_id <> y.player_id and o.voided_at is null and o.created_at > y.created_at
                    where y.auction_id = pu.auction_id and y.player_id = pu.player_id and y.voided_at is null)),
    'max_bids_one_auction', coalesce((
      select max(c.n) from (select count(*) as n from bids b join auctions a on a.id = b.auction_id
        where a.game_id = g.id and b.player_id = (e.base->>'player_id')::uuid and b.voided_at is null group by b.auction_id) c), 0)
  ) order by e.ord), '[]'::jsonb)
  from jsonb_array_elements(ss_player_stats_pre_awards(g)) with ordinality as e(base, ord);
$$;
