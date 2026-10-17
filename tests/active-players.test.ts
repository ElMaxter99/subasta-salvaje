import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGame, getHostState, getPublicState } from '@/lib/services/game-service';
import { joinGame, leaveGame, playerBidResult } from '@/lib/services/play-service';
import { joinedPlayers } from '@/lib/domain/players';
import { act, key, makeCtx, newHost, playerByName, type TestCtx } from './helpers';

let ctx: TestCtx;
beforeAll(async () => { ctx = await makeCtx(); });
afterAll(async () => { await ctx.db.close(); });

/** 3 jugadores previstos (Ana 10 €, Beto 20 €, Carla 20 €) con adjudicación automática; de momento ninguno ha entrado. */
async function setup(mode: 'mobile' | 'host' = 'mobile') {
  const host = newHost();
  const { room_code: room } = await createGame(ctx, host, { name: 'Activos', play_mode: mode, initial_budget_cents: 2000, players: ['Ana', 'Beto', 'Carla'].map((name) => ({ name })) });
  const s0 = await getHostState(ctx, room, host);
  await ctx.db.pg.query("update players set balance_cents = 1000 where game_id = $1 and name = 'Ana'", [s0.game.id]);
  await act(ctx, room, host, { type: 'game.start' });
  await act(ctx, room, host, { type: 'game.set_auto_award', enabled: true, seconds: 10 });
  const s = await getHostState(ctx, room, host);
  return { host, room, s };
}
const announce = async (host: string, room: string, idx: number) => {
  const s = await getHostState(ctx, room, host);
  const a = await act(ctx, room, host, { type: 'auction.announce', item_id: s.items.filter((i) => i.status === 'available')[idx]!.id });
  return a.snapshot.auction!.id;
};

describe('jugadores activos en modo móviles', () => {
  it('quien no ha entrado no impide la adjudicación automática: con Ana (10 €) y Beto (20 €) dentro, Beto pujando 10 € se lo lleva al instante', async () => {
    const { host, room, s } = await setup();
    const ana = await joinGame(ctx, room, { player_id: playerByName(s, 'Ana').id });
    const beto = await joinGame(ctx, room, { player_id: playerByName(s, 'Beto').id });
    expect(ana.token).toBeTruthy();
    const auctionId = await announce(host, room, 0);
    // Carla (20 €) no ha entrado: no puede pujar, así que nadie puede superar 10 €
    const r = await playerBidResult(ctx, room, beto.token, { auction_id: auctionId, amount_cents: 1000, idempotency_key: key() });
    expect(r.autoAwarded).toBe(true);
    expect((await getPublicState(ctx, room)).last_award!.player_id).toBe(playerByName(s, 'Beto').id);
  });

  it('si el tercero SÍ está dentro, puede superar la puja y no se adjudica solo; si se sale, vuelve a contar como inactivo', async () => {
    const { host, room, s } = await setup();
    await joinGame(ctx, room, { player_id: playerByName(s, 'Ana').id });
    const beto = await joinGame(ctx, room, { player_id: playerByName(s, 'Beto').id });
    const carla = await joinGame(ctx, room, { player_id: playerByName(s, 'Carla').id });
    const a1 = await announce(host, room, 0);
    expect((await playerBidResult(ctx, room, beto.token, { auction_id: a1, amount_cents: 1000, idempotency_key: key() })).autoAwarded).toBe(false); // Carla (20 €) puede superarla
    await act(ctx, room, host, { type: 'auction.cancel', auction_id: a1 });
    await leaveGame(ctx, room, carla.token);
    const a2 = await announce(host, room, 0);
    expect((await playerBidResult(ctx, room, beto.token, { auction_id: a2, amount_cents: 1000, idempotency_key: key() })).autoAwarded).toBe(true); // ya no está dentro
  });

  it('en modo anfitrión siguen contando todos (nadie «entra» por móvil)', async () => {
    const { host, room } = await setup('host');
    const s = await getHostState(ctx, room, host);
    const auctionId = await announce(host, room, 0);
    const b = await act(ctx, room, host, { type: 'auction.bid', auction_id: auctionId, player_id: playerByName(s, 'Beto').id, amount_cents: 1000, idempotency_key: crypto.randomUUID() });
    expect(b.snapshot.last_award).toBeFalsy(); // Carla (20 €) podría superarla
  });
});

describe('resultado final: quien nunca entró no sale', () => {
  it('la instantánea marca `joined`: Carla nunca entró; Ana entró y se salió y sigue contando; en modo anfitrión todos', async () => {
    const { host, room, s } = await setup();
    const ana = await joinGame(ctx, room, { player_id: playerByName(s, 'Ana').id });
    await joinGame(ctx, room, { player_id: playerByName(s, 'Beto').id });
    await leaveGame(ctx, room, ana.token); // se sale: ya no está activa, pero sí ha jugado
    const pub = await getPublicState(ctx, room);
    const joined = (n: string) => pub.players.find((p) => p.name === n)!.joined;
    expect([joined('Ana'), joined('Beto'), joined('Carla')]).toEqual([true, true, false]);
    expect(joinedPlayers(pub.players).map((p) => p.name).sort()).toEqual(['Ana', 'Beto']);
    expect((await getHostState(ctx, room, host)).players.find((p) => p.name === 'Carla')!.joined).toBe(false);
    const h = await setup('host');
    expect((await getPublicState(ctx, h.room)).players.every((p) => p.joined)).toBe(true);
  });
});
