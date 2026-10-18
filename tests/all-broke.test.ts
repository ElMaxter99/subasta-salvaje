import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { allPlayersBroke } from '@/lib/domain/broke';
import { autoAwardTick, createGame, getHostState } from '@/lib/services/game-service';
import { joinGame } from '@/lib/services/play-service';
import { act, ensureInitialImages, key, makeCtx, newHost, playerByName, type TestCtx } from './helpers';

let ctx: TestCtx;
beforeAll(async () => { ctx = await makeCtx(); });
afterAll(async () => { await ctx.db.close(); });

const back = (gameId: string, sql: string) => ctx.db.pg.query(sql, [gameId]);
async function game(host: string, extra: Record<string, unknown> = {}) {
  const { room_code } = await createGame(ctx, host, {
    name: 'Sin saldo', initial_budget_cents: 100, min_bid_cents: 100, players: [{ name: 'Ana' }, { name: 'Beto' }],
    items: [1, 2, 3, 4].map((n) => ({ name: `Elemento ${n}`, description: '' })), ...extra,
  });
  await ensureInitialImages(ctx, room_code, host);
  return room_code;
}
async function sell(room: string, host: string, player: string, cents = 100) {
  const s = await getHostState(ctx, room, host);
  const item = s.items.find((i) => i.status === 'available')!;
  const a = await act(ctx, room, host, { type: 'auction.announce', item_id: item.id });
  const pid = playerByName(s, player).id;
  await act(ctx, room, host, { type: 'auction.bid', auction_id: a.snapshot.auction!.id, player_id: pid, amount_cents: cents, idempotency_key: key() });
  return act(ctx, room, host, { type: 'auction.award', auction_id: a.snapshot.auction!.id, expected_winner_id: pid, expected_price_cents: cents, idempotency_key: key() });
}

describe('fin de partida cuando todos se quedan sin saldo', () => {
  it('con saldo en alguien la partida sigue; cuando nadie puede pujar ni el mínimo termina (tras la pausa) aunque queden rondas, con su motivo', async () => {
    const host = newHost();
    const room = await game(host);
    await act(ctx, room, host, { type: 'game.start' });
    const gid = (await getHostState(ctx, room, host)).game.id;
    await sell(room, host, 'Ana'); // Ana 0, Beto 100
    await back(gid, "update auctions set closed_at = now() - interval '20 seconds' where game_id = $1");
    await autoAwardTick(ctx, room);
    expect((await getHostState(ctx, room, host)).game.status).toBe('active');
    await sell(room, host, 'Beto'); // ya nadie tiene saldo; quedan 2 rondas
    let s = await getHostState(ctx, room, host);
    expect(allPlayersBroke(s)).toBe(true);
    await autoAwardTick(ctx, room);
    expect((await getHostState(ctx, room, host)).game.status).toBe('active'); // aún se ve la última adjudicación (8 s)
    await back(gid, "update auctions set closed_at = now() - interval '20 seconds' where game_id = $1");
    await autoAwardTick(ctx, room);
    s = await getHostState(ctx, room, host);
    expect(s.game.status).toBe('finished');
    expect(s.game.finish_reason).toBe('all_broke');
    expect(s.game.rounds_completed).toBeLessThan(s.game.total_rounds);
    expect(s.events.some((e) => e.event_type === 'game_finish_all_broke')).toBe(true);
    // Reiniciar la partida quita el motivo
    await act(ctx, room, host, { type: 'game.reset' });
    const after = await getHostState(ctx, room, host);
    expect(after.game.status).toBe('lobby');
    expect(after.game.finish_reason ?? null).toBeNull();
  });

  it('el anfitrión no puede anunciar otro elemento si todos están sin saldo: la partida termina', async () => {
    const host = newHost();
    const room = await game(host, { initial_budget_cents: 0 });
    await act(ctx, room, host, { type: 'game.start' });
    const s = await getHostState(ctx, room, host);
    const r = await act(ctx, room, host, { type: 'auction.announce', item_id: s.items[0]!.id });
    expect(r.result).toMatchObject({ finished: true, reason: 'all_broke' });
    expect((await getHostState(ctx, room, host)).game).toMatchObject({ status: 'finished', finish_reason: 'all_broke' });
  });

  it('en modo móviles solo cuentan los jugadores que han entrado: quien nunca entró no impide el final', async () => {
    const host = newHost();
    const room = await game(host, { play_mode: 'mobile', players: [{ name: 'Ana' }, { name: 'Beto' }, { name: 'Carla' }] });
    const s0 = await getHostState(ctx, room, host);
    await joinGame(ctx, room, { player_id: playerByName(s0, 'Ana').id });
    await joinGame(ctx, room, { player_id: playerByName(s0, 'Beto').id });
    await act(ctx, room, host, { type: 'game.start' });
    const gid = s0.game.id;
    await sell(room, host, 'Ana');
    await sell(room, host, 'Beto'); // Carla (sin entrar) conserva su saldo
    await back(gid, "update auctions set closed_at = now() - interval '20 seconds' where game_id = $1");
    await autoAwardTick(ctx, room);
    expect((await getHostState(ctx, room, host)).game).toMatchObject({ status: 'finished', finish_reason: 'all_broke' });
  });

  it('allPlayersBroke: sin jugadores o con alguien con saldo no termina', () => {
    const game = { play_mode: 'host', min_bid_cents: 100 } as never;
    expect(allPlayersBroke({ game, players: [] })).toBe(false);
    expect(allPlayersBroke({ game, players: [{ balance_cents: 50 }, { balance_cents: 100 }] as never })).toBe(false);
    expect(allPlayersBroke({ game, players: [{ balance_cents: 50 }, { balance_cents: 0 }] as never })).toBe(true);
  });
});
