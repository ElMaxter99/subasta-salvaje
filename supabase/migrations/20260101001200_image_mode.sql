-- =============================================================================
-- Modo de imágenes por partida:
--   · 'stickers': pegatinas con emojis sobre la casa (ilustraciones locales, SIN IA, gratis e instantáneo);
--   · 'ai':       generación/edición con el proveedor de IA configurado (Cloudflare u OpenAI), con cuotas.
-- Se elige al crear la partida y sólo se puede cambiar en la sala de espera.
-- Ejecutar DESPUÉS de 20260101001000_auto_award.sql.
-- =============================================================================

alter table games add column image_mode text not null default 'stickers' check (image_mode in ('stickers','ai'));

create or replace function ss_create_game(p jsonb) returns jsonb language plpgsql as $$
declare
  g_id uuid;
  code text;
  pl jsonb;
  it jsonb;
  idx int := 0;
  v_budget int := coalesce((p->>'initial_budget_cents')::int, 2000);
begin
  if (p->>'host_id') is null then perform ss_err('not_host'); end if;
  if jsonb_array_length(coalesce(p->'players', '[]'::jsonb)) > 12 then perform ss_err('too_many_players'); end if;
  if (select count(distinct lower(e->>'name')) from jsonb_array_elements(coalesce(p->'players','[]'::jsonb)) e)
     <> jsonb_array_length(coalesce(p->'players','[]'::jsonb)) then perform ss_err('duplicate_name'); end if;
  code := ss_gen_room_code();
  insert into games (room_code, host_id, name, theme, initial_budget_cents, min_bid_cents, ranking_rule, play_mode, image_mode)
  values (code, (p->>'host_id')::uuid, p->>'name', coalesce(p->>'theme', 'house'), v_budget,
          coalesce((p->>'min_bid_cents')::int, 100), coalesce(p->>'ranking_rule', 'none'), coalesce(p->>'play_mode', 'host'), coalesce(p->>'image_mode', 'stickers'))
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

create or replace function ss_set_image_mode(p jsonb) returns jsonb language plpgsql as $$
declare g games;
begin
  g := ss_lock_game(p->>'room_code', (p->>'host_id')::uuid);
  if g.status <> 'lobby' then perform ss_err('game_already_started'); end if;
  if p->>'image_mode' not in ('stickers','ai') then perform ss_err('invalid_input'); end if;
  update games set image_mode = p->>'image_mode' where id = g.id;
  perform ss_log(g.id, g.host_id, 'image_mode_changed', jsonb_build_object('image_mode', p->>'image_mode'));
  perform ss_touch(g.id);
  return jsonb_build_object('ok', true);
end $$;

-- El worker sólo reclama trabajos de los modos para los que tiene proveedor (p->'image_modes').
create or replace function ss_claim_image_job(p jsonb) returns jsonb language plpgsql as $$
declare
  v_worker text := coalesce(p->>'worker_id', 'worker');
  v_lease int := coalesce((p->>'lease_seconds')::int, 300);
  v_candidate record;
  g games;
  j image_jobs;
  v_base image_versions;
  v_player players;
  v_item auction_items;
  v_msg text := 'El worker no terminó el trabajo';
begin
  select c.id, c.game_id into v_candidate
  from image_jobs c
  where ((c.status = 'queued' and c.run_after <= now()) or (c.status = 'running' and c.locked_until < now()))
    and (p->>'game_id' is null or c.game_id = (p->>'game_id')::uuid)
    and (p->'image_modes' is null or exists (
      select 1 from games gm where gm.id = c.game_id
        and gm.image_mode in (select jsonb_array_elements_text(p->'image_modes'))))
    and not exists (
      select 1 from image_jobs r
      where r.player_id = c.player_id and r.id <> c.id and r.status = 'running' and r.locked_until >= now())
    and not exists (
      select 1 from image_jobs o
      where c.kind = 'edit' and o.kind = 'edit' and o.player_id = c.player_id and o.id <> c.id
        and o.status in ('queued','running') and o.created_at < c.created_at)
  order by c.created_at, c.id
  limit 1;
  if not found then return null; end if;

  -- Orden de bloqueo coherente con el resto: primero la partida, luego el trabajo.
  select * into g from games where id = v_candidate.game_id for update;
  select * into j from image_jobs where id = v_candidate.id
    and ((status = 'queued' and run_after <= now()) or (status = 'running' and locked_until < now()))
    for update skip locked;
  if not found then return jsonb_build_object('retry', true); end if;

  -- Lease caducado con todos los intentos gastados: fallo terminal (con versión fallida y evento).
  if j.status = 'running' and j.attempts >= j.max_attempts then
    update image_jobs set status = 'failed', error_message = v_msg, finished_at = now(),
           locked_by = null, locked_until = null, updated_at = now() where id = j.id;
    if j.kind in ('initial','edit') then
      insert into image_versions (game_id, player_id, parent_version_id, source_purchase_id, origin, provider,
                                  generation_status, is_approved, error_message)
      values (j.game_id, j.player_id, case when j.kind = 'edit' then j.base_image_version_id else null end,
              j.purchase_id, case when j.kind = 'initial' then 'initial' else 'edit' end, 'unknown', 'failed', false, v_msg);
    end if;
    perform ss_log(g.id, null, 'image_failed', jsonb_build_object('job_id', j.id, 'terminal', true, 'error', v_msg));
    perform ss_touch(g.id);
    return jsonb_build_object('retry', true);
  end if;

  select * into v_base from image_versions where false;
  select * into v_player from players where false;
  update image_jobs set status = 'running', attempts = attempts + 1, locked_by = v_worker,
         locked_until = now() + make_interval(secs => v_lease),
         started_at = coalesce(started_at, now()), error_message = null, updated_at = now()
  where id = j.id returning * into j;

  if j.kind in ('edit','initial') then
    select * into v_player from players where id = j.player_id;
    -- La base es SIEMPRE la imagen actual del jugador en este momento.
    update image_jobs set base_image_version_id = v_player.current_image_version_id where id = j.id
    returning * into j;
    if j.kind = 'edit' then
      if v_player.current_image_version_id is null then
        update image_jobs set status = 'failed', error_message = 'El jugador no tiene imagen base para editar',
               finished_at = now(), locked_by = null, locked_until = null, updated_at = now() where id = j.id;
        perform ss_touch(g.id);
        return jsonb_build_object('retry', true);
      end if;
      select * into v_base from image_versions where id = j.base_image_version_id;
    end if;
  end if;

  perform ss_touch(g.id);
  select * into v_item from auction_items
    where id = coalesce(j.item_id, (select auction_item_id from purchases where id = j.purchase_id));

  return jsonb_build_object(
    'job_id', j.id, 'kind', j.kind, 'attempts', j.attempts, 'max_attempts', j.max_attempts,
    'game_id', g.id, 'room_code', g.room_code, 'theme', g.theme,
    'player_id', j.player_id, 'player_name', v_player.name,
    'item_id', v_item.id, 'item_name', v_item.name, 'item_description', v_item.description,
    'purchase_id', j.purchase_id,
    'base_version_id', j.base_image_version_id, 'base_storage_path', v_base.storage_path,
    'base_mime_type', v_base.mime_type);
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
      'image_mode', g.image_mode, 'auto_award_enabled', g.auto_award_enabled, 'auto_award_seconds', g.auto_award_seconds, 'current_auction_id', g.current_auction_id,
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

