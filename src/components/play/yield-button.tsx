'use client';

import { useEffect, useRef, useState } from 'react';
import { Flag, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { ApiError, unyieldBidRequest, yieldBidRequest } from '@/lib/client/api';
import type { PublicSnapshot } from '@/lib/domain/types';

/** «Ceder la puja»: el jugador avisa de que NO va a seguir pujando por este elemento y así la subasta se agiliza. */
export function YieldButton({
  roomCode,
  auctionId,
  yielded,
  onSnapshot,
  onNotPlayer,
}: {
  roomCode: string;
  auctionId: string;
  yielded: boolean;
  onSnapshot: (s: PublicSnapshot) => void;
  onNotPlayer: () => void;
}) {
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const noteRef = useRef<HTMLParagraphElement>(null);
  const justYielded = useRef(false);
  // El botón desaparece al ceder: el foco pasa a la nota para no perderse en <body> (solo si cedió en esta sesión, no al recargar).
  useEffect(() => {
    if (yielded && justYielded.current) noteRef.current?.focus();
  }, [yielded]);

  async function onUnyield() {
    if (busy) return;
    setBusy(true);
    try {
      const r = await unyieldBidRequest(roomCode, auctionId);
      navigator.vibrate?.(30);
      toast.success('Vuelves a pujar', { announce: false });
      onSnapshot(r.snapshot);
    } catch (e) {
      if (e instanceof ApiError) {
        toast.error(e.message);
        if (e.code === 'not_player') onNotPlayer();
      } else {
        toast.error('Sin conexión: no se pudo retractar. Vuelve a intentarlo.');
      }
    } finally {
      setBusy(false);
    }
  }

  if (yielded) {
    return (
      <div className="space-y-2 rounded-2xl bg-night-700 px-4 py-2 text-center">
        <p ref={noteRef} tabIndex={-1} role="status" data-testid="yielded-note" className="text-sm font-bold text-white/80 outline-offset-2">
          🏳️ Has cedido esta puja: no pujas más por este elemento.
        </p>
        <Button variant="secondary" size="md" className="w-full" loading={busy} onClick={() => void onUnyield()} data-testid="unyield-button">
          <Undo2 className="size-4" aria-hidden /> Volver a pujar
        </Button>
      </div>
    );
  }

  async function onYield() {
    if (busy) return;
    setBusy(true);
    try {
      const r = await yieldBidRequest(roomCode, auctionId);
      navigator.vibrate?.(30);
      justYielded.current = true;
      toast.success('Has cedido la puja', { announce: false }); // la nota «yielded-note» (role=status) ya lo anuncia
      setConfirm(false);
      onSnapshot(r.snapshot);
    } catch (e) {
      setConfirm(false);
      if (e instanceof ApiError) {
        toast.error(e.message);
        if (e.code === 'not_player') onNotPlayer();
      } else {
        toast.error('Sin conexión: no se pudo ceder la puja. Vuelve a intentarlo.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="secondary" size="md" className="w-full" onClick={() => setConfirm(true)} data-testid="yield-button">
        <Flag className="size-4" aria-hidden /> Ceder la puja (no sigo)
      </Button>
      <ConfirmDialog
        open={confirm}
        title="¿Ceder la puja?"
        confirmLabel="Sí, cedo"
        variant="danger"
        loading={busy}
        onConfirm={() => void onYield()}
        onCancel={() => setConfirm(false)}
      >
        Dejas de pujar por este elemento. Podrás retractarte con «Volver a pujar» mientras la subasta siga abierta (salvo que cedáis todos y se adjudique al instante). Si todos cedéis, se adjudica antes.
      </ConfirmDialog>
    </>
  );
}
