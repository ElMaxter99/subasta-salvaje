-- Modo espectador: enlace público de solo lectura (/game/CODE/watch). El anfitrión puede desactivarlo por partida.
-- Solo es un interruptor de presentación: la instantánea pública ya es de solo lectura y no contiene datos del anfitrión.
alter table games add column if not exists spectator_enabled boolean not null default true;

create or replace function ss_set_spectator(p jsonb) returns jsonb language plpgsql as $$
declare g games;
begin
  g := ss_lock_game(p->>'room_code', (p->>'host_id')::uuid);
  if not (p ? 'spectator_enabled') or jsonb_typeof(p->'spectator_enabled') <> 'boolean' then perform ss_err('invalid_input'); end if;
  update games set spectator_enabled = (p->>'spectator_enabled')::boolean where id = g.id;
  perform ss_touch(g.id);
  return jsonb_build_object('ok', true);
end $$;

-- Estado: añade `game.spectator_enabled` (la función anterior pasa a ser ss_get_state_pre_spectator).
alter function ss_get_state(jsonb) rename to ss_get_state_pre_spectator;
create or replace function ss_get_state(p jsonb) returns jsonb language plpgsql stable as $$
declare res jsonb; g games;
begin
  res := ss_get_state_pre_spectator(p);
  select * into g from games where room_code = upper(coalesce(p->>'room_code', ''));
  if g.id is null then return res; end if;
  return jsonb_set(res, '{game}', (res->'game') || jsonb_build_object('spectator_enabled', g.spectator_enabled));
end $$;
