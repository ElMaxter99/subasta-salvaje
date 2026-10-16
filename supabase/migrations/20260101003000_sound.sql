-- Sonido de la partida: el anfitrión puede silenciar o activar los efectos y la música de la TV desde su panel.
alter table games add column if not exists sound_enabled boolean not null default true;
alter table games add column if not exists music_enabled boolean not null default true;

create or replace function ss_set_sound(p jsonb) returns jsonb language plpgsql as $$
declare g games;
begin
  g := ss_lock_game(p->>'room_code', (p->>'host_id')::uuid);
  if p ? 'sound_enabled' then update games set sound_enabled = (p->>'sound_enabled')::boolean where id = g.id; end if;
  if p ? 'music_enabled' then update games set music_enabled = (p->>'music_enabled')::boolean where id = g.id; end if;
  perform ss_touch(g.id);
  return jsonb_build_object('ok', true);
end $$;

-- Estado: se añaden los dos interruptores (la función anterior pasa a ser ss_get_state_prev2).
alter function ss_get_state(jsonb) rename to ss_get_state_prev2;
create or replace function ss_get_state(p jsonb) returns jsonb language plpgsql stable as $$
declare res jsonb; g games;
begin
  res := ss_get_state_prev2(p);
  select * into g from games where room_code = upper(coalesce(p->>'room_code', ''));
  return jsonb_set(res, '{game}', (res->'game') || jsonb_build_object('sound_enabled', g.sound_enabled, 'music_enabled', g.music_enabled));
end $$;
