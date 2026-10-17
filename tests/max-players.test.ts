import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_PLAYERS } from '@/lib/domain/limits';
import { createGame, getHostState } from '@/lib/services/game-service';
import { joinGame } from '@/lib/services/play-service';
import { act, makeCtx, newHost, type TestCtx } from './helpers';

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await makeCtx();
});
afterAll(async () => {
  await ctx.db.close();
});

const names = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `J${i + 1}` }));

describe('máximo de jugadores por partida', () => {
  it('el tope de la aplicación en SQL coincide con el de TypeScript (10)', async () => {
    expect(await ctx.db.pg.query<{ c: number }>('select ss_max_players_cap() as c').then((r) => r.rows[0]!.c)).toBe(MAX_PLAYERS);
    expect(MAX_PLAYERS).toBe(10);
  });

  it('por defecto el máximo es 10 y no se puede crear una partida con más', async () => {
    const host = newHost();
    const { room_code } = await createGame(ctx, host, { name: 'Defecto', integer_bids: false, players: names(10) });
    expect((await getHostState(ctx, room_code, host)).game.max_players).toBe(10);
    await expect(createGame(ctx, host, { name: 'Once', integer_bids: false, players: names(11) })).rejects.toThrow();
    await expect(createGame(ctx, host, { name: 'Tope', integer_bids: false, max_players: 11, players: [] })).rejects.toThrow();
    await expect(ctx.db.rpc('ss_create_game', { host_id: host, name: 'Directo SQL', max_players: 11, players: [], items: [{ name: 'x' }] })).rejects.toThrow(); // también sin pasar por Zod
  });

  it('el anfitrión puede fijar un máximo menor y la lista inicial debe caber', async () => {
    const host = newHost();
    const { room_code } = await createGame(ctx, host, { name: 'Cuatro', integer_bids: false, max_players: 4, players: names(3) });
    expect((await getHostState(ctx, room_code, host)).game.max_players).toBe(4);
    await act(ctx, room_code, host, { type: 'player.add', name: 'Cuarto' });
    await expect(act(ctx, room_code, host, { type: 'player.add', name: 'Quinto' })).rejects.toThrow(/máximo de jugadores/);
    await expect(createGame(ctx, host, { name: 'No cabe', integer_bids: false, max_players: 2, players: names(3) })).rejects.toThrow();
  });

  it('quien tenga el código no puede unirse por encima del máximo (modo móviles)', async () => {
    const host = newHost();
    const { room_code } = await createGame(ctx, host, { name: 'Móviles', play_mode: 'mobile', integer_bids: false, max_players: 3, players: names(2) });
    await joinGame(ctx, room_code, { name: 'Tercero' });
    await expect(joinGame(ctx, room_code, { name: 'Cuarto' })).rejects.toThrow(/máximo de jugadores/);
    expect((await getHostState(ctx, room_code, host)).players).toHaveLength(3);
  });

  it('cambiar el máximo desde las reglas: no por debajo de los que hay ni por encima de 10', async () => {
    const host = newHost();
    const { room_code } = await createGame(ctx, host, { name: 'Reglas', integer_bids: false, players: names(5) });
    await expect(act(ctx, room_code, host, { type: 'game.set_rules', max_players: 4 })).rejects.toThrow(/menor que los jugadores/);
    await expect(act(ctx, room_code, host, { type: 'game.set_rules', max_players: 11 })).rejects.toThrow();
    await expect(ctx.db.rpc('ss_set_game_rules', { room_code, host_id: host, max_players: 11 })).rejects.toThrow(); // SQL también
    const r = await act(ctx, room_code, host, { type: 'game.set_rules', max_players: 6 });
    expect(r.snapshot.game.max_players).toBe(6);
  });
});
