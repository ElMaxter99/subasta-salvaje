'use client';

import { useEffect, useState } from 'react';
import type { PublicSnapshot } from '@/lib/domain/types';
import { formatEuros } from '@/lib/domain/money';
import './screen.css';

/** Aviso de ~9 s en la TV cuando el anfitrión cobra el «impuesto al más rico» (no se anima lo que ya estaba al cargar). */
export function WildTaxBanner({ snapshot }: { snapshot: PublicSnapshot }) {
  const tax = snapshot.wild_tax ?? null;
  const id = tax?.id ?? null;
  const [seen, setSeen] = useState(id);
  const [active, setActive] = useState<NonNullable<PublicSnapshot['wild_tax']> | null>(null);
  if (id !== seen) {
    setSeen(id);
    if (tax) setActive(tax);
  }
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => setActive(null), 9000);
    return () => clearTimeout(t);
  }, [active]);
  if (!active) return null;
  const { payers, share_cents: share } = active.payload;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[22%] z-40 flex justify-center" role="alert" aria-live="assertive" data-testid="wild-tax-banner">
      <div className="ss-award-card max-w-[75%] rounded-[2rem] border-4 border-violet bg-night-900/95 px-[3.5rem] py-[2rem] text-center shadow-2xl">
        <p className="font-display text-[4rem] uppercase leading-none text-gold">🏛️ ¡Impuesto al más rico!</p>
        <p className="mt-3 text-[2.2rem] font-bold text-white/90">
          {payers.map((p) => `${p.name} paga ${formatEuros(p.amount_cents)}`).join(' · ')}
        </p>
        <p className="mt-1 text-[1.9rem] font-semibold text-violet-soft">Cada uno de los demás recibe {formatEuros(share)}</p>
      </div>
    </div>
  );
}
