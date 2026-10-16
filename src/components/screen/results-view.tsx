'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Coins, Gavel, Medal, Package, Trophy, TrendingUp, Ban } from 'lucide-react';
import type { Player, PublicSnapshot, RankingRule, RuntimeInfo } from '@/lib/domain/types';
import { useLiveGame } from '@/lib/client/use-live-game';
import { ConnectionBadge, DemoBanner } from '@/components/ui/status';
import { formatEuros } from '@/lib/domain/money';
import { computeHighlights, computeRanking, rankingRuleLabel } from '@/lib/domain/ranking';
import { themeLabel } from '@/lib/domain/themes';
import { Confetti } from './award-overlay';
import { HouseImage } from './house-image';
import './screen.css';

function scoreLabel(rule: RankingRule, p: Player): string {
  if (rule === 'balance') return formatEuros(p.balance_cents);
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
          <span className="absolute bottom-2 right-2 rounded-md bg-gold px-2 py-0.5 text-[1rem] font-black uppercase tracking-wider text-night-950">Después</span>
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

function ResultCard({ player, rank, scoreText, tv, dense }: { player: Player; rank: number | null; scoreText: string | null; tv: boolean; dense: boolean }) {
  const spent = player.purchases.reduce((s, x) => s + x.price_cents, 0);
  return (
    <article
      className={`flex min-h-0 flex-col overflow-hidden rounded-2xl border-2 bg-night-800 ${tv ? 'h-full' : ''} ${rank === 1 ? 'border-gold shadow-[0_0_3rem_rgb(251_191_36/0.3)]' : 'border-white/10'}`}
    >
      <div className={`relative flex min-h-0 flex-col ${tv ? 'flex-1' : 'aspect-[3/2]'}`}>
        <BeforeAfter player={player} tv={tv} />
        {rank ? (
          <span className={`absolute right-2 top-2 flex items-center gap-1.5 rounded-full px-3 py-1 font-display ${rank === 1 ? 'bg-gold text-night-950' : 'bg-night-950/85 text-white'} ${tv ? 'text-[1.4rem]' : 'text-lg'}`}>
            {rank === 1 ? <Trophy className="size-5" aria-hidden /> : <Medal className="size-5" aria-hidden />} {rank}.º
          </span>
        ) : null}
      </div>
      <div className="shrink-0 px-4 py-3" style={{ borderTop: `0.3rem solid ${player.color}` }}>
        <div className="flex items-baseline justify-between gap-3">
          <h3 className={`min-w-0 truncate font-display ${tv ? (dense ? 'text-[1.6rem]' : 'text-[2.1rem]') : 'text-2xl'}`} style={{ color: player.color }}>
            {player.name}
          </h3>
          <p className={`shrink-0 font-display tabular-nums ${tv ? (dense ? 'text-[1.6rem]' : 'text-[2.1rem]') : 'text-2xl'}`} aria-label={`Saldo restante de ${player.name}`}>
            {formatEuros(player.balance_cents)}
          </p>
        </div>
        {scoreText ? <p className={`font-bold text-gold ${tv ? 'text-[1.1rem]' : 'text-sm'}`}>{scoreText}</p> : null}
        <ul className={`mt-1 flex flex-wrap items-center gap-1.5 ${tv ? (dense ? 'max-h-[2rem] overflow-hidden' : 'max-h-[3.2rem] overflow-hidden') : ''}`} aria-label={`Elementos de ${player.name}`}>
          {player.purchases.length === 0 ? <li className={`text-white/55 ${tv ? 'text-[1rem]' : 'text-sm'}`}>Sin elementos conseguidos</li> : null}
          {player.purchases.map((p) => (
            <li key={p.purchase_id} className={`flex items-center gap-1 rounded-lg bg-night-950/70 px-1.5 py-0.5 ${tv ? 'text-[1.05rem]' : 'text-sm'}`}>
              <span aria-hidden>{p.emoji ?? '📦'}</span>
              {tv && dense ? null : <span className="max-w-[10rem] truncate font-semibold">{p.name}</span>}
              {tv && dense ? <span className="sr-only">{p.name}</span> : <span className="tabular-nums text-white/60">{formatEuros(p.price_cents)}</span>}
            </li>
          ))}
        </ul>
        {!tv && spent > 0 ? <p className="mt-1 text-xs text-white/55">Gastado: {formatEuros(spent)}</p> : null}
      </div>
    </article>
  );
}

function StatTile({ icon, label, value, tv }: { icon: React.ReactNode; label: string; value: string; tv: boolean }) {
  return (
    <div className={`flex items-center gap-3 rounded-2xl border border-white/10 bg-night-800/90 ${tv ? 'px-4 py-2' : 'px-4 py-3'}`}>
      <span className="text-gold">{icon}</span>
      <div className="min-w-0">
        <p className={`font-display leading-tight tabular-nums text-white ${tv ? 'text-[1.6rem]' : 'text-xl'}`}>{value}</p>
        <p className={`truncate font-semibold text-white/65 ${tv ? 'text-[1rem]' : 'text-xs'}`}>{label}</p>
      </div>
    </div>
  );
}

/** Pantalla final: casas, antes/después, estadísticas y clasificación opcional. */
export function FinalResults({ snapshot, tv = false }: { snapshot: PublicSnapshot; tv?: boolean }) {
  const { game, players, stats } = snapshot;
  const rule = game.ranking_rule;
  const ranking = computeRanking(players, rule);
  const hl = computeHighlights(snapshot);
  const ordered = ranking ? ranking.map((r) => ({ player: r.player, rank: r.rank })) : players.map((player) => ({ player, rank: null as number | null }));

  const n = players.length;
  const cols = n <= 4 ? Math.max(n, 1) : n <= 8 ? 4 : n <= 10 ? 5 : 6;
  const rows = Math.max(1, Math.ceil(n / cols));

  const tiles = (
    <>
      <StatTile tv={tv} icon={<Package className="size-6" aria-hidden />} label="Elementos subastados" value={String(stats.purchases_count)} />
      <StatTile tv={tv} icon={<Coins className="size-6" aria-hidden />} label="Dinero gastado" value={formatEuros(stats.total_spent_cents)} />
      <StatTile tv={tv} icon={<Gavel className="size-6" aria-hidden />} label="Pujas totales" value={String(stats.bids_count)} />
      <StatTile tv={tv} icon={<Ban className="size-6" aria-hidden />} label="Subastas canceladas" value={String(stats.cancelled_auctions)} />
      {hl.mostExpensive ? (
        <StatTile tv={tv} icon={<TrendingUp className="size-6" aria-hidden />} label={`Más caro · ${hl.mostExpensive.itemName} (${hl.mostExpensive.playerName})`} value={formatEuros(hl.mostExpensive.priceCents)} />
      ) : null}
      {hl.biggestSpender ? (
        <StatTile tv={tv} icon={<Coins className="size-6" aria-hidden />} label={`Quien más gastó · ${hl.biggestSpender.playerName}`} value={formatEuros(hl.biggestSpender.spentCents)} />
      ) : null}
      {hl.mostItems ? (
        <StatTile tv={tv} icon={<Trophy className="size-6" aria-hidden />} label={`Más elementos · ${hl.mostItems.playerName}`} value={`${hl.mostItems.count}`} />
      ) : null}
    </>
  );

  const hero = (
    <div className="relative text-center">
      <p className={`font-display uppercase tracking-wide text-gold ${tv ? 'text-[3.4rem] leading-none' : 'text-4xl sm:text-6xl'}`}>¡Fin de la subasta!</p>
      <p className={`font-semibold text-white/80 ${tv ? 'mt-1 text-[1.4rem]' : 'mt-2 text-base sm:text-xl'}`}>
        {game.name} · {themeLabel(game.theme)}
        {ranking ? <> · Clasificación: <strong className="text-gold-soft">{rankingRuleLabel(rule)}</strong></> : null}
      </p>
    </div>
  );

  if (tv) {
    return (
      <div className="relative flex h-full flex-col gap-[0.8rem] px-[2rem] py-[1rem]">
        <Confetti count={36} />
        {hero}
        <div className="grid shrink-0 grid-cols-7 gap-[0.6rem]">{tiles}</div>
        <div
          className="mx-auto grid min-h-0 w-full flex-1 gap-[0.9rem]"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, ${rows === 1 ? '28rem' : '1fr'}))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`, justifyContent: 'center' }}
        >
          {ordered.map(({ player, rank }) => (
            <ResultCard key={player.id} player={player} rank={rank} scoreText={ranking && rank ? scoreLabel(rule, player) : null} tv dense={rows > 1} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="relative mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-8 sm:px-6">
      <Confetti count={30} />
      {hero}

      {ranking ? (
        <section aria-labelledby="clasificacion" className="rounded-3xl border border-gold/30 bg-night-800/80 p-4 sm:p-6">
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

      <section aria-label="Estadísticas" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">{tiles}</section>

      <section aria-label="Casas finales" className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
        {ordered.map(({ player, rank }) => (
          <ResultCard key={player.id} player={player} rank={rank} scoreText={ranking && rank ? scoreLabel(rule, player) : null} tv={false} dense={false} />
        ))}
      </section>
    </div>
  );
}

/** Ruta pública /game/[code]/results (solo lectura). */
export function ResultsView({ roomCode, initial, runtime }: { roomCode: string; initial: PublicSnapshot; runtime: RuntimeInfo }) {
  const { snapshot, connection } = useLiveGame({ roomCode, initial, runtime, view: 'public' });
  const finished = snapshot.game.status === 'finished';
  return (
    <main className="min-h-dvh bg-night-950 text-white">
      <DemoBanner runtime={runtime} />
      {finished ? (
        <FinalResults snapshot={snapshot} />
      ) : (
        <div className="mx-auto flex min-h-[70dvh] max-w-xl flex-col items-center justify-center gap-5 px-4 text-center">
          <Trophy className="size-14 text-gold" aria-hidden />
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
