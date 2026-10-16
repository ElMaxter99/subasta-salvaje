-- =============================================================================
-- Imagen BASE compartida generada con IA/pegatinas: UNA sola generación para toda la partida, la misma para todos
-- los jugadores (actuales y los que se unan después, mientras la partida siga en la sala de espera).
-- Antes «generar para todos» encolaba un trabajo por jugador y cada uno recibía una imagen distinta.
-- Nuevo tipo de trabajo `base` (sin jugador): al completarse, el mismo archivo se asigna a todos y se guarda como
-- imagen por defecto de los nuevos. Ejecutar DESPUÉS de 20260101001800_wild_gallery_undo.sql.
-- =============================================================================

alter table image_jobs drop constraint image_jobs_kind_check;
alter table image_jobs add constraint image_jobs_kind_check check (kind in ('initial','edit','item','base'));
alter table image_jobs drop constraint image_jobs_target_chk;
alter table image_jobs add constraint image_jobs_target_chk check (
  (kind in ('initial','edit') and player_id is not null) or (kind = 'item' and item_id is not null) or kind = 'base');
alter table image_jobs add column scope jsonb;
create unique index image_jobs_one_base_uq on image_jobs (game_id) where kind = 'base' and status in ('queued','running');

-- Un jugador nuevo con la imagen por defecto en «generar»: no se encola nada propio; recibirá la imagen base
-- cuando termine su generación (el trabajo `base` asigna a todos los jugadores presentes en ese momento).
create or replace function ss_apply_default_image(g games, p_player uuid) returns void language plpgsql as $$
declare v_ver uuid; d jsonb := g.new_player_image;
begin
  if d is null then return; end if;
  if d->>'kind' = 'file' then
    insert into image_versions (game_id, player_id, storage_path, origin, provider, mime_type, bytes, is_approved)
    values (g.id, p_player, d->>'storage_path', 'uploaded', coalesce(d->>'provider', 'upload'), d->>'mime_type', (d->>'bytes')::int, true)
    returning id into v_ver;
    update players set current_image_version_id = v_ver where id = p_player;
  end if;
end $$;

create or replace function ss_apply_initial_image(p jsonb) returns jsonb language plpgsql as $$
declare
  g games; pl players; v_ver uuid; v_kind text := p->>'kind';
  v_cur boolean := coalesce((p->>'scope_current')::boolean, true);
  v_new boolean := coalesce((p->>'scope_new')::boolean, false);
  v_applied int := 0; v_default jsonb; v_job uuid;
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
    -- UNA generación para toda la partida. Si ya hay una en curso se sustituye su alcance (no se encola otra).
    select id into v_job from image_jobs where game_id = g.id and kind = 'base' and status in ('queued','running') for update;
    if v_job is null then
      insert into image_jobs (game_id, kind, scope) values (g.id, 'base', jsonb_build_object('current', v_cur, 'new', v_new)) returning id into v_job;
    else
      update image_jobs set scope = jsonb_build_object('current', v_cur, 'new', v_new), updated_at = now() where id = v_job;
    end if;
    v_default := jsonb_build_object('kind', 'generate');
    v_applied := (select count(*) from players where game_id = g.id);
  end if;

  if v_new then
    update games set new_player_image = case when v_kind = 'clear' then null else v_default end where id = g.id;
  end if;
  if v_kind = 'clear' and not v_new then perform ss_err('invalid_input'); end if;

  perform ss_log(g.id, g.host_id, 'initial_image_applied',
    jsonb_build_object('kind', v_kind, 'scope_current', v_cur, 'scope_new', v_new, 'applied', v_applied, 'job_id', v_job));
  perform ss_touch(g.id);
  return jsonb_build_object('ok', true, 'applied', v_applied, 'job_id', v_job);
end $$;

create or replace function ss_complete_image_job(p jsonb) returns jsonb language plpgsql as $$
declare
  v_game uuid; g games; j image_jobs; pl players; v_id uuid; v_origin text; v_is_current boolean := false;
  v_spec jsonb; v_n int := 0; v_cur boolean;
begin
  select game_id into v_game from image_jobs where id = (p->>'job_id')::uuid;
  if not found then perform ss_err('job_not_found'); end if;
  select * into g from games where id = v_game for update;
  select * into j from image_jobs where id = (p->>'job_id')::uuid for update;

  if j.status = 'completed' then
    return jsonb_build_object('ok', true, 'replay', true, 'room_code', g.room_code, 'version_id', j.result_version_id);
  end if;
  if j.status <> 'running' or j.locked_by is distinct from p->>'worker_id' then
    perform ss_err('lease_lost');
  end if;

  if j.kind = 'base' then
    -- Misma imagen (mismo archivo) para todos los jugadores presentes y, si se pidió, para los que se unan después.
    -- Solo mientras la partida sigue en la sala de espera: una vez empezada no se cambian las casas.
    v_spec := jsonb_build_object('kind', 'file', 'storage_path', p->>'storage_path', 'mime_type', p->>'mime_type',
                                 'bytes', (p->>'bytes')::int, 'provider', coalesce(p->>'provider', 'unknown'));
    v_cur := coalesce((j.scope->>'current')::boolean, true);
    if g.status = 'lobby' then
      for pl in select * from players where game_id = g.id and (v_cur or created_at >= j.created_at) order by sort_order for update loop
        insert into image_versions (game_id, player_id, storage_path, origin, provider, mime_type, bytes, prompt_used, generation_status, is_approved)
        values (g.id, pl.id, p->>'storage_path', 'initial', coalesce(p->>'provider', 'unknown'), p->>'mime_type', (p->>'bytes')::int, p->>'prompt', 'completed', true)
        returning id into v_id;
        update players set current_image_version_id = v_id where id = pl.id;
        v_n := v_n + 1;
      end loop;
      if coalesce((j.scope->>'new')::boolean, false) then
        update games set new_player_image = v_spec where id = g.id;
      end if;
    end if;
    v_is_current := v_n > 0;
  elsif j.kind = 'item' then
    update auction_items set image_path = p->>'storage_path' where id = j.item_id;
  else
    select * into pl from players where id = j.player_id for update;
    v_origin := case when j.kind = 'initial' then 'initial' else 'edit' end;
    insert into image_versions (game_id, player_id, parent_version_id, storage_path, source_purchase_id, origin,
                                provider, mime_type, bytes, prompt_used, generation_status, is_approved)
    values (j.game_id, j.player_id, case when j.kind = 'edit' then j.base_image_version_id else null end,
            p->>'storage_path', j.purchase_id, v_origin, coalesce(p->>'provider', 'unknown'),
            p->>'mime_type', (p->>'bytes')::int, p->>'prompt', 'completed', true)
    returning id into v_id;

    v_is_current := pl.current_image_version_id is not distinct from j.base_image_version_id;
    if j.kind = 'initial' then
      v_is_current := v_is_current and (g.status = 'lobby' or pl.current_image_version_id is null);
    end if;
    if v_is_current then
      update players set current_image_version_id = v_id,
             initial_image_version_id = case when j.kind = 'initial' and g.status <> 'lobby'
                                              then coalesce(initial_image_version_id, v_id) else initial_image_version_id end
      where id = pl.id;
    end if;
  end if;

  update image_jobs set status = 'completed', result_version_id = v_id, finished_at = now(),
         locked_by = null, locked_until = null, error_message = null, updated_at = now() where id = j.id;
  perform ss_log(g.id, null, 'image_completed',
    jsonb_build_object('job_id', j.id, 'version_id', v_id, 'is_current', v_is_current, 'kind', j.kind, 'applied', v_n));
  perform ss_touch(g.id);
  return jsonb_build_object('ok', true, 'room_code', g.room_code, 'version_id', v_id, 'is_current', v_is_current);
end $$;
