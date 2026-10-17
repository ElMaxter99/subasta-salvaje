import type { SoundName } from './engine';

/** Cuántos jugadores hay dentro (móvil identificado) de los previstos, y si la partida aún está en la sala de espera. */
export interface Presence { connected: number; total: number; lobby: boolean }

/**
 * Sonido de presencia al pasar de una instantánea a la siguiente (modo móviles):
 *  · alguien entra → «join»; alguien sale → «leave»;
 *  · entra el último de los previstos en la sala de espera (el 100 %) → «allReady», un sonido distinto que avisa de que ya se puede empezar
 *    (sustituye al «join» de ese último jugador).
 * Sin cambios → null. Entradas y salidas simultáneas que se compensan no suenan.
 */
export function presenceSound(prev: Presence, cur: Presence): Extract<SoundName, 'join' | 'leave' | 'allReady'> | null {
  if (cur.connected > prev.connected) return cur.lobby && cur.total > 0 && cur.connected >= cur.total ? 'allReady' : 'join';
  if (cur.connected < prev.connected) return 'leave';
  return null;
}
