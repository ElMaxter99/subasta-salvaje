-- Repetición de la partida (solo lectura, solo anfitrión): una fila por ronda cerrada (adjudicada o cancelada/perdida).
-- Las versiones de imagen de cada casa ya llegan en la instantánea del anfitrión (`versions`, con `source_purchase_id`).
create or replace function ss_get_replay(p jsonb) returns jsonb language plpgsql stable as $$
declare g games;
begin
  select * into g from games where room_code = upper(coalesce(p->>'room_code', ''));
  if not found then perform ss_err('game_not_found'); end if;
  if (p->>'host_id') is null or g.host_id <> (p->>'host_id')::uuid then perform ss_err('not_host'); end if;
  return jsonb_build_object('rounds', coalesce((
    select jsonb_agg(jsonb_build_object(
      'auction_id', a.id, 'round_number', a.round_number, 'status', a.status,
      'item_id', it.id, 'item_name', it.name, 'emoji', it.emoji, 'item_status', it.status,
      'winner_id', a.winner_id, 'price_cents', a.final_price_cents,
      'bids_count', (select count(*) from bids b where b.auction_id = a.id and b.voided_at is null),
      'purchase_id', pu.id, 'wild_event', a.wild_event,
      'opened_at', a.opened_at, 'closed_at', a.closed_at) order by a.opened_at, a.created_at)
    from auctions a join auction_items it on it.id = a.auction_item_id left join purchases pu on pu.auction_id = a.id
    where a.game_id = g.id), '[]'::jsonb));
end $$;
