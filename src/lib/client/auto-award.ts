'use client';

import { useEffect, useState } from 'react';
import type { PublicSnapshot } from '@/lib/domain/types';

/**
 * Segundos que faltan para la adjudicación automática (null si no hay cuenta atrás).
 * Usa la hora del servidor de la instantánea (`server_time`) para no depender del reloj del dispositivo.
 */
export function useAutoAwardCountdown(snapshot: Pick<PublicSnapshot, 'server_time' | 'auction'>): number | null {
  return useCountdownTo(snapshot.auction?.auto_award_at ?? null, snapshot.server_time);
}

/** Segundos hasta `at` (hora del servidor) usando el desfase del reloj del dispositivo; null si no hay fecha. */
export function useCountdownTo(at: string | null | undefined, serverTime: string): number | null {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!at) {
      const t = setTimeout(() => setRemaining(null), 0);
      return () => clearTimeout(t);
    }
    // Desfase entre el reloj del servidor (momento de la instantánea) y el del dispositivo
    const skew = Date.parse(serverTime) - Date.now();
    const compute = () => setRemaining(Math.max(0, Math.ceil((Date.parse(at) - (Date.now() + skew)) / 1000)));
    const first = setTimeout(compute, 0);
    const id = setInterval(compute, 250);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [at, serverTime]);

  return at ? remaining : null;
}
