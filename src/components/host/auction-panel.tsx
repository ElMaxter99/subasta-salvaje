'use client';

import { useState } from 'react';
import { Ban, Gavel, Lock, Megaphone, RotateCcw, SkipForward, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { newIdempotencyKey } from '@/lib/client/api';
import { formatEuros } from '@/lib/domain/money';
import type { Auction } from '@/lib/domain/types';
import { BidPad } from './bid-pad';
import { Card, Dot, Notice, Pill, Thumb, fmtTime } from './bits';
import { playerById, type HostCtx } from './host-context';

interface AwardDraft {
  key: string;
  auctionId: string;
  winnerId: string;
  price: number;
}

export function AuctionPanel({ ctx }: { ctx: HostCtx }) {
  const { snapshot } = ctx;
  const { game, auction } = snapshot;
  const [award, setAward] = useState<AwardDraft | null>(null);
  const [undoOpen, setUndoOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  if (game.status === 'finished') {
    return <Notice tone="ok">La partida ha finalizado. El panel está en modo solo lectura: consulta Resumen y Resultados.</Notice>;
  }
  const live = auction && (auction.status === 'open' || auction.status === 'closed') ? auction : null;

  return (
    <div className="space-y-4">
      {game.status === 'lobby' ? <Notice tone="warn">La partida aún no ha empezado. Ve a «Resumen» y pulsa «Empezar partida» para poder subastar.</Notice> : null}
      {game.status === 'paused' ? <Notice tone="warn">Partida en pausa: no se puede pujar ni anunciar. Reanúdala desde «Resumen».</Notice> : null}

      {live ? (
        <LiveAuction ctx={ctx} auction={live} onAward={() => setAward({ key: newIdempotencyKey(), auctionId: live.id, winnerId: live.current_bidder_id!, price: live.current_bid_cents })} onUndo={() => setUndoOpen(true)} onCancel={() => setCancelOpen(true)} />
      ) : (
        <NextItem ctx={ctx} />
      )}

      <AwardDialog ctx={ctx} draft={award} onClose={() => setAward(null)} />

      <ConfirmDialog
        open={undoOpen}
        title="Deshacer la última puja"
        confirmLabel="Sí, deshacer"
        variant="danger"
        loading={ctx.busy === 'undo'}
        onCancel={() => setUndoOpen(false)}
        onConfirm={async () => {
          const last = live?.bids[0];
          if (live && last) await ctx.run('undo', { type: 'auction.undo_bid', auction_id: live.id, bid_id: last.id }, 'Puja deshecha');
          setUndoOpen(false);
        }}
      >
        {live?.bids[0] ? (
          <p>
            Se anulará la puja de <b>{playerById(snapshot, live.bids[0].player_id)?.name}</b> por <b>{formatEuros(live.bids[0].amount_cents)}</b>. La puja volverá a la anterior.
          </p>
        ) : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={cancelOpen}
        title="Cancelar la subasta"
        confirmLabel="Sí, cancelar subasta"
        variant="danger"
        loading={ctx.busy === 'cancel'}
        onCancel={() => setCancelOpen(false)}
        onConfirm={async () => {
          if (live) await ctx.run('cancel', { type: 'auction.cancel', auction_id: live.id }, 'Subasta cancelada');
          setCancelOpen(false);
        }}
      >
        <p>
          El elemento <b>{live?.item.name}</b> vuelve al catálogo y las pujas se descartan. <b>No se descuenta dinero a nadie.</b>
        </p>
      </ConfirmDialog>
    </div>
  );
}

function LiveAuction({ ctx, auction, onAward, onUndo, onCancel }: { ctx: HostCtx; auction: Auction; onAward: () => void; onUndo: () => void; onCancel: () => void }) {
  const { snapshot, busy, run } = ctx;
  const leader = playerById(snapshot, auction.current_bidder_id);
  const open = auction.status === 'open';
  const hasBids = !!leader;
  const playing = snapshot.game.status === 'active';

  return (
    <>
      <Card className="border-gold/30">
        <div className="flex items-center gap-4">
          {auction.item.image_url ? <Thumb url={auction.item.image_url} alt={auction.item.name} className="size-20" /> : <span className="flex size-20 shrink-0 items-center justify-center rounded-2xl bg-night-950 text-5xl" aria-hidden>{auction.item.emoji ?? '🎁'}</span>}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-sm text-white/70">
              <Pill tone="violet">Ronda {auction.round_number}</Pill>
              <Pill tone={open ? 'teal' : 'gold'}>{open ? 'Pujas abiertas' : 'Pujas cerradas'}</Pill>
            </div>
            <h2 className="mt-1 font-display text-2xl leading-tight sm:text-3xl">
              {auction.item.name}
            </h2>
            {auction.item.description ? <p className="text-sm text-white/70">{auction.item.description}</p> : null}
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 rounded-2xl bg-night-950 p-4 text-center">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-white/60">Puja actual</p>
            <p className="font-display text-4xl text-gold sm:text-5xl" aria-live="polite">
              {hasBids ? formatEuros(auction.current_bid_cents) : '—'}
            </p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-white/60">Líder</p>
            <p className="flex items-center justify-center gap-2 font-display text-2xl sm:text-3xl" style={leader ? { color: leader.color } : undefined}>
              {leader ? <Dot color={leader.color} className="size-5" /> : null}
              {leader ? leader.name : 'Sin pujas'}
            </p>
          </div>
        </div>
      </Card>

      {open && playing ? (
        <Card title="Registrar puja" icon={<Gavel className="size-5 text-gold" aria-hidden />}>
          {snapshot.game.play_mode === 'mobile' ? <p className="mb-3 rounded-xl bg-violet/10 px-3 py-2 text-sm font-semibold text-violet-soft">📱 Los jugadores pujan desde su móvil; también puedes registrar pujas a mano.</p> : null}
          <BidPad ctx={ctx} auction={auction} />
        </Card>
      ) : null}

      <Card title="Pujas" action={open && auction.bids.length > 0 ? (
        <Button size="sm" variant="secondary" disabled={busy !== null} onClick={onUndo}>
          <Undo2 className="size-4" aria-hidden /> Deshacer última puja
        </Button>
      ) : undefined}>
        {auction.bids.length === 0 ? (
          <p className="text-sm text-white/60">Todavía nadie ha pujado.</p>
        ) : (
          <ol className="space-y-1.5">
            {auction.bids.map((b, i) => {
              const p = playerById(snapshot, b.player_id);
              return (
                <li key={b.id} className={`flex items-center justify-between rounded-xl px-3 py-2 ${i === 0 ? 'bg-gold/15' : 'bg-night-900'}`}>
                  <span className="flex items-center gap-2 font-semibold">
                    <Dot color={p?.color ?? '#999'} />
                    {p?.name ?? 'Jugador'}
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="text-xs text-white/50">{fmtTime(b.created_at)}</span>
                    <b className={i === 0 ? 'text-gold' : ''}>{formatEuros(b.amount_cents)}</b>
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Button variant="primary" size="xl" className="sm:col-span-2" disabled={!hasBids || !playing || busy !== null} onClick={onAward}>
          <Gavel className="size-6" aria-hidden /> Adjudicar{leader ? ` a ${leader.name}` : ''}
        </Button>
        {open ? (
          <Button variant="secondary" size="lg" disabled={busy !== null || !playing} loading={busy === 'close'} onClick={() => run('close', { type: 'auction.close', auction_id: auction.id }, 'Puja cerrada')}>
            <Lock className="size-5" aria-hidden /> Cerrar puja
          </Button>
        ) : (
          <Button variant="secondary" size="lg" disabled={busy !== null || !playing} loading={busy === 'reopen'} onClick={() => run('reopen', { type: 'auction.reopen', auction_id: auction.id }, 'Puja reabierta')}>
            <RotateCcw className="size-5" aria-hidden /> Reabrir
          </Button>
        )}
        <Button variant="danger" size="lg" disabled={busy !== null} onClick={onCancel}>
          <Ban className="size-5" aria-hidden /> Cancelar subasta
        </Button>
      </div>
    </>
  );
}

function AwardDialog({ ctx, draft, onClose }: { ctx: HostCtx; draft: AwardDraft | null; onClose: () => void }) {
  const { snapshot } = ctx;
  const winner = playerById(snapshot, draft?.winnerId);
  const item = snapshot.auction?.item;
  const after = winner && draft ? winner.balance_cents - draft.price : 0;
  const live = snapshot.auction;
  const changed = !!draft && (!live || live.id !== draft.auctionId || live.current_bidder_id !== draft.winnerId || live.current_bid_cents !== draft.price);
  return (
    <ConfirmDialog
      open={!!draft}
      title="¿Adjudicar y cobrar?"
      confirmLabel={draft ? `Cobrar ${formatEuros(draft.price)} y adjudicar` : 'Adjudicar'}
      variant="success"
      loading={ctx.busy === 'award'}
      onCancel={onClose}
      onConfirm={async () => {
        if (!draft || changed) return;
        // La clave se reutiliza mientras el diálogo siga abierto: un reintento tras un corte de red nunca cobra dos veces.
        const res = await ctx.run('award', { type: 'auction.award', auction_id: draft.auctionId, expected_winner_id: draft.winnerId, expected_price_cents: draft.price, idempotency_key: draft.key }, 'Adjudicado');
        if (res) {
          onClose();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      }}
    >
      {draft && winner ? (
        <div className="space-y-3">
          <p>
            <b>{item?.emoji} {item?.name}</b> para:
          </p>
          <p className="flex items-center gap-2 font-display text-3xl" style={{ color: winner.color }}>
            <Dot color={winner.color} className="size-6" /> {winner.name}
          </p>
          <dl className="grid grid-cols-2 gap-2 rounded-2xl bg-night-950 p-3 text-sm">
            <dt className="text-white/60">Importe</dt>
            <dd className="text-right font-bold text-gold">{formatEuros(draft.price)}</dd>
            <dt className="text-white/60">Saldo actual</dt>
            <dd className="text-right font-bold">{formatEuros(winner.balance_cents)}</dd>
            <dt className="text-white/60">Saldo resultante</dt>
            <dd className={`text-right font-bold ${after < 0 ? 'text-rose' : 'text-teal'}`}>{formatEuros(after)}</dd>
          </dl>
          {changed ? <p className="rounded-xl bg-rose/20 p-2 text-sm font-bold text-rose">La puja ha cambiado mientras confirmabas. Cancela y revisa los datos antes de adjudicar.</p> : <p className="text-sm text-white/60">El cobro se hace una sola vez, aunque pulses dos veces.</p>}
        </div>
      ) : null}
    </ConfirmDialog>
  );
}

function NextItem({ ctx }: { ctx: HostCtx }) {
  const { snapshot, busy, run } = ctx;
  const { auction, game } = snapshot;
  const available = snapshot.items.filter((i) => i.status === 'available').sort((a, b) => a.sort_order - b.sort_order);
  const playing = game.status === 'active';
  const lastAwarded = auction?.status === 'awarded' ? auction : null;
  const winner = playerById(snapshot, lastAwarded?.winner_id);

  return (
    <>
      {lastAwarded ? (
        <Card className="border-teal/40">
          <p className="text-sm font-bold uppercase tracking-wide text-teal">Adjudicado</p>
          <p className="font-display text-2xl">
            {lastAwarded.item.emoji} {lastAwarded.item.name}
          </p>
          <p className="text-white/80">
            Para <b style={{ color: winner?.color }}>{winner?.name}</b> por <b className="text-gold">{formatEuros(lastAwarded.final_price_cents ?? 0)}</b>. Su imagen se está actualizando (mira «Imágenes»).
          </p>
          <Button className="mt-3 w-full" variant="secondary" size="lg" disabled={busy !== null} loading={busy === 'clear'} onClick={() => run('clear', { type: 'auction.clear' }, 'Pantalla despejada')}>
            <SkipForward className="size-5" aria-hidden /> Siguiente elemento
          </Button>
        </Card>
      ) : auction?.status === 'cancelled' ? (
        <Notice tone="info">La última subasta se canceló sin cobrar nada. Anuncia otro elemento (o el mismo).</Notice>
      ) : null}

      <Card title={`Elementos disponibles (${available.length})`} icon={<Megaphone className="size-5 text-gold" aria-hidden />}>
        {available.length === 0 ? (
          <p className="text-white/70">No quedan elementos disponibles. Añade más en «Catálogo» o finaliza la partida desde «Ajustes».</p>
        ) : (
          <ul className="space-y-2">
            {available.map((it, i) => (
              <li key={it.id} className={`flex flex-wrap items-center gap-3 rounded-2xl p-3 ${i === 0 ? 'border border-gold/50 bg-gold/10' : 'bg-night-900'}`}>
                <span className="text-3xl" aria-hidden>
                  {it.emoji ?? '🎁'}
                </span>
                <div className="min-w-0 flex-1 basis-40">
                  <p className="font-bold">{it.name}</p>
                  {i === 0 ? <Pill tone="gold">Siguiente sugerido</Pill> : <p className="truncate text-xs text-white/60">{it.description}</p>}
                </div>
                <Button variant={i === 0 ? 'primary' : 'secondary'} size={i === 0 ? 'lg' : 'md'} className="w-full sm:w-auto" disabled={!playing || busy !== null} loading={busy === `announce-${it.id}`} onClick={() => run(`announce-${it.id}`, { type: 'auction.announce', item_id: it.id }, `«${it.name}» anunciado en la TV`)}>
                  Anunciar elemento
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
