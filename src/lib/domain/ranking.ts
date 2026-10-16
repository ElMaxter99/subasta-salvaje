import type { Player, PublicSnapshot, RankingRule } from './types';

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
