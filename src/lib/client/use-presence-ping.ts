'use client';

import { useEffect } from 'react';

/** Cada cuánto late el móvil mientras la pestaña está visible. El servidor da por desconectado a quien pasa de ~40 s sin latir. */
export const PING_INTERVAL_MS = 15_000;

/**
 * Latido de presencia del móvil (docs/PRESENCIA-Y-RETIRADOS.md): `POST /api/play/[code]/ping` cada ~15 s con la pestaña VISIBLE, y de
 * inmediato al volver a primer plano, recuperar la red o restaurarse de la caché de páginas. Al cerrar la pestaña (`pagehide`) envía un
 * aviso de salida con `navigator.sendBeacon` para que la TV lo marque «desconectado» enseguida (la identidad va en la cookie; mismo origen).
 * Si la petición falla no pasa nada: el siguiente latido lo reintenta y la partida nunca depende de esto.
 */
export function usePresencePing(roomCode: string, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const url = `/api/play/${encodeURIComponent(roomCode)}/ping`;
    const visible = () => document.visibilityState === 'visible';
    const beat = () => {
      if (!visible()) return;
      void fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', keepalive: true, cache: 'no-store' }).catch(() => {});
    };
    beat();
    const timer = setInterval(beat, PING_INTERVAL_MS);
    const onVisible = () => beat();
    const onBye = (e: PageTransitionEvent) => {
      if (e.persisted) return; // se queda en la caché de páginas: al volver `pageshow` late de nuevo
      try {
        navigator.sendBeacon?.(url, new Blob([JSON.stringify({ bye: true })], { type: 'application/json' }));
      } catch {
        /* sin sendBeacon: el margen de ~40 s lo marcará igualmente */
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    window.addEventListener('pageshow', onVisible);
    window.addEventListener('pagehide', onBye);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
      window.removeEventListener('pageshow', onVisible);
      window.removeEventListener('pagehide', onBye);
    };
  }, [roomCode, enabled]);
}
