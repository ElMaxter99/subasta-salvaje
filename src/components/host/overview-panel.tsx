'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Circle, Flag, Pause, Play, Rocket } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { themeLabel } from '@/lib/domain/themes';
import { Card, Dot, Notice, Pill, STATUS_LABEL } from './bits';
import type { HostCtx } from './host-context';
import { FinishGameDialog } from './finish-dialog';
import { AutoRunCard } from './auto-run-card';
import { GalleryCard } from './gallery-card';
import { PendingImagesNotice } from './pending-images';
import { JoinCard } from './join-card';
import { Ohros } from '@/components/ui/ohros';

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className={`flex items-start gap-2 ${ok ? 'text-white' : 'text-white/70'}`}>
      {ok ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-teal" aria-hidden /> : <Circle className="mt-0.5 size-5 shrink-0 text-white/55" aria-hidden />}
      <span>
        <span className="sr-only">{ok ? 'Hecho: ' : 'Pendiente: '}</span>
        {children}
      </span>
    </li>
  );
}

export function OverviewPanel({ ctx, goTo }: { ctx: HostCtx; goTo: (s: 'jugadores' | 'catalogo' | 'imagenes') => void }) {
  const { snapshot, runtime, busy, run, roomCode } = ctx;
  const { game, players, items, auction } = snapshot;
  const [finishOpen, setFinishOpen] = useState(false);
  const withImage = players.filter((p) => p.current_image).length;
  const imagesOk = players.length > 0 && withImage === players.length;
  const ready = players.length >= 2 && items.length >= 1;
  const live = auction && (auction.status === 'open' || auction.status === 'closed') ? auction : null;
  const maxBid = live && live.current_bid_cents > 0 ? live.current_bid_cents : null;
  const mobile = game.play_mode === 'mobile';
  const connected = players.filter((p) => p.claimed).length;
  const failedJobs = snapshot.jobs.filter((j) => j.status === 'failed').length;

  return (
    <div className="space-y-4">
      {snapshot.game.image_mode === 'ai' && !runtime.aiConfigured ? <Notice tone="warn">Esta partida usa IA pero no hay proveedor configurado: las imágenes quedan en cola. Cambia al modo pegatinas en Ajustes (solo en la sala de espera) o configura IMAGE_PROVIDER.</Notice> : null}
      {snapshot.game.image_mode === 'stickers' ? <Notice tone="info">Modo pegatinas: cada compra añade el emoji del elemento a la casa (ilustraciones locales, sin IA, instantáneo y gratis).</Notice> : null}
      {failedJobs > 0 ? (
        <Notice tone="warn">
          Hay {failedJobs} trabajo{failedJobs > 1 ? 's' : ''} de imagen fallido{failedJobs > 1 ? 's' : ''}. La compra y el saldo están a salvo.{' '}
          <button type="button" className="underline" onClick={() => goTo('imagenes')}>
            Ver imágenes
          </button>
        </Notice>
      ) : null}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-white/60">Estado</p>
            <p className="font-display text-3xl">{STATUS_LABEL[game.status]}</p>
            <p className="text-sm text-white/70">
              Ronda {Math.min(game.rounds_completed + (live ? 1 : 0), game.total_rounds)} de {game.total_rounds} · {themeLabel(game.theme)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs font-bold uppercase tracking-wide text-white/60">Puja máxima actual</p>
            <p className="font-display text-3xl text-gold">{maxBid ? <Ohros cents={maxBid} /> : '—'}</p>
            <p className="text-sm text-white/70">{live ? live.item.name : 'Sin subasta en curso'}</p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          {game.status === 'lobby' ? (
            <Button variant="primary" size="xl" className="w-full sm:w-auto" disabled={!ready || !imagesOk || busy !== null} loading={busy === 'start'} onClick={() => run('start', { type: 'game.start' }, '¡Partida en marcha!')}>
              <Rocket className="size-6" aria-hidden /> Empezar partida
            </Button>
          ) : null}
          {game.status === 'active' ? (
            <Button variant="secondary" size="lg" disabled={busy !== null} loading={busy === 'pause'} onClick={() => run('pause', { type: 'game.pause' }, 'Partida en pausa')}>
              <Pause className="size-5" aria-hidden /> Pausar
            </Button>
          ) : null}
          {game.status === 'paused' ? (
            <Button variant="success" size="xl" disabled={busy !== null} loading={busy === 'resume'} onClick={() => run('resume', { type: 'game.resume' }, 'Partida reanudada')}>
              <Play className="size-6" aria-hidden /> Reanudar
            </Button>
          ) : null}
          {game.status === 'paused' ? (
            <Button variant="danger" size="lg" disabled={busy !== null} onClick={() => setFinishOpen(true)}>
              <Flag className="size-5" aria-hidden /> Finalizar partida
            </Button>
          ) : null}
          <FinishGameDialog ctx={ctx} open={finishOpen} onClose={() => setFinishOpen(false)} />
          {game.status === 'finished' ? (
            <Link href={`/game/${roomCode}/results`} className="inline-flex min-h-14 items-center justify-center rounded-2xl bg-gold px-5 text-lg font-bold text-night-950">
              Ver resultados
            </Link>
          ) : null}
        </div>
      </Card>

      {game.status === 'finished' ? <PendingImagesNotice ctx={ctx} /> : null}
      <GalleryCard ctx={ctx} />

      <AutoRunCard ctx={ctx} />

      <JoinCard ctx={ctx} />

      {game.status === 'lobby' ? (
        <Card title="Antes de empezar">
          <ul className="space-y-2">
            <Check ok={players.length >= 2}>
              Al menos 2 jugadores ({players.length}).{' '}
              <button type="button" className="font-bold text-violet-soft underline" onClick={() => goTo('jugadores')}>
                Gestionar
              </button>
            </Check>
            <Check ok={items.length >= 1}>
              Al menos 1 elemento en el catálogo ({items.length}).{' '}
              <button type="button" className="font-bold text-violet-soft underline" onClick={() => goTo('catalogo')}>
                Gestionar
              </button>
            </Check>
            <Check ok={imagesOk}>
              Imagen inicial de cada jugador ({withImage}/{players.length}). <b>Obligatoria</b> para empezar:{' '}
              <button type="button" className="font-bold text-violet-soft underline" onClick={() => goTo('jugadores')}>
                ponla aquí
              </button>
              .
            </Check>
            {mobile ? (
              <Check ok={players.length > 0 && connected === players.length}>
                Jugadores conectados ({connected}/{players.length}). Informativo: puedes empezar aunque falte alguno{connected < players.length ? ' (los que no se conecten solo podrán pujar si tú registras sus pujas)' : ''}.
              </Check>
            ) : null}
          </ul>
        </Card>
      ) : null}

      <Card title="Saldos">
        <ul className="grid gap-2 sm:grid-cols-2">
          {players.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 rounded-2xl bg-night-900 px-3 py-2.5">
              <span className="flex min-w-0 items-center gap-2 font-bold">
                <Dot color={p.color} />
                <span className="truncate">{p.name}</span>
                {live?.current_bidder_id === p.id ? <Pill tone="gold">líder</Pill> : null}
              </span>
              <span className="shrink-0 text-lg font-bold text-gold"><Ohros cents={p.balance_cents} /></span>
            </li>
          ))}
          {players.length === 0 ? <li className="text-white/60">Aún no hay jugadores.</li> : null}
        </ul>
      </Card>

    </div>
  );
}
