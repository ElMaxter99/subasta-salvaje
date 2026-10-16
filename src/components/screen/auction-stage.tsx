'use client';

import { Gavel, Hourglass, Users } from 'lucide-react';
import type { Auction, GameInfo, Player, PublicSnapshot } from '@/lib/domain/types';
import { useAutoAwardCountdown } from '@/lib/client/auto-award';
import { formatEuros } from '@/lib/domain/money';
import { LobbyInvite } from './join-invite';
import './screen.css';

function ItemVisual({ item }: { item: Auction['item'] }) {
  return (
    <div className="relative aspect-square h-full max-h-full overflow-hidden rounded-3xl border-2 border-gold/40 bg-night-800 shadow-[0_0_4rem_rgb(251_191_36/0.18)]">
      {item.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.image_url} alt={item.name} className="size-full object-cover" />
      ) : (
        <div className="flex size-full items-center justify-center bg-[radial-gradient(circle_at_50%_40%,rgb(139_92_246/0.35),transparent_70%)]">
          <span className="ss-bounce text-[11rem] leading-none" role="img" aria-label={item.name}>
            {item.emoji ?? '🎁'}
          </span>
        </div>
      )}
    </div>
  );
}

function ActiveAuction({ snap, auction, players, compact }: { snap: PublicSnapshot; auction: Auction; players: Player[]; compact: boolean }) {
  const countdown = useAutoAwardCountdown(snap);
  const closed = auction.status === 'closed';
  const awarded = auction.status === 'awarded';
  const price = awarded ? (auction.final_price_cents ?? auction.current_bid_cents) : auction.current_bid_cents;
  const leaderId = awarded ? auction.winner_id : auction.current_bidder_id;
  const leader = players.find((p) => p.id === leaderId);
  const recent = auction.bids.slice(0, 5);
  const nameOf = (id: string) => players.find((p) => p.id === id);

  return (
    <div className="flex h-full min-h-0 items-stretch gap-[2.5rem]">
      <ItemVisual item={auction.item} />

      <div className="flex min-w-0 flex-1 flex-col justify-between py-1">
        <div>
          <h2 className={`font-display leading-[1.05] text-white ${compact ? 'text-[3.6rem]' : 'text-[4.4rem]'}`}>
            {auction.item.emoji ? <span aria-hidden className="mr-3">{auction.item.emoji}</span> : null}
            {auction.item.name}
          </h2>
          <p className={`mt-2 line-clamp-2 max-w-[56rem] font-medium text-white/75 ${compact ? 'text-[1.6rem]' : 'text-[2rem]'}`}>{auction.item.description}</p>
        </div>

        <div aria-live="polite">
          <p className="text-[1.3rem] font-bold uppercase tracking-[0.25em] text-gold-soft">
            {awarded ? 'Precio final' : closed ? 'Puja cerrada' : 'Puja actual'}
          </p>
          <p
            key={price}
            className={`ss-price-pop font-display leading-none tabular-nums text-gold drop-shadow-[0_0_2rem_rgb(251_191_36/0.45)] ${compact ? 'text-[10rem]' : 'text-[13rem]'}`}
          >
            {formatEuros(price)}
          </p>
          {closed ? (
            <p className="mt-2 inline-flex items-center gap-3 rounded-2xl bg-rose px-5 py-2 font-display text-[2rem] text-night-950">
              <Gavel className="size-8" aria-hidden /> ¡Puja cerrada! Última palabra…
            </p>
          ) : null}
          {countdown !== null && !closed && !awarded ? (
            <p
              className={`mt-2 inline-flex items-center gap-3 rounded-2xl px-5 py-2 font-display text-[2rem] tabular-nums ${countdown <= 5 ? 'bg-rose text-night-950' : 'bg-night-700 text-gold-soft'}`}
              data-testid="auto-award-countdown"
            >
              <Hourglass className="size-8" aria-hidden /> {countdown > 0 ? `¡A la una… adjudicado en ${countdown} s!` : '¡Adjudicando…!'}
            </p>
          ) : null}
          {awarded ? (
            <p className="mt-2 inline-flex items-center gap-3 rounded-2xl bg-teal px-5 py-2 font-display text-[2rem] text-night-950">
              <Gavel className="size-8" aria-hidden /> ¡Adjudicado!
            </p>
          ) : null}
        </div>

        <div className="min-h-[3.5rem]">
          {leader ? (
            <p className="flex items-center gap-3 text-[1.9rem] font-bold">
              <span className="size-6 shrink-0 rounded-full ring-4 ring-white/20" style={{ background: leader.color }} aria-hidden />
              <span className="text-white/70">{awarded ? 'Se lo lleva' : 'Va ganando'}</span>
              <span className="truncate font-display text-[2.4rem]" style={{ color: leader.color }}>{leader.name}</span>
            </p>
          ) : (
            <p className="text-[1.7rem] font-semibold text-white/60">
              {auction.bids.length === 0 ? 'Sin pujas todavía: ¡quien puje primero marca el ritmo!' : ''}
            </p>
          )}
        </div>
      </div>

      <aside className={`flex shrink-0 flex-col ${compact ? 'w-[22rem]' : 'w-[25rem]'}`} aria-label="Últimas pujas" aria-live="polite">
        <h3 className="mb-2 text-[1.2rem] font-bold uppercase tracking-[0.25em] text-white/60">Últimas pujas</h3>
        <ol className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
          {recent.map((b, i) => {
            const p = nameOf(b.player_id);
            return (
              <li
                key={b.id}
                className={`ss-bid-in flex items-center justify-between gap-3 rounded-xl border-l-[0.5rem] bg-night-800/90 px-4 py-2 ${i === 0 ? 'ring-2 ring-gold/60' : 'opacity-85'}`}
                style={{ borderColor: p?.color ?? '#888' }}
              >
                <span className="truncate text-[1.5rem] font-bold" style={{ color: p?.color }}>{p?.name ?? 'Jugador'}</span>
                <span className="shrink-0 font-display text-[1.7rem] tabular-nums text-white">{formatEuros(b.amount_cents)}</span>
              </li>
            );
          })}
          {recent.length === 0 ? <li className="rounded-xl border border-dashed border-white/15 px-4 py-3 text-[1.3rem] text-white/50">Aún no hay pujas.</li> : null}
        </ol>
      </aside>
    </div>
  );
}

function IdleStage({ snap }: { snap: PublicSnapshot }) {
  const { game, last_award: award, players } = snap;
  const lobby = game.status === 'lobby';
  const winner = award ? players.find((p) => p.id === award.player_id) : null;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-[1.5rem] text-center" aria-live="polite">
      {lobby && game.play_mode === 'mobile' ? (
        <LobbyInvite roomCode={game.room_code} connected={players.filter((p) => p.claimed).length} total={players.length} />
      ) : lobby ? <LobbyMessage game={game} count={players.length} /> : (
        <>
          <div className="ss-bounce text-[7rem] leading-none" aria-hidden>
            <Hourglass className="mx-auto size-[7rem] text-gold" />
          </div>
          <p className="font-display text-[4.2rem] leading-tight text-white">Preparando la siguiente subasta…</p>
          {award ? (
            <p className="rounded-2xl bg-night-800/90 px-8 py-4 text-[2rem] font-semibold text-white/85">
              Último adjudicado: <span className="mr-1">{award.emoji ?? '🎁'}</span>
              <strong className="text-white">{award.item_name}</strong> para{' '}
              <strong style={{ color: winner?.color }}>{winner?.name ?? 'un jugador'}</strong> por{' '}
              <strong className="font-display tabular-nums text-gold">{formatEuros(award.price_cents)}</strong>
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

function LobbyMessage({ game, count }: { game: GameInfo; count: number }) {
  return (
    <>
      <Users className="size-[5rem] text-teal" aria-hidden />
      <p className="font-display text-[4.8rem] leading-tight text-white">Sala de espera</p>
      <p className="text-[2rem] font-semibold text-white/80">
        {count === 0 ? 'Esperando a los jugadores…' : `${count} ${count === 1 ? 'jugador listo' : 'jugadores listos'} para la subasta`}
      </p>
      <p className="mt-2 text-[1.4rem] font-bold uppercase tracking-[0.3em] text-white/55">Código de sala</p>
      <p className="font-display text-[6.5rem] leading-none tracking-[0.25em] text-gold">{game.room_code}</p>
    </>
  );
}

export function AuctionStage({ snap, compact }: { snap: PublicSnapshot; compact: boolean }) {
  const a = snap.auction;
  const live = a && a.status !== 'cancelled';
  return live ? <ActiveAuction snap={snap} auction={a} players={snap.players} compact={compact} /> : <IdleStage snap={snap} />;
}
