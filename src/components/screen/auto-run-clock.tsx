'use client';

import { Hourglass, Timer } from 'lucide-react';
import { useCountdownTo } from '@/lib/client/auto-award';
import type { PublicSnapshot } from '@/lib/domain/types';

/**
 * Reloj de la subasta automática (TV y móviles), para que nadie piense que el juego se ha «colgado»:
 *  · subasta abierta SIN pujas: segundos que quedan para que, si nadie puja, se salte al siguiente elemento;
 *  · entre una subasta y la siguiente: segundos de pausa que faltan.
 * Accesibilidad: NO es una región viva (cambia cada segundo y el lector lo repetiría sin parar); se lee al navegar hasta él.
 * Solo aparece con la subasta automática activada. Usa la hora del servidor de la instantánea.
 */
export function AutoRunClock({ snapshot, className = '', compact = false }: { snapshot: Pick<PublicSnapshot, 'game' | 'auction' | 'server_time'>; className?: string; compact?: boolean }) {
  const { game, auction, server_time } = snapshot;
  const on = Boolean(game.auto_run_enabled) && game.status === 'active';
  const open = auction?.status === 'open';
  const noBids = open && (auction.bids_count ?? auction.bids.length) === 0;
  const skipAt = on && noBids && auction ? new Date(Date.parse(auction.opened_at) + (game.auto_run_idle_seconds ?? 60) * 1000).toISOString() : null;
  const skipIn = useCountdownTo(skipAt, server_time);
  // Entre subastas: no hay subasta viva (abierta o cerrada) y el servidor ya calcula cuándo se anunciará la siguiente.
  const live = auction?.status === 'open' || auction?.status === 'closed';
  const nextAt = on && !live && auction ? (game.auto_run_next_at ?? null) : null; // sin subasta alguna ya lo muestra la propia pantalla
  const nextIn = useCountdownTo(nextAt, server_time);

  const size = compact ? 'px-3 py-1 text-sm' : 'px-[1.6rem] py-[0.5rem] text-[1.5rem]';
  if (skipIn !== null && noBids) {
    return (
      <p data-testid="auto-run-skip-clock" className={`inline-flex items-center gap-2 rounded-full bg-night-800/90 font-bold tabular-nums text-white/85 ${size} ${className}`}>
        <Timer className={compact ? 'size-4' : 'size-[1.5rem]'} aria-hidden />
        {skipIn > 0 ? `Sin pujas: si nadie puja, se salta en ${skipIn} s` : 'Sin pujas: saltando al siguiente…'}
      </p>
    );
  }
  if (nextIn !== null) {
    return (
      <p data-testid="auto-run-pause-clock" className={`inline-flex items-center gap-2 rounded-full bg-night-800/90 font-bold tabular-nums text-gold-soft ${size} ${className}`}>
        <Hourglass className={compact ? 'size-4' : 'size-[1.5rem]'} aria-hidden />
        {nextIn > 0 ? `Siguiente subasta en ${nextIn} s` : '¡Ya viene el siguiente elemento!'}
      </p>
    );
  }
  return null;
}
