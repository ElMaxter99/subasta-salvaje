'use client';

import { useEffect, useState } from 'react';
import { Crown, Hammer } from 'lucide-react';
import type { Player } from '@/lib/domain/types';
import { formatEuros } from '@/lib/domain/money';
import { HouseImage } from './house-image';
import './screen.css';

export function PlayerCard({ player, leading, maxChips, dense }: { player: Player; leading: boolean; maxChips: number; dense: boolean }) {
  const imageId = player.current_image?.id ?? null;
  const [seenId, setSeenId] = useState(imageId);
  const [updatedKey, setUpdatedKey] = useState(0);
  // Nueva versión de la casa (no en la carga inicial): ajuste de estado durante el render.
  if (imageId !== seenId) {
    setSeenId(imageId);
    if (imageId) setUpdatedKey((k) => k + 1);
  }
  useEffect(() => {
    if (!updatedKey) return;
    const t = setTimeout(() => setUpdatedKey(0), 3200);
    return () => clearTimeout(t);
  }, [updatedKey]);

  const building = player.generating[0];
  const chips = player.purchases;
  const shown = chips.slice(0, maxChips);
  const extra = chips.length - shown.length;

  return (
    <article
      aria-label={`Casa de ${player.name}`}
      style={{ '--leader': player.color } as React.CSSProperties}
      className={`relative flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border-2 bg-night-800 transition-colors duration-500 ${
        leading ? 'ss-leader border-transparent' : 'border-white/10'
      } ${updatedKey ? 'ss-ring' : ''}`}
    >
      <div className="relative min-h-0 flex-1">
        <HouseImage image={player.current_image} alt={`Casa de ${player.name}`} className="absolute inset-0" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-night-950/80 to-transparent" />

        {chips.length > 0 ? (
          <ul aria-label={`Elementos de ${player.name}`} className="absolute left-2 top-2 flex max-w-[75%] flex-wrap gap-1">
            {shown.map((p) => (
              <li
                key={p.purchase_id}
                title={`${p.name} · ${formatEuros(p.price_cents)}`}
                className={`flex items-center justify-center rounded-lg bg-night-950/80 leading-none backdrop-blur ${dense ? 'size-8 text-[1.3rem]' : 'size-10 text-[1.7rem]'}`}
              >
                {p.emoji ?? '📦'}
              </li>
            ))}
            {extra > 0 ? (
              <li className={`flex items-center rounded-lg bg-night-950/80 px-2 font-extrabold text-gold ${dense ? 'h-8 text-[1.05rem]' : 'h-10 text-[1.3rem]'}`}>+{extra}</li>
            ) : null}
          </ul>
        ) : null}

        {leading ? (
          <span className="absolute right-2 top-2 flex items-center gap-1.5 rounded-full bg-gold px-3 py-1 text-[1.05rem] font-black uppercase tracking-wide text-night-950 shadow-lg">
            <Crown className="size-5" aria-hidden /> Va ganando
          </span>
        ) : null}

        {building ? (
          <div className="absolute inset-x-2 bottom-2 overflow-hidden rounded-xl border border-violet/50 bg-night-950/85 px-3 py-2 backdrop-blur" role="status">
            <div className="ss-shimmer absolute inset-0" aria-hidden />
            <p className="relative flex items-center gap-2 text-[1.1rem] font-bold text-violet-soft">
              <Hammer className="size-5 shrink-0 animate-pulse" aria-hidden />
              <span className="truncate">Construyendo {building.item_name ?? 'mejora'}…</span>
            </p>
          </div>
        ) : null}

        {updatedKey ? (
          <>
            <div key={`f${updatedKey}`} className="ss-flash pointer-events-none absolute inset-0 bg-white" aria-hidden />
            <div key={`r${updatedKey}`} className="ss-ribbon absolute inset-x-0 top-1/3 z-10 bg-teal py-1.5 text-center font-display text-[1.5rem] uppercase tracking-wide text-night-950 shadow-xl" role="status">
              ¡Casa actualizada!
            </div>
          </>
        ) : null}
      </div>

      <div className={`flex shrink-0 items-center justify-between gap-3 px-4 ${dense ? 'py-2' : 'py-3'}`} style={{ borderTop: `0.3rem solid ${player.color}` }}>
        <h3 className={`min-w-0 truncate font-display leading-tight ${dense ? 'text-[1.5rem]' : 'text-[1.9rem]'}`} style={{ color: player.color }}>
          {player.name}
        </h3>
        <p className={`shrink-0 font-display leading-none tabular-nums text-white ${dense ? 'text-[1.7rem]' : 'text-[2.2rem]'}`} aria-label={`Saldo de ${player.name}`}>
          {formatEuros(player.balance_cents)}
        </p>
      </div>
    </article>
  );
}
