import { Ohros } from '@/components/ui/ohros';
import type { Player, PlayerStat } from '@/lib/domain/types';
import { computeAwards } from '@/lib/domain/ranking';

/** Premios divertidos (tiburón, derrochador…). `tv` = tira compacta de una fila para la pantalla grande. */
export function AwardsList({ players, stats, tv = false }: { players: Player[]; stats: PlayerStat[] | undefined; tv?: boolean }) {
  const awards = computeAwards(players, stats);
  if (awards.length === 0) return null;
  return (
    <ul aria-label="Premios" data-testid="awards" className={tv ? 'relative z-10 flex shrink-0 flex-wrap items-center justify-center gap-[0.6rem]' : 'flex flex-wrap gap-2'}>
      {awards.map((a) => (
        <li key={a.id} className={`rounded-xl bg-night-800/90 font-semibold ${tv ? 'px-[1rem] py-[0.3rem] text-[1.3rem]' : 'px-3 py-2 text-sm'}`}>
          <span aria-hidden>{a.emoji} </span>
          <span className="text-gold-soft">{a.title}</span>
          <span className="text-white/60"> · </span>
          {a.players.map((p, i) => (
            <span key={p.id} style={{ color: p.color }}>{i > 0 ? ' y ' : ''}{p.name}</span>
          ))}
          <span className="text-white/60"> ({a.detail})</span>
        </li>
      ))}
    </ul>
  );
}

/** Tabla de estadísticas por jugador (resultados web y móviles). */
export function PlayerStatsSection({ players, stats }: { players: Player[]; stats: PlayerStat[] | undefined }) {
  if (!stats || stats.length === 0) return null;
  const rows = players.flatMap((player) => {
    const st = stats.find((x) => x.player_id === player.id);
    return st ? [{ player, st }] : [];
  });
  return (
    <section aria-labelledby="stats-jugadores" className="relative z-10 space-y-3 rounded-3xl border border-white/10 bg-night-800/80 p-4 sm:p-6" data-testid="player-stats">
      <h2 id="stats-jugadores" className="font-display text-2xl text-gold">Estadísticas por jugador</h2>
      <AwardsList players={players} stats={stats} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] border-collapse text-left text-sm">
          <caption className="sr-only">Estadísticas de cada jugador al terminar la partida</caption>
          <thead>
            <tr className="text-xs uppercase tracking-wide text-white/70">
              <th scope="col" className="py-2 pr-3">Jugador</th>
              <th scope="col" className="px-2 py-2 text-right">Elementos</th>
              <th scope="col" className="px-2 py-2 text-right">Gastado</th>
              <th scope="col" className="px-2 py-2 text-right">Pujas</th>
              <th scope="col" className="px-2 py-2 text-right">Puja más alta</th>
              <th scope="col" className="px-2 py-2 text-right">Cedió</th>
              <th scope="col" className="py-2 pl-2 text-right">Saldo final</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ player, st }) => (
              <tr key={player.id} className="border-t border-white/10 tabular-nums">
                <th scope="row" className="py-2 pr-3 font-bold" style={{ color: player.color }}>{player.name}</th>
                <td className="px-2 py-2 text-right">{st.wins}</td>
                <td className="px-2 py-2 text-right"><Ohros cents={st.spent_cents} /></td>
                <td className="px-2 py-2 text-right">{st.bids_count}</td>
                <td className="px-2 py-2 text-right">{st.max_bid_cents > 0 ? <Ohros cents={st.max_bid_cents} /> : '—'}</td>
                <td className="px-2 py-2 text-right">{st.yields_count}</td>
                <td className="py-2 pl-2 text-right"><Ohros cents={player.balance_cents} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
