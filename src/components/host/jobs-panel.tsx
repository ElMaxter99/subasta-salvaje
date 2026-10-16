'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { History, Play, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { kickJobs } from '@/lib/client/api';
import type { ImageJob, JobKind, JobStatus } from '@/lib/domain/types';
import { Card, Notice, Pill, fmtDateTime } from './bits';
import { errorMessage, type HostCtx } from './host-context';

const KIND: Record<JobKind, string> = { base: 'Imagen base de la partida (para todos)', initial: 'Imagen inicial', edit: 'Edición por compra', item: 'Imagen de elemento' };
const STATUS: Record<JobStatus, [string, 'neutral' | 'gold' | 'teal' | 'rose']> = {
  queued: ['En cola', 'neutral'],
  running: ['En curso', 'gold'],
  completed: ['Completado', 'teal'],
  failed: ['Fallido', 'rose'],
};

const pendingJobs = (jobs: ImageJob[]) => jobs.filter((j) => j.status === 'queued' || j.status === 'running').length;

/** Red de seguridad: si hay trabajos pendientes y hay IA, pide al servidor que procese la cola cada ~25 s. */
export function useAutoKick(ctx: Pick<HostCtx, 'roomCode' | 'snapshot' | 'runtime'>) {
  const hasPending = pendingJobs(ctx.snapshot.jobs) > 0;
  const { roomCode, runtime } = ctx;
  useEffect(() => {
    if (!hasPending || (ctx.snapshot.game.image_mode === 'ai' && !runtime.aiConfigured)) return;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') kickJobs(roomCode).catch(() => undefined);
    }, 25_000);
    return () => clearInterval(id);
  }, [hasPending, roomCode, runtime.aiConfigured, ctx.snapshot.game.image_mode]);
}

export function JobsPanel({ ctx, refresh }: { ctx: HostCtx; refresh: () => Promise<void> }) {
  const { snapshot, busy, run, runtime, roomCode } = ctx;
  const toast = useToast();
  const kicking = useRef(false);
  const jobs = snapshot.jobs;
  const pending = pendingJobs(jobs);
  const failed = jobs.filter((j) => j.status === 'failed');

  async function kick() {
    if (kicking.current) return;
    kicking.current = true;
    try {
      await kickJobs(roomCode);
      toast.success('Cola de imágenes en proceso');
      setTimeout(() => void refresh(), 1200);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      kicking.current = false;
    }
  }

  return (
    <div className="space-y-4">
      {snapshot.game.image_mode === 'ai' && !runtime.aiConfigured ? <Notice tone="warn">IA no configurada: las imágenes de esta partida quedan en cola hasta que se configure el proveedor (IMAGE_PROVIDER).</Notice> : null}
      <UsageCard ctx={ctx} />
      {snapshot.game.image_mode === 'ai' && runtime.aiConfigured && !runtime.aiCanEdit ? (
        <Notice tone="warn">
          El modelo de IA configurado solo genera imágenes nuevas: <b>no puede editar la casa existente</b>. Las compras se registran igual y la imagen anterior se conserva, pero la edición saldrá como fallida hasta que configures un modelo con edición (<code>CLOUDFLARE_EDIT_MODEL</code>) u otro proveedor.
        </Notice>
      ) : null}
      {failed.length > 0 ? (
        <Notice tone="warn">
          {failed.length === 1 ? 'Un trabajo de imagen ha fallado' : `${failed.length} trabajos de imagen han fallado`}, pero <b>la compra y el saldo están a salvo</b>. Puedes reintentarlo sin que se cobre nada otra vez.
        </Notice>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" size="lg" onClick={kick}>
          <Play className="size-5" aria-hidden /> Procesar cola ahora
        </Button>
        <span className="text-sm text-white/70">{pending > 0 ? `${pending} pendiente${pending > 1 ? 's' : ''}` : 'Sin trabajos pendientes'}</span>
        <Link href={`/game/${roomCode}/history`} className="ml-auto inline-flex min-h-10 items-center gap-1.5 text-sm font-bold text-violet-soft hover:underline">
          <History className="size-4" aria-hidden /> Historial de imágenes
        </Link>
      </div>

      {jobs.length === 0 ? (
        <Card>
          <p className="text-white/70">Todavía no hay trabajos de imagen. Aparecerán al generar imágenes iniciales o al adjudicar un elemento.</p>
        </Card>
      ) : (
        <ul className="space-y-2">
          {jobs.map((j) => {
            const [label, tone] = STATUS[j.status];
            return (
              <li key={j.id} className={`rounded-2xl border p-3 ${j.status === 'failed' ? 'border-rose/40 bg-rose/5' : 'border-white/10 bg-night-800/80'}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <Pill tone={tone}>{label}</Pill>
                  <span className="font-bold">{KIND[j.kind]}</span>
                  <span className="text-sm text-white/60">
                    {j.attempts}/{j.max_attempts} intentos
                  </span>
                  <span className="ml-auto text-xs text-white/50">{fmtDateTime(j.created_at)}</span>
                </div>
                <p className="mt-1 text-sm text-white/80">
                  {j.player_name ? <>Jugador: <b>{j.player_name}</b></> : null}
                  {j.player_name && j.item_name ? ' · ' : null}
                  {j.item_name ? <>Elemento: <b>{j.item_name}</b></> : null}
                </p>
                {j.status === 'failed' ? (
                  <div className="mt-2 space-y-2">
                    {j.error_message ? <p className="rounded-lg bg-night-950 p-2 text-sm text-rose">{j.error_message}</p> : null}
                    <Button size="md" variant="secondary" disabled={busy !== null} loading={busy === `retry-${j.id}`} onClick={() => run(`retry-${j.id}`, { type: 'image.retry', job_id: j.id }, 'Reintento en cola (no se cobra de nuevo)')}>
                      <RotateCw className="size-4" aria-hidden /> Reintentar
                    </Button>
                    <p className="text-xs text-white/60">Reintentar solo vuelve a generar la imagen: no cobra ni modifica saldos ni compras.</p>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Contador visible de generaciones reales (el proveedor demo no consume ni tiene límite). */
function UsageCard({ ctx }: { ctx: HostCtx }) {
  const u = ctx.snapshot.usage;
  if (!u) return null;
  if (!u.limited) {
    return (
      <Card title="Generaciones de imagen">
        <p className="text-sm text-white/70">
          Modo <b>pegatinas</b>: ilustraciones locales sin IA. No consume cuota ni cuesta nada.
        </p>
      </Card>
    );
  }
  const bar = (used: number, limit: number | null) => {
    const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
    const tone = pct >= 100 ? 'bg-rose' : pct >= 80 ? 'bg-gold' : 'bg-teal';
    return (
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-night-900" role="presentation">
        <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    );
  };
  const full = (u.game_limit !== null && u.game_used >= u.game_limit) || (u.day_limit !== null && u.day_used >= u.day_limit);
  return (
    <Card title="Cuota de generaciones reales">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-sm text-white/70">Esta partida</p>
          <p className="font-display text-2xl tabular-nums" aria-label={`${u.game_used} de ${u.game_limit} generaciones en esta partida`}>
            {u.game_used} / {u.game_limit}
          </p>
          {bar(u.game_used, u.game_limit)}
        </div>
        <div>
          <p className="text-sm text-white/70">Hoy (todas las partidas, UTC)</p>
          <p className="font-display text-2xl tabular-nums" aria-label={`${u.day_used} de ${u.day_limit} generaciones hoy`}>
            {u.day_used} / {u.day_limit}
          </p>
          {bar(u.day_used, u.day_limit)}
        </div>
      </div>
      <p className="mt-2 text-xs text-white/55">
        Proveedor: {u.provider === 'cloudflare' ? 'Cloudflare Workers AI' : 'OpenAI'}. Cuenta cada llamada al proveedor (también las que fallan). Límites: <code>IMAGE_QUOTA_PER_GAME</code> / <code>IMAGE_QUOTA_PER_DAY</code>.
      </p>
      {full ? <Notice tone="warn">Cuota alcanzada: los trabajos nuevos fallarán con un aviso claro y la partida sigue con las imágenes actuales. Se renueva a las 00:00 UTC (diaria).</Notice> : null}
    </Card>
  );
}
