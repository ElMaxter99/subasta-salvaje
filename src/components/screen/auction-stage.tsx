'use client';

import { Gavel, Hourglass } from 'lucide-react';
import type { Auction, GameInfo, Player, PublicSnapshot } from '@/lib/domain/types';
import { useAutoAwardCountdown, useCountdownTo } from '@/lib/client/auto-award';
import { LobbyInvite } from './join-invite';
import { Mascot } from '@/components/mascot/mascot';
import './screen.css';
import { allPlayersBroke } from '@/lib/domain/broke';
import { Ohros } from '@/components/ui/ohros';
import { AutoRunClock } from './auto-run-clock';

function ItemVisual({ item }: { item: Auction['item'] }) {
  return (
    <div className="relative aspect-square h-full max-h-full max-w-full overflow-hidden rounded-3xl border-2 border-gold/40 bg-night-800 shadow-[0_0_4rem_rgb(251_191_36/0.18)]">
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

/** Centro de la subasta en curso (abierta o cerrada): título y puja arriba, la imagen en medio y quién gana abajo. Los jugadores la rodean. */
export function AuctionCenter({ snap, auction, players, compact }: { snap: PublicSnapshot; auction: Auction; players: Player[]; compact: boolean }) {
  const countdown = useAutoAwardCountdown(snap);
  const closed = auction.status === 'closed';
  const price = auction.current_bid_cents;
  const leader = players.find((p) => p.id === auction.current_bidder_id);
  const recent = auction.bids.slice(0, 3);
  const blind = Boolean(auction.hidden);
  const sealed = auction.wild_event === 'sealed';
  const flash = auction.wild_event === 'flash';
  const sealedBidders = (auction.sealed_bidders ?? []).map((id) => players.find((p) => p.id === id)).filter((p): p is Player => !!p);
  const nameOf = (id: string) => players.find((p) => p.id === id);

  return (
    <div className="flex h-full min-h-0 flex-col items-center gap-[0.5rem] text-center">
      <div className="shrink-0">
        <h2 className={`font-display leading-[1.05] text-white ${compact ? 'text-[2.6rem]' : 'text-[3.4rem]'}`}>
          {auction.item.emoji ? <span aria-hidden className="mr-3">{auction.item.emoji}</span> : null}
          {auction.item.name}
        </h2>
        <div className="flex flex-wrap items-center justify-center gap-2 empty:hidden">
          {auction.wild_event ? (
            <p className="inline-flex items-center gap-2 rounded-2xl bg-violet px-4 py-1 font-display text-[1.5rem] text-white" data-testid="wild-badge">
              {auction.wild_event === 'blind'
                ? '🙈 ¡Puja a ciegas! Nadie ve el importe'
                : sealed
                  ? '✉️ ¡Sobre cerrado! Una sola puja por jugador'
                  : flash
                    ? `⚡ ¡Relámpago! Se adjudica ${auction.flash_seconds ?? 8} s después de la última puja`
                    : '🎲 ¡Doble o mitad! Se sortea al adjudicar'}
            </p>
          ) : null}
          {auction.random ? (
            <p className="inline-flex items-center gap-2 rounded-2xl bg-night-700 px-4 py-1 font-display text-[1.5rem] text-gold-soft" data-testid="random-badge">🎲 Elegido al azar</p>
          ) : null}
        </div>
        {auction.item.description ? <p className="mx-auto mt-1 line-clamp-1 max-w-[48rem] text-[1.4rem] font-medium text-white/70">{auction.item.description}</p> : null}
      </div>

      <div aria-live="polite" className="shrink-0">
        <p className="text-[1.2rem] font-bold uppercase tracking-[0.25em] text-gold-soft">
          {closed ? 'Puja cerrada' : sealed && blind ? 'Sobre cerrado' : blind ? 'Puja a ciegas' : 'Puja actual'}
        </p>
        <p
          key={price}
          className={`ss-price-pop font-display leading-none tabular-nums text-gold drop-shadow-[0_0_2rem_rgb(251_191_36/0.45)] ${compact ? 'text-[6.5rem]' : 'text-[8.5rem]'}`}
        >
          {blind ? '¿¿ ??' : <Ohros cents={price} />}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2 empty:hidden">
          {closed ? (
            <p className="inline-flex items-center gap-2 rounded-2xl bg-rose px-4 py-1 font-display text-[1.6rem] text-night-950">
              <Gavel className="size-6" aria-hidden /> ¡Puja cerrada! Última palabra…
            </p>
          ) : null}
          <div className="empty:hidden"><AutoRunClock snapshot={snap} /></div>
          {countdown !== null && !closed ? (
            <p
              className={`inline-flex items-center gap-2 rounded-2xl px-4 py-1 font-display text-[1.6rem] tabular-nums ${countdown <= 5 ? 'bg-rose text-night-950' : 'bg-night-700 text-gold-soft'}`}
              data-testid="auto-award-countdown"
            >
              <Hourglass className="size-6" aria-hidden /> {countdown > 0 ? `${flash ? '⚡ ' : ''}¡A la una… adjudicado en ${countdown} s!` : '¡Adjudicando…!'}
            </p>
          ) : null}
        </div>
      </div>

      <div className="relative min-h-0 w-full flex-1">
        <div className="absolute inset-0 flex items-center justify-center">
          <ItemVisual item={auction.item} />
        </div>
      </div>

      <div className="shrink-0 space-y-1">
        <div className="min-h-[2.4rem]">
          {sealed && blind ? (
            <p className="text-[1.5rem] font-bold text-violet-soft" data-testid="sealed-bidders">
              ✉️ {sealedBidders.length === 0 ? 'Nadie ha pujado todavía' : `Ya han pujado: ${sealedBidders.map((p) => p.name).join(', ')}`} · ¡se abre el sobre al adjudicar!
            </p>
          ) : blind ? (
            <p className="text-[1.5rem] font-bold text-violet-soft">{auction.bids_count ?? 0} {auction.bids_count === 1 ? 'puja hecha' : 'pujas hechas'} · ¡el líder se revelará al adjudicar!</p>
          ) : leader ? (
            <p className="flex items-center justify-center gap-3 text-[1.6rem] font-bold">
              <span className="size-5 shrink-0 rounded-full ring-4 ring-white/20" style={{ background: leader.color }} aria-hidden />
              <span className="text-white/70">Va ganando</span>
              <span className="truncate font-display text-[2rem]" style={{ color: leader.color }}>{leader.name}</span>
            </p>
          ) : (
            <p className="text-[1.4rem] font-semibold text-white/60">{auction.bids.length === 0 && !blind ? 'Sin pujas todavía: ¡quien puje primero marca el ritmo!' : ''}</p>
          )}
        </div>
        {(auction.yielded?.length ?? 0) > 0 ? (
          <p className="text-[1.3rem] font-semibold text-white/70" data-testid="tv-yielded">
            🏳️ Han cedido: {(auction.yielded ?? []).map((id) => players.find((p) => p.id === id)?.name ?? '?').join(', ')}
          </p>
        ) : null}
        {recent.length > 0 ? (
          <ol className="flex flex-wrap items-center justify-center gap-2" aria-label="Últimas pujas" aria-live="polite">
            {recent.map((b, i) => {
              const p = nameOf(b.player_id);
              return (
                <li key={b.id} className={`ss-bid-in flex items-center gap-2 rounded-xl border-l-[0.4rem] bg-night-800/90 px-3 py-1 ${i === 0 ? 'ring-2 ring-gold/60' : 'opacity-80'}`} style={{ borderColor: p?.color ?? '#888' }}>
                  <span className="truncate text-[1.2rem] font-bold" style={{ color: p?.color }}>{p?.name ?? 'Jugador'}</span>
                  <span className="font-display text-[1.4rem] tabular-nums text-white"><Ohros cents={b.amount_cents} /></span>
                </li>
              );
            })}
          </ol>
        ) : null}
      </div>
    </div>
  );
}

/** Sala de espera (la única vista «sin subasta» que conserva el diseño clásico: invitación y jugadores debajo). */
function IdleStage({ snap }: { snap: PublicSnapshot }) {
  const { game, players } = snap;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-[1.5rem] text-center" aria-live="polite">
      {game.play_mode === 'mobile' ? (
        <LobbyInvite roomCode={game.room_code} connected={players.filter((p) => p.claimed).length} total={players.length} />
      ) : <LobbyMessage game={game} count={players.length} />}
    </div>
  );
}

/**
 * Franja superior de la vista «entre subastas» (los jugadores pasan a primer plano): último adjudicado, cuenta atrás hasta la siguiente
 * subasta y los avisos de fin (última ronda / todos sin saldo).
 */
export function SpotlightBanner({ snap }: { snap: PublicSnapshot }) {
  const { game, last_award: award, players, auction } = snap;
  const winner = award ? players.find((p) => p.id === award.player_id) : null;
  const nextIn = useCountdownTo(game.status === 'active' ? game.auto_run_next_at : null, snap.server_time);
  const broke = game.status === 'active' && allPlayersBroke(snap);
  const lastRoundDone = game.status === 'active' && game.total_rounds > 0 && game.rounds_completed >= game.total_rounds;
  const note = auction?.status === 'awarded' ? auction.wild_note : null;
  return (
    <div className="flex flex-col items-center gap-[0.6rem] text-center" aria-live="polite" data-testid="spotlight-banner">
      <p className="flex items-center gap-4 font-display text-[2.8rem] leading-tight text-white">
        <Hourglass className="size-[2.8rem] shrink-0 text-gold" aria-hidden />
        {lastRoundDone ? '¡Esa era la última ronda!' : 'Preparando la siguiente subasta…'}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3 empty:hidden">
        {broke && !lastRoundDone ? (
          <p className="rounded-2xl bg-rose px-6 py-2 font-display text-[1.8rem] text-night-950" data-testid="tv-all-broke">💸 ¡Todos os habéis quedado sin saldo! La partida termina</p>
        ) : null}
        {lastRoundDone ? (
          <p className="rounded-2xl bg-violet px-6 py-2 font-display text-[1.8rem] text-white" data-testid="tv-last-round">Enseguida, los resultados finales</p>
        ) : nextIn !== null ? (
          <p className="inline-flex items-center gap-3 rounded-2xl bg-night-700 px-6 py-2 font-display text-[1.9rem] tabular-nums text-gold-soft" data-testid="tv-next-auction">
            <Hourglass className="size-[1.9rem]" aria-hidden /> {nextIn > 0 ? `Siguiente subasta en ${nextIn} s` : '¡Ya viene el siguiente elemento!'}
          </p>
        ) : null}
        {award ? (
          <p className="rounded-2xl bg-night-800/90 px-6 py-2 text-[1.6rem] font-semibold text-white/85">
            Último adjudicado: <span className="mr-1">{award.emoji ?? '🎁'}</span>
            <strong className="text-white">{award.item_name}</strong> para{' '}
            <strong style={{ color: winner?.color }}>{winner?.name ?? 'un jugador'}</strong> por{' '}
            <strong className="font-display tabular-nums text-gold"><Ohros cents={award.price_cents} /></strong>
            {note ? <span data-testid="wild-result"> · 🎲 {note.outcome === 'half' ? '¡mitad de precio!' : '¡pagó el doble!'}</span> : null}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function LobbyMessage({ game, count }: { game: GameInfo; count: number }) {
  return (
    <>
      <Mascot variant="expr-feliz" size="md" tile motion="bob" />
      <p className="font-display text-[4.8rem] leading-tight text-white">Sala de espera</p>
      <p className="text-[2rem] font-semibold text-white/80">
        {count === 0 ? 'Esperando a los jugadores…' : `${count} ${count === 1 ? 'jugador listo' : 'jugadores listos'} para la subasta`}
      </p>
      <p className="mt-2 text-[1.4rem] font-bold uppercase tracking-[0.3em] text-white/55">Código de sala</p>
      <p className="font-display text-[6.5rem] leading-none tracking-[0.25em] text-gold">{game.room_code}</p>
    </>
  );
}

/** Solo la sala de espera usa este escenario; la subasta en curso y el «entre subastas» tienen su propio diseño en `screen-view`. */
export function AuctionStage({ snap }: { snap: PublicSnapshot }) {
  return <IdleStage snap={snap} />;
}
