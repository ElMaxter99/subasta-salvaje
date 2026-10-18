'use client';

import { useEffect, useState } from 'react';
import type { Auction, Player } from '@/lib/domain/types';

/**
 * Aviso breve «X ha cedido» (TV y móvil) cuando alguien cede la puja. Solo avisa de cesiones NUEVAS dentro de la misma subasta
 * (lo que ya estaba al abrir la pantalla no avisa) y se retira solo a los 4 s. `exceptId` = el propio jugador en el móvil
 * (a él ya se lo dice su nota). La entrada usa `.ss-bid-in`, que se desactiva con prefers-reduced-motion.
 */
export function YieldNotice({ auction, players, exceptId, className = '' }: { auction: Auction | null; players: Player[]; exceptId?: string; className?: string }) {
  const open = auction?.status === 'open';
  const ids = open ? (auction.yielded ?? []) : [];
  const auctionId = open ? auction.id : null;
  const [seen, setSeen] = useState<{ auctionId: string | null; ids: string[] }>({ auctionId, ids });
  const [note, setNote] = useState<{ n: number; names: string[] } | null>(null);
  if (auctionId !== seen.auctionId || ids.join() !== seen.ids.join()) {
    setSeen({ auctionId, ids });
    const fresh = auctionId === seen.auctionId ? ids.filter((id) => !seen.ids.includes(id) && id !== exceptId) : [];
    if (fresh.length > 0) setNote({ n: (note?.n ?? 0) + 1, names: fresh.map((id) => players.find((p) => p.id === id)?.name ?? 'Alguien') });
    else if (auctionId !== seen.auctionId) setNote(null);
  }
  const n = note?.n ?? 0;
  useEffect(() => {
    if (n === 0) return;
    const t = setTimeout(() => setNote(null), 4000);
    return () => clearTimeout(t);
  }, [n]);
  if (!note || !open) return null;
  return (
    <p key={note.n} role="status" data-testid="yield-notice" className={`ss-bid-in rounded-xl bg-night-700 px-3 py-1 text-center font-bold text-white ${className}`}>
      🏳️ {note.names.join(' y ')} {note.names.length === 1 ? 'ha cedido' : 'han cedido'}
    </p>
  );
}
