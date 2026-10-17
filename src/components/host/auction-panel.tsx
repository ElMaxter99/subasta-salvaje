'use client';

import { useState } from 'react';
import { Ban, Gavel, Landmark, Lock, Megaphone, RotateCcw, SkipForward, Undo2 } from 'lucide-react';
import { AutoAwardCard } from './auto-award-card';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { newIdempotencyKey } from '@/lib/client/api';
import { formatOhros } from '@/lib/domain/money';
import type { Auction, WildEvent } from '@/lib/domain/types';
import { BidPad } from './bid-pad';
import { WildCard } from './wild-card';
import { Card, Dot, Notice, Pill, Thumb, fmtTime } from './bits';
import { playerById, type HostCtx } from './host-context';
import { Ohros } from '@/components/ui/ohros';

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

      {game.status !== 'lobby' ? <AutoAwardCard ctx={ctx} /> : null}
      <WildCard ctx={ctx} />

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
            Se anulará la puja de <b>{playerById(snapshot, live.bids[0].player_id)?.name}</b> por <b><Ohros cents={live.bids[0].amount_cents} /></b>. La puja volverá a la anterior.
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
        {live && live.bids.length === 0 ? (
          <p>
            Nadie ha pujado por <b>{live.item.name}</b>: se da por <b>perdido</b> (no lo quiere nadie) y <b>no volverá a salir</b> en otra ronda. La TV lo anunciará. <b>No se descuenta dinero a nadie.</b>
          </p>
        ) : (
          <p>
            El elemento <b>{live?.item.name}</b> vuelve al catálogo y las pujas se descartan. <b>No se descuenta dinero a nadie.</b>
          </p>
        )}
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
              <WildPill event={auction.wild_event} />
            </div>
            {auction.wild_event ? <p className="mt-1 text-xs font-semibold text-violet-soft">{WILD_HELP[auction.wild_event]}</p> : null}
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
              {hasBids ? <Ohros cents={auction.current_bid_cents} /> : '—'}
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
                    <b className={i === 0 ? 'text-gold' : ''}><Ohros cents={b.amount_cents} /></b>
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
      confirmLabel={draft ? `Cobrar ${formatOhros(draft.price)} y adjudicar` : 'Adjudicar'}
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
            <dd className="text-right font-bold text-gold"><Ohros cents={draft.price} /></dd>
            <dt className="text-white/60">Saldo actual</dt>
            <dd className="text-right font-bold"><Ohros cents={winner.balance_cents} /></dd>
            <dt className="text-white/60">Saldo resultante</dt>
            <dd className={`text-right font-bold ${after < 0 ? 'text-rose' : 'text-teal'}`}><Ohros cents={after} /></dd>
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
  const lostCount = snapshot.items.filter((i) => i.status === 'lost').length;
  const playing = game.status === 'active';
  const lastAwarded = auction?.status === 'awarded' ? auction : null;
  const winner = playerById(snapshot, lastAwarded?.winner_id);
  const [wild, setWild] = useState<'auto' | 'none' | WildEvent>('auto');

  return (
    <>
      {lastAwarded ? (
        <Card className="border-teal/40">
          <p className="text-sm font-bold uppercase tracking-wide text-teal">Adjudicado</p>
          <p className="font-display text-2xl">
            {lastAwarded.item.emoji} {lastAwarded.item.name}
          </p>
          <p className="text-white/80">
            Para <b style={{ color: winner?.color }}>{winner?.name}</b> por <b className="text-gold"><Ohros cents={lastAwarded.wild_note?.charged_cents ?? lastAwarded.final_price_cents ?? 0} /></b>. Su imagen se está actualizando (mira «Imágenes»).
          </p>
          {lastAwarded.wild_note ? (
            <p className="mt-1 text-sm font-semibold text-violet-soft">
              🎲 Doble o mitad: {lastAwarded.wild_note.outcome === 'half' ? '¡le ha tocado la mitad!' : '¡le ha tocado pagar el doble!'} (puja de <Ohros cents={lastAwarded.wild_note.bid_cents} />)
            </p>
          ) : null}
          <Button className="mt-3 w-full" variant="secondary" size="lg" disabled={busy !== null} loading={busy === 'clear'} onClick={() => run('clear', { type: 'auction.clear' }, 'Pantalla despejada')}>
            <SkipForward className="size-5" aria-hidden /> Siguiente elemento
          </Button>
        </Card>
      ) : auction?.status === 'cancelled' ? (
        <Notice tone="info">La última subasta se canceló sin cobrar nada. Anuncia otro elemento (o el mismo).</Notice>
      ) : null}

      {game.status === 'active' && game.total_rounds > 0 && game.rounds_completed >= game.total_rounds ? (
        <Card className="border-violet/40">
          <p className="font-display text-xl">🏁 Se han jugado todas las rondas ({game.rounds_completed}/{game.total_rounds})</p>
          <p className="mt-1 text-sm text-white/70">La partida terminará sola en unos segundos (o al anunciar otro elemento). Puedes finalizarla ya o ampliar el máximo de rondas en Ajustes.</p>
          <Button className="mt-3" variant="primary" disabled={busy !== null} loading={busy === 'finish-rounds'} onClick={() => run('finish-rounds', { type: 'game.finish' }, 'Partida finalizada')}>
            Finalizar y ver resultados
          </Button>
        </Card>
      ) : null}
      <LastAwardCard ctx={ctx} />
      <TaxCard ctx={ctx} />

      <Card title={`Elementos disponibles (${available.length})`} icon={<Megaphone className="size-5 text-gold" aria-hidden />}>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            size="lg"
            disabled={!playing || busy !== null || available.length === 0}
            loading={busy === 'announce-random'}
            onClick={() => run('announce-random', { type: 'auction.announce_random', ...(wild === 'auto' ? {} : { wild_event: wild }) }, 'Elemento al azar anunciado en la TV')}
            data-testid="announce-random"
          >
            🎲 Anunciar uno al azar
          </Button>
          <p className="text-xs text-white/60">Elige al azar uno de los elementos disponibles del catálogo y lo anuncia en la TV.{lostCount > 0 ? ` ${lostCount} sin pujas (perdido${lostCount === 1 ? '' : 's'}): no vuelven a salir.` : ''}</p>
        </div>
        <fieldset className="mb-3">
          <legend className="text-xs font-bold uppercase tracking-wide text-white/60">Evento de la próxima subasta</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {([['auto', snapshot.game.wild_chance_pct ? `Automático (${snapshot.game.wild_chance_pct} %)` : 'Normal'], ['none', 'Normal'], ['blind', WILD_LABEL.blind], ['double', WILD_LABEL.double]] as const)
              .filter(([v]) => !(v === 'none' && !snapshot.game.wild_chance_pct))
              .map(([v, label]) => (
                <label key={v} className={`cursor-pointer rounded-xl px-3 py-1.5 text-sm font-bold ${wild === v ? 'bg-gold text-night-950' : 'bg-night-900 text-white/80'}`}>
                  <input type="radio" name="wild" className="sr-only" checked={wild === v} onChange={() => setWild(v)} />
                  {label}
                </label>
              ))}
          </div>
          {wild === 'blind' || wild === 'double' ? <p className="mt-1 text-xs text-white/60">{WILD_HELP[wild]}</p> : null}
        </fieldset>
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
                <Button variant={i === 0 ? 'primary' : 'secondary'} size={i === 0 ? 'lg' : 'md'} className="w-full sm:w-auto" disabled={!playing || busy !== null} loading={busy === `announce-${it.id}`} onClick={() => run(`announce-${it.id}`, { type: 'auction.announce', item_id: it.id, ...(wild === 'auto' ? {} : { wild_event: wild }) }, `«${it.name}» anunciado en la TV`)}>
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

const WILD_LABEL: Record<WildEvent, string> = { blind: '🙈 A ciegas', double: '🎲 Doble o mitad' };
export const WILD_HELP: Record<WildEvent, string> = {
  blind: 'Nadie ve el importe ni quién lidera hasta que se adjudica (tú sí lo ves).',
  double: 'Al adjudicar se sortea: el ganador paga la mitad o el doble de su puja (el doble, hasta donde llegue su saldo).',
};

function WildPill({ event }: { event?: WildEvent | null }) {
  return event ? <Pill tone="violet">{WILD_LABEL[event]}</Pill> : null;
}

/** Última adjudicación de la partida, con la opción de deshacerla (devuelve el dinero y libera el objeto). */
function LastAwardCard({ ctx }: { ctx: HostCtx }) {
  const { snapshot, busy, run } = ctx;
  const last = snapshot.last_award;
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [key, setKey] = useState(newIdempotencyKey);
  if (!last || !['active', 'paused'].includes(snapshot.game.status)) return null;
  const player = playerById(snapshot, last.player_id);
  const running = snapshot.jobs.some((j) => j.purchase_id === last.purchase_id && j.status === 'running');
  return (
    <>
      <Card title="Última adjudicación" icon={<Undo2 className="size-5 text-gold" aria-hidden />}>
        <p className="text-white/80">
          {last.emoji} <b>{last.item_name}</b> para <b style={{ color: player?.color }}>{player?.name}</b> por <b className="text-gold"><Ohros cents={last.price_cents} /></b>.
        </p>
        <Button className="mt-3 w-full sm:w-auto" variant="secondary" disabled={busy !== null || running} onClick={() => { setKey(newIdempotencyKey()); setOpen(true); }}>
          <Undo2 className="size-4" aria-hidden /> Deshacer esta adjudicación
        </Button>
        {running ? <p className="mt-2 text-xs text-white/60">Se está generando su imagen: espera unos segundos para poder deshacerla.</p> : null}
      </Card>
      <ConfirmDialog
        open={open}
        title="Deshacer la adjudicación"
        confirmLabel="Sí, devolver el dinero"
        variant="danger"
        loading={busy === 'undo-award'}
        onCancel={() => setOpen(false)}
        onConfirm={async () => {
          const res = await run('undo-award', { type: 'auction.undo_award', purchase_id: last.purchase_id, reason: reason.trim() || undefined, idempotency_key: key }, 'Adjudicación deshecha');
          if (res) {
            setOpen(false);
            setReason('');
          }
        }}
      >
        <div className="space-y-3">
          <p>
            Se devolverán <b><Ohros cents={last.price_cents} /></b> a <b>{player?.name}</b>, <b>{last.item_name}</b> volverá al catálogo y su imagen volverá a la versión anterior. Solo se puede deshacer la última adjudicación.
          </p>
          <label className="block text-sm font-semibold">
            Motivo (opcional)
            <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} className="mt-1 w-full rounded-xl bg-night-950 px-3 py-2" placeholder="Me equivoqué de jugador…" />
          </label>
        </div>
      </ConfirmDialog>
    </>
  );
}

/** Impuesto al más rico: paga el 20 % y se reparte entre el resto. Solo entre subastas. */
function TaxCard({ ctx }: { ctx: HostCtx }) {
  const { snapshot, busy, run } = ctx;
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(newIdempotencyKey);
  if (snapshot.game.status !== 'active' || snapshot.players.length < 2) return null;
  const max = Math.max(...snapshot.players.map((p) => p.balance_cents));
  const payers = snapshot.players.filter((p) => p.balance_cents === max);
  const pool = payers.reduce((n, p) => n + Math.floor((p.balance_cents * 20) / 100), 0);
  return (
    <>
      <Card title="Evento: impuesto al más rico" icon={<Landmark className="size-5 text-gold" aria-hidden />}>
        <p className="text-sm text-white/70">El jugador con más saldo paga el 20 % y se reparte a partes iguales entre los demás.</p>
        <Button className="mt-3 w-full sm:w-auto" variant="secondary" disabled={busy !== null || pool === 0} onClick={() => { setKey(newIdempotencyKey()); setOpen(true); }}>
          <Landmark className="size-4" aria-hidden /> Cobrar impuesto
        </Button>
      </Card>
      <ConfirmDialog
        open={open}
        title="Cobrar el impuesto"
        confirmLabel="Cobrar y repartir"
        variant="danger"
        loading={busy === 'tax'}
        onCancel={() => setOpen(false)}
        onConfirm={async () => {
          if (await run('tax', { type: 'wild.tax', idempotency_key: key }, 'Impuesto cobrado')) setOpen(false);
        }}
      >
        <p>
          Pagará <b>{payers.map((p) => p.name).join(' y ')}</b> (el 20 % de <Ohros cents={max} />): en total <b><Ohros cents={pool} /></b>, que se reparte entre el resto. La pantalla de la TV lo anunciará.
        </p>
      </ConfirmDialog>
    </>
  );
}
