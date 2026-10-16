-- Imagen inicial común para todos los jugadores (añadida tras la migración núcleo).
-- Ejecutar DESPUÉS de 20260101000000_core.sql y 20260101000100_security.sql.

-- Misma imagen inicial para TODOS los jugadores (subida o de la galería), sólo antes de empezar.
create or replace function ss_set_initial_all(p jsonb) returns jsonb language plpgsql as $$
declare g games; pl players; v_id uuid; v_count int := 0;
begin
  g := ss_lock_game(p->>'room_code', (p->>'host_id')::uuid);
  if g.status <> 'lobby' then perform ss_err('game_already_started'); end if;
  for pl in select * from players where game_id = g.id order by sort_order for update loop
    insert into image_versions (game_id, player_id, parent_version_id, storage_path, origin, provider, mime_type, bytes, is_approved)
    values (g.id, pl.id, null, p->>'storage_path', 'uploaded', coalesce(p->>'provider', 'upload'), p->>'mime_type', (p->>'bytes')::int, true)
    returning id into v_id;
    update players set current_image_version_id = v_id where id = pl.id;
    v_count := v_count + 1;
  end loop;
  if v_count = 0 then perform ss_err('player_not_found'); end if;
  perform ss_log(g.id, g.host_id, 'image_set_for_all', jsonb_build_object('players', v_count, 'provider', p->>'provider'));
  perform ss_touch(g.id);
  return jsonb_build_object('ok', true, 'players', v_count);
end $$;
