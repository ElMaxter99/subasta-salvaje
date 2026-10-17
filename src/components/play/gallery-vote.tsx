'use client';

import { joinedPlayers } from '@/lib/domain/players';
import { useState } from 'react';
import { Check, Vote } from 'lucide-react';
import { HouseImage } from '@/components/screen/house-image';
import { useToast } from '@/components/ui/toast';
import { ApiError, galleryVoteRequest } from '@/lib/client/api';
import type { Player, PublicSnapshot } from '@/lib/domain/types';

/** Galería final: el jugador vota la mejor casa (no la suya). Puede cambiar su voto hasta que el anfitrión cierre. */
export function GalleryVote({ roomCode, snapshot, me, onSnapshot, onNotPlayer }: { roomCode: string; snapshot: PublicSnapshot; me: Player; onSnapshot: (s: PublicSnapshot) => void; onNotPlayer: () => void }) {
  const toast = useToast();
  const g = snapshot.gallery;
  const [choice, setChoice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  if (!g || !g.enabled || snapshot.game.play_mode !== 'mobile') return null;

  const voted = g.voters.includes(me.id);
  const others = joinedPlayers(snapshot.players).filter((p) => p.id !== me.id);

  async function vote(id: string) {
    if (busy) return;
    setBusy(id);
    try {
      const r = await galleryVoteRequest(roomCode, id);
      setChoice(id);
      navigator.vibrate?.(30);
      toast.success('¡Voto registrado!');
      onSnapshot(r.snapshot);
    } catch (e) {
      if (e instanceof ApiError) {
        toast.error(e.message);
        if (e.code === 'not_player') onNotPlayer();
      } else toast.error('Sin conexión: no se pudo enviar el voto.');
    } finally {
      setBusy(null);
    }
  }

  if (g.closed) {
    const top = g.results?.[0];
    const winner = top && top.votes > 0 ? snapshot.players.find((p) => p.id === top.player_id) : null;
    return (
      <section aria-label="Resultado de la votación" className="rounded-3xl border border-gold/40 bg-night-800 p-5 text-center" data-testid="gallery-result">
        <h3 className="font-display text-xl">Votación cerrada</h3>
        <p className="mt-1 text-lg font-bold text-gold">{winner ? `🏆 Mejor casa: ${winner.name} (${top!.votes} ${top!.votes === 1 ? 'voto' : 'votos'})` : 'Nadie recibió votos'}</p>
      </section>
    );
  }

  return (
    <section aria-label="Votar la mejor casa" className="space-y-3 rounded-3xl border border-violet/50 bg-night-800 p-4" data-testid="gallery-vote">
      <h3 className="flex items-center gap-2 font-display text-xl">
        <Vote className="size-5 text-violet-soft" aria-hidden /> Vota la mejor casa
      </h3>
      <p className="text-sm text-white/70">{voted ? 'Ya has votado. Puedes cambiar tu voto hasta que el anfitrión cierre la votación.' : 'Elige la casa que más te guste. No puedes votar la tuya.'}</p>
      <ul className="grid grid-cols-2 gap-3">
        {others.map((p) => {
          const mine = choice === p.id;
          return (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => void vote(p.id)}
                disabled={busy !== null}
                aria-pressed={mine}
                className={`block w-full overflow-hidden rounded-2xl border-2 text-left ${mine ? 'border-gold' : 'border-white/10'} bg-night-900 disabled:opacity-60`}
              >
                <span className="relative block aspect-[3/2]">
                  <HouseImage image={p.current_image} alt={`Casa de ${p.name}`} className="absolute inset-0" emptyLabel="Sin casa" />
                  {mine ? <span className="absolute right-1.5 top-1.5 flex size-7 items-center justify-center rounded-full bg-gold text-night-950"><Check className="size-4" aria-hidden /></span> : null}
                </span>
                <span className="block truncate px-3 py-2 font-bold" style={{ color: p.color }}>{p.name}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
