'use client';

import { useState } from 'react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { inputCls } from './bits';
import type { HostCtx } from './host-context';
import { PendingImagesNotice } from './pending-images';

/** Confirmación fuerte (escribir FINALIZAR) para terminar la partida. Compartida por Resumen y Ajustes. */
export function FinishGameDialog({ ctx, open, onClose }: { ctx: HostCtx; open: boolean; onClose: () => void }) {
  const { busy, run } = ctx;
  const toast = useToast();
  const [typed, setTyped] = useState('');
  return (
    <ConfirmDialog
      open={open}
      title="¿Finalizar la partida?"
      confirmLabel="Finalizar definitivamente"
      variant="danger"
      loading={busy === 'finish'}
      onCancel={() => {
        setTyped('');
        onClose();
      }}
      onConfirm={async () => {
        if (typed.trim().toUpperCase() !== 'FINALIZAR') return toast.error('Escribe FINALIZAR para confirmar.');
        const res = await run('finish', { type: 'game.finish' }, 'Partida finalizada');
        if (res) {
          setTyped('');
          onClose();
        }
      }}
    >
      <p>
        No se podrá reanudar: se cancela cualquier subasta en curso (sin cobrar) y la TV muestra los resultados. Escribe <b>FINALIZAR</b> para confirmar.
      </p>
      <div className="mt-3">
        <PendingImagesNotice ctx={ctx} />
      </div>
      <label htmlFor="finish-confirm" className="sr-only">
        Escribe FINALIZAR
      </label>
      <input id="finish-confirm" className={`${inputCls} mt-2`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" placeholder="FINALIZAR" />
    </ConfirmDialog>
  );
}
