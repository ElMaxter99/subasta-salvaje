'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Ohros } from '@/components/ui/ohros';
import { houseAtStep, roundOutcome } from '@/lib/domain/replay';
import type { HostSnapshot, ReplayRound, RuntimeInfo } from '@/lib/domain/types';
import { DemoBanner } from '@/components/ui/status';
import { Card, Dot, Notice, Pill, Thumb } from './bits';

const PLAY_MS = 2200;

/** Repetición de la partida (solo lectura): línea de tiempo de rondas y reproducción paso a paso de cómo evoluciona cada imagen. */
export function ReplayView({ roomCode, snapshot, rounds, runtime }: { roomCode: string; snapshot: HostSnapshot; rounds: ReplayRound[]; runtime: RuntimeInfo }) {
  const [step, setStep] = useState(0); // 0 = inicio; n = tras la ronda n
  const [playingRaw, setPlaying] = useState(false);
  const total = rounds.length;
  const playing = playingRaw && step < total;
  const players = snapshot.players;
  const nameOf = (id: string | null) => players.find((p) => p.id === id)?.name ?? '—';

  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => setStep((s) => Math.min(s + 1, total)), PLAY_MS);
    return () => clearTimeout(t);
  }, [playing, step, total]);

  const houses = useMemo(() => players.map((p) => ({ player: p, version: houseAtStep(snapshot.versions, rounds, p.id, step) })), [players, snapshot.versions, rounds, step]);
  const current = step > 0 ? rounds[step - 1] : null;
  const lostCount = rounds.filter((r) => roundOutcome(r) === 'lost').length;
  const cancelledCount = rounds.filter((r) => roundOutcome(r) === 'cancelled').length;

  return (
    <div className="min-h-screen pb-10">
      <DemoBanner runtime={runtime} />
      <header className="sticky top-0 z-30 border-b border-white/10 bg-night-900/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-3">
          <Link href={`/game/${roomCode}/host`} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-night-700 px-4 font-bold hover:bg-night-600">
            <ArrowLeft className="size-5" aria-hidden /> Volver al panel
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-xl">Repetición de la partida</h1>
            <p className="truncate text-sm text-white/65">{snapshot.game.name} · {roomCode} · solo lectura</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-4 px-4 pt-4">
        {total === 0 ? (
          <Notice tone="info">Todavía no hay rondas que reproducir: cuando se adjudique o se cancele alguna subasta aparecerá aquí.</Notice>
        ) : (
          <>
            <Card title="Reproducción">
              <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Controles de la repetición">
                <Button variant="secondary" onClick={() => { setPlaying(false); setStep((s) => Math.max(0, s - 1)); }} disabled={step === 0} aria-label="Anterior">
                  <ChevronLeft className="size-5" aria-hidden /> Anterior
                </Button>
                <Button onClick={() => { if (step >= total) { setStep(0); setPlaying(true); } else setPlaying((p) => !p); }} aria-label={playing ? 'Pausar' : 'Reproducir'}>
                  {playing ? <Pause className="size-5" aria-hidden /> : <Play className="size-5" aria-hidden />} {playing ? 'Pausar' : 'Reproducir'}
                </Button>
                <Button variant="secondary" onClick={() => { setPlaying(false); setStep((s) => Math.min(total, s + 1)); }} disabled={step >= total} aria-label="Siguiente">
                  Siguiente <ChevronRight className="size-5" aria-hidden />
                </Button>
                <Button variant="ghost" onClick={() => { setPlaying(false); setStep(0); }} disabled={step === 0} aria-label="Volver al inicio">
                  <RotateCcw className="size-4" aria-hidden /> Inicio
                </Button>
                <p className="ml-auto text-sm font-bold text-white/70" data-testid="replay-step">Paso {step} de {total}</p>
              </div>
              <p className="mt-3 min-h-6 text-white/85" role="status" data-testid="replay-caption">
                {current ? <RoundText r={current} nameOf={nameOf} /> : 'Imágenes al empezar la partida.'}
              </p>
            </Card>

            <section aria-label="Imágenes de los jugadores" className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4" data-testid="replay-houses">
              {houses.map(({ player, version }) => {
                const bought = current && current.winner_id === player.id;
                return (
                  <div key={player.id} className={`rounded-2xl border-2 bg-night-800 p-2 ${bought ? 'border-gold' : 'border-white/10'}`} data-testid="replay-house">
                    <Thumb url={version?.url} alt={`Imagen de ${player.name}`} className="aspect-[3/2] w-full" />
                    <p className="mt-2 flex items-center gap-2 truncate font-bold"><Dot color={player.color} className="size-3" /> {player.name}</p>
                    {bought ? <p className="text-sm font-bold text-gold">Se lleva {current.emoji ?? '🎁'} {current.item_name}</p> : null}
                  </div>
                );
              })}
            </section>

            <Card title={`Línea de tiempo · ${total} ronda${total === 1 ? '' : 's'}`}>
              {lostCount + cancelledCount > 0 ? (
                <p className="mb-3 text-sm text-white/70">
                  {lostCount > 0 ? <>Perdidas (sin pujas): <b>{lostCount}</b>. </> : null}
                  {cancelledCount > 0 ? <>Canceladas: <b>{cancelledCount}</b>.</> : null}
                </p>
              ) : null}
              <ol className="space-y-2" data-testid="replay-timeline">
                {rounds.map((r, i) => {
                  const on = step === i + 1;
                  const out = roundOutcome(r);
                  return (
                    <li key={r.auction_id}>
                      <button
                        type="button"
                        onClick={() => { setPlaying(false); setStep(i + 1); }}
                        aria-current={on ? 'step' : undefined}
                        className={`flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border-2 px-3 py-2 text-left transition ${on ? 'border-gold bg-gold/10' : 'border-white/10 bg-night-900/60 hover:bg-night-700'} ${i + 1 > step ? 'opacity-70' : ''}`}
                      >
                        <span className="w-8 shrink-0 font-display text-lg text-white/60">{r.round_number}</span>
                        <span className="min-w-0 flex-1 truncate font-bold">{r.emoji ?? '🎁'} {r.item_name}</span>
                        {out === 'sold' ? (
                          <span className="text-sm">{nameOf(r.winner_id)} · <b className="text-gold"><Ohros cents={r.price_cents ?? 0} /></b></span>
                        ) : out === 'lost' ? (
                          <Pill tone="rose">Perdido · nadie pujó</Pill>
                        ) : out === 'cancelled' ? (
                          <Pill tone="neutral">Cancelada</Pill>
                        ) : (
                          <Pill tone="violet">En curso</Pill>
                        )}
                        <span className="text-xs text-white/60">{r.bids_count} {r.bids_count === 1 ? 'puja' : 'pujas'}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}

function RoundText({ r, nameOf }: { r: ReplayRound; nameOf: (id: string | null) => string }) {
  const out = roundOutcome(r);
  if (out === 'sold') {
    return <>Ronda {r.round_number}: <b>{nameOf(r.winner_id)}</b> se lleva {r.emoji ?? '🎁'} <b>{r.item_name}</b> por <b className="text-gold"><Ohros cents={r.price_cents ?? 0} /></b> ({r.bids_count} {r.bids_count === 1 ? 'puja' : 'pujas'}).</>;
  }
  if (out === 'lost') return <>Ronda {r.round_number}: {r.emoji ?? '🎁'} <b>{r.item_name}</b> se queda sin dueño (nadie pujó).</>;
  if (out === 'cancelled') return <>Ronda {r.round_number}: la subasta de {r.emoji ?? '🎁'} <b>{r.item_name}</b> se canceló sin cobrar.</>;
  return <>Ronda {r.round_number}: {r.emoji ?? '🎁'} <b>{r.item_name}</b> sigue en curso.</>;
}
