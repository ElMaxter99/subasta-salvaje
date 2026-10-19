import type { ImageVersion, ReplayRound } from './types';

/**
 * Imagen de un jugador tras `step` rondas de la repetición (0 = antes de la primera ronda).
 * Parte de su imagen base (la versión completada más antigua que no nace de una compra) y aplica, en orden de creación,
 * las ediciones nacidas de compras de las rondas ya reproducidas. Función pura, solo lectura.
 */
export function houseAtStep(versions: ImageVersion[], rounds: ReplayRound[], playerId: string, step: number): ImageVersion | null {
  const mine = versions.filter((v) => v.player_id === playerId && v.generation_status === 'completed').sort((a, b) => a.created_at.localeCompare(b.created_at));
  const applied = new Set(rounds.slice(0, step).map((r) => r.purchase_id).filter((x): x is string => Boolean(x)));
  let house: ImageVersion | null = mine.find((v) => v.source_purchase_id === null) ?? null;
  for (const v of mine) {
    if (v.source_purchase_id && applied.has(v.source_purchase_id)) house = v;
  }
  return house;
}

/** Texto corto del desenlace de una ronda. */
export function roundOutcome(r: ReplayRound): 'sold' | 'lost' | 'cancelled' | 'open' {
  if (r.status === 'awarded') return 'sold';
  if (r.status === 'cancelled') return r.item_status === 'lost' ? 'lost' : 'cancelled';
  return 'open';
}
