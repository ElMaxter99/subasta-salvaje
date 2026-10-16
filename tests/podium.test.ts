import { describe, expect, it } from 'vitest';
import { computePodium } from '@/lib/domain/ranking';
import type { Player } from '@/lib/domain/types';

const mk = (id: string, sort_order: number) => ({ id, name: id, sort_order }) as unknown as Player;
const players = ['a', 'b', 'c', 'd', 'e'].map((id, i) => mk(id, i));

describe('podio de la votación', () => {
  it('ordena por votos y deja el resto fuera del podio', () => {
    const { podium, rest } = computePodium(players, new Map([['a', 1], ['b', 4], ['c', 2], ['d', 1]]));
    expect(podium.map((g) => [g.place, g.votes, g.players.map((p) => p.id)])).toEqual([[1, 4, ['b']], [2, 2, ['c']], [3, 1, ['a', 'd']]]);
    expect(rest.map((r) => r.player.id)).toEqual(['e']);
  });
  it('los empates comparten escalón (1.º ex aequo, el siguiente es 2.º)', () => {
    const { podium } = computePodium(players, new Map([['a', 3], ['b', 3], ['c', 1]]));
    expect(podium.map((g) => [g.place, g.players.map((p) => p.id)])).toEqual([[1, ['a', 'b']], [2, ['c']]]);
  });
  it('sin votos no hay podio', () => {
    const { podium, rest } = computePodium(players, new Map());
    expect(podium).toEqual([]);
    expect(rest).toHaveLength(5);
  });
  it('un cuarto escalón queda fuera del podio', () => {
    const { podium, rest } = computePodium(players, new Map([['a', 4], ['b', 3], ['c', 2], ['d', 1]]));
    expect(podium).toHaveLength(3);
    expect(rest.map((r) => r.player.id)).toEqual(['d', 'e']);
  });
});
