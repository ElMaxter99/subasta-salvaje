import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { createGame, getHostState } from '@/lib/services/game-service';
import { importItemPhotos } from '@/lib/services/template-service';
import type { Transport } from '@/lib/security/safe-fetch';
import { makeCtx, newHost, type TestCtx } from './helpers';

let ctx: TestCtx;
let png: Buffer;
beforeAll(async () => {
  ctx = await makeCtx();
  png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#cc3333' } }).png().toBuffer();
});
afterAll(async () => {
  await ctx.db.close();
});

const ok = (bytes: Uint8Array, type = 'image/png'): Transport => async () => ({ status: 200, headers: { 'content-type': type }, body: (async function* () { yield bytes; })(), destroy: () => undefined });

describe('fotos de plantilla por URL', () => {
  it('pone la foto en el elemento correcto (por título), con repetidos por orden; los fallos no bloquean y se explican', async () => {
    const host = newHost();
    const { room_code } = await createGame(ctx, host, {
      name: 'Plantilla', players: [{ name: 'Ana' }, { name: 'Beto' }],
      items: [{ name: 'Volcán', description: '' }, { name: 'Muelle', description: '' }, { name: 'Volcán', description: 'otro' }],
    });
    const transport: Transport = async (u) => {
      if (u.pathname === '/rota.txt') return { status: 200, headers: { 'content-type': 'image/png' }, body: (async function* () { yield new Uint8Array([1, 2, 3]); })(), destroy: () => undefined }; // dice png pero no lo es
      if (u.pathname === '/404.png') return { status: 404, headers: {}, body: (async function* () { /* vacío */ })(), destroy: () => undefined };
      return ok(png)(u, { timeoutMs: 1 });
    };
    const r = await importItemPhotos(ctx, room_code, host, [
      { name: 'Volcán', url: 'https://x.com/v1.png' },
      { name: 'Volcán', url: 'https://x.com/v2.png' },
      { name: 'Muelle', url: 'https://x.com/rota.txt' },
      { name: 'Inexistente', url: 'https://x.com/a.png' },
      { name: 'Muelle', url: 'https://127.0.0.1/a.png' },
      { name: 'Muelle', url: 'https://x.com/404.png' },
    ], { transport });
    expect(r.imported).toBe(2);
    expect(r.failed.map((f) => f.name)).toEqual(expect.arrayContaining(['Muelle', 'Inexistente']));
    expect(r.failed).toHaveLength(4);
    expect(r.failed.find((f) => f.name === 'Inexistente')!.reason).toContain('no existe');
    const s = await getHostState(ctx, room_code, host);
    const volcanes = s.items.filter((i) => i.name === 'Volcán');
    expect(volcanes).toHaveLength(2);
    expect(volcanes.every((i) => Boolean(i.image_url || i.image_path))).toBe(true); // ambos con foto
    expect(s.items.find((i) => i.name === 'Muelle')!.image_path ?? null).toBeNull(); // el que falló, sin foto
  });

  it('otro anfitrión no puede importar fotos en una partida ajena', async () => {
    const host = newHost();
    const { room_code } = await createGame(ctx, host, { name: 'Ajena', players: [{ name: 'Ana' }, { name: 'Beto' }], items: [{ name: 'A', description: '' }] });
    await expect(importItemPhotos(ctx, room_code, newHost(), [{ name: 'A', url: 'https://x.com/a.png' }], { transport: ok(png) })).rejects.toMatchObject({ code: expect.stringMatching(/not_host|game_not_found/) });
  });
});
