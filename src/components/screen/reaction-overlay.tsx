'use client';

import { useEffect, useState } from 'react';
import type { Player, Reaction } from '@/lib/domain/types';
import './screen.css';

/** Cuánto sube cada emoji (ms). */
const DURATION = 4200;
/** Máximo de emojis a la vez (si llegan muchos de golpe, los más antiguos se descartan). */
const MAX_VISIBLE = 14;

interface Floating extends Reaction {
  name: string;
  color: string;
  left: number;
}

/**
 * Reacciones de los móviles: los emojis flotan por la TV. Solo se animan las reacciones NUEVAS vistas en directo
 * (id mayor que el último visto); lo que ya estaba al cargar la pantalla no se anima. Con `prefers-reduced-motion` no se mueven.
 */
export function ReactionOverlay({ reactions, players }: { reactions: Reaction[] | undefined; players: Player[] }) {
  const maxId = reactions && reactions.length ? Math.max(...reactions.map((r) => r.id)) : 0;
  const [seen, setSeen] = useState(maxId);
  const [active, setActive] = useState<Floating[]>([]);
  if (maxId > seen) {
    setSeen(maxId);
    const fresh = (reactions ?? []).filter((r) => r.id > seen).map((r): Floating => {
      const pl = players.find((p) => p.id === r.player_id);
      return { ...r, name: pl?.name ?? '', color: pl?.color ?? '#ffffff', left: 6 + ((r.id * 37) % 86) };
    });
    setActive((a) => [...a, ...fresh].slice(-MAX_VISIBLE));
  }
  if (active.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-30 overflow-hidden" aria-hidden data-testid="reaction-overlay">
      {active.map((r) => (
        <Floater key={r.id} r={r} onDone={() => setActive((a) => a.filter((x) => x.id !== r.id))} />
      ))}
    </div>
  );
}

function Floater({ r, onDone }: { r: Floating; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, DURATION);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- un solo temporizador por reacción
  }, []);
  return (
    <div className="ss-reaction absolute bottom-0 flex flex-col items-center" style={{ left: `${r.left}%`, animationDuration: `${DURATION}ms` }} data-testid="reaction-float">
      <span className="text-[6rem] leading-none drop-shadow-lg">{r.emoji}</span>
      {r.name ? (
        <span className="mt-1 rounded-full px-[1rem] py-[0.1rem] text-[1.5rem] font-bold text-night-950" style={{ background: r.color }}>{r.name}</span>
      ) : null}
    </div>
  );
}
