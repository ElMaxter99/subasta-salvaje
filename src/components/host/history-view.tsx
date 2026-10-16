'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, ChevronDown, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ConnectionBadge, DemoBanner } from '@/components/ui/status';
import { ToastProvider } from '@/components/ui/toast';
import { useLiveGame } from '@/lib/client/use-live-game';
import type { HostSnapshot, ImageVersion, RuntimeInfo } from '@/lib/domain/types';
import { Card, Dot, Notice, Pill, Thumb, fmtDateTime } from './bits';
import { useHostRunner } from './host-context';
import { ImageCompare, versionLabel } from './image-compare';

interface Props {
  roomCode: string;
  initial: HostSnapshot;
  runtime: RuntimeInfo;
}

export function HistoryView(props: Props) {
  return (
    <ToastProvider>
      <HistoryInner {...props} />
    </ToastProvider>
  );
}

function HistoryInner({ roomCode, initial, runtime }: Props) {
  const { snapshot, connection, apply, refresh } = useLiveGame<HostSnapshot>({ roomCode, initial, runtime, view: 'host' });
  const { busy, run } = useHostRunner(roomCode, apply, refresh);
  const wanted = useSearchParams().get('player');
  const [playerId, setPlayerId] = useState<string | null>(wanted);
  const [aId, setA] = useState<string | null>(null);
  const [bId, setB] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<ImageVersion | null>(null);

  const players = snapshot.players;
  const player = players.find((p) => p.id === playerId) ?? players[0];
  const versions = useMemo(() => snapshot.versions.filter((v) => v.player_id === player?.id).sort((x, y) => x.created_at.localeCompare(y.created_at)), [snapshot.versions, player?.id]);
  const byId = (id: string | null) => versions.find((v) => v.id === id) ?? null;
  const a = byId(aId);
  const b = byId(bId);

  return (
    <div className="min-h-screen pb-10">
      <DemoBanner runtime={runtime} />
      <header className="sticky top-0 z-30 border-b border-white/10 bg-night-900/95 backdrop-blur">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-3 px-4 py-3">
          <Link href={`/game/${roomCode}/host`} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-night-700 px-4 font-bold hover:bg-night-600">
            <ArrowLeft className="size-5" aria-hidden /> Volver al panel
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-xl">Historial de imágenes</h1>
            <p className="truncate text-sm text-white/65">{snapshot.game.name} · {roomCode}</p>
          </div>
          <ConnectionBadge state={connection} runtime={runtime} />
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-4 px-4 pt-4">
        {players.length === 0 ? (
          <Notice tone="info">Esta partida aún no tiene jugadores.</Notice>
        ) : (
          <>
            <div role="tablist" aria-label="Jugador" className="flex flex-wrap gap-2">
              {players.map((p) => {
                const on = p.id === player?.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    onClick={() => {
                      setPlayerId(p.id);
                      setA(null);
                      setB(null);
                    }}
                    className={`inline-flex min-h-11 items-center gap-2 rounded-full border-2 px-4 font-bold transition ${on ? 'bg-white/15' : 'border-white/10 bg-night-700 hover:bg-night-600'}`}
                    style={on ? { borderColor: p.color } : undefined}
                  >
                    <Dot color={p.color} /> {p.name}
                  </button>
                );
              })}
            </div>

            {versions.length === 0 ? (
              <Card>
                <p className="text-white/70">{player?.name} todavía no tiene imágenes. Genera o sube una imagen inicial desde el panel.</p>
              </Card>
            ) : (
              <>
                {a && b ? <ImageCompare a={a} b={b} /> : <Notice tone="info">Para comparar, marca dos versiones como «A» y «B» en la línea de tiempo.</Notice>}

                <Card title={`Línea de tiempo · ${versions.length} versión${versions.length === 1 ? '' : 'es'}`}>
                  <ol className="space-y-3">
                    {versions.map((v) => (
                      <VersionItem
                        key={v.id}
                        v={v}
                        parent={versions.find((x) => x.id === v.parent_version_id) ?? null}
                        current={v.id === player?.current_image_version_id}
                        isA={v.id === aId}
                        isB={v.id === bId}
                        onA={() => setA(v.id === aId ? null : v.id)}
                        onB={() => setB(v.id === bId ? null : v.id)}
                        onRestore={() => setRestoring(v)}
                        busy={busy !== null}
                      />
                    ))}
                  </ol>
                </Card>
              </>
            )}
          </>
        )}
      </main>

      <ConfirmDialog
        open={!!restoring}
        title="Restaurar esta versión"
        confirmLabel="Restaurar"
        variant="success"
        loading={busy === 'restore'}
        onCancel={() => setRestoring(null)}
        onConfirm={async () => {
          if (restoring && player) {
            const res = await run('restore', { type: 'image.restore', player_id: player.id, version_id: restoring.id }, 'Versión restaurada');
            if (res) setRestoring(null);
          }
        }}
      >
        <div className="flex items-center gap-3">
          <Thumb url={restoring?.url} alt="Versión a restaurar" className="size-20" />
          <p>
            <b>{restoring ? versionLabel(restoring) : ''}</b> pasará a ser la imagen actual de <b>{player?.name}</b>. <b>No cambia saldos ni compras ni borra versiones posteriores</b>: podrás volver a cualquier otra.
          </p>
        </div>
      </ConfirmDialog>
    </div>
  );
}

function VersionItem({ v, parent, current, isA, isB, onA, onB, onRestore, busy }: { v: ImageVersion; parent: ImageVersion | null; current: boolean; isA: boolean; isB: boolean; onA: () => void; onB: () => void; onRestore: () => void; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const failed = v.generation_status === 'failed';
  const restorable = v.generation_status === 'completed' && v.is_approved && !!v.url;
  return (
    <li className={`rounded-2xl border p-3 ${current ? 'border-gold bg-gold/10' : failed ? 'border-rose/40 bg-rose/5' : 'border-white/10 bg-night-900'}`}>
      <div className="flex items-start gap-3">
        <Thumb url={v.url} alt={`Versión ${versionLabel(v)}`} className="size-24" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <b className="text-base">{versionLabel(v)}</b>
            {current ? <Pill tone="gold">ACTUAL</Pill> : null}
            {v.provider === 'demo' ? <Pill tone="violet">DEMO</Pill> : <Pill>{v.provider}</Pill>}
            <Pill tone={failed ? 'rose' : 'teal'}>{failed ? 'Fallida' : 'Completada'}</Pill>
          </div>
          <p className="text-sm text-white/60">{fmtDateTime(v.created_at)}</p>
          {failed && v.error_message ? <p className="text-sm text-rose">{v.error_message}</p> : null}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="md" variant={isA ? 'primary' : 'secondary'} aria-pressed={isA} disabled={!v.url} onClick={onA}>
          Comparar como A
        </Button>
        <Button size="md" variant={isB ? 'primary' : 'secondary'} aria-pressed={isB} disabled={!v.url} onClick={onB}>
          Comparar como B
        </Button>
        <Button size="md" variant="success" disabled={!restorable || current || busy} onClick={onRestore} title={restorable ? undefined : 'Solo se pueden restaurar versiones completadas y aprobadas'}>
          <RotateCcw className="size-4" aria-hidden /> {current ? 'Es la actual' : 'Restaurar esta versión'}
        </Button>
        <Button size="md" variant="ghost" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <ChevronDown className={`size-4 transition ${open ? 'rotate-180' : ''}`} aria-hidden /> Detalles
        </Button>
      </div>
      {open ? (
        <div className="mt-3 space-y-2 rounded-xl bg-night-950 p-3 text-sm">
          <p>
            <b className="text-white/60">Versión padre:</b> {parent ? `${versionLabel(parent)} · ${fmtDateTime(parent.created_at)}` : v.parent_version_id ? 'no disponible' : 'ninguna (origen)'}
          </p>
          <p>
            <b className="text-white/60">Prompt usado:</b>
          </p>
          <p className="whitespace-pre-wrap break-words text-white/80">{v.prompt_used ?? 'Sin prompt (imagen subida o sin registro).'}</p>
        </div>
      ) : null}
    </li>
  );
}
