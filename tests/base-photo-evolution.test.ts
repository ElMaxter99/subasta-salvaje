import { normalizeImage } from '@/lib/images/normalize';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ImageGenerationProvider } from '@/lib/ai/types';
import { createGame, getHostState, uploadInitialImageForAll } from '@/lib/services/game-service';
import { processImageJobs } from '@/lib/services/jobs-service';
import { act, key, makeCtx, newHost, playerByName, type TestCtx } from './helpers';

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await makeCtx();
});
afterAll(async () => {
  await ctx.db.close();
});

const png = async (r: number, g: number, b: number) => new Uint8Array(await sharp({ create: { width: 64, height: 64, channels: 3, background: { r, g, b } } }).png().toBuffer());
const hex = (u: Uint8Array) => Buffer.from(u).toString('hex');

describe('el anfitrión sube UNA foto base y cada jugador la evoluciona por separado', () => {
  it('cada edición parte de la imagen actual de ese jugador (foto base → v1 → v2)', async () => {
    const seen: { base: string; item: string; previous: string[] }[] = [];
    let n = 0;
    const recording: ImageGenerationProvider = {
      id: 'demo',
      capabilities: { edit: true },
      generateInitialScene: async () => { throw new Error('no debe generar la inicial'); },
      generateItemImage: async () => { throw new Error('no aplica'); },
      async editScene(input) {
        seen.push({ base: hex(input.base.bytes), item: input.itemName, previous: input.previousItems });
        n++;
        return { bytes: await png(10 * n, 20 * n, 30), mime: 'image/png', prompt: `edit ${n}`, model: 'rec' };
      },
    };
    const aiCtx = { ...ctx, provider: recording };
    const host = newHost();
    const { room_code } = await createGame(ctx, host, { name: 'Foto base', players: [{ name: 'Ana' }, { name: 'Beto' }] });
    const photo = await png(200, 100, 50);
    await uploadInitialImageForAll(ctx, room_code, host, photo, { current: true, new: true });
    await act(ctx, room_code, host, { type: 'game.start' });

    const buy = async (playerName: string, idx = 0) => {
      const s = await getHostState(ctx, room_code, host);
      const pid = playerByName(s, playerName).id;
      const item = s.items.filter((i) => i.status === 'available')[idx]!;
      const a = await act(ctx, room_code, host, { type: 'auction.announce', item_id: item.id });
      const id = a.snapshot.auction!.id;
      await act(ctx, room_code, host, { type: 'auction.bid', auction_id: id, player_id: pid, amount_cents: 100, idempotency_key: key() });
      await act(ctx, room_code, host, { type: 'auction.award', auction_id: id, expected_winner_id: pid, expected_price_cents: 100, idempotency_key: key() });
      return item.name;
    };
    await buy('Ana');
    await buy('Beto');
    await buy('Ana');
    const gameId = (await getHostState(ctx, room_code, host)).game.id;
    // Un trabajo por pasada para respetar el orden de la cadena de Ana
    for (let i = 0; i < 3; i++) await processImageJobs(aiCtx, { gameId, maxJobs: 1 });

    expect(seen).toHaveLength(3);
    // Todo lo que se guarda pasa por el formato interno (WebP): se compara con la versión normalizada de la foto subida
    const photoHex = hex((await normalizeImage(photo, 'scene')).bytes);
    // Primera edición de cada jugador: parte exactamente de la foto subida por el anfitrión
    expect(seen[0]!.base).toBe(photoHex);
    expect(seen[1]!.base).toBe(photoHex);
    // Segunda edición de Ana: parte de SU primera edición, no de la foto ni de la de Beto, y conoce lo comprado
    expect(seen[2]!.base).not.toBe(photoHex);
    expect(seen[2]!.base).toBe(hex((await normalizeImage(await png(10, 20, 30), 'scene')).bytes));
    expect(seen[2]!.previous).toHaveLength(1);

    const after = await getHostState(ctx, room_code, host);
    const chain = after.versions.filter((v) => v.player_id === playerByName(after, 'Ana').id);
    expect(chain).toHaveLength(3); // foto base + 2 ediciones
    expect(chain.map((v) => v.origin)).toEqual(['uploaded', 'edit', 'edit']);
  });

  it('al finalizar con ediciones pendientes la imagen final llega después (y mientras tanto figura como «generando»)', async () => {
    const host = newHost();
    const { room_code } = await createGame(ctx, host, { name: 'Final pendiente', players: [{ name: 'Ana' }, { name: 'Beto' }] });
    await uploadInitialImageForAll(ctx, room_code, host, await png(1, 2, 3), { current: true, new: false });
    await act(ctx, room_code, host, { type: 'game.start' });
    const s0 = await getHostState(ctx, room_code, host);
    const ana = playerByName(s0, 'Ana');
    const item = s0.items[0]!;
    const a = await act(ctx, room_code, host, { type: 'auction.announce', item_id: item.id });
    await act(ctx, room_code, host, { type: 'auction.bid', auction_id: a.snapshot.auction!.id, player_id: ana.id, amount_cents: 100, idempotency_key: key() });
    await act(ctx, room_code, host, { type: 'auction.award', auction_id: a.snapshot.auction!.id, expected_winner_id: ana.id, expected_price_cents: 100, idempotency_key: key() });
    await act(ctx, room_code, host, { type: 'game.finish' }); // se finaliza ANTES de que la edición termine
    let s = await getHostState(ctx, room_code, host);
    expect(playerByName(s, 'Ana').generating.some((g) => g.kind === 'edit')).toBe(true);
    expect(playerByName(s, 'Ana').current_image!.id).toBe(playerByName(s, 'Ana').initial_image!.id);
    const recording: ImageGenerationProvider = {
      id: 'demo', capabilities: { edit: true },
      generateInitialScene: async () => { throw new Error('n/a'); }, generateItemImage: async () => { throw new Error('n/a'); },
      editScene: async () => ({ bytes: await png(9, 9, 9), mime: 'image/png', prompt: 'final', model: 'rec' }),
    };
    await processImageJobs({ ...ctx, provider: recording }, { gameId: s0.game.id });
    s = await getHostState(ctx, room_code, host);
    const after = playerByName(s, 'Ana');
    expect(after.generating).toHaveLength(0);
    expect(after.current_image!.id).not.toBe(after.initial_image!.id); // «Después» ya es la imagen final
  });
});
