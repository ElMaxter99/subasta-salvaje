'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** Pantalla completa + visibilidad temporal de los controles (aparecen al mover el ratón). */
export function useFullscreenControls(hideAfterMs = 3500) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const show = () => {
      setVisible(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setVisible(false), hideAfterMs);
    };
    const onFs = () => setIsFullscreen(Boolean(document.fullscreenElement));
    window.addEventListener('mousemove', show);
    window.addEventListener('keydown', show);
    window.addEventListener('touchstart', show);
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      window.removeEventListener('mousemove', show);
      window.removeEventListener('keydown', show);
      window.removeEventListener('touchstart', show);
      document.removeEventListener('fullscreenchange', onFs);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [hideAfterMs]);

  const toggle = useCallback(() => {
    try {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen();
    } catch {
      /* el navegador puede denegarlo */
    }
  }, []);

  return { isFullscreen, visible, toggle };
}
