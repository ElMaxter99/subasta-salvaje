'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type KeepAwakeState = 'wakelock' | 'video' | 'off';

interface WakeLockSentinelLike { release(): Promise<void>; addEventListener(type: 'release', cb: () => void): void }
interface WakeLockLike { request(type: 'screen'): Promise<WakeLockSentinelLike> }

/**
 * Evita que la TV active el salvapantallas o se apague mientras la pantalla de la partida está abierta. Dos mecanismos a la vez:
 *  1. Screen Wake Lock API (Chrome/Edge/Android TV y otros navegadores modernos): se pide al cargar y se vuelve a pedir cuando la
 *     pestaña vuelve a estar visible (el sistema libera el bloqueo al ocultarla).
 *  2. Un vídeo mínimo, mudo y en bucle (`/assets/keepawake/…`), casi invisible: muchos televisores y navegadores de TV (Tizen, webOS…) no
 *     tienen Wake Lock, pero no activan el salvapantallas mientras se reproduce vídeo.
 * Ninguno es una garantía (depende del modelo de TV y de su configuración); `state` indica qué está activo y `enable` reintenta con un gesto
 * del usuario (los navegadores exigen uno para reproducir en algunos casos). No hay peticiones a servidores externos.
 */
export function useKeepAwake(): { state: KeepAwakeState; enable: () => void; videoRef: React.RefObject<HTMLVideoElement | null>; onPlay: () => void; onPause: () => void } {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [lock, setLock] = useState(false);
  const [playing, setPlaying] = useState(false);
  const sentinel = useRef<WakeLockSentinelLike | null>(null);

  const requestLock = useCallback(async () => {
    const wl = (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock;
    if (!wl || document.visibilityState !== 'visible' || sentinel.current) return;
    try {
      const s = await wl.request('screen');
      sentinel.current = s;
      setLock(true);
      s.addEventListener('release', () => { sentinel.current = null; setLock(false); });
    } catch {
      setLock(false); // sin permiso, batería baja, etc.: queda el vídeo
    }
  }, []);

  const playVideo = useCallback(async () => {
    const v = videoRef.current;
    if (!v) return;
    try {
      await v.play();
      setPlaying(true);
    } catch {
      setPlaying(false); // el navegador exige un gesto del usuario: se reintenta en el primer clic o tecla
    }
  }, []);

  useEffect(() => {
    const init = setTimeout(() => { void requestLock(); void playVideo(); }, 0);
    const onVisible = () => {
      if (document.visibilityState === 'visible') { void requestLock(); void playVideo(); }
    };
    const onGesture = () => { void requestLock(); void playVideo(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pointerdown', onGesture, { once: true });
    window.addEventListener('keydown', onGesture, { once: true });
    // Si la pantalla cambia (p. ej. a los resultados) el elemento de vídeo se vuelve a crear: se comprueba cada 20 s que siga sonando.
    const watchdog = setInterval(() => { if (document.visibilityState === 'visible') { void requestLock(); if (videoRef.current?.paused) void playVideo(); } }, 20_000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('keydown', onGesture);
      clearInterval(watchdog);
      clearTimeout(init);
      void sentinel.current?.release().catch(() => undefined);
      sentinel.current = null;
    };
  }, [requestLock, playVideo]);

  const enable = useCallback(() => { void requestLock(); void playVideo(); }, [requestLock, playVideo]);
  const onPlay = useCallback(() => setPlaying(true), []);
  const onPause = useCallback(() => setPlaying(false), []);
  return { state: lock ? 'wakelock' : playing ? 'video' : 'off', enable, videoRef, onPlay, onPause };
}

/** Vídeo mínimo (32×32, negro, mudo, en bucle) que mantiene la pantalla encendida en televisores sin Wake Lock. */
export function KeepAwakeVideo({ videoRef, onPlay, onPause }: { videoRef: React.RefObject<HTMLVideoElement | null>; onPlay: () => void; onPause: () => void }) {
  return (
    <video ref={videoRef} onPlay={onPlay} onPause={onPause} muted loop playsInline preload="auto" aria-hidden tabIndex={-1} data-testid="keep-awake-video" className="pointer-events-none fixed bottom-0 left-0 size-2 opacity-[0.02]">
      <source src="/assets/keepawake/keep-awake.webm" type="video/webm" />
      <source src="/assets/keepawake/keep-awake.mp4" type="video/mp4" />
    </video>
  );
}
