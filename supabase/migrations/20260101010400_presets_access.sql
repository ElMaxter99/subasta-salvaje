-- Presets de partida, acceso por móvil y rondas coherentes con el catálogo.
--
-- 1) ss_apply_settings: aplica de una vez (en UNA transacción: o todo o nada) un conjunto de ajustes reutilizando las funciones
--    que ya validan cada regla (ss_update_game, ss_set_game_rules, ss_set_auto_award, ss_set_auto_run, ss_set_wild,
--    ss_set_join_policy, ss_set_play_mode). No añade reglas nuevas: si una no admite el valor (p. ej. presupuesto con la partida
--    empezada, rondas por debajo de las jugadas) falla con SU error y no se aplica nada.
--    La usan «Aplicar preset» (panel), la tarjeta «Quién puja» (modo + entrada de un toque) y la creación de la partida.
-- 2) ss_item_op: si al quitar elementos el máximo de rondas queda por encima del catálogo, se recorta al nuevo tamaño
--    (el catálogo es el tope: ss_set_game_rules ya lo exigía al editar rondas, pero quitar elementos lo saltaba).

create or replace function ss_apply_settings(p jsonb) returns jsonb language plpgsql as $$
declare
  g games; base jsonb; v_upd jsonb := '{}'::jsonb; v_rules jsonb := '{}'::jsonb; v_aa jsonb; v_ar jsonb; v_keys text[] := '{}';
begin
  g := ss_lock_game(p->>'room_code', (p->>'host_id')::uuid);
  if g.status = 'finished' then perform ss_err('game_finished'); end if;
  base := jsonb_build_object('room_code', p->>'room_code', 'host_id', p->>'host_id');

  -- Modo y entrada primero: así «Abrir para móviles» deja todo coherente aunque falle algo posterior (todo revierte igualmente).
  if p ? 'play_mode' then perform ss_set_play_mode(base || jsonb_build_object('play_mode', p->>'play_mode')); v_keys := v_keys || 'play_mode'::text; end if;
  if p ? 'join_policy' then perform ss_set_join_policy(base || jsonb_build_object('join_policy', p->>'join_policy')); v_keys := v_keys || 'join_policy'::text; end if;

  if p ? 'initial_budget_cents' then v_upd := v_upd || jsonb_build_object('initial_budget_cents', p->'initial_budget_cents'); v_keys := v_keys || 'initial_budget_cents'::text; end if;
  if p ? 'min_bid_cents' then v_upd := v_upd || jsonb_build_object('min_bid_cents', p->'min_bid_cents'); v_keys := v_keys || 'min_bid_cents'::text; end if;
  if v_upd <> '{}'::jsonb then perform ss_update_game(base || v_upd); end if;

  if p ? 'max_rounds' then v_rules := v_rules || jsonb_build_object('max_rounds', p->'max_rounds'); v_keys := v_keys || 'max_rounds'::text; end if;
  if p ? 'max_players' then v_rules := v_rules || jsonb_build_object('max_players', p->'max_players'); v_keys := v_keys || 'max_players'::text; end if;
  if p ? 'integer_bids' then v_rules := v_rules || jsonb_build_object('integer_bids', p->'integer_bids'); v_keys := v_keys || 'integer_bids'::text; end if;
  if v_rules <> '{}'::jsonb then perform ss_set_game_rules(base || v_rules); end if;

  -- Primero la adjudicación automática y luego la subasta automática (que lee el tiempo ya guardado).
  v_aa := p->'auto_award';
  if v_aa is not null and jsonb_typeof(v_aa) = 'object' then
    perform ss_set_auto_award(base || jsonb_build_object('enabled', coalesce((v_aa->>'enabled')::boolean, g.auto_award_enabled),
                                                         'seconds', coalesce((v_aa->>'seconds')::int, g.auto_award_seconds)));
    v_keys := v_keys || 'auto_award'::text;
  end if;
  v_ar := p->'auto_run';
  if v_ar is not null and jsonb_typeof(v_ar) = 'object' then
    -- No enciende ni apaga la subasta automática salvo que se indique `enabled`: conserva el estado actual.
    perform ss_set_auto_run(base || jsonb_build_object('enabled', coalesce((v_ar->>'enabled')::boolean, g.auto_run_enabled),
                                                       'gap_seconds', coalesce((v_ar->>'gap_seconds')::int, g.auto_run_gap_seconds),
                                                       'idle_seconds', coalesce((v_ar->>'idle_seconds')::int, g.auto_run_idle_seconds)));
    v_keys := v_keys || 'auto_run'::text;
  end if;

  if p ? 'wild_chance_pct' then perform ss_set_wild(base || jsonb_build_object('chance_pct', p->'wild_chance_pct')); v_keys := v_keys || 'wild_chance_pct'::text; end if;

  perform ss_log(g.id, g.host_id, 'settings_applied', jsonb_build_object('keys', to_jsonb(v_keys), 'preset', p->>'preset_id'));
  perform ss_touch(g.id);
  return jsonb_build_object('ok', true, 'applied', to_jsonb(v_keys));
end $$;

-- Al quitar elementos, el máximo de rondas no puede quedar por encima del catálogo.
alter function ss_item_op(jsonb) rename to ss_item_op_pre_presets;

create or replace function ss_item_op(p jsonb) returns jsonb language plpgsql as $$
declare res jsonb; g games; v_items int; v_new int;
begin
  res := ss_item_op_pre_presets(p);
  if p->>'op' = 'remove' then
    select * into g from games where room_code = upper(coalesce(p->>'room_code', ''));
    select count(*) into v_items from auction_items where game_id = g.id;
    if g.max_rounds is not null and v_items >= 1 and g.max_rounds > v_items then
      v_new := greatest(v_items, ss_rounds_done(g.id));
      update games set max_rounds = v_new where id = g.id;
      perform ss_log(g.id, g.host_id, 'rules_changed', jsonb_build_object('max_rounds', v_new::text, 'reason', 'catalog_shrunk'));
      res := res || jsonb_build_object('rounds_adjusted', v_new);
    end if;
  end if;
  return res;
end $$;
