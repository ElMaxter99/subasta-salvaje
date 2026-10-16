'use client';

import { useEffect, useState } from 'react';
import { Mascot } from '@/components/mascot/mascot';
import type { MascotId } from '@/components/mascot/assets';
import { useAutoAwardCountdown } from '@/lib/client/auto-award';
import type { PublicSnapshot } from '@/lib/domain/types';

type Moment = { kind: 'announce' | 'bid'; n: number } | null;

/**
 * Mascota de la cabecera de la TV: cambia de gesto según lo que ocurre (anuncio, puja nueva, cuenta atrás, puja cerrada, adjudicado…).
 * Vive en la cabecera, fuera del escenario y de las casas, así que nunca tapa información; es decorativa (aria-hidden).
 */
export function MascotCue({ snap }: { snap: PublicSnapshot }) {
  const countdown = useAutoAwardCountdown(snap);
  const a = snap.auction && snap.auction.status !== 'cancelled' ? snap.auction : null;
  const auctionId = a?.id ?? null;
  const bids = a ? (a.bids_count ?? a.bids.length) : 0;

  const [seen, setSeen] = useState({ auctionId, bids });
  const [moment, setMoment] = useState<Moment>(null);
  // Ajuste de estado durante el render (no en la carga inicial): anuncio nuevo o puja nueva ⇒ momento breve.
  if (auctionId !== seen.auctionId || bids !== seen.bids) {
    setSeen({ auctionId, bids });
    if (auctionId && auctionId !== seen.auctionId) setMoment({ kind: 'announce', n: bids });
    else if (bids > seen.bids) setMoment({ kind: 'bid', n: bids });
  }
  useEffect(() => {
    if (!moment) return;
    const t = setTimeout(() => setMoment(null), moment.kind === 'announce' ? 4500 : 2500);
    return () => clearTimeout(t);
  }, [moment]);

  let variant: MascotId = 'expr-pensativo';
  if (snap.game.status === 'lobby') variant = 'expr-feliz';
  else if (snap.game.status === 'paused') variant = 'expr-triste';
  else if (a?.status === 'awarded') variant = 'expr-celebrando';
  else if (a?.status === 'closed') variant = 'pose-adjudica';
  else if (a && countdown !== null && countdown > 0 && countdown <= 10) variant = 'pose-cuenta-atras';
  else if (moment?.kind === 'announce') variant = 'pose-anuncia';
  else if (moment?.kind === 'bid') variant = 'expr-sorprendido';
  else if (a) variant = 'expr-feliz';

  // `key` reinicia la animación de entrada en cada cambio de gesto.
  return <Mascot key={variant} variant={variant} size="xs" tile motion="pop" className="ss-cue" />;
}
