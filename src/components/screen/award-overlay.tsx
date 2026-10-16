'use client';

import { useEffect, useState } from 'react';
import type { LastAward, Player } from '@/lib/domain/types';
import { formatEuros } from '@/lib/domain/money';
import { Mascot } from '@/components/mascot/mascot';
import './screen.css';

/** Instante (ms) hasta el que el overlay de adjudicación tapa la pantalla; lo usan las tarjetas para no animar «Casa actualizada» por debajo. */
export const awardOverlay = { until: 0 };

const COLORS = ['#fbbf24', '#8b5cf6', '#2dd4bf', '#fb7185', '#f8fafc', '#60a5fa'];

/** Confeti CSS determinista (sin aleatoriedad en el render). */
export function Confetti({ count = 44 }: { count?: number }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {Array.from({ length: count }, (_, i) => {
        const left = (i * 37 + 11) % 100;
        const dx = ((i * 53) % 21) - 10;
        return (
          <span
            key={i}
            className="ss-confetti absolute top-0 block"
            style={
              {
                left: `${left}%`,
                width: `${0.5 + (i % 3) * 0.25}rem`,
                height: `${0.9 + (i % 4) * 0.3}rem`,
                background: COLORS[i % COLORS.length],
                borderRadius: i % 5 === 0 ? '50%' : '2px',
                '--dx': `${dx}vw`,
                '--rot': `${360 + ((i * 97) % 720)}deg`,
                '--dur': `${3.2 + ((i * 7) % 20) / 10}s`,
                '--delay': `${-((i * 13) % 30) / 10}s`,
              } as React.CSSProperties
            }
          />
        );
      })}
    </div>
  );
}

/** Overlay «¡ADJUDICADO!» de ~5 s cuando aparece un nuevo last_award.purchase_id. */
export function AwardOverlay({ award, players }: { award: LastAward | null; players: Player[] }) {
  const id = award?.purchase_id ?? null;
  const [seen, setSeen] = useState(id); // lo ya cargado al inicio no se anima
  const [active, setActive] = useState<LastAward | null>(null);
  if (id !== seen) {
    setSeen(id);
    if (award) setActive(award);
  }
  useEffect(() => {
    if (!active) return;
    awardOverlay.until = Date.now() + 5400;
    const t = setTimeout(() => setActive(null), 5400);
    return () => clearTimeout(t);
  }, [active]);

  if (!active) return null;
  const winner = players.find((p) => p.id === active.player_id);
  const color = winner?.color ?? '#fbbf24';
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center gap-[3rem]" role="alert" aria-live="assertive">
      <div className="ss-award-bg absolute inset-0 bg-night-950/85 backdrop-blur-sm" />
      <Confetti count={60} />
      <div
        className="ss-award-card relative flex max-w-[58%] flex-col items-center gap-[1.2rem] rounded-[2rem] border-4 bg-night-900/95 px-[4rem] py-[2.5rem] text-center shadow-2xl"
        style={{ borderColor: color, boxShadow: `0 0 6rem ${color}66` }}
      >
        <p className="font-display text-[5.5rem] uppercase leading-none tracking-wide text-gold drop-shadow">¡Adjudicado!</p>
        <p className="ss-bounce text-[9rem] leading-none">{active.emoji ?? '🎁'}</p>
        <p className="font-display text-[3.2rem] leading-tight text-white">{active.item_name}</p>
        <p className="text-[2.4rem] font-bold text-white/90">
          para <span className="font-display" style={{ color }}>{winner?.name ?? 'un jugador'}</span>
        </p>
        <p className="font-display text-[4.5rem] leading-none tabular-nums text-gold">{formatEuros(active.price_cents)}</p>
      </div>
      <Mascot variant="pose-adjudica" size="md" tile motion="pop" className="relative" />
    </div>
  );
}
