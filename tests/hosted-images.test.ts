import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ImageGenerationProvider } from '@/lib/ai/types';

// Las imágenes alojadas en el repositorio de fotos NO se descargan al crear la partida: este espía lo comprueba y, al generar con IA,
// sirve los bytes de cada enlace.
const REPO = 'yo/fotos';
const HOSTED_HOUSE = `https://cdn.jsdelivr.net/gh/${REPO}@${'a'.repeat(40)}/plantillas/luna/scene-casa-aaaaaaaaaaaa.webp`;
const HOSTED_ITEM = `https://cdn.jsdelivr.net/gh/${REPO}@${'a'.repeat(40)}/plantillas/luna/item-rover-bbbbbbbbbbbb.webp`;
const OTHER = 'https://otro-servidor.com/foto.png';
const served = new Map<string, Uint8Array>();
const fetched: string[] = [];
vi.mock('@/lib/security/safe-fetch', async (orig) => ({
  ...(await orig<typeof import('@/lib/security/safe-fetch')>()),
  fetchImageBytes: vi.fn(async (url: string) => { fetched.push(url); const b = served.get(url); if (!b) throw new Error('404'); return b; }),
}));

import { createGame, getHostState, getPublicState } from '@/lib/services/game-service';
import { processImageJobs } from '@/lib/services/jobs-service';
import { importInitialImage, importItemPhotos } from '@/lib/services/template-service';
import { act, key, makeCtx, newHost, playerByName, type TestCtx } from './helpers';

let ctx: TestCtx;
const img = async (r: number, g: number, b: number) => new Uint8Array(await sharp({ create: { width: 64, height: 64, channels: 3, background: { r, g, b } } }).webp().toBuffer());
beforeAll(async () => {
  vi.stubEnv('GITHUB_ASSETS_REPO', REPO);
  vi.stubEnv('GITHUB_ASSETS_TOKEN', ['github', 'pat', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4'].join('_'));
  ctx = await makeCtx();
  served.set(HOSTED_HOUSE, await img(200, 100, 50));
  served.set(HOSTED_ITEM, await img(10, 200, 10));
  served.set(OTHER, new Uint8Array(await sharp({ create: { width: 64, height: 64, channels: 3, background: '#cc3333' } }).png().toBuffer()));
});
afterAll(async () => { vi.unstubAllEnvs(); await ctx.db.close(); });

describe('imágenes ya alojadas: se usan por enlace, sin descargarlas ni copiarlas', () => {
  it('foto de elemento e imagen inicial alojadas: cero descargas, cero archivos en el almacenamiento y la instantánea apunta al enlace', async () => {
    fetched.length = 0;
    const host = newHost();
    const { room_code } = await createGame(ctx, host, { name: 'Alojadas', players: [{ name: 'Ana' }, { name: 'Beto' }], items: [{ name: 'Rover', description: '' }, { name: 'Cráter', description: '' }] });
    const photos = await importItemPhotos(ctx, room_code, host, [{ name: 'Rover', url: HOSTED_ITEM }]);
    const initial = await importInitialImage(ctx, room_code, host, HOSTED_HOUSE);
    expect(photos).toEqual({ imported: 1, failed: [] });
    expect(initial).toEqual({ ok: true });
    expect(fetched).toEqual([]); // nada se descargó
    expect(ctx.storage.files.size).toBe(0); // nada se copió
    const s = await getHostState(ctx, room_code, host);
    expect(s.items.find((i) => i.name === 'Rover')!.image_url).toBe(HOSTED_ITEM);
    expect(playerByName(s, 'Ana').current_image!.url).toBe(HOSTED_HOUSE);
    expect(playerByName(s, 'Beto').current_image!.url).toBe(HOSTED_HOUSE);
    expect((await getPublicState(ctx, room_code)).players[0]!.current_image!.url).toBe(HOSTED_HOUSE);
    await act(ctx, room_code, host, { type: 'game.start' }); // con la imagen inicial alojada se puede empezar
  });

  it('las de otros servidores se siguen descargando y normalizando (no se enlaza un servidor cualquiera)', async () => {
    fetched.length = 0;
    const host = newHost();
    const { room_code } = await createGame(ctx, host, { name: 'Ajenas', players: [{ name: 'Ana' }], items: [{ name: 'Rover', description: '' }] });
    const r = await importItemPhotos(ctx, room_code, host, [{ name: 'Rover', url: OTHER }]);
    expect(r.imported).toBe(1);
    expect(fetched).toEqual([OTHER]);
    const item = (await getHostState(ctx, room_code, host)).items[0]!;
    expect(item.image_url).not.toBe(OTHER);
    expect(item.image_url).toContain('games'); // copia propia
  });

  it('al generar con IA se lee la imagen y la foto del elemento por enlace y SOLO el resultado se guarda en el almacenamiento', async () => {
    fetched.length = 0;
    const filesBefore = ctx.storage.files.size;
    const seen: { base: string; item?: string }[] = [];
    const provider: ImageGenerationProvider = {
      id: 'demo', capabilities: { edit: true },
      generateInitialScene: async () => { throw new Error('no aplica'); },
      generateItemImage: async () => { throw new Error('no aplica'); },
      editScene: async (i) => { seen.push({ base: Buffer.from(i.base.bytes).toString('hex'), item: i.itemImage ? Buffer.from(i.itemImage.bytes).toString('hex') : undefined }); return { bytes: await img(1, 2, 3), mime: 'image/webp', prompt: 'p', model: 'm' }; },
    };
    const host = newHost();
    const { room_code } = await createGame(ctx, host, { name: 'Fusión', players: [{ name: 'Ana' }, { name: 'Beto' }], items: [{ name: 'Rover', description: '' }] });
    await importItemPhotos(ctx, room_code, host, [{ name: 'Rover', url: HOSTED_ITEM }]);
    await importInitialImage(ctx, room_code, host, HOSTED_HOUSE);
    await act(ctx, room_code, host, { type: 'game.start' });
    const s = await getHostState(ctx, room_code, host);
    const ana = playerByName(s, 'Ana').id;
    const a = await act(ctx, room_code, host, { type: 'auction.announce', item_id: s.items[0]!.id });
    await act(ctx, room_code, host, { type: 'auction.bid', auction_id: a.snapshot.auction!.id, player_id: ana, amount_cents: 100, idempotency_key: key() });
    await act(ctx, room_code, host, { type: 'auction.award', auction_id: a.snapshot.auction!.id, expected_winner_id: ana, expected_price_cents: 100, idempotency_key: key() });
    await processImageJobs({ ...ctx, provider }, { gameId: s.game.id, maxJobs: 1 });
    expect(fetched.sort()).toEqual([HOSTED_HOUSE, HOSTED_ITEM].sort()); // se leyeron por enlace en el momento de generar
    expect(seen).toHaveLength(1);
    expect(seen[0]!.base).toBe(Buffer.from(served.get(HOSTED_HOUSE)!).toString('hex'));
    expect(seen[0]!.item).toBe(Buffer.from(served.get(HOSTED_ITEM)!).toString('hex'));
    expect(ctx.storage.files.size - filesBefore).toBe(1); // solo la imagen generada
    const after = await getHostState(ctx, room_code, host);
    const versions = after.versions.filter((v) => v.player_id === ana);
    expect(versions.map((v) => v.origin)).toEqual(['uploaded', 'edit']);
    expect(versions[0]!.storage_path).toBe(HOSTED_HOUSE);
    expect(versions[1]!.storage_path).toMatch(/^games\//);
  });
});
