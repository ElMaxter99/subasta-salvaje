'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { HostSnapshot, PublicSnapshot, RuntimeInfo } from '@/lib/domain/types';

export type ConnectionState = 'live' | 'polling' | 'offline';

interface Options<T extends PublicSnapshot> {
  roomCode: string;
  initial: T;
  runtime: RuntimeInfo;
  /** 'host' consulta /api/games/[code] (requiere sesión); 'public' consulta la vista pública. */
  view: 'host' | 'public';
}

const SAFETY_POLL_MS = 8000; // red de seguridad aunque Realtime esté conectado
const FALLBACK_POLL_MS_DEMO = 1500;
const FALLBACK_POLL_MS = 3000;

/**
 * Mantiene la instantánea de la partida sincronizada:
 *  1. Realtime Broadcast de Supabase avisa de cambios ("changed" + versión).
 *  2. Ante cualquier aviso (o por polling de seguridad) se vuelve a leer el estado desde la BD.
 *  3. Sólo se aplica una instantánea si su `version` es MAYOR que la actual: los eventos duplicados
 *     o atrasados nunca pisan datos más recientes (p. ej. una imagen nueva).
 *  4. Al reconectar o volver a la pestaña se recupera el estado completo.
 */
export function useLiveGame<T extends PublicSnapshot = PublicSnapshot>({ roomCode, initial, runtime, view }: Options<T>) {
  const [snapshot, setSnapshot] = useState<T>(initial);
  const [connection, setConnection] = useState<ConnectionState>(runtime.mode === 'supabase' ? 'polling' : 'polling');
  const [lastSync, setLastSync] = useState<number>(() => Date.now());
  const versionRef = useRef(initial.version);
  const inflight = useRef<Promise<void> | null>(null);
  const realtimeOk = useRef(false);

  const apply = useCallback((next: T) => {
    if (next.version > versionRef.current) {
      versionRef.current = next.version;
      setSnapshot(next);
    }
    setLastSync(Date.now());
  }, []);

  const refresh = useCallback(async () => {
    if (inflight.current) return inflight.current;
    const url = view === 'host' ? `/api/games/${roomCode}` : `/api/public/games/${roomCode}`;
    inflight.current = (async () => {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { snapshot: T };
        apply(data.snapshot);
        setConnection(realtimeOk.current ? 'live' : 'polling');
      } catch {
        setConnection('offline');
      } finally {
        inflight.current = null;
      }
    })();
    return inflight.current;
  }, [apply, roomCode, view]);

  // Adjudicación automática: al vencer la cuenta atrás se relee el estado (el servidor adjudica en esa lectura).
  const autoAt = snapshot.auction?.auto_award_at ?? null;
  useEffect(() => {
    if (!autoAt) return;
    const skew = Date.parse(snapshot.server_time) - Date.now();
    const wait = Date.parse(autoAt) - (Date.now() + skew);
    const timers = [600, 2500, 6000].map((extra) => setTimeout(() => void refresh(), Math.max(0, wait) + extra));
    return () => timers.forEach(clearTimeout);
  }, [autoAt, snapshot.server_time, refresh]);

  // Realtime (sólo con Supabase)
  useEffect(() => {
    if (runtime.mode !== 'supabase' || !runtime.supabaseUrl || !runtime.supabaseAnonKey) return;
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    (async () => {
      const { createClient } = await import('@supabase/supabase-js');
      if (cancelled) return;
      const client = createClient(runtime.supabaseUrl!, runtime.supabaseAnonKey!, { auth: { persistSession: false, autoRefreshToken: false } });
      const channel = client
        .channel(`game:${roomCode.toUpperCase()}`)
        .on('broadcast', { event: 'changed' }, (msg) => {
          const v = Number((msg.payload as { version?: number } | undefined)?.version ?? 0);
          if (!v || v > versionRef.current) void refresh();
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            realtimeOk.current = true;
            setConnection('live');
            void refresh(); // recupera lo ocurrido mientras estábamos desconectados
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            realtimeOk.current = false;
            setConnection((c) => (c === 'offline' ? c : 'polling'));
          }
        });
      cleanup = () => {
        void client.removeChannel(channel);
      };
    })();
    return () => {
      cancelled = true;
      realtimeOk.current = false;
      cleanup?.();
    };
  }, [roomCode, runtime.mode, runtime.supabaseUrl, runtime.supabaseAnonKey, refresh]);

  // Polling (principal en demo, red de seguridad con Realtime)
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'hidden' && view === 'host') return;
      void refresh();
    };
    const every = runtime.mode === 'supabase' ? SAFETY_POLL_MS : FALLBACK_POLL_MS_DEMO;
    let id = setInterval(tick, every);
    // Si Realtime cae, se acelera el sondeo
    const watchdog = setInterval(() => {
      clearInterval(id);
      id = setInterval(tick, realtimeOk.current ? every : runtime.mode === 'supabase' ? FALLBACK_POLL_MS : FALLBACK_POLL_MS_DEMO);
    }, 5000);
    const onVisible = () => document.visibilityState === 'visible' && void refresh();
    const onOnline = () => void refresh();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    window.addEventListener('focus', onOnline);
    return () => {
      clearInterval(id);
      clearInterval(watchdog);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('focus', onOnline);
    };
  }, [refresh, runtime.mode, view]);

  return { snapshot, connection, lastSync, refresh, apply: apply as (s: T) => void };
}

export type LiveHost = ReturnType<typeof useLiveGame<HostSnapshot>>;
