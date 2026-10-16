-- =============================================================================
-- Imagen inicial para jugadores ACTUALES y/o NUEVOS (desde el panel del anfitrión, sala de espera):
--   · kind 'file':     una imagen (subida o de la galería) -> se aplica a los jugadores actuales y/o se guarda
--                      como imagen por defecto de los que se unan después (desde el móvil o añadidos en el panel);
--   · kind 'generate': se encola la generación de la imagen inicial (IA o pegatinas según el modo de la partida)
--                      para los actuales y/o los nuevos;
--   · kind 'clear':    quita la imagen por defecto de los nuevos.
-- Ejecutar DESPUÉS de 20260101001400_delete_games.sql.
-- =============================================================================

alter table games add column new_player_image jsonb;

-- Aplica la imagen por defecto de la partida a UN jugador recién creado (no hace nada si no hay).
create or replace function ss_apply_default_image(g games, p_player uuid) returns void language plpgsql as $$
declare v_ver uuid; d jsonb := g.new_player_image;
begin
  if d is null then return; end if;
  if d->>'kind' = 'file' then
    insert into image_versions (game_id, player_id, storage_path, origin, provider, mime_type, bytes, is_approved)
    values (g.id, p_player, d->>'storage_path', 'uploaded', coalesce(d->>'provider', 'upload'), d->>'mime_type', (d->>'bytes')::int, true)
    returning id into v_ver;
    update players set current_image_version_id = v_ver where id = p_player;
  elsif d->>'kind' = 'generate' then
    if not exists (select 1 from image_jobs where player_id = p_player and kind = 'initial' and status in ('queued','running')) then
      insert into image_jobs (game_id, kind, player_id) values (g.id, 'initial', p_player);
    end if;
  end if;
end $$;

create or replace function ss_apply_initial_image(p jsonb) returns jsonb language plpgsql as $$
declare
  g games; pl players; v_ver uuid; v_kind text := p->>'kind';
  v_cur boolean := coalesce((p->>'scope_current')::boolean, true);
  v_new boolean := coalesce((p->>'scope_new')::boolean, false);
  v_applied int := 0; v_default jsonb;
begin
  g := ss_lock_game(p->>'room_code', (p->>'host_id')::uuid);
  if g.status <> 'lobby' then perform ss_err('game_already_started'); end if;
  if v_kind not in ('file','generate','clear') then perform ss_err('invalid_action'); end if;
  if not v_cur and not v_new then perform ss_err('invalid_input'); end if;

  if v_kind = 'file' then
    v_default := jsonb_build_object('kind', 'file', 'storage_path', p->>'storage_path', 'mime_type', p->>'mime_type',
                                    'bytes', (p->>'bytes')::int, 'provider', coalesce(p->>'provider', 'upload'));
    if v_cur then
      for pl in select * from players where game_id = g.id order by sort_order for update loop
        insert into image_versions (game_id, player_id, storage_path, origin, provider, mime_type, bytes, is_approved)
        values (g.id, pl.id, p->>'storage_path', 'uploaded', coalesce(p->>'provider', 'upload'), p->>'mime_type', (p->>'bytes')::int, true)
        returning id into v_ver;
        update players set current_image_version_id = v_ver where id = pl.id;
        v_applied := v_applied + 1;
      end loop;
    end if;
  elsif v_kind = 'generate' then
    v_default := jsonb_build_object('kind', 'generate');
    if v_cur then
      if (select count(*) from image_jobs where game_id = g.id) + (select count(*) from players where game_id = g.id) > 150 then
        perform ss_err('image_quota_exceeded');
      end if;
      for pl in select * from players where game_id = g.id order by sort_order loop
        if not exists (select 1 from image_jobs where player_id = pl.id and kind = 'initial' and status in ('queued','running')) then
          insert into image_jobs (game_id, kind, player_id) values (g.id, 'initial', pl.id);
          v_applied := v_applied + 1;
        end if;
      end loop;
    end if;
  end if;

  if v_new then
    update games set new_player_image = case when v_kind = 'clear' then null else v_default end where id = g.id;
  end if;
  if v_kind = 'clear' and not v_new then perform ss_err('invalid_input'); end if;

  perform ss_log(g.id, g.host_id, 'initial_image_applied',
    jsonb_build_object('kind', v_kind, 'scope_current', v_cur, 'scope_new', v_new, 'applied', v_applied));
  perform ss_touch(g.id);
  return jsonb_build_object('ok', true, 'applied', v_applied);
end $$;

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
    if (select count(*) from players where game_id = g.id) >= 12 then perform ss_err('too_many_players'); end if;
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

create or replace function ss_join_new_player(p jsonb) returns jsonb language plpgsql as $$
declare g games; v_id uuid; v_n int; v_path text; v_mime text; v_prov text; v_ver uuid;
begin
  g := ss_lock_game_public(p->>'room_code');
  if g.play_mode <> 'mobile' then perform ss_err('mobile_disabled'); end if;
  if g.join_policy = 'closed' then perform ss_err('room_closed'); end if;
  if g.join_policy <> 'open' then perform ss_err('new_names_disabled'); end if;
  if g.status <> 'lobby' then perform ss_err('game_already_started'); end if;
  if (select count(*) from players where game_id = g.id) >= 12 then perform ss_err('too_many_players'); end if;
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

create or replace function ss_get_state(p jsonb) returns jsonb language plpgsql stable as $$
declare
  g games;
  v_host boolean := coalesce(p->>'view', 'public') = 'host';
  res jsonb;
begin
  select * into g from games where room_code = upper(coalesce(p->>'room_code', ''));
  if not found then perform ss_err('game_not_found'); end if;
  if v_host and (p->>'host_id' is null or g.host_id <> (p->>'host_id')::uuid) then
    perform ss_err('not_host');
  end if;

  res := jsonb_build_object(
    'version', g.version,
    'server_time', clock_timestamp(),
    'game', jsonb_build_object(
      'id', g.id, 'room_code', g.room_code, 'name', g.name, 'status', g.status, 'theme', g.theme,
      'initial_budget_cents', g.initial_budget_cents, 'min_bid_cents', g.min_bid_cents,
      'ranking_rule', g.ranking_rule, 'play_mode', g.play_mode, 'join_policy', g.join_policy,
      'image_mode', g.image_mode, 'new_player_image_kind', g.new_player_image->>'kind', 'auto_award_enabled', g.auto_award_enabled, 'auto_award_seconds', g.auto_award_seconds, 'current_auction_id', g.current_auction_id,
      'created_at', g.created_at, 'finished_at', g.finished_at,
      'total_rounds', (select count(*) from auction_items where game_id = g.id),
      'rounds_completed', (select count(*) from auctions where game_id = g.id and status = 'awarded')),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pl.id, 'name', pl.name, 'color', pl.color, 'sort_order', pl.sort_order,
        'balance_cents', pl.balance_cents, 'votes', pl.votes, 'claimed', (pl.token_hash is not null),
        'current_image_version_id', pl.current_image_version_id,
        'current_image', (select jsonb_build_object('id', v.id, 'storage_path', v.storage_path,
                              'provider', v.provider, 'created_at', v.created_at)
                          from image_versions v where v.id = pl.current_image_version_id),
        'initial_image', (select jsonb_build_object('id', v.id, 'storage_path', v.storage_path,
                              'provider', v.provider, 'created_at', v.created_at)
                          from image_versions v where v.id = pl.initial_image_version_id),
        'purchases', coalesce((
          select jsonb_agg(jsonb_build_object('purchase_id', pu.id, 'item_id', it.id, 'name', it.name,
                                              'emoji', it.emoji, 'price_cents', pu.price_cents, 'created_at', pu.created_at)
                           order by pu.created_at, pu.id)
          from purchases pu join auction_items it on it.id = pu.auction_item_id where pu.player_id = pl.id), '[]'::jsonb),
        'generating', coalesce((
          select jsonb_agg(jsonb_build_object('job_id', jb.id, 'kind', jb.kind, 'status', jb.status,
                                              'item_name', it.name) order by jb.created_at)
          from image_jobs jb
          left join purchases pu on pu.id = jb.purchase_id
          left join auction_items it on it.id = pu.auction_item_id
          where jb.player_id = pl.id and jb.status in ('queued','running')), '[]'::jsonb)
      ) order by pl.sort_order, pl.created_at)
      from players pl where pl.game_id = g.id), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('id', it.id, 'name', it.name, 'description', it.description,
                                           'emoji', it.emoji, 'image_path', it.image_path,
                                           'sort_order', it.sort_order, 'status', it.status)
                       order by it.sort_order, it.created_at)
      from auction_items it where it.game_id = g.id), '[]'::jsonb),
    'auction', (
      select jsonb_build_object(
        'id', a.id, 'status', a.status, 'round_number', a.round_number,
        'current_bid_cents', a.current_bid_cents, 'current_bidder_id', a.current_bidder_id,
        'winner_id', a.winner_id, 'final_price_cents', a.final_price_cents,
        'opened_at', a.opened_at, 'closed_at', a.closed_at,
        'auto_award_at', case when g.auto_award_enabled and a.status = 'open' and a.current_bidder_id is not null then
          greatest(coalesce((select max(b2.created_at) from bids b2 where b2.auction_id = a.id and b2.voided_at is null), a.opened_at), a.timer_reset_at) + make_interval(secs => g.auto_award_seconds) end,
        'item', jsonb_build_object('id', it.id, 'name', it.name, 'description', it.description,
                                   'emoji', it.emoji, 'image_path', it.image_path),
        'bids', coalesce((
          select jsonb_agg(jsonb_build_object('id', b.id, 'player_id', b.player_id,
                                              'amount_cents', b.amount_cents, 'created_at', b.created_at)
                           order by b.amount_cents desc, b.id desc)
          from (select * from bids where auction_id = a.id and voided_at is null
                order by amount_cents desc, id desc limit 15) b), '[]'::jsonb))
      from auctions a join auction_items it on it.id = a.auction_item_id where a.id = g.current_auction_id),
    'last_award', (
      select jsonb_build_object('purchase_id', pu.id, 'player_id', pu.player_id, 'item_name', it.name,
                                'emoji', it.emoji, 'price_cents', pu.price_cents, 'created_at', pu.created_at)
      from purchases pu join auction_items it on it.id = pu.auction_item_id
      where pu.game_id = g.id order by pu.created_at desc, pu.id desc limit 1),
    'stats', jsonb_build_object(
      'purchases_count', (select count(*) from purchases where game_id = g.id),
      'total_spent_cents', coalesce((select sum(price_cents) from purchases where game_id = g.id), 0),
      'bids_count', (select count(*) from bids b join auctions a on a.id = b.auction_id
                     where a.game_id = g.id and b.voided_at is null),
      'cancelled_auctions', (select count(*) from auctions where game_id = g.id and status = 'cancelled'))
  );

  if v_host then
    res := res || jsonb_build_object(
      'host_id', g.host_id,
      'jobs', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', jb.id, 'kind', jb.kind, 'status', jb.status, 'attempts', jb.attempts, 'max_attempts', jb.max_attempts,
          'error_message', jb.error_message, 'player_id', jb.player_id, 'player_name', pl.name,
          'item_id', coalesce(jb.item_id, it.id), 'item_name', it.name, 'purchase_id', jb.purchase_id,
          'result_version_id', jb.result_version_id, 'run_after', jb.run_after,
          'created_at', jb.created_at, 'started_at', jb.started_at, 'finished_at', jb.finished_at)
          order by jb.created_at desc)
        from (select * from image_jobs where game_id = g.id order by created_at desc limit 60) jb
        left join players pl on pl.id = jb.player_id
        left join purchases pu on pu.id = jb.purchase_id
        left join auction_items it on it.id = coalesce(jb.item_id, pu.auction_item_id)), '[]'::jsonb),
      'versions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', v.id, 'player_id', v.player_id, 'parent_version_id', v.parent_version_id,
          'storage_path', v.storage_path, 'source_purchase_id', v.source_purchase_id,
          'item_name', it.name, 'origin', v.origin, 'provider', v.provider,
          'prompt_used', v.prompt_used, 'generation_status', v.generation_status,
          'is_approved', v.is_approved, 'error_message', v.error_message, 'created_at', v.created_at)
          order by v.created_at asc, v.id)
        from image_versions v
        left join purchases pu on pu.id = v.source_purchase_id
        left join auction_items it on it.id = pu.auction_item_id
        where v.game_id = g.id), '[]'::jsonb),
      'events', coalesce((
        select jsonb_agg(jsonb_build_object('id', e.id, 'event_type', e.event_type, 'payload', e.payload,
                                            'created_at', e.created_at) order by e.id desc)
        from (select * from game_events where game_id = g.id order by id desc limit 40) e), '[]'::jsonb)
    );
  end if;
  return res;
end $$;

