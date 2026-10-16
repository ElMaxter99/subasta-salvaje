'use client';

import { useRef, useState } from 'react';
import { Gavel } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { ApiError, newIdempotencyKey, playerBidRequest } from '@/lib/client/api';
import { formatEuros, parseEurosToCents } from '@/lib/domain/money';
import type { PublicSnapshot } from '@/lib/domain/types';

const QUICK = [100, 200, 500, 1000];

/** Pad de puja: botones rápidos + importe manual. Una petición a la vez. */
export function BidPad({
  roomCode,
  auctionId,
  baseCents,
  minBidCents,
  balanceCents,
  leading,
  onSnapshot,
  onNotPlayer,
}: {
  roomCode: string;
  auctionId: string;
  /** Puja actual, o la mínima si aún no hay pujas. */
  baseCents: number;
  minBidCents: number;
  balanceCents: number;
  leading: boolean;
  onSnapshot: (s: PublicSnapshot) => void;
  onNotPlayer: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const [confirm, setConfirm] = useState<number | null>(null);
  const keyRef = useRef<{ amount: number; auction: string; key: string } | null>(null);

  const noFunds = balanceCents < minBidCents || balanceCents <= 0;
  const locked = leading || noFunds;
  const manual = parseEurosToCents(text);
  const manualBad = text.trim() !== '' && manual === null;

  async function send(amount: number) {
    if (busy) return;
    setBusy(true);
    setConfirm(null);
    // Reutiliza la clave si se reintenta el mismo importe tras un fallo de red.
    const prev = keyRef.current;
    const key = prev && prev.amount === amount && prev.auction === auctionId ? prev.key : newIdempotencyKey();
    keyRef.current = { amount, auction: auctionId, key };
    try {
      const r = await playerBidRequest(roomCode, auctionId, amount, key);
      keyRef.current = null;
      navigator.vibrate?.(40);
      toast.success(`Puja de ${formatEuros(amount)} enviada`);
      setText('');
      onSnapshot(r.snapshot);
    } catch (e) {
      if (e instanceof ApiError) {
        keyRef.current = null;
        toast.error(e.message);
        if (e.code === 'not_player') onNotPlayer();
      } else {
        toast.error('Sin conexión: no se pudo enviar la puja. Vuelve a intentarlo.');
      }
    } finally {
      setBusy(false);
    }
  }

  function request(amount: number) {
    if (amount * 2 >= balanceCents) setConfirm(amount);
    else void send(amount);
  }

  return (
    <div className="space-y-3" aria-label="Pujar">
      {noFunds ? (
        <p role="status" className="rounded-2xl bg-night-700 px-4 py-3 text-center text-base font-bold text-gold">
          No te queda saldo para pujar
        </p>
      ) : null}
      <div className="grid grid-cols-4 gap-2">
        {QUICK.map((d) => {
          const amount = baseCents + d;
          return (
            <Button
              key={d}
              variant="primary"
              size="lg"
              className="!px-1 !text-xl"
              disabled={locked || busy || amount > balanceCents}
              onClick={() => request(amount)}
              aria-label={`Pujar ${formatEuros(amount)} (más ${formatEuros(d)})`}
            >
              +{d / 100} €
            </Button>
          );
        })}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (manual !== null) request(manual);
        }}
      >
        <div className="min-w-0 flex-1">
          <label htmlFor="bid-amount" className="sr-only">
            Importe de la puja en euros
          </label>
          <input
            id="bid-amount"
            inputMode="decimal"
            autoComplete="off"
            enterKeyHint="send"
            value={text}
            disabled={locked}
            onChange={(e) => setText(e.target.value)}
            onFocus={(e) => window.setTimeout(() => e.target.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300)}
            aria-invalid={manualBad || undefined}
            placeholder={`Otro importe (€) · mín. ${formatEuros(baseCents + 100)}`}
            className="min-h-14 w-full rounded-2xl border border-white/20 bg-night-950 px-4 text-lg text-white placeholder:text-sm placeholder:text-white/40 disabled:opacity-45"
          />
        </div>
        <Button type="submit" variant="success" size="lg" loading={busy} disabled={locked || manual === null || manual <= 0} className="shrink-0">
          <Gavel className="size-5" aria-hidden /> Pujar
        </Button>
      </form>
      {manualBad ? (
        <p role="alert" className="text-sm font-semibold text-rose">
          Escribe un importe válido, por ejemplo 12 o 12,5.
        </p>
      ) : null}
      <ConfirmDialog
        open={confirm !== null}
        title={confirm !== null ? `¿Pujar ${formatEuros(confirm)}?` : ''}
        confirmLabel="Sí, pujar"
        variant="success"
        loading={busy}
        onConfirm={() => confirm !== null && void send(confirm)}
        onCancel={() => setConfirm(null)}
      >
        Es la mitad o más de tu saldo ({formatEuros(balanceCents)}).
      </ConfirmDialog>
    </div>
  );
}
