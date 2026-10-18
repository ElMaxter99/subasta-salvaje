import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { autoAwardTick, createGame, getHostState, getPublicState } from '@/lib/services/game-service';
import { act, key, makeCtx, newHost, playerByName, type TestCtx } from './helpers';

let ctx: TestCtx;
beforeAll(async () => { ctx = await makeCtx(); });
afterAll(async () => { await ctx.db.close(); });

async function setup(opts: { auto?: boolean; wild?: 'flash' } = {}) {
  const host = newHost();
  const { room_code: room } = await createGame(ctx, host, {
    name: 'Gracia', initial_budget_cents: 5000, play_mode: 'host', players: ['Ana', 'Beto', 'Carla'].map((name) => ({ name })),
    items: [1, 2].map((n) => ({ name: `Elemento ${n}`, description: '' })),
  });
  await act(ctx, room, host, { type: 'game.start' });
  if (opts.auto !== false) await act(ctx, room, host, { type: 'game.set_auto_award', enabled: true, seconds: 10 });
  const s = await getHostState(ctx, room, host);
  const a = await act(ctx, room, host, { type: 'auction.announce', item_id: s.items[0]!.id, ...(opts.wild ? { wild_event: opts.wild } : {}) });
  const auctionId = a.snapshot.auction!.id;
  const bid = (name: string, cents: number) => act(ctx, room, host, { type: 'auction.bid', auction_id: auctionId, player_id: playerByName(s, name).id, amount_cents: cents, idempotency_key: key() });
  const backdate = async (secs: number) => {
    await ctx.db.pg.query('update bids set created_at = now() - make_interval(secs => $2) where auction_id = $1', [auctionId, secs]);
    await ctx.db.pg.query("update auctions set timer_reset_at = '-infinity' where id = $1", [auctionId]);
  };
  const grace = (extra: Record<string, unknown> = {}) => act(ctx, room, host, { type: 'auction.grace', auction_id: auctionId, ...extra });
  return { host, room, s, auctionId, bid, backdate, grace };
}

describe('pausa de gracia', () => {
  it('aplaza la adjudicación automática N s, la anota en el registro y no toca saldos', async () => {
    const t = await setup();
    await t.bid('Ana', 300);
    await t.backdate(9); // faltaría 1 s
    const before = (await getHostState(ctx, t.room, t.host)).auction!;
    const r = await t.grace({ seconds: 10, player_id: playerByName(t.s, 'Beto').id });
    const after = r.snapshot.auction!;
    expect(new Date(after.auto_award_at!).getTime()).toBeGreaterThan(new Date(before.auto_award_at!).getTime() + 8000);
    expect(after.grace).toMatchObject({ uses: 1, max: 3, player_id: playerByName(t.s, 'Beto').id });
    expect((await getPublicState(ctx, t.room)).auction!.grace?.uses).toBe(1);
    expect(await autoAwardTick(ctx, t.room)).toBe(false); // sin gracia habría vencido ya
    expect(r.snapshot.players.map((p) => p.balance_cents)).toEqual([5000, 5000, 5000]);
    const ev = await ctx.db.pg.query<{ payload: { seconds: number; uses: number } }>("select payload from game_events where event_type = 'auction_grace'");
    expect(ev.rows[0]!.payload).toMatchObject({ seconds: 10, uses: 1 });
    // Pasada la gracia, vuelve a adjudicarse (y se cobra una sola vez)
    await t.backdate(3600);
    expect(await autoAwardTick(ctx, t.room)).toBe(true);
    expect(playerByName(await getHostState(ctx, t.room, t.host), 'Ana').balance_cents).toBe(4700);
  });

  it('vale también en relámpago y por defecto son 10 s', async () => {
    const t = await setup({ auto: false, wild: 'flash' });
    await t.bid('Ana', 300);
    await t.backdate(7);
    const r = await t.grace();
    const at = new Date(r.snapshot.auction!.auto_award_at!).getTime();
    expect(at - new Date(r.snapshot.server_time).getTime()).toBeGreaterThan(9000);
    expect(await autoAwardTick(ctx, t.room)).toBe(false);
  });

  it('límite de 3 usos por subasta, segundos acotados y solo con cuenta atrás y líder', async () => {
    const t = await setup();
    await expect(t.grace()).rejects.toMatchObject({ code: 'grace_not_applicable' }); // aún sin pujas
    await t.bid('Ana', 300);
    await expect(t.grace({ seconds: 31 })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.grace({ seconds: 0 })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.grace({ player_id: crypto.randomUUID() })).rejects.toMatchObject({ code: 'player_not_found' });
    for (let i = 0; i < 3; i++) await t.grace({ seconds: 5 });
    await expect(t.grace()).rejects.toMatchObject({ code: 'grace_limit' });
    await expect(act(ctx, t.room, newHost(), { type: 'auction.grace', auction_id: t.auctionId })).rejects.toMatchObject({ code: 'not_host' });
    const u = await setup({ auto: false }); // sin adjudicación automática ni relámpago no hay cuenta atrás que aplazar
    await u.bid('Ana', 300);
    await expect(u.grace()).rejects.toMatchObject({ code: 'grace_not_applicable' });
  });

  it('no aplica a una subasta cerrada', async () => {
    const t = await setup();
    await t.bid('Ana', 300);
    await act(ctx, t.room, t.host, { type: 'auction.close', auction_id: t.auctionId });
    await expect(t.grace()).rejects.toMatchObject({ code: 'auction_closed' });
  });
});
