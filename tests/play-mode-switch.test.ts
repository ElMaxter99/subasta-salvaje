import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGame, getHostState, getPublicState } from '@/lib/services/game-service';
import { identifyPlayer, joinGame, playerBid, sendReaction, yieldBid } from '@/lib/services/play-service';
import { act, key, makeCtx, newHost, playerByName, type TestCtx } from './helpers';

let ctx: TestCtx;
beforeAll(async () => { ctx = await makeCtx(); });
afterAll(async () => { await ctx.db.close(); });

async function hostGame(host: string, extra: Record<string, unknown> = {}) {
  const { room_code } = await createGame(ctx, host, { name: 'Cambio de modo', play_mode: 'host', integer_bids: false, players: [{ name: 'Ana' }, { name: 'Beto' }, { name: 'Carla' }], ...extra });
  return room_code;
}
async function startAndAnnounce(host: string, room: string) {
  await act(ctx, room, host, { type: 'game.start' });
  const s = await getHostState(ctx, room, host);
  const a = await act(ctx, room, host, { type: 'auction.announce', item_id: s.items[0]!.id });
  return { auctionId: a.snapshot.auction!.id, s };
}

describe('cambio de modo a mitad de partida', () => {
  it('anfitrión → móviles con una subasta abierta: reclaman casilla, pujan y el anfitrión sigue registrando pujas', async () => {
    const host = newHost();
    const room = await hostGame(host);
    const { auctionId, s } = await startAndAnnounce(host, room);
    const ana = playerByName(s, 'Ana').id, beto = playerByName(s, 'Beto').id, carla = playerByName(s, 'Carla').id;

    // En modo anfitrión el móvil no puede nada
    await expect(joinGame(ctx, room, { player_id: ana })).rejects.toMatchObject({ code: 'mobile_disabled' });
    // El anfitrión puja por Beto (por voz)
    await act(ctx, room, host, { type: 'auction.bid', auction_id: auctionId, player_id: beto, amount_cents: 300, idempotency_key: key() });

    // «Abrir para móviles»: modo + entrada en una sola acción
    const r = await act(ctx, room, host, { type: 'game.set_access', play_mode: 'mobile', join_policy: 'open' });
    expect(r.snapshot.game).toMatchObject({ play_mode: 'mobile', join_policy: 'open', status: 'active' });
    expect(r.snapshot.auction!.id).toBe(auctionId);
    expect(r.snapshot.auction!.current_bid_cents).toBe(300); // la subasta abierta no se toca

    // Ana reclama su casilla y puja desde el móvil; Carla sigue sin móvil
    const j = await joinGame(ctx, room, { player_id: ana });
    expect(await identifyPlayer(ctx, room, j.token)).toBe(ana);
    const after = await playerBid(ctx, room, j.token, { auction_id: auctionId, amount_cents: 500, idempotency_key: key() });
    expect(after.auction!.current_bid_cents).toBe(500);
    expect(after.auction!.current_bidder_id).toBe(ana);
    // El anfitrión sigue pudiendo registrar la puja de quien no tiene móvil
    const h = await act(ctx, room, host, { type: 'auction.bid', auction_id: auctionId, player_id: carla, amount_cents: 700, idempotency_key: key() });
    expect(h.snapshot.auction!.current_bidder_id).toBe(carla);
    // Mitad de partida: nombres nuevos NO (solo sala de espera), pero sí casillas libres
    await expect(joinGame(ctx, room, { name: 'Tarde' })).rejects.toMatchObject({ code: 'game_already_started' });
    await expect(joinGame(ctx, room, { player_id: beto })).resolves.toMatchObject({ player_id: beto });
    const pub = await getPublicState(ctx, room);
    expect(pub.players.filter((p) => p.claimed).map((p) => p.name).sort()).toEqual(['Ana', 'Beto']);
  });

  it('móviles → anfitrión: los móviles ya conectados no pueden pujar, ceder ni reaccionar, y la partida sigue sin romperse', async () => {
    const host = newHost();
    const room = await hostGame(host, { play_mode: 'mobile' });
    const { auctionId, s } = await startAndAnnounce(host, room);
    const ana = await joinGame(ctx, room, { player_id: playerByName(s, 'Ana').id });
    await playerBid(ctx, room, ana.token, { auction_id: auctionId, amount_cents: 300, idempotency_key: key() });

    const r = await act(ctx, room, host, { type: 'game.set_access', play_mode: 'host' });
    expect(r.snapshot.game.play_mode).toBe('host');
    expect(r.snapshot.auction!.current_bid_cents).toBe(300);
    const bid = () => playerBid(ctx, room, ana.token, { auction_id: auctionId, amount_cents: 900, idempotency_key: key() });
    await expect(bid()).rejects.toMatchObject({ code: 'mobile_disabled' });
    await expect(yieldBid(ctx, room, ana.token, { auction_id: auctionId })).rejects.toMatchObject({ code: 'mobile_disabled' });
    await expect(sendReaction(ctx, room, ana.token, { emoji: '👏' })).rejects.toMatchObject({ code: 'mobile_disabled' });
    // La TV (instantánea pública) y el panel siguen funcionando, y el anfitrión sigue adjudicando
    expect((await getPublicState(ctx, room)).auction!.status).toBe('open');
    await act(ctx, room, host, { type: 'auction.bid', auction_id: auctionId, player_id: playerByName(s, 'Beto').id, amount_cents: 500, idempotency_key: key() });
    await act(ctx, room, host, { type: 'auction.close', auction_id: auctionId });
    const done = await act(ctx, room, host, { type: 'auction.award', auction_id: auctionId, expected_winner_id: playerByName(s, 'Beto').id, expected_price_cents: 500, idempotency_key: key() });
    expect(playerByName(done.snapshot, 'Beto').balance_cents).toBe(1500);
    // Volver a móviles: el token de Ana sigue valiendo (no pierde su casilla)
    await act(ctx, room, host, { type: 'game.set_access', play_mode: 'mobile' });
    expect(await identifyPlayer(ctx, room, ana.token)).toBe(playerByName(s, 'Ana').id);
    const s2 = await getHostState(ctx, room, host);
    const ann = await act(ctx, room, host, { type: 'auction.announce', item_id: s2.items[1]!.id });
    await expect(playerBid(ctx, room, ana.token, { auction_id: ann.snapshot.auction!.id, amount_cents: 200, idempotency_key: key() })).resolves.toBeTruthy();
  });

  it('política de entrada: cerrada (room_closed), solo mis jugadores (new_names_disabled) y máximo de jugadores en la sala de espera', async () => {
    const host = newHost();
    const room = await hostGame(host);
    await act(ctx, room, host, { type: 'game.set_access', play_mode: 'mobile', join_policy: 'slots' });
    await expect(joinGame(ctx, room, { name: 'Nuevo' })).rejects.toMatchObject({ code: 'new_names_disabled' });
    await act(ctx, room, host, { type: 'game.set_access', join_policy: 'closed' });
    const s = await getHostState(ctx, room, host);
    await expect(joinGame(ctx, room, { player_id: s.players[0]!.id })).rejects.toMatchObject({ code: 'room_closed' });
    await act(ctx, room, host, { type: 'game.set_access', join_policy: 'open' });
    await act(ctx, room, host, { type: 'game.set_rules', max_players: 3 });
    await expect(joinGame(ctx, room, { name: 'Cuarto' })).rejects.toMatchObject({ code: 'too_many_players' });
    await expect(joinGame(ctx, room, { player_id: s.players[0]!.id })).resolves.toBeTruthy();
  });

  it('«Cerrar la entrada» no expulsa a los móviles ya conectados', async () => {
    const host = newHost();
    const room = await hostGame(host, { play_mode: 'mobile' });
    const { auctionId, s } = await startAndAnnounce(host, room);
    const ana = await joinGame(ctx, room, { player_id: playerByName(s, 'Ana').id });
    await act(ctx, room, host, { type: 'game.set_access', join_policy: 'closed' });
    await expect(playerBid(ctx, room, ana.token, { auction_id: auctionId, amount_cents: 200, idempotency_key: key() })).resolves.toBeTruthy();
    await expect(joinGame(ctx, room, { player_id: playerByName(s, 'Beto').id })).rejects.toMatchObject({ code: 'room_closed' });
  });

  it('game.set_access es atómico, solo del anfitrión, y no se admite en una partida terminada', async () => {
    const host = newHost();
    const room = await hostGame(host);
    await expect(act(ctx, room, newHost(), { type: 'game.set_access', play_mode: 'mobile' })).rejects.toMatchObject({ code: 'not_host' });
    await expect(act(ctx, room, host, { type: 'game.set_access', play_mode: 'mobile', join_policy: 'cualquiera' })).rejects.toMatchObject({ code: 'invalid_input' });
    expect((await getHostState(ctx, room, host)).game.play_mode).toBe('host'); // nada a medias
    await act(ctx, room, host, { type: 'game.start' });
    await act(ctx, room, host, { type: 'game.finish' });
    await expect(act(ctx, room, host, { type: 'game.set_access', play_mode: 'mobile' })).rejects.toMatchObject({ code: 'game_finished' });
  });

  it('limitación documentada: con adjudicación automática, en modo móviles quien no tiene móvil conectado no cuenta como «puede superar»', async () => {
    const host = newHost();
    const room = await hostGame(host);
    await act(ctx, room, host, { type: 'game.set_auto_award', enabled: true, seconds: 20 });
    const { auctionId, s } = await startAndAnnounce(host, room);
    await act(ctx, room, host, { type: 'game.set_access', play_mode: 'mobile', join_policy: 'open' });
    const r = await act(ctx, room, host, { type: 'auction.bid', auction_id: auctionId, player_id: playerByName(s, 'Ana').id, amount_cents: 300, idempotency_key: key() });
    // Nadie tiene móvil conectado: se adjudica al instante (comportamiento existente del modo móviles; la tarjeta del panel lo avisa).
    expect((r.result as { auto_awarded?: boolean }).auto_awarded).toBe(true);
  });
});
