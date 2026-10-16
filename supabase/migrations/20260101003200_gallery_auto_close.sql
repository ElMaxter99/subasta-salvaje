-- Galería final: la votación se cierra sola cuando han votado TODOS los jugadores conectados (mínimo 2), para que la TV pase
-- al podio sin esperar al anfitrión. El anfitrión puede seguir cerrándola a mano en cualquier momento.
create or replace function ss_gallery_vote(p jsonb) returns jsonb language plpgsql as $$
declare g games; pl players; tg players; v_connected int; v_voters int; v_closed boolean := false;
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
  select count(*) into v_connected from players where game_id = g.id and token_hash is not null;
  select count(distinct voter_id) into v_voters from gallery_votes where game_id = g.id;
  if v_connected >= 2 and v_voters >= v_connected then
    update games set gallery_closed_at = now() where id = g.id;
    perform ss_log(g.id, g.host_id, 'gallery_closed', jsonb_build_object('auto', true));
    v_closed := true;
  end if;
  perform ss_touch(g.id);
  return jsonb_build_object('ok', true, 'auto_closed', v_closed);
end $$;
