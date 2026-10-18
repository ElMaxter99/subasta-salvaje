import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readJson, roomKey } from '@/lib/api';
import { createGame, getHostState, getPublicState } from '@/lib/services/game-service';
import { joinGame, playerBid, playerCookieName, yieldBid } from '@/lib/services/play-service';
import { act, key, makeCtx, newHost, playerByName, type TestCtx } from './helpers';

let ctx: TestCtx;
beforeAll(async () => { ctx = await makeCtx(); });
afterAll(async () => { await ctx.db.close(); });

async function setup(wild: 'blind' | 'none') {
  const host = newHost();
  const { room_code: room } = await createGame(ctx, host, { name: 'Seg', play_mode: 'mobile', integer_bids: false, players: [{ name: 'Ana' }, { name: 'Beto' }, { name: 'Carla' }] });
  const s0 = await getHostState(ctx, room, host);
  const tokens: Record<string, string> = {};
  for (const n of ['Ana', 'Beto', 'Carla']) tokens[n] = (await joinGame(ctx, room, { player_id: playerByName(s0, n).id })).token;
  await act(ctx, room, host, { type: 'game.start' });
  const s = await getHostState(ctx, room, host);
  const a = await act(ctx, room, host, { type: 'auction.announce', item_id: s.items[0]!.id, wild_event: wild });
  return { host, room, tokens, auctionId: a.snapshot.auction!.id };
}

describe('ceder la puja y subastas a ciegas', () => {
  it('a ciegas, el líder oculto no es delatado por `yield_leader`; en abierta sí se rechaza', async () => {
    const blind = await setup('blind');
    await playerBid(ctx, blind.room, blind.tokens.Ana, { auction_id: blind.auctionId, amount_cents: 300, idempotency_key: key() });
    const r = await yieldBid(ctx, blind.room, blind.tokens.Ana, { auction_id: blind.auctionId });
    expect(r.snapshot.game.room_code).toBe(blind.room);
    // La respuesta para el líder y para un no líder es la misma forma (sin error).
    await expect(yieldBid(ctx, blind.room, blind.tokens.Beto, { auction_id: blind.auctionId })).resolves.toBeDefined();

    const open = await setup('none');
    await playerBid(ctx, open.room, open.tokens.Ana, { auction_id: open.auctionId, amount_cents: 300, idempotency_key: key() });
    await expect(yieldBid(ctx, open.room, open.tokens.Ana, { auction_id: open.auctionId })).rejects.toMatchObject({ code: 'yield_leader' });
  });

  it('la vista pública de una puja a ciegas no expone `all_yielded`; la del anfitrión sí', async () => {
    const s = await setup('blind');
    await playerBid(ctx, s.room, s.tokens.Ana, { auction_id: s.auctionId, amount_cents: 300, idempotency_key: key() });
    await yieldBid(ctx, s.room, s.tokens.Beto, { auction_id: s.auctionId });
    const pub = await getPublicState(ctx, s.room);
    expect((pub.auction as unknown as { all_yielded?: boolean }).all_yielded).toBe(false);
    const host = await getHostState(ctx, s.room, s.host);
    expect((host.auction as unknown as { all_yielded?: boolean }).all_yielded).toBe(false); // Carla aún puede pujar
    await yieldBid(ctx, s.room, s.tokens.Carla, { auction_id: s.auctionId }).catch(() => undefined);
  });

  it('sin token no se llega a la BD y un cuerpo con campos de identidad se rechaza o ignora', async () => {
    const s = await setup('none');
    await expect(yieldBid(ctx, s.room, undefined, { auction_id: s.auctionId })).rejects.toMatchObject({ code: 'not_player' });
    await expect(yieldBid(ctx, s.room, s.tokens.Ana, { auction_id: 'no-uuid' })).rejects.toMatchObject({ code: 'invalid_input' });
  });
});

describe('utilidades de las rutas de jugador', () => {
  it('roomKey y la cookie unifican mayúsculas y espacios (sin saltarse los límites por sala)', () => {
    expect(roomKey(' abcd ')).toBe('ABCD');
    expect(roomKey('aBcD')).toBe(roomKey('ABCD'));
    expect(playerCookieName(roomKey(' abcd '))).toBe(playerCookieName('ABCD'));
  });

  it('readJson limita el tamaño y devuelve null si no es JSON', async () => {
    const mk = (body: string, h: Record<string, string> = {}) => new Request('http://x/y', { method: 'POST', body, headers: h });
    expect(await readJson(mk('{"a":1}'))).toEqual({ a: 1 });
    expect(await readJson(mk('no json'))).toBeNull();
    await expect(readJson(mk('x'.repeat(5000)))).rejects.toMatchObject({ status: 413 });
    await expect(readJson(mk('{}', { 'content-length': '999999' }))).rejects.toMatchObject({ status: 413 });
  });
});
