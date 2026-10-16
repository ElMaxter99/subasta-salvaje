'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { deleteGameRequest } from '@/lib/client/api';
import { Card, inputCls } from './bits';
import type { HostCtx } from './host-context';

/** Borrado definitivo de la partida (y sus imágenes) por el anfitrión. Pide escribir BORRAR. */
export function DeleteGameCard({ ctx }: { ctx: HostCtx }) {
  const { roomCode, busy, snapshot } = ctx;
  const toast = useToast();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [deleting, setDeleting] = useState(false);
  const expires = snapshot.expires_at ? new Date(snapshot.expires_at) : null;

  async function confirm() {
    if (typed.trim().toUpperCase() !== 'BORRAR') return toast.error('Escribe BORRAR para confirmar.');
    setDeleting(true);
    try {
      await deleteGameRequest(roomCode);
      toast.success('Partida borrada');
      router.push('/');
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo borrar la partida.');
      setDeleting(false);
    }
  }

  return (
    <Card title="Borrar partida" icon={<Trash2 className="size-5 text-rose" aria-hidden />} className="border-rose/40">
      <p className="mb-3 text-sm text-white/75">
        Elimina <b>para siempre</b> la partida: jugadores, pujas, compras, historial y todas sus imágenes. La pantalla de TV y los móviles dejarán de ver la sala. No se puede deshacer.
      </p>
      {expires ? (
        <p className="mb-3 text-xs text-white/55">
          Aunque no hagas nada, se borrará sola si pasa tiempo sin actividad (ahora, el {expires.toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}).
        </p>
      ) : null}
      <Button variant="danger" size="lg" disabled={busy !== null || deleting} onClick={() => { setTyped(''); setOpen(true); }}>
        <Trash2 className="size-5" aria-hidden /> Borrar partida
      </Button>
      <ConfirmDialog
        open={open}
        title="¿Borrar la partida para siempre?"
        confirmLabel="Sí, borrar todo"
        variant="danger"
        loading={deleting}
        onCancel={() => setOpen(false)}
        onConfirm={confirm}
      >
        <p>
          Se borrarán <b>{snapshot.players.length} jugadores</b>, el historial y las imágenes de la sala <b>{roomCode}</b>. Escribe <b>BORRAR</b> para confirmar.
        </p>
        <label htmlFor="delete-confirm" className="sr-only">
          Escribe BORRAR
        </label>
        <input id="delete-confirm" className={`${inputCls} mt-2`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" placeholder="BORRAR" />
      </ConfirmDialog>
    </Card>
  );
}
