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

describe('prompt de edición: la base puede ser cualquier cosa y se EDITA con el elemento (no solo se añade)', () => {
  it('no asume el tipo de imagen base: cubre lugares, comida/bebida, objetos, animales y personas, y pide una edición creativa y coherente (sin collage ni halos)', () => {
    const p = buildEditPrompt({ ...input, theme: 'batido de leche', previousItems: [] });
    expect(p).toMatch(/can be anything \(a place, a room, a drink, a food, an object, an animal, a person\)/);
    expect(p).toMatch(/Do not just paste the element on top: EDIT the base so the combination makes sense and is fun/);
    expect(p).toMatch(/a boat needs water and a person can sit in it/);
    expect(p).toMatch(/ingredient is poured into the drink/);
    expect(p).toMatch(/ONE coherent photo in the style of the base, not a collage/);
    expect(p).toMatch(/cut-out edges or halos/);
    expect(p).toMatch(/never floating/);
    expect(p).toMatch(/Keep the base identity .*edit it, do not replace it/);
    expect(p).toMatch(/Final check: clearly the same base picture, edited so the new element is naturally part of it/);
  });
});

describe('longitud del prompt', () => {
  it('cabe en el límite de los proveedores (~2000 caracteres) incluso con nombres largos y muchas compras, sin perder el final', () => {
    const base = { ...input, itemName: 'N'.repeat(120), itemDescription: 'D'.repeat(400) };
    const prev = Array.from({ length: 12 }, (_, i) => `Elemento muy largo número ${i} con nombre extenso extenso`);
    for (const p of [buildEditPrompt({ ...base, previousItems: prev }), buildBlendPrompt({ ...base, previousItems: prev, itemImage: { bytes: new Uint8Array(), mime: 'image/png' } })]) {
      expect(p.length).toBeLessThanOrEqual(2000);
      expect(p).toMatch(/Final check/);
      expect(p).toMatch(/No text, letters, numbers, logos or watermarks anywhere\.$/); // el final no se corta
    }
  });
});

describe('prompt de edición: lo ya comprado debe seguir visible', () => {
  it('pide no tapar ni sustituir lo anterior (aunque el entorno cambie), lo nombra y sugiere una zona distinta', () => {
    const first = buildEditPrompt({ ...input, previousItems: [] });
    expect(first).toContain('Nothing has been added yet');
    expect(first).toContain(regionFor(0));
    const second = buildEditPrompt({ ...input, previousItems: ['Pikachu'] });
    expect(second).toMatch(/ALREADY contains this element, added in earlier rounds: Pikachu/);
    expect(second).toMatch(/never replaced, covered or hidden \(the scene around it may change\)/);
    expect(second).toContain(regionFor(1));
    const blend = buildBlendPrompt({ ...input, previousItems: ['Pikachu', 'Barca vieja'], itemImage: { bytes: new Uint8Array(), mime: 'image/png' } });
    expect(blend).toMatch(/these elements, added in earlier rounds: Pikachu, Barca vieja/);
    expect(blend).toMatch(/They all stay clearly visible and recognizable/);
    expect(blend).toMatch(/Final check: Pikachu, Barca vieja still clearly visible, nothing added earlier removed or replaced/);
    expect(blend).toMatch(/only the object, not its background or unrelated people/);
    expect(new Set([0, 1, 2, 3].map(regionFor)).size).toBe(4); // cada compra apunta a una zona distinta
  });
});

describe('tamaño de la edición en Pollinations', () => {
  it('conserva la proporción de la imagen (16:9 → 1024x576) salvo que el propietario fije el tamaño', async () => {
    const wide = await png(1, 2, 3, 1536, 864);
    expect(await editSize(wide, { size: '1024x768' })).toBe('1024x576');
    expect(await editSize(await png(1, 2, 3, 1200, 1200), { size: '1024x768' })).toBe('1024x1024');
    expect(await editSize(wide, { size: '1024x768', sizeFixed: true })).toBe('1024x768');
    expect(await editSize(new Uint8Array([1, 2, 3]), { size: '1024x768' })).toBe('1024x768'); // ilegible: el configurado
  });
});
