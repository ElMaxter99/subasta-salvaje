import type { Player, PlayerStat, PublicSnapshot, RankingRule } from './types';
import { formatOhros } from './money';

export interface RankingEntry {
  player: Player;
  rank: number;
  score: number;
}

const scoreFor = (rule: Exclude<RankingRule, 'none'>, p: Player): number =>
  rule === 'balance' ? p.balance_cents : rule === 'items' ? p.purchases.length : p.votes;

/**
 * Clasificación opcional según una regla EXPLÍCITA y configurable (saldo, nº de elementos o votos
 * del anfitrión). No evalúa la calidad artística de las imágenes. Los empates comparten posición.
 */
export function computeRanking(players: Player[], rule: RankingRule): RankingEntry[] | null {
  if (rule === 'none') return null;
  const scored = players.map((player) => ({ player, score: scoreFor(rule, player) })).sort((a, b) => b.score - a.score);
  let rank = 0;
  let prev: number | null = null;
  return scored.map((e, i) => {
    if (prev === null || e.score !== prev) rank = i + 1;
    prev = e.score;
    return { ...e, rank };
  });
}

export interface TeamEntry {
  /** Etiqueta tal como la escribió el anfitrión (la del primer jugador del equipo). */
  team: string;
  players: Player[];
  balance_cents: number;
  items: number;
  votes: number;
  /** Puntuación según la regla de clasificación activa (null con `none`). */
  score: number | null;
  /** Puesto (empates comparten); null con `none`. */
  rank: number | null;
}

/**
 * Equipos ligeros: agrupa por etiqueta (sin distinguir mayúsculas) y SUMA saldos, elementos y votos de sus jugadores.
 * Los jugadores sin etiqueta no forman equipo. Devuelve null si ningún jugador tiene equipo (nada cambia en la interfaz).
 * La puntuación sigue la regla activa (`balance`, `items`, `votes`); con `none` se ordena por nombre y no hay puestos.
 */
export function computeTeams(players: Player[], rule: RankingRule): TeamEntry[] | null {
  const groups = new Map<string, TeamEntry>();
  for (const p of players) {
    const label = (p.team ?? '').trim();
    if (!label) continue;
    const key = label.toLowerCase();
    const g = groups.get(key) ?? { team: label, players: [], balance_cents: 0, items: 0, votes: 0, score: null, rank: null };
    g.players.push(p);
    g.balance_cents += p.balance_cents;
    g.items += p.purchases.length;
    g.votes += p.votes;
    groups.set(key, g);
  }
  if (groups.size === 0) return null;
  const list = [...groups.values()];
  if (rule === 'none') return list.sort((a, b) => a.team.localeCompare(b.team, 'es'));
  for (const g of list) g.score = rule === 'balance' ? g.balance_cents : rule === 'items' ? g.items : g.votes;
  list.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.team.localeCompare(b.team, 'es'));
  let rank = 0;
  let prev: number | null = null;
  list.forEach((g, i) => {
    if (prev === null || g.score !== prev) rank = i + 1;
    prev = g.score;
    g.rank = rank;
  });
  return list;
}

export function rankingRuleLabel(rule: RankingRule): string {
  switch (rule) {
    case 'balance':
      return 'Más dinero restante';
    case 'items':
      return 'Más elementos conseguidos';
    case 'votes':
      return 'Votación del público';
    default:
      return 'Sin clasificación';
  }
}

export interface GameHighlights {
  mostExpensive: { playerName: string; itemName: string; priceCents: number } | null;
  biggestSpender: { playerName: string; spentCents: number } | null;
  mostItems: { playerName: string; count: number } | null;
}

export function computeHighlights(snap: Pick<PublicSnapshot, 'players'>): GameHighlights {
  let mostExpensive: GameHighlights['mostExpensive'] = null;
  let biggestSpender: GameHighlights['biggestSpender'] = null;
  let mostItems: GameHighlights['mostItems'] = null;
  for (const p of snap.players) {
    const spent = p.purchases.reduce((s, x) => s + x.price_cents, 0);
    if (spent > 0 && (!biggestSpender || spent > biggestSpender.spentCents)) biggestSpender = { playerName: p.name, spentCents: spent };
    if (p.purchases.length > 0 && (!mostItems || p.purchases.length > mostItems.count)) mostItems = { playerName: p.name, count: p.purchases.length };
    for (const x of p.purchases) {
      if (!mostExpensive || x.price_cents > mostExpensive.priceCents) {
        mostExpensive = { playerName: p.name, itemName: x.name, priceCents: x.price_cents };
      }
    }
  }
  return { mostExpensive, biggestSpender, mostItems };
}

export interface PodiumGroup {
  /** 1 = primer puesto, 2 = segundo… (los empatados comparten puesto y el siguiente es el inmediato: 1, 1, 2). */
  place: number;
  votes: number;
  players: Player[];
}

/**
 * Podio de la votación de la galería: agrupa por número de votos (de más a menos). Los empatados comparten escalón.
 * `podium` son los 3 primeros escalones con votos; `rest` el resto de jugadores (con o sin votos). Sin ningún voto no hay podio.
 */
export function computePodium(players: Player[], votes: Map<string, number>): { podium: PodiumGroup[]; rest: { player: Player; votes: number }[] } {
  const withVotes = players.map((player) => ({ player, votes: votes.get(player.id) ?? 0 })).sort((a, b) => b.votes - a.votes || a.player.sort_order - b.player.sort_order);
  const groups: PodiumGroup[] = [];
  for (const e of withVotes) {
    if (e.votes <= 0) continue;
    const last = groups[groups.length - 1];
    if (last && last.votes === e.votes) last.players.push(e.player);
    else groups.push({ place: groups.length + 1, votes: e.votes, players: [e.player] });
  }
  const podium = groups.slice(0, 3);
  const onPodium = new Set(podium.flatMap((g) => g.players.map((p) => p.id)));
  return { podium, rest: withVotes.filter((e) => !onPodium.has(e.player.id)) };
}

export interface PlayerAward {
  id: 'shark' | 'spender' | 'saver' | 'hothead' | 'peacemaker' | 'unlucky';
  emoji: string;
  title: string;
  /** Qué se ha medido, para mostrarlo junto al título («5 elementos»). */
  detail: string;
  /** Jugadores que lo comparten (empate = todos). */
  players: Player[];
}

/**
 * «Premios» divertidos a partir de las estadísticas finales. Solo describen lo ocurrido (no afectan a la clasificación ni a nada).
 * Cada premio exige un mínimo para no premiar el cero, y los empates lo comparten.
 */
export function computeAwards(players: Player[], stats: PlayerStat[] | undefined): PlayerAward[] {
  if (!stats || stats.length === 0) return [];
  const rows = players.flatMap((player) => {
    const st = stats.find((x) => x.player_id === player.id);
    return st ? [{ player, st }] : [];
  });
  const out: PlayerAward[] = [];
  const pick = (id: PlayerAward['id'], emoji: string, title: string, value: (r: (typeof rows)[number]) => number, min: number, detail: (v: number) => string) => {
    let best = -Infinity;
    for (const r of rows) best = Math.max(best, value(r));
    if (!(best >= min)) return;
    out.push({ id, emoji, title, detail: detail(best), players: rows.filter((r) => value(r) === best).map((r) => r.player) });
  };
  pick('shark', '🦈', 'El tiburón', (r) => r.st.wins, 1, (v) => `${v} ${v === 1 ? 'elemento' : 'elementos'}`);
  pick('spender', '💸', 'El derrochador', (r) => r.st.spent_cents, 1, (v) => formatOhros(v));
  pick('saver', '🐜', 'El ahorrador', (r) => r.player.balance_cents, 1, (v) => `${formatOhros(v)} sin gastar`);
  pick('hothead', '🔥', 'El pujón', (r) => r.st.bids_count, 3, (v) => `${v} pujas`);
  pick('peacemaker', '🕊️', 'El pacifista', (r) => r.st.yields_count, 1, (v) => `cedió ${v} ${v === 1 ? 'vez' : 'veces'}`);
  pick('unlucky', '😅', 'El gafe', (r) => r.st.auctions_bid - r.st.wins, 2, (v) => `${v} subastas perdidas`);
  return out;
}
