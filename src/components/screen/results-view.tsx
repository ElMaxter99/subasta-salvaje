'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Coins, Gavel, Medal, Package, Trophy, TrendingUp, Ban } from 'lucide-react';
import type { Gallery, Player, PublicSnapshot, RankingRule, RuntimeInfo } from '@/lib/domain/types';
import { GameGone } from '@/components/ui/game-gone';
import { useLiveGame } from '@/lib/client/use-live-game';
import { ConnectionBadge, DemoBanner } from '@/components/ui/status';
import { formatOhros } from '@/lib/domain/money';
import { joinedPlayers } from '@/lib/domain/players';
import { computeHighlights, computePodium, computeRanking, rankingRuleLabel } from '@/lib/domain/ranking';
import { Podium } from './podium';
import { themeLabel } from '@/lib/domain/themes';
import { Confetti } from './award-overlay';
import { ItemIcon, Mascot, Sparkles } from '@/components/mascot/mascot';
import { HouseImage } from './house-image';
import './screen.css';
import { Ohros } from '@/components/ui/ohros';

function scoreLabel(rule: RankingRule, p: Player): string {
  if (rule === 'balance') return formatOhros(p.balance_cents);
  if (rule === 'items') return `${p.purchases.length} ${p.purchases.length === 1 ? 'elemento' : 'elementos'}`;
  return `${p.votes} ${p.votes === 1 ? 'voto' : 'votos'}`;
}

/** Final «antes / después»: miniatura de la casa inicial + deslizador para comparar. */
function BeforeAfter({ player, tv }: { player: Player; tv: boolean }) {
  const before = player.initial_image;
  const after = player.current_image;
  const [pos, setPos] = useState(0);
  const comparable = Boolean(before?.url && after?.url && before.id !== after.id);
  return (
    <div className="relative min-h-0 flex-1">
      <HouseImage image={after} alt={`Casa final de ${player.name}`} className="absolute inset-0" emptyLabel="Sin casa final" />
      {comparable ? (
        <>
          <div className="absolute inset-0 overflow-hidden" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }} aria-hidden={pos === 0}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={before!.url!} alt={`Casa inicial de ${player.name}`} className="size-full object-cover" />
            <span className="absolute left-2 top-2 rounded-md bg-night-950/85 px-2 py-0.5 text-[1rem] font-black uppercase tracking-wider text-white">Antes</span>
          </div>
          {pos > 0 ? <div className="absolute inset-y-0 w-1 -translate-x-1/2 bg-white shadow-[0_0_12px_#fff]" style={{ left: `${pos}%` }} aria-hidden /> : null}
          {pos === 0 ? (
            <figure className="absolute left-2 top-2 m-0 overflow-hidden rounded-lg border-2 border-white/80 bg-night-950 shadow-lg">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={before!.url!} alt={`Casa inicial de ${player.name}`} className={`object-cover ${tv ? 'h-[4.5rem] w-[6.75rem]' : 'h-16 w-24'}`} />
              <figcaption className="bg-night-950 py-0.5 text-center text-[0.9rem] font-black uppercase tracking-wider text-white">Antes</figcaption>
            </figure>
          ) : null}
          <span className="absolute right-2 top-2 rounded-md bg-gold px-2 py-0.5 text-[1rem] font-black uppercase tracking-wider text-night-950">Después</span>
          {!tv ? (
            <input
              type="range"
              min={0}
              max={100}
              value={pos}
              onChange={(e) => setPos(Number(e.target.value))}
              aria-label={`Comparar antes y después de la casa de ${player.name}`}
              className="absolute inset-x-3 bottom-2 w-[calc(100%-6.5rem)] accent-gold"
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function ResultCard({ player, rank, scoreText, tv, dense, votes = null, galleryWinner = false }: { player: Player; rank: number | null; scoreText: string | null; tv: boolean; dense: boolean; votes?: number | null; galleryWinner?: boolean }) {
  const spent = player.purchases.reduce((s, x) => s + x.price_cents, 0);
  return (
    <article
      className={`flex min-h-0 flex-col overflow-hidden rounded-2xl border-2 bg-night-800 ${tv ? 'w-full' : ''} ${rank === 1 || galleryWinner ? 'border-gold shadow-[0_0_3rem_rgb(251_191_36/0.3)]' : 'border-white/10'}`}
    >
      {/* Siempre 3:2 (también en la TV): con `flex-1` la imagen se estiraba al alto de la tarjeta y `object-cover` recortaba la casa final. */}
      <div className="relative flex min-h-0 aspect-[3/2] flex-col">
        <BeforeAfter player={player} tv={tv} />
        {player.generating.some((g) => g.kind === 'edit') ? (
          <span className={`absolute right-2 bottom-2 rounded-full bg-violet px-3 py-1 font-black text-white ${tv ? 'text-[1.2rem]' : 'text-sm'}`} role="status" data-testid="final-generating">
            ⏳ Generando la imagen final…
          </span>
        ) : null}
        {votes !== null ? (
          <span className={`absolute bottom-2 left-2 rounded-full px-3 py-1 font-black text-night-950 ${galleryWinner ? 'bg-gold' : 'bg-white/90'} ${tv ? 'text-[1.2rem]' : 'text-sm'}`} data-testid="gallery-votes">
            {galleryWinner ? '🏆 ' : '🗳️ '}{votes} {votes === 1 ? 'voto' : 'votos'}
          </span>
        ) : null}
      </div>
      <div className="shrink-0 px-4 py-3" style={{ borderTop: `0.3rem solid ${player.color}` }}>
        <div className="flex items-baseline justify-between gap-3">
          <h3 className={`flex min-w-0 items-center gap-2 truncate font-display ${tv ? (dense ? 'text-[1.6rem]' : 'text-[2.1rem]') : 'text-2xl'}`} style={{ color: player.color }}>
            {rank ? (
              <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-[0.7em] text-night-950 ${rank === 1 ? 'bg-gold' : 'bg-white/85'}`}>
                {rank === 1 ? <Trophy className="size-[0.9em]" aria-hidden /> : <Medal className="size-[0.9em]" aria-hidden />} {rank}.º
              </span>
            ) : null}
            {rank === 1 || galleryWinner ? <ItemIcon variant="item-corona" motion="drop" className="!h-[1.1em]" /> : null}
            <span className="truncate">{player.name}</span>
          </h3>
          <p className={`shrink-0 font-display tabular-nums ${tv ? (dense ? 'text-[1.6rem]' : 'text-[2.1rem]') : 'text-2xl'}`} aria-label={`Saldo restante de ${player.name}`}>
            <Ohros cents={player.balance_cents} />
          </p>
        </div>
        {scoreText ? <p className={`font-bold text-gold ${tv ? 'text-[1.1rem]' : 'text-sm'}`}>{scoreText}</p> : null}
        <ul className={`mt-1 flex flex-wrap items-center gap-1.5 ${tv ? (dense ? 'max-h-[2rem] overflow-hidden' : 'max-h-[3.2rem] overflow-hidden') : ''}`} aria-label={`Elementos de ${player.name}`}>
          {player.purchases.length === 0 ? <li className={`text-white/55 ${tv ? 'text-[1rem]' : 'text-sm'}`}>Sin elementos conseguidos</li> : null}
          {player.purchases.map((p) => (
            <li key={p.purchase_id} className={`flex items-center gap-1 rounded-lg bg-night-950/70 px-1.5 py-0.5 ${tv ? 'text-[1.05rem]' : 'text-sm'}`}>
              <span aria-hidden>{p.emoji ?? '📦'}</span>
              {tv && dense ? null : <span className="max-w-[10rem] truncate font-semibold">{p.name}</span>}
              {tv && dense ? <span className="sr-only">{p.name}</span> : <span className="tabular-nums text-white/60"><Ohros cents={p.price_cents} /></span>}
            </li>
          ))}
        </ul>
        {!tv && spent > 0 ? <p className="mt-1 text-xs text-white/55">Gastado: <Ohros cents={spent} /></p> : null}
      </div>
    </article>
  );
}

function StatTile({ icon, label, value, tv }: { icon: React.ReactNode; label: string; value: React.ReactNode; tv: boolean }) {
  return (
    <div className={`flex items-center gap-3 rounded-2xl border border-white/10 bg-night-800/90 ${tv ? 'px-4 py-2' : 'px-4 py-3'}`}>
      <span className="text-gold">{icon}</span>
      <div className="min-w-0">
        <p className={`font-display leading-tight tabular-nums text-white ${tv ? 'text-[1.6rem]' : 'text-xl'}`}>{value}</p>
        <p className={`font-semibold leading-tight text-white/65 ${tv ? 'line-clamp-2 text-[1rem]' : 'text-xs'}`}>{label}</p>
      </div>
    </div>
  );
}

/** Resultado de la galería: ganador(es) por votos, o el progreso mientras la votación sigue abierta. */
function galleryInfo(snapshot: PublicSnapshot) {
  const g: Gallery | undefined = snapshot.gallery;
  if (!g || !g.enabled || snapshot.game.play_mode !== 'mobile') return null;
  const votes = new Map((g.results ?? []).map((r) => [r.player_id, r.votes]));
  const top = g.closed && g.results?.length ? Math.max(...g.results.map((r) => r.votes)) : 0;
  const winners = g.closed && top > 0 ? joinedPlayers(snapshot.players).filter((p) => (votes.get(p.id) ?? 0) === top) : [];
  return { g, votes: g.closed ? votes : null, top, winners };
}

function GalleryBanner({ snapshot, tv }: { snapshot: PublicSnapshot; tv: boolean }) {
  const info = galleryInfo(snapshot);
  if (!info) return null;
  const connected = snapshot.players.filter((p) => p.claimed).length;
  const size = tv ? 'text-[1.5rem]' : 'text-lg';
  if (info.g.open) {
    return (
      <p className={`mx-auto mt-2 w-fit rounded-2xl bg-violet px-6 py-2 text-center font-bold text-white ${size}`} role="status" data-testid="gallery-open">
        🗳️ ¡Votación abierta! Vota desde tu móvil la mejor casa · {info.g.voters.length} {info.g.voters.length === 1 ? 'voto' : 'votos'} de {Math.max(connected, info.g.voters.length)}
      </p>
    );
  }
  if (info.winners.length > 0) {
    return (
      <p className={`mx-auto mt-2 w-fit rounded-2xl bg-gold px-6 py-2 text-center font-display text-night-950 ${size}`} role="status" data-testid="gallery-winner">
        🏆 Mejor casa según los jugadores: {info.winners.map((w) => w.name).join(' y ')} ({info.top} {info.top === 1 ? 'voto' : 'votos'})
      </p>
    );
  }
  return (
    <p className={`mx-auto mt-2 w-fit rounded-2xl bg-night-700 px-6 py-2 text-center font-semibold text-white/80 ${size}`} role="status">
      Votación cerrada sin votos.
    </p>
  );
}

/** Pantalla final: casas, antes/después, estadísticas y clasificación opcional. */
export function FinalResults({ snapshot, tv = false }: { snapshot: PublicSnapshot; tv?: boolean }) {
  const { game, stats } = snapshot;
  const players = joinedPlayers(snapshot.players); // quien nunca entró (modo móviles) no sale en el resultado
  const rule = game.ranking_rule;
  const ranking = computeRanking(players, rule);
  const hl = computeHighlights({ ...snapshot, players });
  const lost = snapshot.items.filter((i) => i.status === 'lost'); // subastas que terminaron sin ninguna puja
  const ordered = ranking ? ranking.map((r) => ({ player: r.player, rank: r.rank })) : players.map((player) => ({ player, rank: null as number | null }));

  const n = players.length;
  const cols = n <= 4 ? Math.max(n, 1) : n <= 8 ? 4 : n <= 10 ? 5 : 6;
  const rows = Math.max(1, Math.ceil(n / cols));
  const gallery = galleryInfo(snapshot);
  // Con la votación de la galería cerrada y con votos, la pantalla final pasa a mostrar el PODIO.
  const pod = gallery?.g.closed && gallery.votes && gallery.top > 0 ? computePodium(players, gallery.votes) : null;
  const cardProps = (id: string) => ({ votes: gallery?.votes ? (gallery.votes.get(id) ?? 0) : null, galleryWinner: Boolean(gallery?.winners.some((w) => w.id === id)) });

  const tiles = (
    <>
      <StatTile tv={tv} icon={<Package className="size-6" aria-hidden />} label="Elementos subastados" value={String(stats.purchases_count)} />
      <StatTile tv={tv} icon={<Coins className="size-6" aria-hidden />} label="Dinero gastado" value={<Ohros cents={stats.total_spent_cents} />} />
      <StatTile tv={tv} icon={<Gavel className="size-6" aria-hidden />} label="Pujas totales" value={String(stats.bids_count)} />
      {lost.length > 0 ? (
        <StatTile tv={tv} icon={<Ban className="size-6" aria-hidden />} label={`Sin pujas (nadie los quiso)${lost.length <= 3 ? ` · ${lost.map((i) => i.name).join(', ')}` : ''}`} value={String(lost.length)} />
      ) : null}
      <StatTile tv={tv} icon={<Ban className="size-6" aria-hidden />} label="Subastas canceladas" value={String(stats.cancelled_auctions)} />
      {hl.mostExpensive ? (
        <StatTile tv={tv} icon={<TrendingUp className="size-6" aria-hidden />} label={`Más caro · ${hl.mostExpensive.itemName} (${hl.mostExpensive.playerName})`} value={<Ohros cents={hl.mostExpensive.priceCents} />} />
      ) : null}
      {hl.biggestSpender ? (
        <StatTile tv={tv} icon={<Coins className="size-6" aria-hidden />} label={`Quien más gastó · ${hl.biggestSpender.playerName}`} value={<Ohros cents={hl.biggestSpender.spentCents} />} />
      ) : null}
      {hl.mostItems ? (
        <StatTile tv={tv} icon={<Trophy className="size-6" aria-hidden />} label={`Más elementos · ${hl.mostItems.playerName}`} value={`${hl.mostItems.count}`} />
      ) : null}
    </>
  );

  const hero = (
    <div className="relative flex flex-col items-center text-center">
      <Sparkles />
      <div className="flex items-center justify-center gap-[1.5rem]">
        <Mascot variant="expr-hype" size={tv ? 'xs' : 'sm'} tile motion="bob" />
        <p className={`font-display uppercase tracking-wide text-gold ${tv ? 'text-[3.4rem] leading-none' : 'text-4xl sm:text-6xl'}`}>¡Fin de la subasta!</p>
      </div>
      <p className={`font-semibold text-white/80 ${tv ? 'mt-1 text-[1.4rem]' : 'mt-2 text-base sm:text-xl'}`}>
        {game.name} · {themeLabel(game.theme)}
        {ranking ? <> · Clasificación: <strong className="text-gold-soft">{rankingRuleLabel(rule)}</strong></> : null}
      </p>
      <GalleryBanner snapshot={snapshot} tv={tv} />
    </div>
  );

  if (tv && pod) {
    return (
      <div className="relative flex h-full flex-col gap-[0.8rem] px-[2rem] py-[1rem]" data-testid="podium-view">
        <Confetti count={48} />
        <div className="relative z-10">{hero}</div>
        <div className="relative z-10 flex min-h-0 flex-1 items-end justify-center">
          <Podium groups={pod.podium} tv />
        </div>
        {pod.rest.length > 0 ? (
          <ul className="relative z-10 flex shrink-0 flex-wrap items-center justify-center gap-[0.6rem]" aria-label="Resto de jugadores">
            {pod.rest.map(({ player, votes }) => (
              <li key={player.id} className="rounded-xl bg-night-800/90 px-[1rem] py-[0.3rem] text-[1.3rem] font-semibold" style={{ color: player.color }}>
                {player.name} <span className="text-white/70">· {votes} {votes === 1 ? 'voto' : 'votos'}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="relative z-10 grid shrink-0 grid-cols-4 gap-[0.6rem]">{tiles}</div>
      </div>
    );
  }

  if (tv) {
    return (
      <div className="relative flex h-full flex-col gap-[0.8rem] px-[2rem] py-[1rem]">
        <Confetti count={36} />
        <div className="relative z-10">{hero}</div>
        <div className="relative z-10 grid shrink-0 grid-cols-7 gap-[0.6rem]">{tiles}</div>
        <div className="relative z-10 mx-auto flex min-h-0 w-full flex-1 flex-col gap-[0.9rem]">
          {Array.from({ length: rows }, (_, r) => ordered.slice(r * cols, (r + 1) * cols)).map((row, r) => (
            // Cada fila se centra por separado para que la última (incompleta) no quede pegada a la izquierda.
            <div key={r} className="flex min-h-0 flex-1 justify-center gap-[0.9rem]">
              {row.map(({ player, rank }) => (
                <div key={player.id} className="flex min-h-0 items-center" style={{ width: `calc((100% - ${(cols - 1) * 0.9}rem) / ${cols})`, maxWidth: rows === 1 ? (n <= 3 ? '40rem' : '28rem') : undefined }}>
                  <ResultCard player={player} rank={rank} scoreText={ranking && rank && rule !== 'balance' ? scoreLabel(rule, player) : null} tv dense={rows > 1} {...cardProps(player.id)} />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="relative mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-8 sm:px-6">
      <Confetti count={30} />
      <div className="relative z-10">{hero}</div>

      {ranking ? (
        <section aria-labelledby="clasificacion" className="relative z-10 rounded-3xl border border-gold/30 bg-night-800/80 p-4 sm:p-6">
          <h2 id="clasificacion" className="flex items-center gap-2 font-display text-2xl text-gold">
            <Trophy className="size-6" aria-hidden /> Clasificación
          </h2>
          <p className="mb-4 text-sm text-white/65">Regla: {rankingRuleLabel(rule)}. Solo refleja esta regla, no valora la calidad de las imágenes.</p>
          <ol className="grid gap-2">
            {ranking.map((r) => (
              <li key={r.player.id} className={`flex items-center gap-3 rounded-xl px-4 py-3 ${r.rank === 1 ? 'bg-gold/15 ring-2 ring-gold' : 'bg-night-900/70'}`}>
                <span className={`flex size-10 shrink-0 items-center justify-center rounded-full font-display text-lg ${r.rank === 1 ? 'bg-gold text-night-950' : 'bg-night-700 text-white'}`}>{r.rank}</span>
                <span className="size-4 shrink-0 rounded-full" style={{ background: r.player.color }} aria-hidden />
                <span className="min-w-0 flex-1 truncate font-display text-lg" style={{ color: r.player.color }}>{r.player.name}</span>
                <span className="shrink-0 font-bold tabular-nums text-white">{scoreLabel(rule, r.player)}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {pod ? (
        <div className="relative z-10" data-testid="podium-view">
          <Podium groups={pod.podium} tv={false} />
          {pod.rest.length > 0 ? (
            <ul className="mt-4 flex flex-wrap justify-center gap-2" aria-label="Resto de jugadores">
              {pod.rest.map(({ player, votes }) => (
                <li key={player.id} className="rounded-xl bg-night-800 px-3 py-1 text-sm font-semibold" style={{ color: player.color }}>
                  {player.name} <span className="text-white/70">· {votes} {votes === 1 ? 'voto' : 'votos'}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <section aria-label="Estadísticas" className="relative z-10 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">{tiles}</section>

      <section aria-label="Casas finales" className="relative z-10 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
        {ordered.map(({ player, rank }) => (
          <ResultCard key={player.id} player={player} rank={rank} scoreText={ranking && rank && rule !== 'balance' ? scoreLabel(rule, player) : null} tv={false} dense={false} {...cardProps(player.id)} />
        ))}
      </section>
    </div>
  );
}

/** Ruta pública /game/[code]/results (solo lectura). */
export function ResultsView({ roomCode, initial, runtime }: { roomCode: string; initial: PublicSnapshot; runtime: RuntimeInfo }) {
  const { snapshot, connection, gone } = useLiveGame({ roomCode, initial, runtime, view: 'public' });
  const finished = snapshot.game.status === 'finished';
  if (gone) return <GameGone roomCode={roomCode} />;
  return (
    <main className="min-h-dvh bg-night-950 text-white">
      <DemoBanner runtime={runtime} />
      {finished ? (
        <FinalResults snapshot={snapshot} />
      ) : (
        <div className="mx-auto flex min-h-[70dvh] max-w-xl flex-col items-center justify-center gap-5 px-4 text-center">
          <Mascot variant="pose-cuenta-atras" size="md" tile motion="bob" />
          <h1 className="font-display text-3xl">La partida aún está en curso</h1>
          <p className="text-white/70">Los resultados aparecerán aquí cuando termine la subasta «{snapshot.game.name}».</p>
          <Link href={`/game/${roomCode}/screen`} className="inline-flex items-center gap-2 rounded-2xl bg-gold px-6 py-3 text-lg font-bold text-night-950 hover:bg-gold-soft">
            Ir a la pantalla de TV <ArrowRight className="size-5" aria-hidden />
          </Link>
        </div>
      )}
      <footer className="flex justify-center px-4 pb-6">
        <ConnectionBadge state={connection} runtime={runtime} />
      </footer>
    </main>
  );
}
