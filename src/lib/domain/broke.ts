import type { PublicSnapshot } from '@/lib/domain/types';

/**
 * ¿Se ha quedado todo el mundo sin saldo para pujar (ni siquiera la puja mínima)? Misma regla que `ss_all_broke` en SQL:
 * cuentan todos los jugadores (en modo móviles, los que han entrado alguna vez) y tiene que haber al menos uno.
 */
export function allPlayersBroke(snapshot: Pick<PublicSnapshot, 'game' | 'players'>): boolean {
  const { game, players } = snapshot;
  const counted = players.filter((p) => game.play_mode !== 'mobile' || p.joined !== false);
  return counted.length > 0 && counted.every((p) => p.balance_cents < game.min_bid_cents);
}
