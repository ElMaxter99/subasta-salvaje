import { MAX_PLAYERS } from './limits';
import { formatOhros } from './money';
import type { HostSnapshot } from './types';

/**
 * Presets de partida: un preset es SOLO un conjunto de valores para campos que la base de datos ya valida
 * (`ss_update_game`, `ss_set_game_rules`, `ss_set_auto_award`, `ss_set_auto_run`, `ss_set_wild`, `ss_set_join_policy`).
 * No contiene reglas: aquí solo se decide qué valores proponer y se ajustan al catálogo y al estado reales (rondas ≤ elementos,
 * rondas ≥ jugadas, jugadores ≥ actuales…) para no provocar errores evitables. Quien manda sigue siendo SQL.
 *
 * Referencia de valores: 1,5–3,5 Ohros por ronda (docs/PLANTILLAS-SISTEMA-CATALOGO.md, «Variantes»).
 */
export const PRESET_IDS = ['rapida', 'normal', 'larga', 'pocos', 'muchos'] as const;
export type PresetId = (typeof PRESET_IDS)[number];

/** Valores que un preset puede fijar. Los nombres coinciden con los de las acciones `game.set_*` / `ss_apply_settings`. */
export interface PresetSettings {
  /** Presupuesto inicial de cada jugador (céntimos). Solo antes de empezar. */
  initial_budget_cents?: number;
  /** Puja mínima (céntimos). No con una subasta abierta. */
  min_bid_cents?: number;
  max_rounds?: number;
  integer_bids?: boolean;
  max_players?: number;
  auto_award?: { enabled: boolean; seconds: number };
  /** Pausa entre subastas y segundos sin pujas de la subasta automática (NO la enciende ni la apaga). */
  auto_run?: { gap_seconds: number; idle_seconds: number };
  wild_chance_pct?: number;
  join_policy?: 'open' | 'slots' | 'closed';
}

interface PresetDef {
  id: PresetId;
  label: string;
  emoji: string;
  /** Descripción corta que ve el anfitrión. */
  desc: string;
  /** Rondas deseadas (se recortan al catálogo). */
  rounds: number;
  /** Ohros por ronda: el presupuesto es rondas efectivas × esto, en Ohros enteros. */
  ohrosPerRound: number;
  min_bid_cents: number;
  award_seconds: number;
  gap_seconds: number;
  idle_seconds: number;
  wild_chance_pct: number;
  max_players?: number;
  join_policy?: 'open';
}

const DEFS: PresetDef[] = [
  { id: 'rapida', label: 'Rápida', emoji: '⚡', desc: '8 rondas y poco dinero: 15–20 minutos, ritmo ágil.', rounds: 8, ohrosPerRound: 2, min_bid_cents: 100, award_seconds: 15, gap_seconds: 6, idle_seconds: 40, wild_chance_pct: 10 },
  { id: 'normal', label: 'Normal', emoji: '🎯', desc: '10 rondas con presupuesto equilibrado. El punto de partida de siempre.', rounds: 10, ohrosPerRound: 2.5, min_bid_cents: 100, award_seconds: 20, gap_seconds: 10, idle_seconds: 60, wild_chance_pct: 10 },
  { id: 'larga', label: 'Larga', emoji: '🏁', desc: '20 rondas y más margen para remontar: una velada entera.', rounds: 20, ohrosPerRound: 2, min_bid_cents: 100, award_seconds: 25, gap_seconds: 12, idle_seconds: 60, wild_chance_pct: 15 },
  { id: 'pocos', label: 'Para pocos jugadores (2–3)', emoji: '👫', desc: '8 rondas y presupuesto ajustado, hasta 3 jugadores: así hay competencia de verdad.', rounds: 8, ohrosPerRound: 1.75, min_bid_cents: 100, award_seconds: 15, gap_seconds: 8, idle_seconds: 45, wild_chance_pct: 15, max_players: 3 },
  { id: 'muchos', label: 'Para muchos (7–10)', emoji: '🎉', desc: '12 rondas y más dinero para que todos ganen algo; entrada abierta hasta 10 jugadores.', rounds: 12, ohrosPerRound: 2.5, min_bid_cents: 100, award_seconds: 20, gap_seconds: 8, idle_seconds: 45, wild_chance_pct: 10, max_players: MAX_PLAYERS, join_policy: 'open' },
];

export interface PresetInfo { id: PresetId; label: string; emoji: string; desc: string }
export const PRESETS: PresetInfo[] = DEFS.map(({ id, label, emoji, desc }) => ({ id, label, emoji, desc }));

export function isPresetId(v: unknown): v is PresetId {
  return typeof v === 'string' && (PRESET_IDS as readonly string[]).includes(v);
}
export function presetInfo(id: PresetId): PresetInfo {
  return PRESETS.find((p) => p.id === id)!;
}

/** Estado actual de la partida (o de los campos del asistente) sobre el que se calcula el preset. */
export interface PresetContext {
  /** 'new' = partida aún sin crear (asistente). */
  status: 'new' | 'lobby' | 'active' | 'paused' | 'finished';
  /** Elementos del catálogo (tope de rondas). */
  items: number;
  rounds_done?: number;
  players?: number;
  /** Hay una subasta abierta o cerrada sin adjudicar. */
  auction_live?: boolean;
  play_mode?: 'host' | 'mobile';
  current?: {
    initial_budget_cents?: number;
    min_bid_cents?: number;
    max_rounds?: number | null;
    integer_bids?: boolean;
    max_players?: number;
    auto_award_enabled?: boolean;
    auto_award_seconds?: number;
    auto_run_gap_seconds?: number;
    auto_run_idle_seconds?: number;
    wild_chance_pct?: number;
    join_policy?: string;
  };
}

export interface PresetChange { key: string; label: string; from: string; to: string }
export interface PresetPlan {
  preset: PresetInfo;
  /** Valores a enviar (solo los aplicables ahora). */
  settings: PresetSettings;
  /** Solo lo que cambia de verdad respecto al estado actual. */
  changes: PresetChange[];
  /** Campos del preset que no se pueden aplicar ahora, con el motivo. */
  skipped: { label: string; reason: string }[];
  /** Ajustes hechos para respetar el catálogo o el estado ("rondas recortadas a 6 productos"…). */
  notes: string[];
}

const secs = (n: number | undefined) => (n === undefined ? '—' : `${n} s`);
const yesNo = (b: boolean | undefined) => (b === undefined ? '—' : b ? 'sí' : 'no');

/** Calcula qué cambiaría el preset `id` en el contexto dado. Función pura: no toca nada. */
export function planPreset(id: PresetId, ctx: PresetContext): PresetPlan {
  const def = DEFS.find((d) => d.id === id)!;
  const cur = ctx.current ?? {};
  const settings: PresetSettings = {};
  const changes: PresetChange[] = [];
  const skipped: PresetPlan['skipped'] = [];
  const notes: string[] = [];
  const started = ctx.status !== 'new' && ctx.status !== 'lobby';

  // Rondas: nunca más que elementos ni menos que las ya jugadas.
  const done = ctx.rounds_done ?? 0;
  let rounds = def.rounds;
  if (ctx.items >= 1 && rounds > ctx.items) {
    rounds = ctx.items;
    notes.push(`El catálogo tiene ${ctx.items} ${ctx.items === 1 ? 'elemento' : 'elementos'}: las rondas se recortan a ${rounds}.`);
  }
  if (rounds < done) {
    rounds = done;
    notes.push(`Ya se han jugado ${done} rondas: no pueden bajar de ahí.`);
  }
  rounds = Math.max(1, rounds);
  if (ctx.items >= 1) {
    settings.max_rounds = rounds;
    const before = cur.max_rounds ?? ctx.items;
    if (before !== rounds) changes.push({ key: 'max_rounds', label: 'Máximo de rondas', from: String(before), to: String(rounds) });
  }

  // Presupuesto proporcional a las rondas efectivas, en Ohros enteros.
  const budget = Math.max(1, Math.round(rounds * def.ohrosPerRound)) * 100;
  if (started) {
    skipped.push({ label: 'Presupuesto inicial', reason: 'solo se puede cambiar antes de empezar' });
  } else {
    settings.initial_budget_cents = budget;
    if (cur.initial_budget_cents !== budget) changes.push({ key: 'initial_budget_cents', label: 'Presupuesto inicial', from: cur.initial_budget_cents === undefined ? '—' : formatOhros(cur.initial_budget_cents), to: formatOhros(budget) });
  }

  if (ctx.auction_live) {
    skipped.push({ label: 'Puja mínima', reason: 'hay una subasta abierta; cierra o adjudica y vuelve a probar' });
  } else {
    settings.min_bid_cents = def.min_bid_cents;
    if (cur.min_bid_cents !== def.min_bid_cents) changes.push({ key: 'min_bid_cents', label: 'Puja mínima', from: cur.min_bid_cents === undefined ? '—' : formatOhros(cur.min_bid_cents), to: formatOhros(def.min_bid_cents) });
  }

  settings.integer_bids = true;
  if (cur.integer_bids !== true) changes.push({ key: 'integer_bids', label: 'Pujas en Ohros enteros', from: yesNo(cur.integer_bids), to: 'sí' });

  if (def.max_players !== undefined) {
    let mp = def.max_players;
    if (ctx.players !== undefined && ctx.players > mp) {
      mp = ctx.players;
      notes.push(`Ya hay ${ctx.players} jugadores: el máximo no puede bajar de ahí.`);
    }
    settings.max_players = mp;
    if (cur.max_players !== mp) changes.push({ key: 'max_players', label: 'Máximo de jugadores', from: String(cur.max_players ?? MAX_PLAYERS), to: String(mp) });
  }

  settings.auto_award = { enabled: true, seconds: def.award_seconds };
  if (cur.auto_award_enabled !== true || cur.auto_award_seconds !== def.award_seconds) {
    changes.push({ key: 'auto_award', label: 'Adjudicación automática', from: cur.auto_award_enabled ? secs(cur.auto_award_seconds) : 'desactivada', to: secs(def.award_seconds) });
  }

  settings.auto_run = { gap_seconds: def.gap_seconds, idle_seconds: def.idle_seconds };
  if (cur.auto_run_gap_seconds !== def.gap_seconds) changes.push({ key: 'auto_run_gap', label: 'Pausa entre subastas (automática)', from: secs(cur.auto_run_gap_seconds), to: secs(def.gap_seconds) });
  if (cur.auto_run_idle_seconds !== def.idle_seconds) changes.push({ key: 'auto_run_idle', label: 'Tiempo sin pujas (automática)', from: secs(cur.auto_run_idle_seconds), to: secs(def.idle_seconds) });

  settings.wild_chance_pct = def.wild_chance_pct;
  if (cur.wild_chance_pct !== def.wild_chance_pct) changes.push({ key: 'wild_chance_pct', label: 'Eventos sorpresa', from: cur.wild_chance_pct === undefined ? '—' : `${cur.wild_chance_pct} %`, to: `${def.wild_chance_pct} %` });

  // La política de entrada solo tiene sentido en móviles y antes de empezar (abrirla a mitad de partida es decisión aparte: tarjeta «Quién puja»).
  if (def.join_policy && ctx.play_mode !== 'host' && !started) {
    settings.join_policy = def.join_policy;
    if (cur.join_policy !== def.join_policy) changes.push({ key: 'join_policy', label: 'Entrada por móvil', from: cur.join_policy ?? '—', to: 'abierta' });
  }

  if (ctx.status === 'finished') {
    return { preset: presetInfo(id), settings: {}, changes: [], skipped: [{ label: 'Todo', reason: 'la partida ha terminado' }], notes: [] };
  }
  return { preset: presetInfo(id), settings, changes, skipped, notes };
}

/** ¿Los valores actuales coinciden con los que fijaría el preset? (para marcar «Personalizado» cuando se edita a mano). */
export function presetMatches(id: PresetId, ctx: PresetContext): boolean {
  return planPreset(id, ctx).changes.length === 0;
}

/** Contexto del preset a partir de la instantánea del anfitrión (lo comparten el panel —vista previa— y el servidor —aplicación—). */
export function presetContextFromSnapshot(snap: Pick<HostSnapshot, 'game' | 'items' | 'players' | 'auction'>): PresetContext {
  const g = snap.game;
  return {
    status: g.status,
    items: snap.items.length,
    rounds_done: g.rounds_completed,
    players: snap.players.length,
    auction_live: Boolean(snap.auction && (snap.auction.status === 'open' || snap.auction.status === 'closed')),
    play_mode: g.play_mode,
    current: {
      initial_budget_cents: g.initial_budget_cents,
      min_bid_cents: g.min_bid_cents,
      max_rounds: g.max_rounds,
      integer_bids: g.integer_bids,
      max_players: g.max_players,
      auto_award_enabled: g.auto_award_enabled,
      auto_award_seconds: g.auto_award_seconds,
      auto_run_gap_seconds: g.auto_run_gap_seconds,
      auto_run_idle_seconds: g.auto_run_idle_seconds,
      wild_chance_pct: g.wild_chance_pct,
      join_policy: g.join_policy,
    },
  };
}
