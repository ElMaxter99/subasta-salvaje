'use client';

import { Eye, Gavel, Hourglass, Pause, Trophy } from 'lucide-react';
import { Mascot } from '@/components/mascot/mascot';
import { FinalResults } from '@/components/screen/results-view';
import { AutoRunClock } from '@/components/screen/auto-run-clock';
import { HouseImage } from '@/components/screen/house-image';
import { GameGone } from '@/components/ui/game-gone';
import { Ohros } from '@/components/ui/ohros';
import { ConnectionBadge, DemoBanner } from '@/components/ui/status';
import { useAutoAwardCountdown, useCountdownTo } from '@/lib/client/auto-award';
import { useLiveGame } from '@/lib/client/use-live-game';
import { joinedPlayers } from '@/lib/domain/players';
import { themeLabel } from '@/lib/domain/themes';
import type { Auction, Player, PublicSnapshot, RuntimeInfo } from '@/lib/domain/types';
import '@/components/screen/screen.css';

/** Pantalla cuando la clave no es válida, se regeneró o el anfitrión desactivó el modo espectador (no revela si la sala existe). */
export function SpectatorDenied() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-night-950 px-4 text-center text-white" data-testid="spectator-denied">
      <Mascot variant="expr-triste" size="md" tile motion="none" />
      <h1 className="font-display text-2xl">Este enlace de espectador no está disponible</h1>
      <p className="max-w-md text-white/75">El enlace no es válido, el anfitrión lo ha cambiado o ha desactivado el modo espectador. Pídele el enlace actual.</p>
    </main>
  );
}

/**
 * Vista de ESPECTADOR (`/game/[code]/watch`): solo lectura, pensada para el móvil. Sin sesión, sin token de jugador y sin controles.
 * Exige la clave secreta del enlace (`?k=`) y solo pinta la instantánea pública (`view: 'watch'`); respeta `auction.hidden` (puja a ciegas / sobre cerrado: el importe y el líder
 * no se muestran ni se calculan aquí). Sin sonido. Las únicas regiones vivas son el resumen de la puja y el aviso de estado.
 */
export function WatchView({ roomCode, initial, runtime, accessKey }: { roomCode: string; initial: PublicSnapshot; runtime: RuntimeInfo; accessKey: string }) {
  const { snapshot, connection, gone, denied } = useLiveGame({ roomCode, initial, runtime, view: 'watch', accessKey });
  if (gone) return <GameGone roomCode={roomCode} />;
  if (denied) return <SpectatorDenied />;
  const { game } = snapshot;

  return (
    <main className="min-h-dvh bg-night-950 text-white" data-testid="watch-view">
      <DemoBanner runtime={runtime} />
      <header className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 pt-4">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-bold uppercase tracking-wide text-violet-soft">
            <Eye className="size-4" aria-hidden /> Espectador · solo lectura
          </p>
          <h1 className="break-words font-display text-2xl leading-tight sm:text-3xl">{game.name}</h1>
          <p className="text-sm text-white/75">{themeLabel(game.theme)}{game.total_rounds > 0 ? ` · ronda ${Math.min(game.rounds_completed + (snapshot.auction?.status === 'awarded' ? 0 : 1), game.total_rounds)} de ${game.total_rounds}` : ''}</p>
        </div>
        <ConnectionBadge state={connection} runtime={runtime} />
      </header>
      {game.status === 'finished' ? <FinalResults snapshot={snapshot} /> : <LiveBody snapshot={snapshot} />}
      <footer className="mx-auto max-w-3xl px-4 pb-8 pt-2 text-center text-sm text-white/65">
        Estás viendo la partida en directo. No puedes pujar ni cambiar nada desde aquí.
      </footer>
    </main>
  );
}

function LiveBody({ snapshot }: { snapshot: PublicSnapshot }) {
  const { game, auction } = snapshot;
  const players = game.status === 'lobby' ? snapshot.players : joinedPlayers(snapshot.players);
  const live = game.status !== 'lobby' && (auction?.status === 'open' || auction?.status === 'closed');
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-4">
      {game.status === 'lobby' ? <Lobby snapshot={snapshot} /> : null}
      {game.status === 'paused' ? (
        <p role="status" className="flex items-center gap-2 rounded-2xl bg-night-700 px-4 py-3 text-lg font-bold text-gold-soft" data-testid="watch-paused">
          <Pause className="size-5 shrink-0" aria-hidden /> Partida en pausa
        </p>
      ) : null}
      {live && auction ? <AuctionCard snapshot={snapshot} auction={auction} players={snapshot.players} /> : null}
      {game.status !== 'lobby' && !live ? <Between snapshot={snapshot} players={snapshot.players} /> : null}
      <PlayersGrid players={players} leaderId={live && !auction?.hidden ? (auction?.current_bidder_id ?? null) : null} lobby={game.status === 'lobby'} />
    </div>
  );
}

function Lobby({ snapshot }: { snapshot: PublicSnapshot }) {
  const n = snapshot.players.length;
  return (
    <section aria-label="Sala de espera" className="flex flex-col items-center gap-2 rounded-3xl border border-white/10 bg-night-800/80 px-4 py-6 text-center" data-testid="watch-lobby">
      <Mascot variant="expr-feliz" size="sm" tile motion="none" />
      <h2 className="font-display text-2xl">Sala de espera</h2>
      <p className="text-white/80" role="status">{n === 0 ? 'Esperando a los jugadores…' : `${n} ${n === 1 ? 'jugador listo' : 'jugadores listos'}. La subasta empieza enseguida.`}</p>
    </section>
  );
}

/** Subasta en curso: elemento, puja actual (o «¿¿ ??» si es a ciegas), quién gana, reloj y últimas pujas. */
function AuctionCard({ snapshot, auction, players }: { snapshot: PublicSnapshot; auction: Auction; players: Player[] }) {
  const countdown = useAutoAwardCountdown(snapshot);
  const closed = auction.status === 'closed';
  const blind = Boolean(auction.hidden);
  const sealed = auction.wild_event === 'sealed';
  const flash = auction.wild_event === 'flash';
  const leader = blind ? undefined : players.find((p) => p.id === auction.current_bidder_id);
  const byId = (id: string) => players.find((p) => p.id === id);
  const sealedBidders = (auction.sealed_bidders ?? []).map(byId).filter((p): p is Player => !!p);
  const bids = blind ? [] : auction.bids.slice(0, 5);
  const label = closed ? 'Puja cerrada' : sealed && blind ? 'Sobre cerrado' : blind ? 'Puja a ciegas' : 'Puja actual';
  const wildText = auction.wild_event === 'blind' ? '🙈 Puja a ciegas: nadie ve el importe' : sealed ? '✉️ Sobre cerrado: una sola puja por jugador' : flash ? '⚡ Relámpago' : auction.wild_event ? '🎲 Doble o mitad: se sortea al adjudicar' : null;

  return (
    <section aria-labelledby="watch-item" className="overflow-hidden rounded-3xl border-2 border-gold/40 bg-night-800" data-testid="watch-auction">
      <div className="relative aspect-[4/3] w-full bg-night-900">
        {auction.item.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={auction.item.image_url} alt={auction.item.name} className="absolute inset-0 size-full object-cover" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(circle_at_50%_40%,rgb(139_92_246/0.35),transparent_70%)]">
            <span className="text-8xl leading-none" role="img" aria-label={auction.item.name}>{auction.item.emoji ?? '🎁'}</span>
          </div>
        )}
      </div>
      <div className="space-y-3 px-4 py-4 text-center">
        <div>
          <h2 id="watch-item" className="break-words font-display text-3xl leading-tight">
            {auction.item.emoji ? <span aria-hidden className="mr-2">{auction.item.emoji}</span> : null}
            {auction.item.name}
          </h2>
          {auction.item.description ? <p className="mt-1 text-base text-white/75">{auction.item.description}</p> : null}
          <div className="mt-2 flex flex-wrap justify-center gap-2 empty:hidden">
            {wildText ? <p className="rounded-xl bg-violet px-3 py-1 text-sm font-bold text-white" data-testid="watch-wild">{wildText}</p> : null}
            {auction.random ? <p className="rounded-xl bg-night-700 px-3 py-1 text-sm font-bold text-gold-soft">🎲 Elegido al azar</p> : null}
          </div>
        </div>

        <div aria-live="polite" aria-atomic="true" data-testid="watch-bid">
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-gold-soft">{label}</p>
          <p className="font-display text-6xl leading-none tabular-nums text-gold" data-testid="watch-price">{blind ? '¿¿ ??' : <Ohros cents={auction.current_bid_cents} />}</p>
          <div className="mt-2 min-h-7 text-lg font-bold">
            {sealed && blind ? (
              <p className="text-violet-soft" data-testid="watch-sealed">
                ✉️ {sealedBidders.length === 0 ? 'Nadie ha pujado todavía' : `Ya han pujado: ${sealedBidders.map((p) => p.name).join(', ')}`}
              </p>
            ) : blind ? (
              <p className="text-violet-soft">{auction.bids_count ?? 0} {auction.bids_count === 1 ? 'puja hecha' : 'pujas hechas'} · el líder se revela al adjudicar</p>
            ) : leader ? (
              <p className="flex items-center justify-center gap-2">
                <span className="size-4 shrink-0 rounded-full ring-2 ring-white/30" style={{ background: leader.color }} aria-hidden />
                <span className="text-white/75">Va ganando</span>
                <span className="min-w-0 truncate font-display text-xl" style={{ color: leader.color }}>{leader.name}</span>
              </p>
            ) : (
              <p className="font-semibold text-white/75">Sin pujas todavía</p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2 empty:hidden">
          {closed ? (
            <p className="inline-flex items-center gap-2 rounded-2xl bg-rose px-3 py-1 font-display text-lg text-night-950">
              <Gavel className="size-5" aria-hidden /> ¡Puja cerrada! Última palabra…
            </p>
          ) : null}
          <AutoRunClock snapshot={snapshot} compact />
          {countdown !== null && !closed ? (
            <p className={`inline-flex items-center gap-2 rounded-2xl px-3 py-1 font-display text-lg tabular-nums ${countdown <= 5 ? 'bg-rose text-night-950' : 'bg-night-700 text-gold-soft'}`} data-testid="watch-countdown">
              <Hourglass className="size-5" aria-hidden /> {countdown > 0 ? `${flash ? '⚡ ' : ''}Adjudicado en ${countdown} s` : 'Adjudicando…'}
            </p>
          ) : null}
        </div>

        {(auction.yielded?.length ?? 0) > 0 ? (
          <p className="text-sm font-semibold text-white/75">🏳️ Han cedido: {(auction.yielded ?? []).map((id) => byId(id)?.name ?? '?').join(', ')}</p>
        ) : null}

        {bids.length > 0 ? (
          <div className="text-left">
            <h3 className="mb-1 text-sm font-bold uppercase tracking-wide text-white/75">Últimas pujas</h3>
            <ol className="grid gap-1.5" data-testid="watch-bids">
              {bids.map((b, i) => {
                const p = byId(b.player_id);
                return (
                  <li key={b.id} className={`flex items-center justify-between gap-3 rounded-xl border-l-4 bg-night-900/80 px-3 py-2 ${i === 0 ? 'ring-1 ring-gold/60' : ''}`} style={{ borderColor: p?.color ?? '#888' }}>
                    <span className="min-w-0 truncate font-bold" style={{ color: p?.color }}>{p?.name ?? 'Jugador'}</span>
                    <span className="shrink-0 font-display tabular-nums"><Ohros cents={b.amount_cents} /></span>
                  </li>
                );
              })}
            </ol>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** Entre subastas (o antes de la primera): último adjudicado y cuenta atrás hasta la siguiente. */
function Between({ snapshot, players }: { snapshot: PublicSnapshot; players: Player[] }) {
  const { game, last_award: award } = snapshot;
  const nextIn = useCountdownTo(game.status === 'active' ? game.auto_run_next_at : null, snapshot.server_time);
  const winner = award ? players.find((p) => p.id === award.player_id) : null;
  if (game.status === 'paused') return null;
  return (
    <section aria-label="Entre subastas" className="space-y-2 rounded-3xl border border-white/10 bg-night-800/80 px-4 py-5 text-center" data-testid="watch-between">
      <p className="flex items-center justify-center gap-2 font-display text-xl" role="status">
        <Hourglass className="size-5 text-gold" aria-hidden /> Preparando la siguiente subasta…
      </p>
      {nextIn !== null ? (
        <p className="font-bold tabular-nums text-gold-soft">{nextIn > 0 ? `Siguiente subasta en ${nextIn} s` : '¡Ya viene el siguiente elemento!'}</p>
      ) : null}
      {award ? (
        <p className="text-base font-semibold text-white/85">
          <Trophy className="mr-1 inline size-4 text-gold" aria-hidden />
          Último adjudicado: <span aria-hidden>{award.emoji ?? '🎁'}</span> <strong className="text-white">{award.item_name}</strong> para{' '}
          <strong style={{ color: winner?.color }}>{winner?.name ?? 'un jugador'}</strong> por{' '}
          <strong className="font-display tabular-nums text-gold"><Ohros cents={award.price_cents} /></strong>
        </p>
      ) : null}
    </section>
  );
}

/** Casas y saldos de los jugadores (solo datos públicos de la instantánea). */
function PlayersGrid({ players, leaderId, lobby }: { players: Player[]; leaderId: string | null; lobby: boolean }) {
  return (
    <section aria-labelledby="watch-players">
      <h2 id="watch-players" className="mb-2 font-display text-xl text-gold">Jugadores</h2>
      <ul className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2" data-testid="watch-players">
        {players.map((p) => (
          <li key={p.id} className={`overflow-hidden rounded-2xl border-2 bg-night-800 ${leaderId === p.id ? 'border-gold' : 'border-white/10'}`} data-testid="watch-player">
            <div className="relative aspect-[3/2] w-full">
              <HouseImage image={p.current_image} alt={`Casa de ${p.name}`} className="absolute inset-0" emptyLabel="Sin casa todavía" />
              {p.generating.some((g) => g.kind === 'edit') ? (
                <span className="absolute bottom-2 right-2 rounded-full bg-violet px-3 py-1 text-sm font-black text-white">⏳ Mejorando la casa…</span>
              ) : null}
            </div>
            <div className="px-3 py-2" style={{ borderTop: `0.25rem solid ${p.color}` }}>
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="min-w-0 truncate font-display text-xl" style={{ color: p.color }}>{p.name}</h3>
                {lobby ? <span className="shrink-0 text-sm font-bold text-teal">{p.claimed ? 'Conectado' : 'Esperando'}</span> : (
                  <span className="shrink-0 font-display text-xl tabular-nums" aria-label={`Saldo de ${p.name}`}><Ohros cents={p.balance_cents} /></span>
                )}
              </div>
              {!lobby ? (
                <p className="text-sm text-white/75">
                  {p.purchases.length === 0 ? 'Sin elementos todavía' : `${p.purchases.length} ${p.purchases.length === 1 ? 'elemento' : 'elementos'}: `}
                  {p.purchases.length > 0 ? <span aria-hidden>{p.purchases.map((x) => x.emoji ?? '📦').join(' ')}</span> : null}
                  {p.purchases.length > 0 ? <span className="sr-only">{p.purchases.map((x) => x.name).join(', ')}</span> : null}
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
