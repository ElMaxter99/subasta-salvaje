'use client';

import { useEffect, useState } from 'react';
import { Bubble, Mascot } from '@/components/mascot/mascot';
import type { MascotId } from '@/components/mascot/assets';
import type { Player, PublicSnapshot } from '@/lib/domain/types';

type Moment = { kind: 'outbid' | 'won'; n: number } | null;

/**
 * Mascota del móvil: reacciona a lo que le pasa al jugador (vas ganando, te han superado, te llevaste el objeto, sala de espera…).
 * Es decorativa; la información importante sigue en los textos de la pantalla.
 */
export function PlayerMascot({ snapshot, me }: { snapshot: PublicSnapshot; me: Player }) {
  const { game, auction, last_award } = snapshot;
  const open = auction?.status === 'open' && game.status === 'active';
  const blind = Boolean(auction?.hidden);
  const leaderId = open && !blind ? auction!.current_bidder_id : null;
  const leading = leaderId === me.id;
  const awardId = last_award?.player_id === me.id ? last_award.purchase_id : null;

  const [seen, setSeen] = useState({ leading, awardId });
  const [moment, setMoment] = useState<Moment>(null);
  // Cambios respecto al render anterior (ajuste de estado durante el render, sin Date.now ni efectos).
  if (leading !== seen.leading || awardId !== seen.awardId) {
    setSeen({ leading, awardId });
    if (awardId && awardId !== seen.awardId) setMoment({ kind: 'won', n: 0 });
    else if (seen.leading && !leading && open) setMoment({ kind: 'outbid', n: 0 });
  }
  useEffect(() => {
    if (!moment) return;
    const t = setTimeout(() => setMoment(null), moment.kind === 'won' ? 5000 : 3000);
    return () => clearTimeout(t);
  }, [moment]);

  let variant: MascotId = 'expr-pensativo';
  let say: string | null = null;
  if (game.status === 'finished') variant = 'expr-celebrando';
  else if (game.status === 'lobby') variant = 'expr-feliz';
  else if (game.status === 'paused') variant = 'expr-triste';
  else if (moment?.kind === 'won') { variant = 'expr-celebrando'; say = '¡Tuyo!'; }
  else if (moment?.kind === 'outbid') { variant = 'expr-sorprendido'; say = '¡Te han superado!'; }
  else if (leading) { variant = 'expr-feliz'; say = '¡Vas ganando!'; }
  else if (open && blind) variant = 'expr-guino';

  return (
    <div className="flex items-end gap-1.5" aria-hidden>
      {say ? <Bubble key={say}>{say}</Bubble> : null}
      <Mascot key={variant} variant={variant} size="xs" tile motion="pop" />
    </div>
  );
}
