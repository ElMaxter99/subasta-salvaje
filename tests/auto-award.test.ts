import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { autoAwardTick, createGame, getHostState, getPublicState } from '@/lib/services/game-service';
import { joinGame, playerBidResult } from '@/lib/services/play-service';
import { act, key, makeCtx, newHost, playerByName, type TestCtx } from './helpers';

let ctx: TestCtx;
beforeAll(async () => { ctx = await makeCtx(); });
afterAll(async () => { await ctx.db.close(); });

async function setup(opts: { auto?: boolean; seconds?: number; budget?: number; mode?: 'host' | 'mobile' } = {}) {
  const host = newHost();
  const { room_code: room } = await createGame(ctx, host, {
    name: 'Auto', initial_budget_cents: opts.budget ?? 2000, play_mode: opts.mode ?? 'host',
    players: ['Ana', 'Beto', 'Carla'].map((name) => ({ name })),
  });
  await act(ctx, room, host, { type: 'game.start' });
  if (opts.auto !== false) await act(ctx, room, host, { type: 'game.set_auto_award', enabled: true, seconds: opts.seconds ?? 10 });
  const s = await getHostState(ctx, room, host);
  const a = await act(ctx, room, host, { type: 'auction.announce', item_id: s.items[0]!.id });
  return { host, room, s, auctionId: a.snapshot.auction!.id };
}
const bid = (host: string, room: string, auctionId: string, playerId: string, amount: number) =>
  act(ctx, room, host, { type: 'auction.bid', auction_id: auctionId, player_id: playerId, amount_cents: amount, idempotency_key: key() });
const backdate = async (auctionId: string, seconds: number) => {
  await ctx.db.pg.query('update bids set created_at = now() - make_interval(secs => $2) where auction_id = $1', [auctionId, seconds]);
  await ctx.db.pg.query("update auctions set timer_reset_at = '-infinity' where id = $1", [auctionId]);
};

describe('adjudicación automática', () => {
  it('está desactivada por defecto: nunca adjudica sola', async () => {
    const { host, room, s, auctionId } = await setup({ auto: false });
    await bid(host, room, auctionId, playerByName(s, 'Ana').id, 2000); // nadie puede superarlo, pero no está activada
    await backdate(auctionId, 3600);
    expect(await autoAwardTick(ctx, room)).toBe(false);
    expect((await getHostState(ctx, room, host)).auction!.status).toBe('open');
  });

  it('por tiempo: espera N segundos desde la última puja, cobra una sola vez y crea el trabajo de imagen', async () => {
    const { host, room, s, auctionId } = await setup({ seconds: 10 });
    const ana = playerByName(s, 'Ana').id;
    await bid(host, room, auctionId, ana, 300);
    const open = await getHostState(ctx, room, host);
    expect(open.auction!.auto_award_at).toBeTruthy();
    expect(new Date(open.auction!.auto_award_at!).getTime()).toBeGreaterThan(new Date(open.server_time).getTime());
    expect(await autoAwardTick(ctx, room)).toBe(false); // todavía no venció
    await backdate(auctionId, 11);
    const results = await Promise.all(Array.from({ length: 6 }, () => autoAwardTick(ctx, room)));
    expect(results.filter(Boolean)).toHaveLength(1); // concurrentes: sólo una adjudica
    const after = await getHostState(ctx, room, host);
    expect(after.auction!.status).toBe('awarded');
    expect(playerByName(after, 'Ana').balance_cents).toBe(1700);
    expect(after.stats.purchases_count).toBe(1);
    expect(after.jobs.filter((j) => j.kind === 'edit')).toHaveLength(1);
    expect(after.events.find((e) => e.event_type === 'auction_awarded')!.payload).toMatchObject({ source: 'auto' });
    expect(await autoAwardTick(ctx, room)).toBe(false);
    // Un «Adjudicar» manual posterior (con otra clave) no recobra
    const m = await act(ctx, room, host, { type: 'auction.award', auction_id: auctionId, expected_winner_id: ana, expected_price_cents: 300, idempotency_key: key() });
    expect(playerByName(m.snapshot, 'Ana').balance_cents).toBe(1700);
  });

  it('cada puja reinicia la cuenta atrás, y deshacer o reabrir también (no se adjudica al anterior por sorpresa)', async () => {
    const { host, room, s, auctionId } = await setup({ seconds: 10 });
    const ana = playerByName(s, 'Ana').id;
    const beto = playerByName(s, 'Beto').id;
    await bid(host, room, auctionId, ana, 300);
    const r = await bid(host, room, auctionId, beto, 500);
    await backdate(auctionId, 60);
    // Deshacer la última puja: la anterior es antigua, pero el reloj se reinicia
    await act(ctx, room, host, { type: 'auction.undo_bid', auction_id: auctionId, bid_id: r.snapshot.auction!.bids[0]!.id });
    expect(await autoAwardTick(ctx, room)).toBe(false);
    expect((await getHostState(ctx, room, host)).auction!.current_bidder_id).toBe(ana);
    // Cerrar y reabrir también reinicia
    await backdate(auctionId, 60);
    await act(ctx, room, host, { type: 'auction.close', auction_id: auctionId });
    expect(await autoAwardTick(ctx, room)).toBe(false); // cerrada: la gestiona el anfitrión
    await act(ctx, room, host, { type: 'auction.reopen', auction_id: auctionId });
    expect(await autoAwardTick(ctx, room)).toBe(false);
  });

  it('instantánea: si nadie más puede superar la puja se adjudica al momento (también desde el móvil)', async () => {
    const { host, room, s, auctionId } = await setup({ budget: 500 });
    const ana = playerByName(s, 'Ana').id;
    await bid(host, room, auctionId, ana, 300);
    expect((await getHostState(ctx, room, host)).auction!.status).toBe('open'); // Beto y Carla aún pueden pujar 301..500
    const r = await bid(host, room, auctionId, playerByName(s, 'Beto').id, 500); // 500 = saldo de todos: nadie puede superarlo
    expect(r.result.auto_awarded).toBe(true);
    expect(r.snapshot.auction!.status).toBe('awarded');
    expect(playerByName(r.snapshot, 'Beto').balance_cents).toBe(0);
    expect(r.snapshot.stats.purchases_count).toBe(1);
    // La partida continúa con normalidad: se puede anunciar el siguiente elemento
    await act(ctx, room, host, { type: 'auction.announce', item_id: r.snapshot.items.find((i) => i.status === 'available')!.id });
  });

  it('instantánea desde un móvil: playerBidResult informa de la adjudicación automática', async () => {
    const { host, room, s, auctionId } = await setup({ budget: 400, mode: 'mobile' });
    const ana = await joinGame(ctx, room, { player_id: playerByName(s, 'Ana').id });
    const out = await playerBidResult(ctx, room, ana.token, { auction_id: auctionId, amount_cents: 400, idempotency_key: key() });
    expect(out.autoAwarded).toBe(true);
    expect(out.snapshot.auction!.status).toBe('awarded');
    expect(playerByName(await getHostState(ctx, room, host), 'Ana').balance_cents).toBe(0);
  });

  it('no adjudica con la partida en pausa ni si el temporizador está desactivado después', async () => {
    const { host, room, s, auctionId } = await setup({ seconds: 5 });
    await bid(host, room, auctionId, playerByName(s, 'Ana').id, 300);
    await backdate(auctionId, 60);
    await act(ctx, room, host, { type: 'game.pause' });
    expect(await autoAwardTick(ctx, room)).toBe(false);
    await act(ctx, room, host, { type: 'game.resume' });
    await act(ctx, room, host, { type: 'game.set_auto_award', enabled: false, seconds: 5 });
    expect(await autoAwardTick(ctx, room)).toBe(false);
    // Al reactivarla, la cuenta atrás parte de cero
    await act(ctx, room, host, { type: 'game.set_auto_award', enabled: true, seconds: 5 });
    expect(await autoAwardTick(ctx, room)).toBe(false);
  });

  it('la configuración la controla sólo el anfitrión y se valida; la vista pública expone la cuenta atrás', async () => {
    const { host, room, s, auctionId } = await setup({ seconds: 15 });
    await expect(act(ctx, room, newHost(), { type: 'game.set_auto_award', enabled: true, seconds: 5 })).rejects.toMatchObject({ code: 'not_host' });
    await expect(act(ctx, room, host, { type: 'game.set_auto_award', enabled: true, seconds: 1 })).rejects.toMatchObject({ code: 'invalid_input' });
    await bid(host, room, auctionId, playerByName(s, 'Ana').id, 300);
    const pub = await getPublicState(ctx, room);
    expect(pub.game).toMatchObject({ auto_award_enabled: true, auto_award_seconds: 15 });
    expect(pub.auction!.auto_award_at).toBeTruthy();
    expect(pub.server_time).toBeTruthy();
  });
});
