import sharp, { type Sharp } from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ImageGenerationProvider } from '@/lib/ai/types';
import { createGame, getHostState, uploadInitialImageForAll } from '@/lib/services/game-service';
import { processImageJobs } from '@/lib/services/jobs-service';
import { act, key, makeCtx, newHost, playerByName, type TestCtx } from './helpers';

let ctx: TestCtx;
beforeAll(async () => { ctx = await makeCtx(); });
afterAll(async () => { await ctx.db.close(); });

const gray = () => sharp({ create: { width: 640, height: 360, channels: 3, background: '#808080' } });
const withSquare = (img: Sharp, x: number, y: number, w: number, h: number, c: string) =>
  img.composite([{ input: { create: { width: w, height: h, channels: 3 as const, background: c } }, left: x, top: y }]).png().toBuffer().then((b) => new Uint8Array(b));

describe('una edición que «pierde» lo anterior no puede borrarlo de la casa', () => {
  it('2.ª compra: el modelo repinta la escena sin el objeto de la 1.ª, pero la imagen guardada lo conserva', async () => {
    let call = 0;
    const provider: ImageGenerationProvider = {
      id: 'demo', capabilities: { edit: true },
      generateInitialScene: async () => { throw new Error('no aplica'); },
      generateItemImage: async () => { throw new Error('no aplica'); },
      async editScene() {
        call++;
        // 1.ª: añade un cuadrado ROJO a la izquierda (zona de la 1.ª compra). 2.ª: repinta todo sin el rojo y añade uno AZUL al centro.
        const bytes = call === 1 ? await withSquare(gray(), 20, 250, 80, 80, '#ff0000') : await withSquare(gray(), 300, 230, 100, 100, '#0000ff');
        return { bytes, mime: 'image/png', prompt: `edit ${call}`, model: 'modelo-de-prueba' };
      },
    };
    const host = newHost();
    const { room_code } = await createGame(ctx, host, { name: 'Guardia', players: [{ name: 'Ana' }, { name: 'Beto' }] });
    await uploadInitialImageForAll(ctx, room_code, host, new Uint8Array(await gray().png().toBuffer()), { current: true, new: true });
    await act(ctx, room_code, host, { type: 'game.start' });
    const buy = async (idx: number) => {
      const s = await getHostState(ctx, room_code, host);
      const a = await act(ctx, room_code, host, { type: 'auction.announce', item_id: s.items.filter((i) => i.status === 'available')[idx]!.id });
      const pid = playerByName(s, 'Ana').id;
      await act(ctx, room_code, host, { type: 'auction.bid', auction_id: a.snapshot.auction!.id, player_id: pid, amount_cents: 100, idempotency_key: key() });
      await act(ctx, room_code, host, { type: 'auction.award', auction_id: a.snapshot.auction!.id, expected_winner_id: pid, expected_price_cents: 100, idempotency_key: key() });
    };
    await buy(0);
    await buy(0);
    const gameId = (await getHostState(ctx, room_code, host)).game.id;
    for (let i = 0; i < 2; i++) await processImageJobs({ ...ctx, provider }, { gameId, maxJobs: 1 });
    const s = await getHostState(ctx, room_code, host);
    const mine = s.versions.filter((v) => v.player_id === playerByName(s, 'Ana').id);
    expect(mine.map((v) => v.origin)).toEqual(['uploaded', 'edit', 'edit']);
    expect(mine[2]!.parent_version_id).toBe(mine[1]!.id);
    expect(mine[2]!.prompt_used).toContain('guardia de zona');
    const final = ctx.storage.files.get(mine[2]!.storage_path!)!;
    const { data, info } = await sharp(Buffer.from(final.bytes)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const at = (x: number, y: number) => [0, 1, 2].map((k) => data[(y * info.width + x) * 3 + k]!);
    const [r1, g1] = at(60, 290); // el objeto de la 1.ª compra sigue ahí (rojo)
    expect(r1).toBeGreaterThan(200);
    expect(g1).toBeLessThan(60);
    const [, , b2] = at(350, 280); // y el de la 2.ª también (azul)
    expect(b2).toBeGreaterThan(200);
  });
});
