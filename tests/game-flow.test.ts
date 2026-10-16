import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { computeRanking } from '@/lib/domain/ranking';
import { createGame, getHostState, getPublicState, listGames, performAction } from '@/lib/services/game-service';
import { act, key, makeCtx, newHost, playerByName, startedGame, type TestCtx } from './helpers';

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await makeCtx();
});
afterAll(async () => {
  await ctx.db.close();
});

async function openAuction(host: string, room: string, itemIndex = 0) {
  const snap = await getHostState(ctx, room, host);
  const item = snap.items.filter((i) => i.status === 'available')[itemIndex]!;
  const r = await act(ctx, room, host, { type: 'auction.announce', item_id: item.id });
  return { auctionId: r.snapshot.auction!.id, item, snap: r.snapshot };
}
const bid = (host: string, room: string, auctionId: string, playerId: string, amount: number, k = key()) =>
  act(ctx, room, host, { type: 'auction.bid', auction_id: auctionId, player_id: playerId, amount_cents: amount, idempotency_key: k });
const award = (host: string, room: string, auctionId: string, winner: string, price: number, k = key()) =>
  act(ctx, room, host, { type: 'auction.award', auction_id: auctionId, expected_winner_id: winner, expected_price_cents: price, idempotency_key: k });

describe('1-2. Crear partida, jugadores y presupuesto', () => {
  it('crea una partida con código de sala, catálogo de la temática y presupuesto por defecto', async () => {
    const host = newHost();
    const { room_code } = await createGame(ctx, host, { name: 'Mi noche', players: [{ name: 'Ana' }, { name: 'Beto' }] });
    expect(room_code).toMatch(/^[A-Z2-9]{6}$/);
    const snap = await getHostState(ctx, room_code, host);
    expect(snap.game.status).toBe('lobby');
    expect(snap.game.initial_budget_cents).toBe(2000);
    expect(snap.items.length).toBeGreaterThan(5);
    expect((await listGames(ctx, host)).map((g) => g.room_code)).toContain(room_code);
  });

  it('añade, edita, reordena y elimina jugadores; todos parten del presupuesto inicial', async () => {
    const host = newHost();
    const { room_code } = await createGame(ctx, host, { name: 'P', initial_budget_cents: 3500, players: [{ name: 'Ana' }] });
    await act(ctx, room_code, host, { type: 'player.add', name: 'Beto' });
    let s = (await act(ctx, room_code, host, { type: 'player.add', name: 'Carla', color: '#ff0000' })).snapshot;
    expect(s.players.map((p) => p.name)).toEqual(['Ana', 'Beto', 'Carla']);
    expect(s.players.every((p) => p.balance_cents === 3500)).toBe(true);
    s = (await act(ctx, room_code, host, { type: 'player.reorder', ordered_ids: [...s.players].reverse().map((p) => p.id) })).snapshot;
    expect(s.players.map((p) => p.name)).toEqual(['Carla', 'Beto', 'Ana']);
    s = (await act(ctx, room_code, host, { type: 'player.update', player_id: playerByName(s, 'Beto').id, name: 'Beatriz' })).snapshot;
    s = (await act(ctx, room_code, host, { type: 'player.remove', player_id: playerByName(s, 'Ana').id })).snapshot;
    expect(s.players.map((p) => p.name)).toEqual(['Carla', 'Beatriz']);
    s = (await act(ctx, room_code, host, { type: 'game.update', initial_budget_cents: 5000 })).snapshot;
    expect(s.players.every((p) => p.balance_cents === 5000)).toBe(true);
    await expect(act(ctx, room_code, host, { type: 'player.add', name: 'carla' })).rejects.toThrow(); // nombre repetido
  });

  it('no deja empezar con menos de 2 jugadores y bloquea cambios de jugadores tras empezar', async () => {
    const host = newHost();
    const { room_code } = await createGame(ctx, host, { name: 'P', players: [{ name: 'Solo' }] });
    await expect(act(ctx, room_code, host, { type: 'game.start' })).rejects.toMatchObject({ code: 'not_enough_players' });
    await act(ctx, room_code, host, { type: 'player.add', name: 'Otro' });
    await act(ctx, room_code, host, { type: 'game.start' });
    await expect(act(ctx, room_code, host, { type: 'player.add', name: 'Tarde' })).rejects.toMatchObject({ code: 'game_already_started' });
  });
});

describe('3-5. Pujas', () => {
  it('registra una puja válida y mantiene el historial', async () => {
    const host = newHost();
    const { room, snap } = await startedGame(ctx, host);
    const { auctionId } = await openAuction(host, room);
    await bid(host, room, auctionId, playerByName(snap, 'Ana').id, 300);
    const r = await bid(host, room, auctionId, playerByName(snap, 'Beto').id, 450);
    expect(r.snapshot.auction!.current_bid_cents).toBe(450);
    expect(r.snapshot.auction!.current_bidder_id).toBe(playerByName(snap, 'Beto').id);
    expect(r.snapshot.auction!.bids.map((b) => b.amount_cents)).toEqual([450, 300]);
  });

  it('rechaza pujas inválidas: importe no positivo, por debajo de la actual o del mínimo', async () => {
    const host = newHost();
    const { room, snap } = await startedGame(ctx, host);
    const { auctionId } = await openAuction(host, room);
    const ana = playerByName(snap, 'Ana').id;
    await expect(bid(host, room, auctionId, ana, 0)).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(bid(host, room, auctionId, ana, 50)).rejects.toMatchObject({ code: 'bid_below_minimum' });
    await bid(host, room, auctionId, ana, 500);
    await expect(bid(host, room, auctionId, playerByName(snap, 'Beto').id, 500)).rejects.toMatchObject({ code: 'bid_too_low' });
  });

  it('rechaza una puja superior al saldo del jugador (validado en servidor/BD)', async () => {
    const host = newHost();
    const { room, snap } = await startedGame(ctx, host, { budget: 1000 });
    const { auctionId } = await openAuction(host, room);
    const ana = playerByName(snap, 'Ana').id;
    await expect(bid(host, room, auctionId, ana, 1001)).rejects.toMatchObject({ code: 'insufficient_balance' });
    await expect(bid(host, room, auctionId, ana, 1000)).resolves.toBeTruthy();
  });

  it('el saldo ya gastado limita las pujas siguientes', async () => {
    const host = newHost();
    const { room, snap } = await startedGame(ctx, host, { budget: 1000 });
    const ana = playerByName(snap, 'Ana').id;
    const a1 = await openAuction(host, room, 0);
    await bid(host, room, a1.auctionId, ana, 700);
    await award(host, room, a1.auctionId, ana, 700);
    const a2 = await openAuction(host, room, 0);
    await expect(bid(host, room, a2.auctionId, ana, 301)).rejects.toMatchObject({ code: 'insufficient_balance' });
    await expect(bid(host, room, a2.auctionId, ana, 300)).resolves.toBeTruthy();
  });

  it('rechaza pujas después del cierre y en pausa; reabrir permite volver a pujar', async () => {
    const host = newHost();
    const { room, snap } = await startedGame(ctx, host);
    const { auctionId } = await openAuction(host, room);
    const ana = playerByName(snap, 'Ana').id;
    await bid(host, room, auctionId, ana, 200);
    await act(ctx, room, host, { type: 'auction.close', auction_id: auctionId });
    await expect(bid(host, room, auctionId, playerByName(snap, 'Beto').id, 300)).rejects.toMatchObject({ code: 'auction_closed' });
    await act(ctx, room, host, { type: 'auction.reopen', auction_id: auctionId });
    await act(ctx, room, host, { type: 'game.pause' });
    await expect(bid(host, room, auctionId, playerByName(snap, 'Beto').id, 300)).rejects.toMatchObject({ code: 'game_paused' });
    await act(ctx, room, host, { type: 'game.resume' });
    await expect(bid(host, room, auctionId, playerByName(snap, 'Beto').id, 300)).resolves.toBeTruthy();
  });

  it('una puja repetida con la misma clave de idempotencia no se duplica', async () => {
    const host = newHost();
    const { room, snap } = await startedGame(ctx, host);
    const { auctionId } = await openAuction(host, room);
    const k = key();
    const ana = playerByName(snap, 'Ana').id;
    await bid(host, room, auctionId, ana, 200, k);
    const again = await bid(host, room, auctionId, ana, 200, k);
    expect(again.snapshot.auction!.bids).toHaveLength(1);
  });

  it('deshacer la última puja restaura la anterior y es idempotente', async () => {
    const host = newHost();
    const { room, snap } = await startedGame(ctx, host);
    const { auctionId } = await openAuction(host, room);
    await bid(host, room, auctionId, playerByName(snap, 'Ana').id, 200);
    const r = await bid(host, room, auctionId, playerByName(snap, 'Beto').id, 400);
    const last = r.snapshot.auction!.bids[0]!;
    const u1 = await act(ctx, room, host, { type: 'auction.undo_bid', auction_id: auctionId, bid_id: last.id });
    expect(u1.snapshot.auction!.current_bid_cents).toBe(200);
    const u2 = await act(ctx, room, host, { type: 'auction.undo_bid', auction_id: auctionId, bid_id: last.id }); // doble clic
    expect(u2.snapshot.auction!.current_bid_cents).toBe(200);
    expect(u2.snapshot.auction!.bids).toHaveLength(1);
  });
});

describe('6-8. Adjudicación', () => {
  it('adjudica: cobra, registra compra e inventario y deja la subasta cerrada', async () => {
    const host = newHost();
    const { room, snap } = await startedGame(ctx, host);
    const { auctionId, item } = await openAuction(host, room);
    const beto = playerByName(snap, 'Beto').id;
    await bid(host, room, auctionId, beto, 750);
    const r = await award(host, room, auctionId, beto, 750);
    const b = playerByName(r.snapshot, 'Beto');
    expect(b.balance_cents).toBe(2000 - 750);
    expect(b.purchases.map((p) => p.name)).toEqual([item.name]);
    expect(r.snapshot.auction!.status).toBe('awarded');
    expect(r.snapshot.auction!.final_price_cents).toBe(750);
    expect(r.snapshot.items.find((i) => i.id === item.id)!.status).toBe('sold');
    expect(r.snapshot.stats.total_spent_cents).toBe(750);
    // el resto de saldos no cambia
    expect(playerByName(r.snapshot, 'Ana').balance_cents).toBe(2000);
  });

  it('no cobra dos veces ante dobles clics, recargas y reintentos (misma o distinta clave)', async () => {
    const host = newHost();
    const { room, snap } = await startedGame(ctx, host);
    const { auctionId } = await openAuction(host, room);
    const ana = playerByName(snap, 'Ana').id;
    await bid(host, room, auctionId, ana, 600);
    const k = key();
    await award(host, room, auctionId, ana, 600, k);
    await award(host, room, auctionId, ana, 600, k); // reintento HTTP: misma clave
    const r = await award(host, room, auctionId, ana, 600); // recarga: clave nueva
    expect(playerByName(r.snapshot, 'Ana').balance_cents).toBe(1400);
    expect(playerByName(r.snapshot, 'Ana').purchases).toHaveLength(1);
    expect(r.snapshot.jobs.filter((j) => j.kind === 'edit')).toHaveLength(1);
  });

  it('serializa adjudicaciones concurrentes: sólo una compra y un único cobro', async () => {
    const host = newHost();
    const { room, snap } = await startedGame(ctx, host);
    const { auctionId } = await openAuction(host, room);
    const carla = playerByName(snap, 'Carla').id;
    await bid(host, room, auctionId, carla, 900);
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => award(host, room, auctionId, carla, 900)));
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    const after = await getHostState(ctx, room, host);
    expect(playerByName(after, 'Carla').balance_cents).toBe(1100);
    expect(playerByName(after, 'Carla').purchases).toHaveLength(1);
    expect(after.stats.purchases_count).toBe(1);
  });

  it('rechaza adjudicar con datos obsoletos, sin pujas, o con otro ganador/precio', async () => {
    const host = newHost();
    const { room, snap } = await startedGame(ctx, host);
    const { auctionId } = await openAuction(host, room);
    const ana = playerByName(snap, 'Ana').id;
    const beto = playerByName(snap, 'Beto').id;
    await expect(award(host, room, auctionId, ana, 100)).rejects.toMatchObject({ code: 'no_bids' });
    await bid(host, room, auctionId, ana, 300);
    await bid(host, room, auctionId, beto, 400); // aparece una puja mientras se confirma
    await expect(award(host, room, auctionId, ana, 300)).rejects.toMatchObject({ code: 'stale_state' });
    await award(host, room, auctionId, beto, 400);
    await expect(award(host, room, auctionId, ana, 300)).rejects.toMatchObject({ code: 'auction_already_awarded' });
  });

  it('cancelar una subasta no descuenta dinero y devuelve el elemento al catálogo', async () => {
    const host = newHost();
    const { room, snap } = await startedGame(ctx, host);
    const { auctionId, item } = await openAuction(host, room);
    await bid(host, room, auctionId, playerByName(snap, 'Ana').id, 500);
    const r = await act(ctx, room, host, { type: 'auction.cancel', auction_id: auctionId });
    expect(r.snapshot.players.every((p) => p.balance_cents === 2000)).toBe(true);
    expect(r.snapshot.items.find((i) => i.id === item.id)!.status).toBe('available');
    expect(r.snapshot.stats.purchases_count).toBe(0);
    await expect(bid(host, room, auctionId, playerByName(snap, 'Ana').id, 600)).rejects.toMatchObject({ code: 'auction_closed' });
  });

  it('sólo se permite una subasta viva a la vez', async () => {
    const host = newHost();
    const { room } = await startedGame(ctx, host);
    await openAuction(host, room, 0);
    const snap = await getHostState(ctx, room, host);
    await expect(act(ctx, room, host, { type: 'auction.announce', item_id: snap.items.find((i) => i.status === 'available')!.id })).rejects.toMatchObject({ code: 'auction_in_progress' });
  });
});

describe('13. Autorización', () => {
  it('un usuario no propietario no puede leer la vista de anfitrión ni ejecutar acciones', async () => {
    const host = newHost();
    const intruder = newHost();
    const { room, snap } = await startedGame(ctx, host);
    await expect(getHostState(ctx, room, intruder)).rejects.toMatchObject({ code: 'not_host' });
    await expect(act(ctx, room, intruder, { type: 'auction.announce', item_id: snap.items[0]!.id })).rejects.toMatchObject({ code: 'not_host' });
    await expect(act(ctx, room, intruder, { type: 'game.finish' })).rejects.toMatchObject({ code: 'not_host' });
    // La vista pública sí es accesible pero no expone datos de anfitrión
    const pub = await getPublicState(ctx, room);
    expect(pub).not.toHaveProperty('host_id');
    expect(pub).not.toHaveProperty('jobs');
    expect(pub).not.toHaveProperty('events');
    expect(pub).not.toHaveProperty('versions');
    expect(JSON.stringify(pub)).not.toContain(host);
  });

  it('rechaza acciones mal formadas antes de llegar a la BD', async () => {
    const host = newHost();
    const { room } = await startedGame(ctx, host);
    await expect(performAction(ctx, room, host, { type: 'auction.bid', amount_cents: -5 })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(performAction(ctx, room, host, { type: 'hack' })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(getPublicState(ctx, "x'; drop table games;--")).rejects.toMatchObject({ code: 'game_not_found' });
  });

  it('no se puede operar sobre jugadores/subastas de otra partida', async () => {
    const host = newHost();
    const a = await startedGame(ctx, host);
    const b = await startedGame(ctx, host);
    const { auctionId } = await openAuction(host, a.room);
    await expect(bid(host, a.room, auctionId, playerByName(b.snap, 'Ana').id, 300)).rejects.toMatchObject({ code: 'player_not_found' });
    await expect(bid(host, b.room, auctionId, playerByName(b.snap, 'Ana').id, 300)).rejects.toMatchObject({ code: 'auction_not_found' });
  });
});

describe('14. Pantalla pública', () => {
  it('refleja puja, ganador y saldos tras cada cambio y publica versiones crecientes', async () => {
    const host = newHost();
    const { room, snap } = await startedGame(ctx, host);
    const before = await getPublicState(ctx, room);
    expect(before.auction).toBeNull();
    const { auctionId, item } = await openAuction(host, room);
    let pub = await getPublicState(ctx, room);
    expect(pub.auction?.item.name).toBe(item.name);
    const ana = playerByName(snap, 'Ana').id;
    await bid(host, room, auctionId, ana, 800);
    pub = await getPublicState(ctx, room);
    expect(pub.auction?.current_bid_cents).toBe(800);
    expect(pub.auction?.current_bidder_id).toBe(ana);
    await award(host, room, auctionId, ana, 800);
    pub = await getPublicState(ctx, room);
    expect(pub.last_award).toMatchObject({ player_id: ana, price_cents: 800, item_name: item.name });
    expect(playerByName(pub as never, 'Ana').balance_cents).toBe(1200);
    expect(pub.version).toBeGreaterThan(before.version);
    const mine = ctx.publisher.calls.filter((c) => c.room === room).map((c) => c.version);
    expect(mine).toEqual([...mine].sort((x, y) => x - y));
    expect(new Set(mine).size).toBe(mine.length);
  });
});

describe('15. Finalizar y resultados', () => {
  it('finaliza la partida, cancela la subasta viva, conserva saldos y calcula clasificación explícita', async () => {
    const host = newHost();
    const { room, snap } = await startedGame(ctx, host);
    await act(ctx, room, host, { type: 'game.update', ranking_rule: 'balance' });
    const a1 = await openAuction(host, room, 0);
    const ana = playerByName(snap, 'Ana').id;
    const beto = playerByName(snap, 'Beto').id;
    await bid(host, room, a1.auctionId, ana, 1500);
    await award(host, room, a1.auctionId, ana, 1500);
    const a2 = await openAuction(host, room, 0);
    await bid(host, room, a2.auctionId, beto, 100);
    const r = await act(ctx, room, host, { type: 'game.finish' });
    expect(r.snapshot.game.status).toBe('finished');
    expect(r.snapshot.auction).toBeNull();
    expect(r.snapshot.stats.cancelled_auctions).toBe(1);
    expect(playerByName(r.snapshot, 'Beto').balance_cents).toBe(2000);
    const ranking = computeRanking(r.snapshot.players, r.snapshot.game.ranking_rule)!;
    expect(ranking[ranking.length - 1]!.player.name).toBe('Ana');
    expect(ranking.filter((e) => e.rank === 1)).toHaveLength(3); // empate a 2000
    await expect(act(ctx, room, host, { type: 'game.finish' })).resolves.toBeTruthy(); // idempotente
    await expect(openAuction(host, room)).rejects.toMatchObject({ code: 'game_not_active' });
    const pub = await getPublicState(ctx, room);
    expect(pub.game.status).toBe('finished');
    expect(pub.stats.purchases_count).toBe(1);
  });

  it('votación: sólo con la regla activada y nunca altera saldos', async () => {
    const host = newHost();
    const { room, snap } = await startedGame(ctx, host);
    const ana = playerByName(snap, 'Ana').id;
    await expect(act(ctx, room, host, { type: 'votes.adjust', player_id: ana, delta: 1 })).rejects.toMatchObject({ code: 'voting_disabled' });
    await act(ctx, room, host, { type: 'game.update', ranking_rule: 'votes' });
    const r = await act(ctx, room, host, { type: 'votes.adjust', player_id: ana, delta: 1 });
    expect(playerByName(r.snapshot, 'Ana').votes).toBe(1);
    expect(playerByName(r.snapshot, 'Ana').balance_cents).toBe(2000);
  });
});
