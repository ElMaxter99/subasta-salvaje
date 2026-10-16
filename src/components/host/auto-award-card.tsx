'use client';

import { useState } from 'react';
import { Timer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAutoAwardCountdown } from '@/lib/client/auto-award';
import { Card, Pill, inputCls } from './bits';
import type { HostCtx } from './host-context';

const PRESETS = [10, 20, 30, 60];

/**
 * Adjudicación automática: por tiempo desde la última puja, o al instante si nadie más puede superar la puja.
 * Permite al anfitrión jugar sin pulsar «Adjudicar» en cada ronda.
 */
export function AutoAwardCard({ ctx }: { ctx: HostCtx }) {
  const { snapshot, busy, run } = ctx;
  const { game } = snapshot;
  const [seconds, setSeconds] = useState(String(game.auto_award_seconds));
  const countdown = useAutoAwardCountdown(snapshot);
  const secs = Number(seconds);
  const valid = Number.isInteger(secs) && secs >= 3 && secs <= 300;
  const finished = game.status === 'finished';
  const changed = valid && secs !== game.auto_award_seconds;

  return (
    <Card title="Adjudicación automática" icon={<Timer className="size-5 text-gold" aria-hidden />} action={<Pill tone={game.auto_award_enabled ? 'teal' : 'neutral'}>{game.auto_award_enabled ? 'Activada' : 'Desactivada'}</Pill>}>
      <p className="mb-3 text-sm text-white/70">
        Cuando está activada, la subasta se adjudica sola <b>{game.auto_award_seconds} s después de la última puja</b> (cada puja reinicia la cuenta atrás) o <b>al instante si nadie más puede superar la puja</b> por falta de saldo. Se cobra igual que con «Adjudicar»: una sola vez. Si cierras la puja o está en pausa, no se adjudica sola.
      </p>
      {countdown !== null && game.auto_award_enabled ? (
        <p role="status" className="mb-3 rounded-2xl bg-night-900 px-4 py-2 text-center text-lg font-bold tabular-nums text-gold" data-testid="host-auto-countdown">
          {countdown > 0 ? `Se adjudicará en ${countdown} s` : 'Adjudicando…'}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={game.auto_award_enabled ? 'secondary' : 'primary'}
          size="lg"
          disabled={finished || busy !== null || !valid}
          loading={busy === 'auto-toggle'}
          onClick={() => run('auto-toggle', { type: 'game.set_auto_award', enabled: !game.auto_award_enabled, seconds: valid ? secs : game.auto_award_seconds }, game.auto_award_enabled ? 'Adjudicación automática desactivada' : 'Adjudicación automática activada')}
        >
          {game.auto_award_enabled ? 'Desactivar' : 'Activar'}
        </Button>
        <label htmlFor="auto-seconds" className="sr-only">
          Segundos desde la última puja
        </label>
        <input id="auto-seconds" className={`${inputCls} !w-24`} inputMode="numeric" value={seconds} onChange={(e) => setSeconds(e.target.value.replace(/\D/g, '').slice(0, 3))} aria-invalid={!valid || undefined} />
        <span className="text-sm text-white/70">segundos</span>
        {PRESETS.map((n) => (
          <Button key={n} size="sm" variant="ghost" disabled={finished || busy !== null} onClick={() => setSeconds(String(n))} aria-label={`${n} segundos`}>
            {n} s
          </Button>
        ))}
        {game.auto_award_enabled && changed ? (
          <Button variant="success" size="md" disabled={busy !== null} loading={busy === 'auto-secs'} onClick={() => run('auto-secs', { type: 'game.set_auto_award', enabled: true, seconds: secs }, `Ahora: ${secs} s desde la última puja`)}>
            Guardar
          </Button>
        ) : null}
      </div>
      {!valid ? <p className="mt-2 text-sm text-rose">Introduce entre 3 y 300 segundos.</p> : null}
    </Card>
  );
}
