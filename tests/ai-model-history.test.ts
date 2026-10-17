import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ImageGenerationProvider } from '@/lib/ai/types';
import { buildBlendPrompt, buildEditPrompt, regionFor } from '@/lib/ai/prompts';
import { editSize } from '@/lib/ai/pollinations';
import { createGame, getHostState, uploadInitialImageForAll } from '@/lib/services/game-service';
import { processImageJobs } from '@/lib/services/jobs-service';
import { act, key, makeCtx, newHost, playerByName, type TestCtx } from './helpers';

let ctx: TestCtx;
beforeAll(async () => { ctx = await makeCtx(); });
afterAll(async () => { await ctx.db.close(); });

const png = async (r: number, g: number, b: number, w = 64, h = 64) => new Uint8Array(await sharp({ create: { width: w, height: h, channels: 3, background: { r, g, b } } }).png().toBuffer());
const input = { theme: 'house', itemName: 'Barca', itemDescription: 'a pedal boat', itemEmoji: null, base: { bytes: new Uint8Array(), mime: 'image/png' } };

describe('el historial guarda el modelo de IA de cada versión', () => {
  it('la versión generada lleva proveedor y modelo; las subidas no', async () => {
    const provider: ImageGenerationProvider = {
      id: 'demo', capabilities: { edit: true },
      generateInitialScene: async () => { throw new Error('no aplica'); },
      generateItemImage: async () => { throw new Error('no aplica'); },
      editScene: async () => ({ bytes: await png(9, 9, 9), mime: 'image/png', prompt: 'p', model: 'flux.2-klein-4b' }),
    };
    const host = newHost();
    const { room_code } = await createGame(ctx, host, { name: 'Modelo', players: [{ name: 'Ana' }, { name: 'Beto' }] });
    await uploadInitialImageForAll(ctx, room_code, host, await png(200, 100, 50), { current: true, new: true });
    await act(ctx, room_code, host, { type: 'game.start' });
    const s = await getHostState(ctx, room_code, host);
    const pid = playerByName(s, 'Ana').id;
    const item = s.items.find((i) => i.status === 'available')!;
    const a = await act(ctx, room_code, host, { type: 'auction.announce', item_id: item.id });
    await act(ctx, room_code, host, { type: 'auction.bid', auction_id: a.snapshot.auction!.id, player_id: pid, amount_cents: 100, idempotency_key: key() });
    await act(ctx, room_code, host, { type: 'auction.award', auction_id: a.snapshot.auction!.id, expected_winner_id: pid, expected_price_cents: 100, idempotency_key: key() });
    await processImageJobs({ ...ctx, provider }, { gameId: s.game.id, maxJobs: 2 });
    const after = await getHostState(ctx, room_code, host);
    const mine = after.versions.filter((v) => v.player_id === pid);
    expect(mine.map((v) => v.origin)).toEqual(['uploaded', 'edit']);
    expect(mine[0]!.model ?? null).toBeNull();
    expect(mine[1]!.model).toBe('flux.2-klein-4b');
  });
});

describe('prompt de edición: la base puede ser cualquier cosa y el resultado debe ser natural y divertido', () => {
  it('no asume que la base es una casa: cubre lugares, comida/bebida, objetos y seres vivos, y pide una sola imagen coherente (sin collage ni halos)', () => {
    const p = buildEditPrompt({ ...input, theme: 'batido de leche', previousItems: [] });
    expect(p).toMatch(/can be anything \(a house, a room, a drink, a food/);
    expect(p).toMatch(/if the base is a food, a drink or an object, use the element as something that is added to it/);
    expect(p).toMatch(/if the base is a living being/);
    expect(p).toMatch(/ONE coherent photograph or picture in the style of the base, not a collage/);
    expect(p).toMatch(/no white or dark halos/);
    expect(p).toMatch(/never floating/);
    expect(p).toMatch(/Final check: the base picture is unchanged except for the one added element/);
    expect(p).toMatch(/Do NOT redraw, restyle or remove anything/);
  });
});

describe('prompt de edición: lo ya comprado debe seguir visible', () => {
  it('pide no tapar ni sustituir lo anterior, lo nombra y sugiere una zona distinta', () => {
    const first = buildEditPrompt({ ...input, previousItems: [] });
    expect(first).toContain('Nothing has been added to the base picture yet');
    expect(first).toContain(regionFor(0));
    const second = buildEditPrompt({ ...input, previousItems: ['Pikachu'] });
    expect(second).toMatch(/ALREADY contains this element, added in earlier rounds: Pikachu/);
    expect(second).toMatch(/must NOT replace, cover, overlap or hide it/);
    expect(second).toContain(regionFor(1));
    const blend = buildBlendPrompt({ ...input, previousItems: ['Pikachu', 'Barca vieja'], itemImage: { bytes: new Uint8Array(), mime: 'image/png' } });
    expect(blend).toMatch(/these elements, added in earlier rounds: Pikachu, Barca vieja/);
    expect(blend).toMatch(/They all stay fully visible/);
    expect(blend).toMatch(/Final check: Pikachu, Barca vieja are still clearly visible exactly where they were, nothing existing was replaced by something else/);
    expect(blend).toMatch(/leave out the background and the unrelated people or scenery/);
    expect(new Set([0, 1, 2, 3].map(regionFor)).size).toBe(4); // cada compra apunta a una zona distinta
  });
});

describe('tamaño de la edición en Pollinations', () => {
  it('conserva la proporción de la casa (16:9 → 1024x576) salvo que el propietario fije el tamaño', async () => {
    const wide = await png(1, 2, 3, 1536, 864);
    expect(await editSize(wide, { size: '1024x768' })).toBe('1024x576');
    expect(await editSize(await png(1, 2, 3, 1200, 1200), { size: '1024x768' })).toBe('1024x1024');
    expect(await editSize(wide, { size: '1024x768', sizeFixed: true })).toBe('1024x768');
    expect(await editSize(new Uint8Array([1, 2, 3]), { size: '1024x768' })).toBe('1024x768'); // ilegible: el configurado
  });
});
