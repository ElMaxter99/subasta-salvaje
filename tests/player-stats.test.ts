import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { computeAwards } from '@/lib/domain/ranking';
import type { Player, PlayerStat } from '@/lib/domain/types';
import { createGame, getHostState, getPublicState } from '@/lib/services/game-service';
import { joinGame, playerBid, yieldBid } from '@/lib/services/play-service';
import { act, ensureInitialImages, key, makeCtx, newHost, playerByName, type TestCtx } from './helpers';

let ctx: TestCtx;
beforeAll(async () => { ctx = await makeCtx(); });
afterAll(async () => { await ctx.db.close(); });

describe('estadísticas por jugador al final', () => {
  it('solo aparecen con la partida terminada y cuentan pujas, ganados, gasto y cesiones', async () => {
    const host = newHost();
    const { room_code: room } = await createGame(ctx, host, {
      name: 'Stats', play_mode: 'mobile', initial_budget_cents: 2000, players: [{ name: 'Ana' }, { name: 'Beto' }],
      items: [1, 2].map((n) => ({ name: `Elemento ${n}`, description: '' })),
    });
    await ensureInitialImages(ctx, room, host);
    const s0 = await getHostState(ctx, room, host);
    const tok: Record<string, string> = {};
    for (const n of ['Ana', 'Beto']) tok[n] = (await joinGame(ctx, room, { player_id: playerByName(s0, n).id })).token;
    await act(ctx, room, host, { type: 'game.start' });
    expect((await getPublicState(ctx, room)).player_stats).toBeUndefined();

    const s1 = await getHostState(ctx, room, host);
    const a = await act(ctx, room, host, { type: 'auction.announce', item_id: s1.items[0]!.id });
    const auction = a.snapshot.auction!.id;
    const bid = (who: string, cents: number) => playerBid(ctx, room, tok[who], { auction_id: auction, amount_cents: cents, idempotency_key: key() });
    await bid('Ana', 100);
    await bid('Beto', 300);
    await yieldBid(ctx, room, tok.Ana, { auction_id: auction });
    await act(ctx, room, host, { type: 'auction.award', auction_id: auction, expected_winner_id: playerByName(s0, 'Beto').id, expected_price_cents: 300, idempotency_key: key() });
    await act(ctx, room, host, { type: 'game.finish' });

    const fin = await getPublicState(ctx, room);
    const stat = (name: string) => fin.player_stats!.find((x) => x.player_id === playerByName(s0, name).id)!;
    expect(stat('Beto')).toMatchObject({ bids_count: 1, max_bid_cents: 300, auctions_bid: 1, wins: 1, spent_cents: 300, yields_count: 0 });
    expect(stat('Ana')).toMatchObject({ bids_count: 1, max_bid_cents: 100, auctions_bid: 1, wins: 0, spent_cents: 0, yields_count: 1 });
  });

  it('premios: exigen un mínimo, comparten empates y no premian el cero', () => {
    const mk = (id: string, balance: number): Player => ({ id, name: id, color: '#fff', balance_cents: balance, purchases: [], sort_order: 0 }) as unknown as Player;
    const [a, b] = [mk('a', 500), mk('b', 500)];
    const st = (id: string, o: Partial<PlayerStat>): PlayerStat => ({ player_id: id, bids_count: 0, max_bid_cents: 0, auctions_bid: 0, wins: 0, spent_cents: 0, yields_count: 0, ...o });
    expect(computeAwards([a, b], [st('a', {}), st('b', {})]).map((x) => x.id)).toEqual(['saver']); // todo a cero salvo el saldo
    const awards = computeAwards([a, b], [st('a', { wins: 2, spent_cents: 400, bids_count: 5, auctions_bid: 4 }), st('b', { wins: 2, yields_count: 1, auctions_bid: 3 })]);
    const by = (id: string) => awards.find((x) => x.id === id)!;
    expect(by('shark').players.map((p) => p.id)).toEqual(['a', 'b']); // empate compartido
    expect(by('spender').players.map((p) => p.id)).toEqual(['a']);
    expect(by('hothead').players.map((p) => p.id)).toEqual(['a']);
    expect(by('peacemaker').players.map((p) => p.id)).toEqual(['b']);
    expect(by('unlucky').players.map((p) => p.id)).toEqual(['a']); // a: 4 subastas con pujas − 2 ganadas = 2 perdidas (b: 1, bajo el mínimo)
  });
});
