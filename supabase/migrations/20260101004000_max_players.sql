-- Máximo de jugadores por partida: configurable por el anfitrión (1..10) y 10 por defecto.
-- El tope de la aplicación (10) vive en ss_max_players_cap(); nadie con el código de la partida puede pasarlo.
-- Las partidas existentes quedan en 10 (las que ya tuvieran más conservan a sus jugadores, pero no admiten más).

create or replace function ss_max_players_cap() returns int language sql immutable as $$ select 10 $$;

alter table games add column max_players integer not null default 10 check (max_players between 1 and 10);

-- Alta de partida: valida el máximo y que la lista inicial de jugadores quepa.
create or replace function ss_create_game(p jsonb) returns jsonb language plpgsql as $$
declare
  g_id uuid;
  code text;
  pl jsonb;
  it jsonb;
  idx int := 0;
  v_budget int := coalesce((p->>'initial_budget_cents')::int, 2000);
  v_max int := coalesce(nullif(p->>'max_players', '')::int, ss_max_players_cap());
begin
  if (p->>'host_id') is null then perform ss_err('not_host'); end if;
  if v_max < 1 or v_max > ss_max_players_cap() then perform ss_err('invalid_input'); end if;
  if jsonb_array_length(coalesce(p->'players', '[]'::jsonb)) > v_max then perform ss_err('too_many_players'); end if;
  if (select count(distinct lower(e->>'name')) from jsonb_array_elements(coalesce(p->'players','[]'::jsonb)) e)
     <> jsonb_array_length(coalesce(p->'players','[]'::jsonb)) then perform ss_err('duplicate_name'); end if;
  code := ss_gen_room_code();
  insert into games (room_code, host_id, name, theme, initial_budget_cents, min_bid_cents, ranking_rule, play_mode, image_mode, max_players)
  values (code, (p->>'host_id')::uuid, p->>'name', coalesce(p->>'theme', 'house'), v_budget,
          coalesce((p->>'min_bid_cents')::int, 100), coalesce(p->>'ranking_rule', 'none'), coalesce(p->>'play_mode', 'host'), coalesce(p->>'image_mode', 'stickers'), v_max)
  returning id into g_id;

  for pl in select * from jsonb_array_elements(coalesce(p->'players', '[]'::jsonb)) loop
    idx := idx + 1;
    insert into players (game_id, name, color, sort_order, balance_cents)
    values (g_id, pl->>'name', coalesce(pl->>'color', '#a78bfa'), idx, v_budget);
  end loop;

  idx := 0;
  for it in select * from jsonb_array_elements(coalesce(p->'items', '[]'::jsonb)) loop
    idx := idx + 1;
    insert into auction_items (game_id, name, description, emoji, sort_order)
    values (g_id, it->>'name', coalesce(it->>'description', ''), it->>'emoji', idx);
  end loop;

  perform ss_log(g_id, (p->>'host_id')::uuid, 'game_created', jsonb_build_object('room_code', code));
  return jsonb_build_object('game_id', g_id, 'room_code', code);
end $$;

-- Anfitrión añade jugadores (sala de espera): respeta el máximo de ESTA partida.
create or replace function ss_player_op(p jsonb) returns jsonb language plpgsql as $$
declare
  g games; v_op text := p->>'op'; v_id uuid; v_pid uuid; i int := 0; v_ids jsonb;
begin
  g := ss_lock_game(p->>'room_code', (p->>'host_id')::uuid);

  if (v_op = 'add' or v_op = 'update') and p->>'name' is not null
     and exists (select 1 from players where game_id = g.id and lower(name) = lower(p->>'name')
                 and id is distinct from (p->>'player_id')::uuid) then
    perform ss_err('duplicate_name');
  end if;

  if v_op = 'add' then
    if g.status <> 'lobby' then perform ss_err('game_already_started'); end if;
    if (select count(*) from players where game_id = g.id) >= g.max_players then perform ss_err('too_many_players'); end if;
    insert into players (game_id, name, color, sort_order, balance_cents)
    values (g.id, p->>'name', coalesce(p->>'color', '#a78bfa'),
            coalesce((select max(sort_order) from players where game_id = g.id), 0) + 1, g.initial_budget_cents)
    returning id into v_id;
    perform ss_apply_default_image(g, v_id);
  elsif v_op = 'update' then
    v_id := (p->>'player_id')::uuid;
    update players set name = coalesce(p->>'name', name), color = coalesce(p->>'color', color)
    where id = v_id and game_id = g.id;
    if not found then perform ss_err('player_not_found'); end if;
  elsif v_op = 'remove' then
    if g.status <> 'lobby' then perform ss_err('game_already_started'); end if;
    v_id := (p->>'player_id')::uuid;
    delete from players where id = v_id and game_id = g.id;
    if not found then perform ss_err('player_not_found'); end if;
  elsif v_op = 'reorder' then
    if g.status <> 'lobby' then perform ss_err('game_already_started'); end if;
    v_ids := p->'ordered_ids';
    for v_pid in select (jsonb_array_elements_text(v_ids))::uuid loop
      i := i + 1;
      update players set sort_order = i where id = v_pid and game_id = g.id;
    end loop;
  else
    perform ss_err('invalid_action');
  end if;

  perform ss_log(g.id, g.host_id, 'player_' || v_op, jsonb_build_object('player_id', v_id));
  perform ss_touch(g.id);
  return jsonb_build_object('ok', true, 'player_id', v_id);
end $$;

-- Un jugador se une desde su móvil: respeta el máximo de ESTA partida.
create or replace function ss_join_new_player(p jsonb) returns jsonb language plpgsql as $$
declare g games; v_id uuid; v_n int; v_path text; v_mime text; v_prov text; v_ver uuid;
begin
  g := ss_lock_game_public(p->>'room_code');
  if g.play_mode <> 'mobile' then perform ss_err('mobile_disabled'); end if;
  if g.join_policy = 'closed' then perform ss_err('room_closed'); end if;
  if g.join_policy <> 'open' then perform ss_err('new_names_disabled'); end if;
  if g.status <> 'lobby' then perform ss_err('game_already_started'); end if;
  if (select count(*) from players where game_id = g.id) >= g.max_players then perform ss_err('too_many_players'); end if;
  if exists (select 1 from players where game_id = g.id and lower(name) = lower(p->>'name')) then perform ss_err('duplicate_name'); end if;
  insert into players (game_id, name, color, sort_order, balance_cents, token_hash)
  values (g.id, p->>'name', coalesce(p->>'color', '#a78bfa'),
          coalesce((select max(sort_order) from players where game_id = g.id), 0) + 1, g.initial_budget_cents, p->>'token_hash')
  returning id into v_id;
  -- Si todos los demás comparten la MISMA imagen actual (p. ej. la imagen de partida común), el nuevo la hereda.
  perform ss_apply_default_image(g, v_id);
  select count(distinct v.storage_path), min(v.storage_path), min(v.mime_type), min(v.provider)
    into v_n, v_path, v_mime, v_prov
  from players pl join image_versions v on v.id = pl.current_image_version_id
  where pl.game_id = g.id and pl.id <> v_id;
  if g.new_player_image is null and v_n = 1 and (select count(*) from players where game_id = g.id and id <> v_id and current_image_version_id is null) = 0 then
    insert into image_versions (game_id, player_id, storage_path, origin, provider, mime_type, is_approved)
    values (g.id, v_id, v_path, 'uploaded', coalesce(v_prov, 'upload'), v_mime, true) returning id into v_ver;
    update players set current_image_version_id = v_ver where id = v_id;
  end if;
  perform ss_log(g.id, null, 'player_joined', jsonb_build_object('player_id', v_id, 'new', true));
  perform ss_touch(g.id);
  return jsonb_build_object('ok', true, 'player_id', v_id);
end $$;

-- Cambiar el máximo desde las reglas (no puede quedar por debajo de los jugadores que ya hay).
create or replace function ss_set_game_rules(p jsonb) returns jsonb language plpgsql as $$
declare g games; v_rounds int; v_done int; v_max int;
begin
  g := ss_lock_game(p->>'room_code', (p->>'host_id')::uuid);
  if g.status = 'finished' then perform ss_err('game_finished'); end if;
  select count(*) into v_done from auctions where game_id = g.id and status = 'awarded';
  if p ? 'max_rounds' then
    -- null/ausente = todos los elementos del catálogo
    v_rounds := coalesce(nullif(p->>'max_rounds', '')::int, (select count(*) from auction_items where game_id = g.id));
    if v_rounds < 1 or v_rounds > 500 then perform ss_err('invalid_input'); end if;
    if v_rounds < v_done then perform ss_err('rounds_below_played'); end if;
    update games set max_rounds = v_rounds where id = g.id;
  end if;
  if p ? 'max_players' then
    v_max := (p->>'max_players')::int;
    if v_max < 1 or v_max > ss_max_players_cap() then perform ss_err('invalid_input'); end if;
    if v_max < (select count(*) from players where game_id = g.id) then perform ss_err('max_players_below_current'); end if;
    update games set max_players = v_max where id = g.id;
  end if;
  if p ? 'integer_bids' then
    update games set integer_bids = (p->>'integer_bids')::boolean where id = g.id;
  end if;
  perform ss_log(g.id, g.host_id, 'rules_changed', jsonb_build_object('max_rounds', p->>'max_rounds', 'integer_bids', p->>'integer_bids', 'max_players', p->>'max_players'));
  perform ss_touch(g.id);
  return jsonb_build_object('ok', true);
end $$;

-- Estado: se expone el máximo en la instantánea.
alter function ss_get_state(jsonb) rename to ss_get_state_pre_maxplayers;

create or replace function ss_get_state(p jsonb) returns jsonb language plpgsql stable as $$
declare g games; res jsonb;
begin
  res := ss_get_state_pre_maxplayers(p);
  select * into g from games where room_code = upper(coalesce(p->>'room_code', ''));
  return jsonb_set(res, '{game}', (res->'game') || jsonb_build_object('max_players', g.max_players));
end $$;
