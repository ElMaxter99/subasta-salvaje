-- Control de acceso REAL del espectador: el enlace /game/CODE/watch exige una clave secreta (capacidad) por partida.
--  · games.spectator_token: 64 hex aleatorios (dos UUID v4 sin guiones), distinta en cada partida (también en las ya existentes).
--  · Solo se muestra al anfitrión de la partida (ss_spectator_token) y nunca forma parte de la instantánea pública.
--  · El anfitrión puede regenerarla (ss_spectator_regenerate): el enlace anterior deja de funcionar al instante.
--  · ss_spectator_check compara hashes SHA-256 (no la clave en claro) y exige que el modo espectador esté activo.
-- La instantánea pública por código de sala (TV, resultados) NO cambia: este control solo gobierna la ruta de espectador.
-- Ejecutar DESPUÉS de 20260101009901_security_observability.sql.
alter table games add column if not exists spectator_token text;
update games set spectator_token = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '') where spectator_token is null;
alter table games alter column spectator_token set default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''));
alter table games alter column spectator_token set not null;

create or replace function ss_spectator_token(p jsonb) returns jsonb language plpgsql stable as $$
declare t text;
begin
  select spectator_token into t from games where room_code = upper(coalesce(p->>'room_code', '')) and host_id = (p->>'host_id')::uuid;
  if t is null then
    if exists (select 1 from games where room_code = upper(coalesce(p->>'room_code', ''))) then perform ss_err('not_host'); end if;
    perform ss_err('game_not_found');
  end if;
  return jsonb_build_object('token', t);
end $$;

create or replace function ss_spectator_regenerate(p jsonb) returns jsonb language plpgsql as $$
declare g games;
begin
  g := ss_lock_game(p->>'room_code', (p->>'host_id')::uuid);
  update games set spectator_token = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '') where id = g.id;
  perform ss_log(g.id, g.host_id, 'spectator_token_regenerated', '{}'::jsonb);
  perform ss_touch(g.id);
  return jsonb_build_object('ok', true);
end $$;

-- ¿Es válida la clave para esta partida y está el modo espectador activo? Devuelve siempre {ok:boolean}; sala inexistente = no válida
-- (misma respuesta que una clave incorrecta, para no distinguir salas por este camino).
create or replace function ss_spectator_check(p jsonb) returns jsonb language sql stable as $$
  select jsonb_build_object('ok', coalesce((
    select g.spectator_enabled and sha256(convert_to(g.spectator_token, 'UTF8')) = sha256(convert_to(coalesce(p->>'token', ''), 'UTF8'))
    from games g where g.room_code = upper(coalesce(p->>'room_code', ''))), false));
$$;
