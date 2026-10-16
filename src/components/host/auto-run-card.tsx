'use client';

import { useState } from 'react';
import { PlayCircle, StopCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCountdownTo } from '@/lib/client/auto-award';
import { Card, Pill, inputCls } from './bits';
import type { HostCtx } from './host-context';

const num = (s: string) => (/^\d+$/.test(s) ? Number(s) : NaN);

/**
 * Subasta automática: el servidor anuncia por orden los elementos disponibles (como si el gamemaster los fuera anunciando),
 * adjudica sola (tiempo desde la última puja o al instante si nadie puede superar) y espera una pausa entre subastas.
 */
export function AutoRunCard({ ctx }: { ctx: HostCtx }) {
  const { snapshot, busy, run } = ctx;
  const { game } = snapshot;
  const [gap, setGap] = useState(String(game.auto_run_gap_seconds ?? 10));
  const [idle, setIdle] = useState(String(game.auto_run_idle_seconds ?? 60));
  const [award, setAward] = useState(String(game.auto_award_seconds));
  const next = useCountdownTo(game.auto_run_next_at ?? null, snapshot.server_time);
  if (game.status === 'finished') return null;

  const on = Boolean(game.auto_run_enabled);
  const gapN = num(gap), idleN = num(idle), awardN = num(award);
  const valid = gapN >= 3 && gapN <= 300 && idleN >= 10 && idleN <= 600 && awardN >= 3 && awardN <= 300;
  const left = snapshot.items.filter((i) => i.status === 'available').length;
  const rounds = Math.max(game.total_rounds - game.rounds_completed, 0);
  const field = `${inputCls} !w-24`;

  return (
    <Card title="Subasta automática" icon={<PlayCircle className="size-5 text-gold" aria-hidden />} action={<Pill tone={on ? 'teal' : 'neutral'}>{on ? 'En marcha' : 'Desactivada'}</Pill>}>
      <p className="mb-3 text-sm text-white/70">
        El servidor <b>anuncia solo los elementos disponibles, por orden</b>, como si tú los fueras anunciando; <b>adjudica solo</b> y espera la pausa configurada antes de la siguiente subasta. Al activarla se enciende también la adjudicación automática (con el último tiempo que usaste, 20 s de serie, o el que pongas aquí). Quedan <b>{rounds}</b> {rounds === 1 ? 'ronda' : 'rondas'} y <b>{left}</b> {left === 1 ? 'elemento' : 'elementos'}; al terminar las rondas la partida finaliza sola.
      </p>
      {on && next !== null && game.status === 'active' ? (
        <p role="status" className="mb-3 rounded-2xl bg-night-900 px-4 py-2 text-center text-lg font-bold tabular-nums text-gold" data-testid="auto-run-countdown">
          {next > 0 ? `Siguiente subasta en ${next} s` : 'Anunciando la siguiente…'}
        </p>
      ) : null}
      {on && game.status === 'paused' ? <p className="mb-3 text-sm font-semibold text-gold-soft">La partida está en pausa: la subasta automática espera a que la reanudes.</p> : null}
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm font-semibold">
          Pausa entre subastas (s)
          <input className={`${field} mt-1 block`} inputMode="numeric" value={gap} onChange={(e) => setGap(e.target.value.replace(/\D/g, '').slice(0, 3))} aria-label="Pausa entre subastas en segundos" />
        </label>
        <label className="text-sm font-semibold">
          Adjudica tras (s)
          <input className={`${field} mt-1 block`} inputMode="numeric" value={award} onChange={(e) => setAward(e.target.value.replace(/\D/g, '').slice(0, 3))} aria-label="Segundos hasta adjudicar desde la última puja" />
        </label>
        <label className="text-sm font-semibold">
          Sin pujas, saltar a los (s)
          <input className={`${field} mt-1 block`} inputMode="numeric" value={idle} onChange={(e) => setIdle(e.target.value.replace(/\D/g, '').slice(0, 3))} aria-label="Segundos sin pujas antes de saltar al siguiente elemento" />
        </label>
        {on ? (
          <>
            <Button variant="secondary" size="lg" disabled={busy !== null || !valid} loading={busy === 'autorun-save'} onClick={() => run('autorun-save', { type: 'game.set_auto_run', enabled: true, gap_seconds: gapN, idle_seconds: idleN, auto_award_seconds: awardN }, 'Ajustes de la subasta automática guardados')}>
              Guardar
            </Button>
            <Button variant="danger" size="lg" disabled={busy !== null} loading={busy === 'autorun-stop'} onClick={() => run('autorun-stop', { type: 'game.set_auto_run', enabled: false, gap_seconds: valid ? gapN : 10, idle_seconds: valid ? idleN : 60 }, 'Subasta automática detenida')}>
              <StopCircle className="size-5" aria-hidden /> Detener
            </Button>
          </>
        ) : (
          <Button variant="primary" size="lg" disabled={busy !== null || !valid || game.status === 'lobby'} loading={busy === 'autorun-start'} onClick={() => run('autorun-start', { type: 'game.set_auto_run', enabled: true, gap_seconds: gapN, idle_seconds: idleN, auto_award_seconds: awardN }, 'Subasta automática en marcha')}>
            <PlayCircle className="size-5" aria-hidden /> Iniciar subasta automática
          </Button>
        )}
      </div>
      {game.status === 'lobby' ? <p className="mt-2 text-sm text-white/60">Empieza la partida para poder iniciar la subasta automática.</p> : null}
      {!valid ? <p className="mt-2 text-sm text-rose">Pausa 3–300 s, adjudicación 3–300 s, salto sin pujas 10–600 s.</p> : null}
      <p className="mt-2 text-xs text-white/55">Si nadie puja en una subasta, el elemento pasa al final de la cola; si se da una vuelta entera sin pujas, la subasta automática se detiene sola. Puedes seguir usando el panel a mano en cualquier momento.</p>
    </Card>
  );
}
