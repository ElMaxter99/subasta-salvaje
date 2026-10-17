'use client';

import { useEffect, useState } from 'react';
import type { LastUnsold } from '@/lib/domain/types';
import { Mascot } from '@/components/mascot/mascot';
import './screen.css';

/** Cuánto dura la animación en la TV (ms). */
const DURATION = 5200;

/**
 * «¡Nadie lo quiere!»: animación de ~5 s en la TV cuando una subasta termina sin ninguna puja (el elemento queda perdido y no vuelve a salir).
 * Se muestra una sola vez por cada nuevo `last_unsold.event_id` observado en directo; lo que ya estaba al cargar la pantalla no se anima.
 */
export function UnsoldOverlay({ unsold }: { unsold: LastUnsold | null | undefined }) {
  const id = unsold?.event_id ?? null;
  const [seen, setSeen] = useState(id);
  const [active, setActive] = useState<LastUnsold | null>(null);
  if (id !== seen) {
    setSeen(id);
    if (unsold) setActive(unsold);
  }
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => setActive(null), DURATION);
    return () => clearTimeout(t);
  }, [active]);
  if (!active) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center gap-[3rem] overflow-hidden" role="alert" aria-live="assertive" data-testid="unsold-overlay">
      <div className="ss-award-bg absolute inset-0 bg-night-950/90 backdrop-blur-sm" style={{ animationDuration: `${DURATION}ms` }} />
      <span className="ss-unsold-tumble pointer-events-none absolute bottom-[8%] left-0 text-[7rem]" aria-hidden>🍂</span>
      <div className="ss-award-card relative flex max-w-[58%] flex-col items-center gap-[1.2rem] rounded-[2rem] border-4 border-white/25 bg-night-900/95 px-[4rem] py-[2.5rem] text-center shadow-2xl">
        <p className="font-display text-[5.5rem] uppercase leading-none tracking-wide text-white/90 drop-shadow">¡Nadie lo quiere!</p>
        <p className="ss-unsold-emoji text-[9rem] leading-none" aria-hidden>{active.emoji ?? '🎁'}</p>
        <p className="font-display text-[3.2rem] leading-tight text-white">{active.item_name}</p>
        <p className="text-[2.2rem] font-bold text-white/70">Sin ninguna puja: se queda sin dueño y no vuelve a salir.</p>
      </div>
      <Mascot variant="expr-triste" size="md" tile motion="pop" className="relative" />
    </div>
  );
}
