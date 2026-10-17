'use client';

import { useState } from 'react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { inputCls } from './bits';
import type { HostCtx } from './host-context';

/** Confirmación fuerte (escribir REINICIAR) para dejar la partida como en la sala de espera. */
export function ResetGameDialog({ ctx, open, onClose }: { ctx: HostCtx; open: boolean; onClose: () => void }) {
  const { busy, run } = ctx;
  const toast = useToast();
  const [typed, setTyped] = useState('');
  return (
    <ConfirmDialog
      open={open}
      title="¿Reiniciar la partida?"
      confirmLabel="Reiniciar y borrar"
      variant="danger"
      loading={busy === 'reset'}
      onCancel={() => {
        setTyped('');
        onClose();
      }}
      onConfirm={async () => {
        if (typed.trim().toUpperCase() !== 'REINICIAR') return toast.error('Escribe REINICIAR para confirmar.');
        const res = await run('reset', { type: 'game.reset' }, 'Partida reiniciada');
        if (res) {
          setTyped('');
          onClose();
        }
      }}
    >
      <p>
        La partida vuelve a la sala de espera, como antes de empezar: se borran subastas, pujas, compras, votos y el historial, las imágenes generadas se eliminan (cada jugador recupera su imagen inicial) y todos recuperan su presupuesto inicial. Se conservan jugadores, catálogo y ajustes. La cuota de IA ya gastada no se devuelve. No se puede deshacer. Escribe <b>REINICIAR</b> para confirmar.
      </p>
      <label htmlFor="reset-confirm" className="sr-only">
        Escribe REINICIAR
      </label>
      <input id="reset-confirm" className={`${inputCls} mt-3`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" placeholder="REINICIAR" />
    </ConfirmDialog>
  );
}
