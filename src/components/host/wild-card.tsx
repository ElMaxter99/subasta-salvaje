'use client';

import { Dices } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, Pill } from './bits';
import type { HostCtx } from './host-context';

const CHANCES = [0, 15, 25, 50, 100];

/** Eventos sorpresa automáticos: probabilidad de que una subasta salga «a ciegas» o «doble o mitad» si no eliges tú. */
export function WildCard({ ctx }: { ctx: HostCtx }) {
  const { snapshot, busy, run } = ctx;
  const pct = snapshot.game.wild_chance_pct ?? 0;
  if (snapshot.game.status === 'finished') return null;
  return (
    <Card title="Eventos sorpresa" icon={<Dices className="size-5 text-gold" aria-hidden />} action={<Pill tone={pct > 0 ? 'violet' : 'neutral'}>{pct > 0 ? `${pct} % de las subastas` : 'Solo si los eliges'}</Pill>}>
      <p className="mb-3 text-sm text-white/70">
        Al anunciar un elemento puedes elegir un evento: <b>🙈 a ciegas</b> (nadie ve el importe ni el líder hasta adjudicar) o <b>🎲 doble o mitad</b> (al adjudicar se sortea si el ganador paga la mitad o el doble de su puja).
        Aquí fijas la probabilidad con la que sale uno <b>por sorpresa</b> cuando eliges «Automático». El <b>impuesto al más rico</b> lo lanzas tú entre subastas.
      </p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Probabilidad de evento sorpresa">
        {CHANCES.map((n) => (
          <Button key={n} size="sm" variant={pct === n ? 'primary' : 'secondary'} disabled={busy !== null} aria-pressed={pct === n} onClick={() => pct !== n && run(`wild-${n}`, { type: 'game.set_wild', chance_pct: n }, n === 0 ? 'Eventos sorpresa automáticos desactivados' : `Eventos sorpresa: ${n} %`)}>
            {n === 0 ? 'Ninguno' : `${n} %`}
          </Button>
        ))}
      </div>
    </Card>
  );
}
