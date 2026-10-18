-- «Volver a pujar»: retractarse de ceder la puja (ver 20260101009100_yield_bid.sql). Nunca toca saldos.
-- Reglas (lo más simple y seguro):
--   · Solo con la subasta ABIERTA. Si ceder provocó la adjudicación inmediata o dio el elemento por perdido, la subasta ya no está
--     abierta (adjudicada / cancelada) y retractarse es imposible: así nunca se «deshace» un cobro ni un elemento perdido.
--   · Si OTRO jugador cedió después que tú, solo puedes retractarte en los primeros 8 s desde que cediste (un toque equivocado);
--     pasado ese tiempo, los demás ya han decidido contando con tu cesión y no se les cambia el escenario a mitad de remate.
--     Si nadie cedió después de ti, puedes retractarte en cualquier momento mientras la subasta siga abierta.
--   · Idempotente: si no habías cedido, responde ok con `replay`.
create or replace function ss_unyield_bid(p jsonb) returns jsonb language plpgsql as $$
declare g games; pl players; a auctions; y auction_yields; res jsonb := jsonb_build_object('ok', true);
begin
  g := ss_lock_game_public(p->>'room_code');
  if g.play_mode <> 'mobile' then perform ss_err('mobile_disabled'); end if;
  select * into pl from players where game_id = g.id and token_hash = p->>'token_hash' and p->>'token_hash' is not null;
  if not found then perform ss_err('not_player'); end if;
  if g.status = 'paused' then perform ss_err('game_paused'); end if;
  if g.status <> 'active' then perform ss_err('game_not_active'); end if;
  select * into a from auctions where id = (p->>'auction_id')::uuid and game_id = g.id for update;
  if not found then perform ss_err('auction_not_found'); end if;
  if a.status <> 'open' then perform ss_err('unyield_closed'); end if;
  select * into y from auction_yields where auction_id = a.id and player_id = pl.id;
  if not found then return res || jsonb_build_object('replay', true); end if;
  if exists (select 1 from auction_yields o where o.auction_id = a.id and o.player_id <> pl.id and o.created_at > y.created_at)
     and clock_timestamp() - y.created_at >= interval '8 seconds' then
    perform ss_err('unyield_too_late');
  end if;
  delete from auction_yields where auction_id = a.id and player_id = pl.id;
  perform ss_log(g.id, null, 'bid_unyielded', jsonb_build_object('auction_id', a.id, 'player_id', pl.id));
  perform ss_touch(g.id);
  return res;
end $$;
