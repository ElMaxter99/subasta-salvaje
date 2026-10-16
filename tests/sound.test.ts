import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGame, getHostState, getPublicState } from '@/lib/services/game-service';
import { act, makeCtx, newHost, type TestCtx } from './helpers';

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await makeCtx();
});
afterAll(async () => {
  await ctx.db.close();
});

describe('sonido de la partida (controlado por el anfitrión)', () => {
  it('por defecto efectos y música están activos; el anfitrión los apaga y la TV (vista pública) lo ve', async () => {
    const host = newHost();
    const { room_code } = await createGame(ctx, host, { name: 'Sonido', players: [{ name: 'Ana' }, { name: 'Beto' }] });
    let pub = await getPublicState(ctx, room_code);
    expect(pub.game).toMatchObject({ sound_enabled: true, music_enabled: true });
    await act(ctx, room_code, host, { type: 'game.set_sound', sound_enabled: false });
    pub = await getPublicState(ctx, room_code);
    expect(pub.game).toMatchObject({ sound_enabled: false, music_enabled: true });
    await act(ctx, room_code, host, { type: 'game.set_sound', music_enabled: false });
    expect((await getHostState(ctx, room_code, host)).game).toMatchObject({ sound_enabled: false, music_enabled: false });
    await act(ctx, room_code, host, { type: 'game.set_sound', sound_enabled: true, music_enabled: true });
    expect((await getPublicState(ctx, room_code)).game).toMatchObject({ sound_enabled: true, music_enabled: true });
  });

  it('solo el anfitrión de la partida puede cambiarlo', async () => {
    const host = newHost();
    const { room_code } = await createGame(ctx, host, { name: 'Ajeno', players: [{ name: 'Ana' }, { name: 'Beto' }] });
    await expect(act(ctx, room_code, newHost(), { type: 'game.set_sound', sound_enabled: false })).rejects.toMatchObject({ code: expect.stringMatching(/not_host|game_not_found/) });
  });
});
