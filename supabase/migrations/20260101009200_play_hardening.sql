-- Seguridad de las rutas de jugador (revisión docs/SEGURIDAD-PLAY.md). Ejecutar DESPUÉS de 20260101009101_security_yield_bid.sql.
-- «Ceder la puja» no debe revelar quién lidera una subasta A CIEGAS:
--   · el líder oculto ya no recibe `yield_leader` (que lo delataba a quien sondea sin coste): en una puja a ciegas su cesión
--     se registra igual que la de cualquiera (el líder sigue siéndolo; no puede volver a pujar por ese elemento);
--   · la instantánea PÚBLICA no expone `all_yielded` en una puja a ciegas (dependía del importe oculto).
-- No toca saldos ni la adjudicación (sigue siendo ss_award_core).
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
  if a.current_bidder_id = pl.id and a.wild_event is distinct from 'blind' then perform ss_err('yield_leader'); end if;
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

alter function ss_get_state(jsonb) rename to ss_get_state_pre_play_hardening;
create or replace function ss_get_state(p jsonb) returns jsonb language plpgsql stable as $$
declare res jsonb;
begin
  res := ss_get_state_pre_play_hardening(p);
  if coalesce(p->>'view', 'public') <> 'host' and jsonb_typeof(res->'auction') = 'object'
     and (res->'auction'->>'wild_event') = 'blind' and res->'auction' ? 'all_yielded' then
    res := jsonb_set(res, '{auction,all_yielded}', 'false'::jsonb);
  end if;
  return res;
end $$;
