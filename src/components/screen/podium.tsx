'use client';

import { Trophy } from 'lucide-react';
import type { Player } from '@/lib/domain/types';
import type { PodiumGroup } from '@/lib/domain/ranking';
import { ItemIcon } from '@/components/mascot/mascot';
import { HouseImage } from './house-image';

const STEP = {
  1: { label: '1.º', bar: 'bg-gold text-night-950', ring: 'border-gold shadow-[0_0_3rem_rgb(251_191_36/0.35)]', height: 'h-[7.5rem]', tvHeight: 'h-[6.5rem]' },
  2: { label: '2.º', bar: 'bg-white/85 text-night-950', ring: 'border-white/70', height: 'h-[5rem]', tvHeight: 'h-[4.2rem]' },
  3: { label: '3.º', bar: 'bg-[#cd7f32] text-night-950', ring: 'border-[#cd7f32]/80', height: 'h-[3.2rem]', tvHeight: 'h-[2.8rem]' },
} as const;

function Winner({ player, votes, place, tv, shared }: { player: Player; votes: number; place: 1 | 2 | 3; tv: boolean; shared: boolean }) {
  const s = STEP[place];
  return (
    <article className={`flex min-w-0 flex-col overflow-hidden rounded-2xl border-2 bg-night-800 ${s.ring}`} style={{ flex: '1 1 0', maxWidth: shared ? undefined : tv ? '30rem' : '20rem' }} data-testid={`podium-player-${place}`}>
      <div className="relative aspect-[3/2] w-full">
        <HouseImage image={player.current_image} alt={`Imagen final de ${player.name}`} className="absolute inset-0" emptyLabel="Sin imagen final" />
        {place === 1 ? <span className="absolute -top-1 left-1/2 -translate-x-1/2"><ItemIcon variant="item-corona" motion="drop" className={tv ? '!h-[3.2rem]' : '!h-10'} /></span> : null}
      </div>
      <div className="shrink-0 px-3 py-2 text-center" style={{ borderTop: `0.3rem solid ${player.color}` }}>
        <h3 className={`truncate font-display ${tv ? 'text-[1.9rem]' : 'text-xl'}`} style={{ color: player.color }}>{player.name}</h3>
        <p className={`font-bold text-gold ${tv ? 'text-[1.3rem]' : 'text-sm'}`}>🗳️ {votes} {votes === 1 ? 'voto' : 'votos'}</p>
      </div>
    </article>
  );
}

/**
 * Podio de la votación de la galería: 2.º a la izquierda, 1.º en el centro y más alto, 3.º a la derecha. Los empatados comparten escalón.
 * Solo se muestra con la votación cerrada (el recuento no es público antes).
 */
export function Podium({ groups, tv }: { groups: PodiumGroup[]; tv: boolean }) {
  const byPlace = new Map(groups.map((g) => [g.place, g]));
  const order = [2, 1, 3].map((p) => byPlace.get(p)).filter((g): g is PodiumGroup => Boolean(g));
  return (
    <section aria-label="Podio de la votación" className="relative z-10 flex min-h-0 w-full items-end justify-center gap-[1rem]" data-testid="podium">
      {order.map((g) => {
        const place = g.place as 1 | 2 | 3;
        const s = STEP[place];
        return (
          <div key={g.place} className="flex min-w-0 flex-col items-stretch" style={{ flex: `${Math.max(g.players.length, 1)} 1 0`, maxWidth: `${Math.max(g.players.length, 1) * (tv ? 30 : 20)}rem` }}>
            <div className="flex items-end gap-[0.8rem]">
              {g.players.map((p) => <Winner key={p.id} player={p} votes={g.votes} place={place} tv={tv} shared={g.players.length > 1} />)}
            </div>
            <div className={`mt-[0.6rem] flex items-center justify-center gap-2 rounded-t-xl font-display ${s.bar} ${tv ? s.tvHeight : s.height} ${tv ? 'text-[2.6rem]' : 'text-3xl'}`} aria-label={`${place}.º puesto${g.players.length > 1 ? ' (empate)' : ''}`}>
              {place === 1 ? <Trophy className="size-[0.9em]" aria-hidden /> : null}
              {s.label}
              {g.players.length > 1 ? <span className={`font-sans font-bold ${tv ? 'text-[1.1rem]' : 'text-xs'}`}>empate</span> : null}
            </div>
          </div>
        );
      })}
    </section>
  );
}
