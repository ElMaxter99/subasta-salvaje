'use client';

import { useEffect, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { Ohros } from '@/components/ui/ohros';
import type { Player, PublicSnapshot } from '@/lib/domain/types';

type Alert = { auctionId: string; by: string; cents: number; n: number };

/**
 * Aviso «¡Te han superado!» en el móvil: cuando dejas de ir ganando en la subasta abierta aparece un cartel bien visible (y vibra) con
 * quién te ha superado y por cuánto. Se retira solo a los 8 s, o antes si vuelves a ir ganando o cambia la subasta.
 * No aplica a puja a ciegas ni sobre cerrado (no se conoce el líder). Es solo un aviso: no cambia ninguna regla.
 */
export function OutbidAlert({ snapshot, me }: { snapshot: PublicSnapshot; me: Player }) {
  const { game, auction, players } = snapshot;
  const open = auction?.status === 'open' && game.status === 'active';
  const leading = open && !auction.hidden && auction.current_bidder_id === me.id;
  const auctionId = open ? auction.id : null;

  const [seen, setSeen] = useState({ leading, auctionId });
  const [alert, setAlert] = useState<Alert | null>(null);
  // Transición «iba ganando → ya no» dentro de la MISMA subasta (ajuste de estado durante el render, sin efectos ni Date.now).
  if (leading !== seen.leading || auctionId !== seen.auctionId) {
    setSeen({ leading, auctionId });
    if (seen.leading && !leading && open && auction.id === seen.auctionId && auction.current_bidder_id) {
      const by = players.find((p) => p.id === auction.current_bidder_id)?.name ?? 'Alguien';
      setAlert({ auctionId: auction.id, by, cents: auction.current_bid_cents, n: (alert?.n ?? 0) + 1 });
    }
  }

  const n = alert?.n ?? 0;
  useEffect(() => {
    if (n === 0) return;
    navigator.vibrate?.([120, 60, 120]);
    const t = setTimeout(() => setAlert(null), 8000);
    return () => clearTimeout(t);
  }, [n]);

  if (!alert || !open || leading || auction.id !== alert.auctionId) return null;
  return (
    <p role="alert" data-testid="outbid-alert" className="flex items-center justify-center gap-2 rounded-2xl bg-rose px-4 py-3 text-center text-lg font-black text-night-950 shadow-lg">
      <TriangleAlert className="size-6 shrink-0" aria-hidden />
      <span>¡Te han superado! {alert.by} puja <Ohros cents={alert.cents} /></span>
    </p>
  );
}
