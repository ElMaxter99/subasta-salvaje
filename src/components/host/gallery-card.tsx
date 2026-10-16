'use client';

import { Vote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, Pill } from './bits';
import { playerById, type HostCtx } from './host-context';

/** Galería final: seguimiento de votos en vivo y cierre de la votación (revela el resultado en la TV). */
export function GalleryCard({ ctx }: { ctx: HostCtx }) {
  const { snapshot, busy, run } = ctx;
  const g = snapshot.gallery;
  if (!g?.enabled || snapshot.game.status !== 'finished') return null;
  if (snapshot.game.play_mode !== 'mobile') {
    return (
      <Card title="Galería final" icon={<Vote className="size-5 text-gold" aria-hidden />}>
        <p className="text-sm text-white/70">La votación de la galería solo está disponible en partidas «cada jugador desde su móvil». Aquí puedes usar la clasificación por votación del público (Ajustes).</p>
      </Card>
    );
  }
  const connected = snapshot.players.filter((p) => p.claimed).length;
  const results = g.results ?? [];
  return (
    <Card title="Galería final: votación" icon={<Vote className="size-5 text-gold" aria-hidden />} action={<Pill tone={g.closed ? 'neutral' : 'violet'}>{g.closed ? 'Cerrada' : 'Abierta'}</Pill>}>
      <p className="mb-3 text-sm text-white/70">
        {g.closed
          ? 'La votación está cerrada y el resultado ya se ve en la TV.'
          : `Los jugadores votan desde su móvil la mejor casa (no pueden votar la suya). Han votado ${g.voters.length} de ${Math.max(connected, g.voters.length)}. El recuento solo lo ves tú hasta que cierres la votación.`}
      </p>
      <ol className="mb-3 space-y-1.5" aria-label="Recuento de votos">
        {results.map((r) => {
          const p = playerById(snapshot, r.player_id);
          return (
            <li key={r.player_id} className="flex items-center justify-between rounded-xl bg-night-900 px-3 py-2">
              <span className="font-semibold" style={{ color: p?.color }}>{p?.name}</span>
              <b className="tabular-nums">{r.votes} {r.votes === 1 ? 'voto' : 'votos'}</b>
            </li>
          );
        })}
      </ol>
      {!g.closed ? (
        <Button variant="primary" size="lg" disabled={busy !== null} loading={busy === 'gallery-close'} onClick={() => run('gallery-close', { type: 'gallery.close' }, 'Votación cerrada: resultado en la TV')}>
          Cerrar votación y revelar el resultado
        </Button>
      ) : null}
    </Card>
  );
}
