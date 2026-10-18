-- Reglas de juego extra:
--   1) Eventos sorpresa nuevos: 'flash' (subasta relámpago: se adjudica sola 8 s después de la última puja) y
--      'sealed' (sobre cerrado: puja oculta y UNA sola puja por jugador; gana la más alta, a igualdad la primera).
--      La adjudicación pasa SIEMPRE por ss_award_core (cobro único, sin cobros nuevos).
--   2) Presupuesto individual (players.initial_balance_cents, ss_player_set_budget) y reinicio que lo restaura.
--   3) Equipos ligeros (players.team, ss_player_set_team): solo una etiqueta, sin compartir saldo.
-- Ejecutar DESPUÉS de 20260101007400_random_picks.sql. Nunca edita migraciones anteriores: reemplaza funciones por versiones nuevas.

-- ---------------------------------------------------------------------------
-- 1) Eventos sorpresa
-- ---------------------------------------------------------------------------
alter table auctions drop constraint if exists auctions_wild_event_check;
alter table auctions add constraint auctions_wild_event_check check (wild_event in ('blind','double','flash','sealed'));
-- Segundos de adjudicación propios de ESTA subasta (relámpago = 8). Prevalece sobre games.auto_award_seconds y NO exige games.auto_award_enabled.
alter table auctions add column if not exists auto_seconds_override integer check (auto_seconds_override is null or auto_seconds_override between 3 and 300);

-- Anunciar: acepta los eventos nuevos. El sorteo automático (wild_chance_pct) sigue siendo entre blind/double: flash y sobre cerrado son manuales.
create or replace function ss_announce(p jsonb) returns jsonb language plpgsql as $$
declare g games; it auction_items; a_id uuid; v_round int; v_wild text := nullif(p->>'wild_event', '');
begin
  g := ss_lock_game(p->>'room_code', (p->>'host_id')::uuid);
  if g.status = 'paused' then perform ss_err('game_paused'); end if;
  if g.status <> 'active' then perform ss_err('game_not_active'); end if;
  if v_wild is not null and v_wild not in ('blind','double','flash','sealed','none') then perform ss_err('invalid_input'); end if;
  -- Rondas agotadas: en vez de anunciar se termina la partida («sí o sí»).
  if g.max_rounds is not null and ss_rounds_done(g.id) >= g.max_rounds then
    perform ss_finish_game_internal(g);
    perform ss_log(g.id, g.host_id, 'game_finish_rounds', jsonb_build_object('max_rounds', g.max_rounds));
    perform ss_touch(g.id);
    return jsonb_build_object('ok', true, 'finished', true, 'reason', 'rounds_completed');
  end if;
  if exists (select 1 from auctions where game_id = g.id and status in ('open','closed')) then
    perform ss_err('auction_in_progress');
  end if;
  select * into it from auction_items where id = (p->>'item_id')::uuid and game_id = g.id for update;
  if not found then perform ss_err('item_not_found'); end if;
  if it.status <> 'available' then perform ss_err('item_not_available'); end if;

  -- Sin evento indicado: sorteo según la probabilidad configurada (0 = nunca). «none» = subasta normal.
  if v_wild is null and g.wild_chance_pct > 0 and random() * 100 < g.wild_chance_pct then
    v_wild := (array['blind','double'])[1 + floor(random() * 2)::int];
  end if;
  if v_wild = 'none' then v_wild := null; end if;

  select count(*) + 1 into v_round from auctions where game_id = g.id;
  insert into auctions (game_id, auction_item_id, round_number, wild_event, auto_seconds_override)
  values (g.id, it.id, v_round, v_wild, case when v_wild = 'flash' then 8 end) returning id into a_id;
  update auction_items set status = 'in_auction' where id = it.id;
  update games set current_auction_id = a_id where id = g.id;

  perform ss_log(g.id, g.host_id, 'auction_announced', jsonb_build_object('auction_id', a_id, 'item_id', it.id, 'item', it.name, 'wild_event', v_wild));
  perform ss_touch(g.id);
  return jsonb_build_object('ok', true, 'auction_id', a_id, 'wild_event', v_wild);
end $$;

-- Pujar. Copia de la última versión (20260101005400) con la rama «sobre cerrado»:
--   · una sola puja vigente por jugador (sealed_already_bid); si el anfitrión la anula, puede volver a pujar;
--   · no se rechaza por ser menor que la actual (no da pistas) ni por «ya vas ganando»;
--   · la actual solo cambia si la nueva es ESTRICTAMENTE mayor (a igualdad gana la primera);
--   · nunca se adjudica al instante por «nadie puede superarla» (lo cierra y adjudica el anfitrión).
create or replace function ss_bid_internal(g games, p jsonb, p_player uuid, p_source text) returns jsonb language plpgsql as $$
declare
  a auctions; pl players; replay jsonb; v_amount int; v_key text; v_bid uuid; res jsonb; v_sealed boolean;
begin
  v_key := p->>'idempotency_key';
  replay := ss_idem_get(g.id, v_key, 'place_bid');
  if replay is not null then return replay || jsonb_build_object('replay', true); end if;

  v_amount := (p->>'amount_cents')::int;
  if v_amount is null or v_amount <= 0 then perform ss_err('invalid_amount'); end if;
  if g.integer_bids and v_amount % 100 <> 0 then perform ss_err('bid_not_whole'); end if;
  if g.status = 'paused' then perform ss_err('game_paused'); end if;
  if g.status <> 'active' then perform ss_err('game_not_active'); end if;

  select * into a from auctions where id = (p->>'auction_id')::uuid and game_id = g.id for update;
  if not found then perform ss_err('auction_not_found'); end if;
  if a.status <> 'open' then perform ss_err('auction_closed'); end if;
  v_sealed := coalesce(a.wild_event = 'sealed', false);

  select * into pl from players where id = p_player and game_id = g.id for update;
  if not found then perform ss_err('player_not_found'); end if;

  if v_sealed and exists (select 1 from bids where auction_id = a.id and player_id = pl.id and voided_at is null) then
    perform ss_err('sealed_already_bid');
  end if;
  if v_amount > pl.balance_cents then perform ss_err('insufficient_balance'); end if;
  if v_amount < g.min_bid_cents then perform ss_err('bid_below_minimum'); end if;
  if not v_sealed then
    if v_amount <= a.current_bid_cents then perform ss_err('bid_too_low'); end if;
    -- Un jugador no puja contra sí mismo desde el móvil (evita subir la puja por error).
    if p_source = 'player' and a.current_bidder_id = pl.id then perform ss_err('already_leading'); end if;
  end if;

  insert into bids (auction_id, player_id, amount_cents, created_by_host_id, source)
  values (a.id, pl.id, v_amount, g.host_id, p_source) returning id into v_bid;
  if (not v_sealed) or v_amount > a.current_bid_cents then
    update auctions set current_bid_cents = v_amount, current_bidder_id = pl.id where id = a.id;
  end if;

  perform ss_log(g.id, case when p_source = 'host' then g.host_id else null end, 'bid_placed',
    jsonb_build_object('bid_id', v_bid, 'auction_id', a.id, 'player_id', pl.id, 'amount_cents', v_amount, 'source', p_source));
  res := jsonb_build_object('ok', true, 'bid_id', v_bid);
  -- Adjudicación AUTOMÁTICA instantánea: si nadie más puede superar la puja, se adjudica ya (no en sobre cerrado).
  if g.auto_award_enabled and not v_sealed and not exists (
       select 1 from players p2 where p2.game_id = g.id and p2.id <> pl.id and p2.balance_cents > v_amount
          and (g.play_mode <> 'mobile' or p2.token_hash is not null)) then
    select * into a from auctions where id = a.id;
    res := res || ss_award_core(g, a, 'auto') || jsonb_build_object('auto_awarded', true, 'auto_reason', 'nobody_can_outbid');
  else
    perform ss_touch(g.id);
  end if;
  perform ss_idem_put(g.id, v_key, 'place_bid', res);
  return res;
end $$;

-- Adjudicación por tiempo. Copia de 20260101001000 con:
--   · relámpago: vence a los auctions.auto_seconds_override (8) s de la última puja aunque la automática esté apagada;
--   · sobre cerrado: nunca se adjudica sola.
-- Sigue siendo pública, idempotente y pasa por ss_award_core (cobro único, con la subasta bloqueada FOR UPDATE).
create or replace function ss_auto_award(p jsonb) returns jsonb language plpgsql as $$
declare g games; a auctions; v_secs int; v_due timestamptz;
begin
  select * into g from games where room_code = upper(coalesce(p->>'room_code', ''));
  if not found or g.status <> 'active' or g.current_auction_id is null then
    return jsonb_build_object('awarded', false);
  end if;
  -- Chequeo SIN bloqueo: solo se toma el bloqueo de la partida si la cuenta atrás ya venció.
  select * into a from auctions where id = g.current_auction_id and status = 'open' and current_bidder_id is not null;
  if not found or a.wild_event = 'sealed' then return jsonb_build_object('awarded', false); end if;
  v_secs := case when a.wild_event = 'flash' then coalesce(a.auto_seconds_override, 8)
                 when g.auto_award_enabled then g.auto_award_seconds end;
  if v_secs is null then return jsonb_build_object('awarded', false); end if;
  v_due := greatest(coalesce((select max(b.created_at) from bids b where b.auction_id = a.id and b.voided_at is null), a.opened_at), a.timer_reset_at)
           + make_interval(secs => v_secs);
  if v_due > clock_timestamp() then return jsonb_build_object('awarded', false); end if;

  g := ss_lock_game_public(p->>'room_code');
  select * into a from auctions where id = g.current_auction_id for update;
  -- Revalida con el bloqueo tomado (otra petición pudo adjudicar o llegar una puja nueva).
  if g.status <> 'active' or a.status <> 'open' or a.current_bidder_id is null or a.wild_event = 'sealed' then
    return jsonb_build_object('awarded', false);
  end if;
  v_secs := case when a.wild_event = 'flash' then coalesce(a.auto_seconds_override, 8)
                 when g.auto_award_enabled then g.auto_award_seconds end;
  if v_secs is null then return jsonb_build_object('awarded', false); end if;
  if greatest(coalesce((select max(b.created_at) from bids b where b.auction_id = a.id and b.voided_at is null), a.opened_at), a.timer_reset_at)
       + make_interval(secs => v_secs) > clock_timestamp() then
    return jsonb_build_object('awarded', false);
  end if;
  return ss_award_core(g, a, 'auto') || jsonb_build_object('awarded', true, 'auto_reason', 'timeout');
end $$;

-- ---------------------------------------------------------------------------
-- 2) Presupuesto individual y 3) equipos ligeros
-- ---------------------------------------------------------------------------
alter table players add column if not exists initial_balance_cents integer check (initial_balance_cents is null or (initial_balance_cents >= 0 and initial_balance_cents <= 100000000));
alter table players add column if not exists team text check (team is null or char_length(team) between 1 and 20);
update players pl set initial_balance_cents = g.initial_budget_cents from games g where g.id = pl.game_id and pl.initial_balance_cents is null;

-- Todo jugador nuevo (anfitrión, móvil o semilla) nace con su presupuesto inicial = su saldo de entrada.
create or replace function ss_players_initial_balance() returns trigger language plpgsql as $$
begin
  if new.initial_balance_cents is null then new.initial_balance_cents := new.balance_cents; end if;
  return new;
end $$;
drop trigger if exists players_initial_balance on players;
create trigger players_initial_balance before insert on players for each row execute function ss_players_initial_balance();

-- Fija el saldo inicial de UN jugador (solo en la sala de espera). Idempotente por naturaleza (fija un valor).
create or replace function ss_player_set_budget(p jsonb) returns jsonb language plpgsql as $$
declare g games; v_cents int;
begin
  g := ss_lock_game(p->>'room_code', (p->>'host_id')::uuid);
  if g.status <> 'lobby' then perform ss_err('game_already_started'); end if;
  if jsonb_typeof(p->'budget_cents') is distinct from 'number' or (p->>'budget_cents') !~ '^[0-9]{1,12}$' then perform ss_err('invalid_input'); end if;
  v_cents := (p->>'budget_cents')::bigint;
  if v_cents < 0 or v_cents > 100000000 then perform ss_err('invalid_input'); end if;
  update players set balance_cents = v_cents, initial_balance_cents = v_cents where id = (p->>'player_id')::uuid and game_id = g.id;
  if not found then perform ss_err('player_not_found'); end if;
  perform ss_log(g.id, g.host_id, 'player_budget_set', jsonb_build_object('player_id', p->>'player_id', 'budget_cents', v_cents));
  perform ss_touch(g.id);
  return jsonb_build_object('ok', true);
end $$;

-- Etiqueta de equipo (≤ 20 caracteres, solo sala de espera). Vacía = sin equipo. Si ya existe un equipo igual sin distinguir
-- mayúsculas, se reutiliza su escritura para que «Rojo» y «rojo» cuenten como el mismo equipo.
create or replace function ss_player_set_team(p jsonb) returns jsonb language plpgsql as $$
declare g games; v_team text; v_existing text;
begin
  g := ss_lock_game(p->>'room_code', (p->>'host_id')::uuid);
  if g.status <> 'lobby' then perform ss_err('game_already_started'); end if;
  v_team := btrim(regexp_replace(regexp_replace(coalesce(p->>'team', ''), '[[:cntrl:]]', '', 'g'), '\s+', ' ', 'g'));
  if char_length(v_team) > 20 then perform ss_err('invalid_input'); end if;
  if v_team = '' then v_team := null; end if;
  if v_team is not null then
    select team into v_existing from players where game_id = g.id and lower(team) = lower(v_team) and id <> (p->>'player_id')::uuid limit 1;
    if v_existing is not null then v_team := v_existing; end if;
  end if;
  update players set team = v_team where id = (p->>'player_id')::uuid and game_id = g.id;
  if not found then perform ss_err('player_not_found'); end if;
  perform ss_log(g.id, g.host_id, 'player_team_set', jsonb_build_object('player_id', p->>'player_id', 'team', v_team));
  perform ss_touch(g.id);
  return jsonb_build_object('ok', true, 'team', v_team);
end $$;

-- Ajustes de la partida: copia de la versión de 20260101000000. Cambiar el presupuesto GENERAL pisa los saldos
-- (y los presupuestos iniciales) de TODOS los jugadores, también los individuales; solo antes de empezar.
create or replace function ss_update_game(p jsonb) returns jsonb language plpgsql as $$
declare g games; v_budget int;
begin
  g := ss_lock_game(p->>'room_code', (p->>'host_id')::uuid);
  if g.status = 'finished' then perform ss_err('game_finished'); end if;

  if p ? 'initial_budget_cents' or p ? 'theme' then
    if g.status <> 'lobby' then perform ss_err('game_already_started'); end if;
  end if;
  if p ? 'min_bid_cents' and g.current_auction_id is not null
     and exists (select 1 from auctions where id = g.current_auction_id and status in ('open','closed')) then
    perform ss_err('auction_in_progress');
  end if;

  update games set
    name = coalesce(p->>'name', name),
    theme = coalesce(p->>'theme', theme),
    min_bid_cents = coalesce((p->>'min_bid_cents')::int, min_bid_cents),
    ranking_rule = coalesce(p->>'ranking_rule', ranking_rule),
    initial_budget_cents = coalesce((p->>'initial_budget_cents')::int, initial_budget_cents)
  where id = g.id;

  if p ? 'initial_budget_cents' then
    v_budget := (p->>'initial_budget_cents')::int;
    update players set balance_cents = v_budget, initial_balance_cents = v_budget where game_id = g.id;
  end if;

  perform ss_log(g.id, g.host_id, 'game_updated', p - 'room_code' - 'host_id');
  perform ss_touch(g.id);
  return jsonb_build_object('ok', true);
end $$;

-- Reiniciar partida: copia de 20260101006200; cada jugador vuelve a SU presupuesto inicial (individual si lo tiene, si no el general).
-- Los equipos se conservan.
create or replace function ss_reset_game(p jsonb) returns jsonb language plpgsql as $$
declare g games; v_paths jsonb; v_keep uuid[];
begin
  g := ss_lock_game(p->>'room_code', (p->>'host_id')::uuid);
  select coalesce(array_agg(initial_image_version_id), '{}') into v_keep from players where game_id = g.id and initial_image_version_id is not null;

  -- Archivos a borrar: versiones que no son la imagen inicial de un jugador.
  select coalesce(jsonb_agg(storage_path), '[]'::jsonb) into v_paths
    from image_versions where game_id = g.id and storage_path is not null and not (id = any (v_keep));

  update games set current_auction_id = null where id = g.id;
  delete from gallery_votes where game_id = g.id;
  delete from image_jobs where game_id = g.id and kind = 'edit';
  update image_jobs set result_version_id = null where game_id = g.id and result_version_id is not null and not (result_version_id = any (v_keep));
  update image_jobs set base_image_version_id = null where game_id = g.id and base_image_version_id is not null and not (base_image_version_id = any (v_keep));
  update image_versions set parent_version_id = null where game_id = g.id and id = any (v_keep) and parent_version_id is not null;
  update players set current_image_version_id = initial_image_version_id,
                     balance_cents = coalesce(initial_balance_cents, g.initial_budget_cents), votes = 0 where game_id = g.id;
  delete from image_versions where game_id = g.id and not (id = any (v_keep));
  delete from bids where auction_id in (select id from auctions where game_id = g.id);
  delete from purchases where game_id = g.id;
  delete from auctions where game_id = g.id;
  update auction_items set status = 'available' where game_id = g.id;
  delete from idempotency_keys where game_id = g.id;
  delete from game_events where game_id = g.id;
  update games set status = 'lobby', finished_at = null, gallery_closed_at = null, auto_run_since = null, auto_run_skips = 0 where id = g.id;
  perform ss_log(g.id, g.host_id, 'game_reset', '{}'::jsonb);
  perform ss_touch(g.id);
  return jsonb_build_object('ok', true, 'storage_paths', v_paths);
end $$;

-- ---------------------------------------------------------------------------
-- Instantánea: equipo y presupuesto inicial por jugador; relámpago (cuenta atrás de 8 s) y sobre cerrado
-- (oculto en vistas públicas + quién ya ha pujado, sin importes).
-- ---------------------------------------------------------------------------
alter function ss_get_state(jsonb) rename to ss_get_state_pre_rules;

create or replace function ss_get_state(p jsonb) returns jsonb language plpgsql stable as $$
declare
  res jsonb; a auctions; v_host boolean := coalesce(p->>'view', 'public') = 'host';
  v_hide boolean; v_extra jsonb;
begin
  res := ss_get_state_pre_rules(p);

  if jsonb_typeof(res->'players') = 'array' then
    res := jsonb_set(res, '{players}', coalesce((
      select jsonb_agg(t.e || jsonb_build_object('team', pl.team, 'initial_balance_cents', pl.initial_balance_cents) order by t.ord)
      from jsonb_array_elements(res->'players') with ordinality as t(e, ord)
      left join players pl on pl.id = (t.e->>'id')::uuid), '[]'::jsonb));
  end if;

  if jsonb_typeof(res->'auction') = 'object' and (res->'auction'->>'id') is not null then
    select * into a from auctions where id = (res->'auction'->>'id')::uuid;
    if a.wild_event = 'flash' then
      v_extra := jsonb_build_object('flash_seconds', coalesce(a.auto_seconds_override, 8),
        'auto_award_at', case when a.status = 'open' and a.current_bidder_id is not null then
          greatest(coalesce((select max(b.created_at) from bids b where b.auction_id = a.id and b.voided_at is null), a.opened_at), a.timer_reset_at)
          + make_interval(secs => coalesce(a.auto_seconds_override, 8)) end);
      res := jsonb_set(res, '{auction}', (res->'auction') || v_extra);
    elsif a.wild_event = 'sealed' then
      v_hide := a.status in ('open','closed') and not v_host;
      -- Nunca hay cuenta atrás en un sobre cerrado. `sealed_bidders` = quién ya pujó (sin importes).
      res := jsonb_set(res, '{auction}', (res->'auction') || jsonb_build_object('auto_award_at', null, 'hidden', v_hide,
        'sealed_bidders', coalesce((select jsonb_agg(distinct b.player_id) from bids b where b.auction_id = a.id and b.voided_at is null), '[]'::jsonb)));
      if v_hide then
        res := jsonb_set(res, '{auction}', (res->'auction') || jsonb_build_object(
          'current_bid_cents', 0, 'current_bidder_id', null, 'bids', '[]'::jsonb,
          'bids_count', (select count(*) from bids where auction_id = a.id and voided_at is null)));
      end if;
    end if;
  end if;
  return res;
end $$;
