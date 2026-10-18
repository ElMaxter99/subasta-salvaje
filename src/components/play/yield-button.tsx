'use client';

import { useState } from 'react';
import { Flag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { ApiError, yieldBidRequest } from '@/lib/client/api';
import type { PublicSnapshot } from '@/lib/domain/types';

/** «Ceder la puja»: el jugador avisa de que NO va a seguir pujando por este elemento (irrevocable) y así la subasta se agiliza. */
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

  if (yielded) {
    return (
      <p role="status" data-testid="yielded-note" className="rounded-2xl bg-night-700 px-4 py-2 text-center text-sm font-bold text-white/80">
        🏳️ Has cedido esta puja: no pujas más por este elemento.
      </p>
    );
  }

  async function onYield() {
    if (busy) return;
    setBusy(true);
    try {
      const r = await yieldBidRequest(roomCode, auctionId);
      navigator.vibrate?.(30);
      toast.success('Has cedido la puja');
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
        Dejas de pujar por este elemento y no podrás volver a hacerlo en esta subasta. Si todos cedéis, se adjudica antes.
      </ConfirmDialog>
    </>
  );
}
