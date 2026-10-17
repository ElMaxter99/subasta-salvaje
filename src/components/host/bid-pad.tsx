'use client';

import { useMemo, useState } from 'react';
import { Gavel } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { newIdempotencyKey } from '@/lib/client/api';
import { formatOhros, parseOhrosToCents, wholeUp } from '@/lib/domain/money';
import type { Auction } from '@/lib/domain/types';
import { Dot, inputCls } from './bits';
import type { HostCtx } from './host-context';
import { Ohros } from '@/components/ui/ohros';

const INCREMENTS = [100, 200, 500, 1000];

/** Selector de jugador + botones rápidos + importe manual. El servidor valida; aquí solo se ayuda. */
export function BidPad({ ctx, auction }: { ctx: HostCtx; auction: Auction }) {
  const { snapshot, busy, run } = ctx;
  const { players, game } = snapshot;
  const [selected, setSelected] = useState<string | null>(null);
  const [manual, setManual] = useState('');

  const hasBids = auction.current_bid_cents > 0;
  // Sin pujas la base es 0: «+1 Ohro» = puja de 1 Ohro (la puja mínima actúa como suelo).
  const base = hasBids ? auction.current_bid_cents : 0;
  const whole = game.integer_bids !== false;
  const minNext = wholeUp(hasBids ? auction.current_bid_cents + 1 : game.min_bid_cents, whole);
  const player = players.find((p) => p.id === selected) ?? null;
  const manualCents = useMemo(() => parseOhrosToCents(manual), [manual]);

  async function bid(amount: number, key = `bid-${amount}`) {
    if (!player) return;
    const res = await run(key, { type: 'auction.bid', auction_id: auction.id, player_id: player.id, amount_cents: amount, idempotency_key: newIdempotencyKey() }, `${player.name} puja ${formatOhros(amount)}`);
    if (res) setManual('');
  }

  const manualProblem =
    manual.trim() === '' ? null : manualCents === null ? `Escribe un importe válido, p. ej. ${whole ? '12' : '12 o 12,5'}` : whole && manualCents % 100 !== 0 ? 'En esta partida solo se puede pujar en Ohros enteros' : manualCents < minNext ? `Debe ser al menos ${formatOhros(minNext)}` : player && manualCents > player.balance_cents ? `${player.name} solo tiene ${formatOhros(player.balance_cents)}` : null;

  return (
    <div className="space-y-4">
      <div role="radiogroup" aria-label="¿Quién puja?" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {players.map((p) => {
          const cantPay = p.balance_cents < minNext;
          const on = p.id === selected;
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={cantPay || busy !== null}
              onClick={() => setSelected(p.id)}
              className={`flex min-h-16 flex-col items-start justify-center gap-0.5 rounded-2xl border-2 px-3 py-2 text-left transition disabled:opacity-40 ${on ? 'bg-white/15' : 'border-white/10 bg-night-700 hover:bg-night-600'}`}
              style={on ? { borderColor: p.color } : undefined}
            >
              <span className="flex items-center gap-2 text-base font-bold">
                <Dot color={p.color} />
                {p.name}
                {p.id === auction.current_bidder_id ? <span className="rounded bg-gold px-1.5 text-xs text-night-950">líder</span> : null}
              </span>
              <span className="text-sm text-white/70">{cantPay ? 'No llega a la puja' : `Saldo ${formatOhros(p.balance_cents)}`}</span>
            </button>
          );
        })}
      </div>

      <p className="text-sm text-white/70" aria-live="polite">
        {player ? (
          <>
            Puja de <b style={{ color: player.color }}>{player.name}</b> · máximo posible <b className="text-white"><Ohros cents={player.balance_cents} /></b> (todo su saldo)
          </>
        ) : (
          'Elige primero quién puja.'
        )}
      </p>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {INCREMENTS.map((inc) => {
          const amount = wholeUp(Math.max(base + inc, game.min_bid_cents), whole);
          const tooMuch = !!player && amount > player.balance_cents;
          return (
            <Button key={inc} variant="primary" size="lg" disabled={!player || tooMuch || busy !== null} loading={busy === `bid-${amount}`} onClick={() => bid(amount)} aria-label={`Sumar ${formatOhros(inc)}: pujar ${formatOhros(amount)}`}>
              +<Ohros cents={inc} />
              <span className="text-sm font-semibold opacity-75"><Ohros cents={amount} /></span>
            </Button>
          );
        })}
      </div>
      {!hasBids ? (
        <Button variant="secondary" size="md" className="w-full" disabled={!player || wholeUp(game.min_bid_cents, whole) > (player?.balance_cents ?? 0) || busy !== null} onClick={() => bid(wholeUp(game.min_bid_cents, whole))}>
          Pujar la mínima (<Ohros cents={wholeUp(game.min_bid_cents, whole)} />)
        </Button>
      ) : null}

      <form
        className="space-y-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (manualCents !== null && !manualProblem) void bid(manualCents, 'bid-manual');
        }}
      >
        <label htmlFor="bid-manual" className="text-sm font-semibold text-white/80">
          Importe manual (Ohros)
        </label>
        <div className="flex gap-2">
          <input id="bid-manual" className={inputCls} inputMode={whole ? 'numeric' : 'decimal'} placeholder={whole ? '12' : '12,5'} value={manual} onChange={(e) => setManual(e.target.value)} autoComplete="off" />
          <Button type="submit" variant="success" size="md" disabled={!player || manualCents === null || !!manualProblem || busy !== null} loading={busy === 'bid-manual'} className="shrink-0">
            <Gavel className="size-5" aria-hidden /> Pujar
          </Button>
        </div>
        {manualProblem ? <p className="text-sm font-semibold text-rose">{manualProblem}</p> : null}
      </form>
    </div>
  );
}
