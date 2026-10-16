'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Crown, LogOut, Pause, Trophy } from 'lucide-react';
import { BidPad } from './bid-pad';
import { MyHouse } from './house';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ConnectionBadge } from '@/components/ui/status';
import type { ConnectionState } from '@/lib/client/use-live-game';
import { formatEuros } from '@/lib/domain/money';
import type { Player, PublicSnapshot, RuntimeInfo } from '@/lib/domain/types';

/** Paso 2: móvil identificado como un jugador. */
export function PlayerScreen({
  roomCode,
  snapshot,
  me,
  connection,
  runtime,
  onSnapshot,
  onLeave,
  onNotPlayer,
  leaving,
}: {
  roomCode: string;
  snapshot: PublicSnapshot;
  me: Player;
  connection: ConnectionState;
  runtime: RuntimeInfo;
  onSnapshot: (s: PublicSnapshot) => void;
  onLeave: () => void;
  onNotPlayer: () => void;
  leaving: boolean;
}) {
  const { game, auction, last_award, players } = snapshot;
  const [menu, setMenu] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const nameOf = (id: string | null) => players.find((p) => p.id === id)?.name ?? 'Alguien';

  const open = auction?.status === 'open' && game.status === 'active';
  const closed = auction?.status === 'closed' && game.status !== 'finished';
  const leading = open && auction.current_bidder_id === me.id;
  const hasBids = (auction?.bids.length ?? 0) > 0;
  // Sin pujas la base es 0: el primer «+1 €» es una puja de 1 € (la puja mínima de la partida actúa como suelo en el pad).
  const base = open && hasBids ? auction.current_bid_cents : 0;
  const lowFunds = me.balance_cents <= 0 || me.balance_cents < game.min_bid_cents;
  const recent = open ? [...auction.bids].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 4) : [];

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-night-900/95 px-4 pb-3 pt-3 backdrop-blur">
        <div className="flex items-center justify-between gap-2">
          <p className="flex min-w-0 items-center gap-2 text-lg font-bold">
            <span aria-hidden className="size-5 shrink-0 rounded-full border-2 border-white/40" style={{ background: me.color }} />
            <span className="truncate">{me.name}</span>
          </p>
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenu((m) => !m)}
              aria-expanded={menu}
              aria-haspopup="true"
              className="min-h-11 rounded-xl px-3 text-sm font-bold text-white/80 hover:bg-white/10"
            >
              Menú
            </button>
            {menu ? (
              <div className="absolute right-0 top-12 z-40 w-56 rounded-2xl border border-white/15 bg-night-800 p-2 shadow-2xl">
                <button
                  type="button"
                  onClick={() => {
                    setMenu(false);
                    setConfirmLeave(true);
                  }}
                  className="flex min-h-12 w-full items-center gap-2 rounded-xl px-3 text-left text-base font-bold hover:bg-white/10"
                >
                  <LogOut className="size-5" aria-hidden /> No soy yo / Salir
                </button>
              </div>
            ) : null}
          </div>
        </div>
        <div className="mt-1 flex items-end justify-between gap-2">
          <div aria-live="polite">
            <p className="text-xs font-bold uppercase tracking-wider text-white/60">Tu saldo</p>
            <p className="font-display text-4xl leading-none text-gold" data-testid="balance">
              {formatEuros(me.balance_cents)}
            </p>
          </div>
          <ConnectionBadge state={connection} runtime={runtime} className="pb-1 !text-xs" />
        </div>
      </header>

      <main className="flex-1 space-y-4 px-4 pb-6 pt-4">
        {game.status === 'paused' ? (
          <p role="status" className="flex items-center justify-center gap-2 rounded-2xl bg-gold px-4 py-3 text-base font-bold text-night-950">
            <Pause className="size-5" aria-hidden /> Partida en pausa
          </p>
        ) : null}

        {game.status === 'finished' ? (
          <div className="space-y-3 rounded-3xl border border-white/10 bg-night-800 p-5 text-center">
            <h2 className="font-display text-2xl">La partida ha terminado</h2>
            <Link href={`/game/${roomCode}/results`} className="inline-flex min-h-14 items-center justify-center rounded-2xl bg-gold px-6 text-lg font-bold text-night-950">
              Ver resultados
            </Link>
          </div>
        ) : null}

        {game.status === 'lobby' ? (
          <p role="status" aria-live="polite" className="rounded-2xl bg-night-800 px-4 py-4 text-center text-lg font-bold">
            Esperando a que empiece la partida…
          </p>
        ) : null}

        {open ? (
          <section aria-label="Subasta en curso" className="space-y-4">
            <div className="flex items-center gap-4 rounded-3xl border border-white/10 bg-night-800 p-4">
              {auction.item.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={auction.item.image_url} alt="" className="size-20 shrink-0 rounded-2xl object-cover" />
              ) : (
                <span aria-hidden className="flex size-20 shrink-0 items-center justify-center rounded-2xl bg-night-700 text-5xl">
                  {auction.item.emoji ?? '🎁'}
                </span>
              )}
              <div className="min-w-0">
                <h2 className="font-display text-2xl leading-tight">{auction.item.name}</h2>
                {auction.item.description ? <p className="mt-1 line-clamp-3 text-sm text-white/70">{auction.item.description}</p> : null}
              </div>
            </div>

            <div
              aria-live="polite"
              className={`rounded-3xl border-2 p-4 text-center ${leading ? 'border-teal bg-teal/15' : 'border-gold/40 bg-night-800'}`}
            >
              <p className="text-xs font-bold uppercase tracking-wider text-white/60">Puja actual</p>
              <p className="font-display text-6xl leading-tight text-gold" data-testid="current-bid">
                {hasBids ? formatEuros(auction.current_bid_cents) : '—'}
              </p>
              <p className="mt-1 flex items-center justify-center gap-2 text-lg font-bold" data-testid="leader">
                {leading ? (
                  <>
                    <Crown className="size-5 text-teal" aria-hidden /> <span className="text-teal">¡Vas ganando!</span>
                  </>
                ) : hasBids ? (
                  <>Va ganando {nameOf(auction.current_bidder_id)}</>
                ) : (
                  <>Aún sin pujas · mínimo {formatEuros(game.min_bid_cents)}</>
                )}
              </p>
            </div>

            {recent.length > 0 ? (
              <ul className="space-y-1 text-sm" aria-label="Últimas pujas">
                {recent.map((b, i) => (
                  <li key={b.id} className={`flex justify-between rounded-xl px-3 py-1.5 ${i === 0 ? 'bg-white/10 font-bold' : 'text-white/70'}`}>
                    <span>{b.player_id === me.id ? 'Tú' : nameOf(b.player_id)}</span>
                    <span>{formatEuros(b.amount_cents)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}

        {closed ? (
          <p role="status" aria-live="polite" className="rounded-3xl border-2 border-violet bg-violet/20 px-4 py-6 text-center font-display text-2xl">
            ¡Puja cerrada! El anfitrión va a adjudicar…
          </p>
        ) : null}

        {game.status === 'active' && !open && !closed ? (
          <p role="status" aria-live="polite" className="rounded-2xl bg-night-800 px-4 py-4 text-center text-lg font-bold">
            Esperando el siguiente elemento…
          </p>
        ) : null}

        {!open && last_award && game.status !== 'lobby' ? (
          <p
            role="status"
            aria-live="polite"
            className={`flex items-start gap-3 rounded-2xl px-4 py-3 text-base font-bold ${last_award.player_id === me.id ? 'bg-teal text-night-950' : 'bg-night-800'}`}
          >
            <Trophy className="mt-0.5 size-5 shrink-0" aria-hidden />
            <span>
              {last_award.player_id === me.id ? '¡Te llevaste ' : `¡${nameOf(last_award.player_id)} se llevó `}
              {last_award.emoji ?? ''} {last_award.item_name} por {formatEuros(last_award.price_cents)}!
            </span>
          </p>
        ) : null}

        {!open && game.status === 'active' && lowFunds ? (
          <p role="status" className="rounded-2xl bg-night-700 px-4 py-3 text-center font-bold text-gold">
            No te queda saldo para pujar
          </p>
        ) : null}

        {!open ? (
          <>
            <MyHouse player={me} />
            {me.purchases.length > 0 ? (
              <section aria-label="Tus compras" className="space-y-2">
                <h3 className="font-display text-lg">Tus compras</h3>
                <ul className="space-y-1">
                  {me.purchases.map((p) => (
                    <li key={p.purchase_id} className="flex justify-between gap-2 rounded-xl bg-night-800 px-3 py-2 text-sm">
                      <span className="min-w-0 truncate">
                        {p.emoji ?? '🎁'} {p.name}
                      </span>
                      <span className="shrink-0 font-bold text-gold">{formatEuros(p.price_cents)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        ) : null}
      </main>

      {open ? (
        <div className="sticky bottom-0 z-20 border-t border-white/10 bg-night-900/95 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur">
          <BidPad
            roomCode={roomCode}
            auctionId={auction.id}
            baseCents={base}
            minBidCents={game.min_bid_cents}
            balanceCents={me.balance_cents}
            leading={leading}
            onSnapshot={onSnapshot}
            onNotPlayer={onNotPlayer}
          />
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmLeave}
        title="¿Dejar de ser este jugador?"
        confirmLabel="Salir"
        variant="danger"
        loading={leaving}
        onConfirm={onLeave}
        onCancel={() => setConfirmLeave(false)}
      >
        Podrás volver a elegir jugador. No perderás tu saldo ni tus compras.
      </ConfirmDialog>
    </div>
  );
}
