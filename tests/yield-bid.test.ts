import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getHostState, getPublicState } from '@/lib/services/game-service';
import { joinGame, playerBid, yieldBid } from '@/lib/services/play-service';
import { act, ensureInitialImages, key, makeCtx, newHost, playerByName, type TestCtx } from './helpers';

let ctx: TestCtx;
beforeAll(async () => { ctx = await makeCtx(); });
afterAll(async () => { await ctx.db.close(); });

/** Partida en modo móviles con Ana, Beto y Carla conectados y una subasta abierta. */
async function setup(extra: Record<string, unknown> = {}) {
  const host = newHost();
  const { createGame } = await import('@/lib/services/game-service');
  const { room_code: room } = await createGame(ctx, host, {
    name: 'Ceder', play_mode: 'mobile', initial_budget_cents: 2000, players: [{ name: 'Ana' }, { name: 'Beto' }, { name: 'Carla' }],
    items: [1, 2, 3].map((n) => ({ name: `Elemento ${n}`, description: '' })),
  });
  await ensureInitialImages(ctx, room, host);
  const s0 = await getHostState(ctx, room, host);
  const tokens: Record<string, string> = {};
  for (const n of ['Ana', 'Beto', 'Carla']) tokens[n] = (await joinGame(ctx, room, { player_id: playerByName(s0, n).id })).token;
  await act(ctx, room, host, { type: 'game.start' });
  if (extra.auto_award) await act(ctx, room, host, { type: 'game.set_auto_award', enabled: true, seconds: 30 });
  const s1 = await getHostState(ctx, room, host);
  const a = await act(ctx, room, host, { type: 'auction.announce', item_id: s1.items[0]!.id });
  const auction = a.snapshot.auction!.id;
  const bid = (who: string, cents: number) => playerBid(ctx, room, tokens[who], { auction_id: auction, amount_cents: cents, idempotency_key: key() });
  const yld = (who: string) => yieldBid(ctx, room, tokens[who], { auction_id: auction });
  return { host, room, auction, s0, bid, yld };
}

describe('ceder la puja', () => {
  it('quien cede aparece en la instantánea, no puede volver a pujar y es idempotente; el líder no puede cederla', async () => {
    const t = await setup();
    await t.bid('Ana', 100);
    await expect(t.yld('Ana')).rejects.toMatchObject({ code: 'yield_leader' });
    const r = await t.yld('Beto');
    expect(r.autoAwarded).toBe(false);
    await t.yld('Beto'); // repetir no falla
    const s = await getPublicState(ctx, t.room);
    expect(s.auction?.yielded).toEqual([playerByName(t.s0, 'Beto').id]);
    expect(s.auction?.all_yielded).toBe(false); // Carla sigue pudiendo pujar
    await expect(t.bid('Beto', 300)).rejects.toMatchObject({ code: 'already_yielded' });
    await t.bid('Carla', 200); // el resto sigue pujando
  });

  it('cuando ceden todos menos el líder: con adjudicación automática se adjudica al instante (cobro único); sin ella solo se avisa', async () => {
    const t = await setup({ auto_award: true });
    await t.bid('Ana', 300);
    await t.yld('Beto');
    const done = await t.yld('Carla');
    expect(done.autoAwarded).toBe(true);
    const s = await getHostState(ctx, t.room, t.host);
    expect(s.auction?.status).toBe('awarded');
    expect(playerByName(s, 'Ana').balance_cents).toBe(1700);
    expect(playerByName(s, 'Beto').balance_cents).toBe(2000);

    const u = await setup(); // sin adjudicación automática
    await u.bid('Ana', 300);
    await u.yld('Beto');
    await u.yld('Carla');
    const s2 = await getHostState(ctx, u.room, u.host);
    expect(s2.auction).toMatchObject({ status: 'open', all_yielded: true });
    expect(playerByName(s2, 'Ana').balance_cents).toBe(2000);
  });

  it('sin pujas y con la subasta automática, si todos ceden el elemento se da por perdido sin esperar al reloj', async () => {
    const t = await setup();
    await act(ctx, t.room, t.host, { type: 'game.set_auto_run', enabled: true, gap_seconds: 4, idle_seconds: 60, auto_award_seconds: 4 });
    await t.yld('Ana');
    await t.yld('Beto');
    const last = await t.yld('Carla');
    expect(last.autoAwarded).toBe(false);
    const s = await getHostState(ctx, t.room, t.host);
    expect(s.auction?.status ?? null).not.toBe('open');
    expect(s.items.filter((i) => i.status === 'lost')).toHaveLength(1);
  });

  it('errores: sin identificar, subasta ya cerrada y sobre cerrado', async () => {
    const t = await setup();
    await expect(yieldBid(ctx, t.room, null, { auction_id: t.auction })).rejects.toMatchObject({ code: 'not_player' });
    await expect(yieldBid(ctx, t.room, 'x'.repeat(30), { auction_id: t.auction })).rejects.toMatchObject({ code: 'not_player' });
    await expect(t.yld('Ana')).resolves.toBeTruthy();
    await t.bid('Beto', 100);
    await act(ctx, t.room, t.host, { type: 'auction.cancel', auction_id: t.auction });
    await expect(t.yld('Carla')).rejects.toMatchObject({ code: 'auction_closed' });
  });
});
