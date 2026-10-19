'use client';

import { Button } from '@/components/ui/button';
import { Notice } from './bits';
import type { HostCtx } from './host-context';

/**
 * Avisa de los jugadores cuya imagen FINAL aún no existe: ediciones en cola/en curso (se completarán solas) o fallidas
 * (cada una se queda con la imagen anterior hasta que se reintente). Sirve antes de finalizar y en la partida terminada.
 */
export function PendingImagesNotice({ ctx }: { ctx: HostCtx }) {
  const { snapshot, busy, run } = ctx;
  const edits = snapshot.jobs.filter((j) => j.kind === 'edit');
  const pending = edits.filter((j) => j.status === 'queued' || j.status === 'running');
  const failed = edits.filter((j) => j.status === 'failed');
  if (pending.length === 0 && failed.length === 0) return null;
  const names = (js: typeof edits) => [...new Set(js.map((j) => j.player_name ?? 'Jugador'))].join(', ');
  return (
    <div className="space-y-2" data-testid="pending-images">
      {pending.length > 0 ? (
        <Notice tone="info">
          ⏳ Se están generando {pending.length} {pending.length === 1 ? 'imagen final' : 'imágenes finales'} ({names(pending)}). Se mostrarán solas en cuanto terminen, aunque finalices ya.
        </Notice>
      ) : null}
      {failed.length > 0 ? (
        <Notice tone="warn">
          <p>
            ⚠️ {failed.length} {failed.length === 1 ? 'edición ha fallado' : 'ediciones han fallado'} ({names(failed)}): esas imágenes se quedarán como estaban antes (en «Después» se verá la inicial o una intermedia).
          </p>
          <Button
            className="mt-2"
            size="sm"
            variant="secondary"
            disabled={busy !== null}
            loading={busy === 'retry-all'}
            onClick={async () => {
              for (const j of failed) await run('retry-all', { type: 'image.retry', job_id: j.id });
            }}
          >
            Reintentar las fallidas
          </Button>
        </Notice>
      ) : null}
    </div>
  );
}
