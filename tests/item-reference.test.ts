import { normalizeImage } from '@/lib/images/normalize';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCloudflareProvider } from '@/lib/ai/cloudflare';
import { frameImage, withComposedEdit } from '@/lib/ai/compose';
import { sniffImageMime } from '@/lib/ai/image-validation';
import { createOpenAiProvider } from '@/lib/ai/openai';
import { buildEditPrompt } from '@/lib/ai/prompts';
import type { EditSceneInput, ImageGenerationProvider } from '@/lib/ai/types';
import { emptySceneFor } from '@/lib/domain/themes';
import { createGame, getHostState, uploadItemImage } from '@/lib/services/game-service';
import { processImageJobs } from '@/lib/services/jobs-service';
import { act, key, makeCtx, newHost, playerByName, type TestCtx } from './helpers';

const solid = (w: number, h: number, c: { r: number; g: number; b: number }) => sharp({ create: { width: w, height: h, channels: 3, background: c } });
const png = async (r: number, g: number, b: number, w = 64, h = 64) => new Uint8Array(await solid(w, h, { r, g, b }).png().toBuffer());
const hex = (u: Uint8Array) => Buffer.from(u).toString('hex');

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await makeCtx();
});
afterAll(async () => {
  await ctx.db.close();
});

/** Conejo rosa con lazo azul (ilustrativo): fondo con degradado, sin fondo liso recortable. */
async function bunnyPhoto() {
  const noise = Buffer.alloc(200 * 200 * 3);
  for (let i = 0; i < noise.length; i++) noise[i] = (i * 37) % 251;
  return new Uint8Array(await sharp(noise, { raw: { width: 200, height: 200, channels: 3 } }).jpeg().toBuffer());
}

const input = (over: Partial<EditSceneInput> = {}): EditSceneInput => ({ base: { bytes: new Uint8Array([1]), mime: 'image/png' }, theme: 'house', itemName: 'Conejo', itemDescription: 'Un amable conejo', itemEmoji: null, previousItems: [], ...over });

describe('el tema fija el prompt base de la imagen inicial', () => {
  it('las plantillas usan su escena y un tema libre se describe como lugar reconocible', () => {
    expect(emptySceneFor('island')).toContain('island');
    const custom = emptySceneFor('base lunar');
    expect(custom).toContain('base lunar');
    expect(custom).toMatch(/empty/);
  });
});

describe('mezclar la foto del elemento con la imagen: proveedores', () => {
  it('el prompt describe imagen 0 = escena e imagen 1 = elemento y exige reproducirlo fielmente', () => {
    const p = buildEditPrompt(input({ itemImage: { bytes: new Uint8Array([1]), mime: 'image/png' } }));
    expect(p).toMatch(/Image 0 is the BASE picture/);
    expect(p).toMatch(/Image 1 is a reference photo of the new element "Conejo"/);
    expect(p).toMatch(/faithfully/);
    expect(buildEditPrompt(input())).not.toMatch(/Image 1/); // sin foto: edición solo con texto
  });

  it('Cloudflare envía la escena (input_image_0) y la foto del elemento (input_image_1)', async () => {
    const jpeg = Buffer.from(await png(10, 10, 10)).toString('base64');
    const forms: FormData[] = [];
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      forms.push(init.body as FormData);
      return new Response(JSON.stringify({ result: { image: jpeg }, success: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const p = createCloudflareProvider({ accountId: 'a', apiToken: 't', model: '@cf/m', steps: 4, editModel: '@cf/black-forest-labs/flux-2-klein-4b', width: 1024, height: 768, fetchImpl, resizeForReference: async (b) => b });
    await p.editScene(input({ base: { bytes: await png(1, 2, 3), mime: 'image/png' }, itemImage: { bytes: await bunnyPhoto(), mime: 'image/jpeg' } }));
    const f = forms[0]!;
    expect(f.get('input_image_0')).toBeInstanceOf(Blob);
    expect(f.get('input_image_1')).toBeInstanceOf(Blob);
    expect(String(f.get('prompt'))).toMatch(/Image 1 is a reference photo/);
    // sin foto de elemento solo hay una referencia
    await p.editScene(input({ base: { bytes: await png(1, 2, 3), mime: 'image/png' } }));
    expect(forms[1]!.get('input_image_1')).toBeNull();
  });

  it('OpenAI envía dos imágenes (image[]): escena primero y elemento después (PNG)', async () => {
    const b64 = Buffer.from(await png(5, 5, 5)).toString('base64');
    const forms: FormData[] = [];
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      forms.push(init.body as FormData);
      return new Response(JSON.stringify({ data: [{ b64_json: b64 }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const p = createOpenAiProvider({ apiKey: 'k', fetchImpl });
    await p.editScene(input({ itemImage: { bytes: await bunnyPhoto(), mime: 'image/jpeg' } }));
    const imgs = forms[0]!.getAll('image[]') as File[];
    expect(imgs).toHaveLength(2);
    expect(imgs[1]!.type).toBe('image/png');
    expect(forms[0]!.get('image')).toBeNull();
  });
});

describe('plan B por composición con la foto del elemento', () => {
  it('pega LA FOTO del elemento (enmarcada si no tiene fondo liso) y no genera nada nuevo', async () => {
    let generations = 0;
    const inner: ImageGenerationProvider = {
      id: 'cloudflare', capabilities: { edit: false },
      generateInitialScene: async () => { generations++; throw new Error('n/a'); },
      generateItemImage: async () => { generations++; throw new Error('no debe generar el objeto: ya hay foto'); },
      editScene: async () => { throw new Error('n/a'); },
    };
    const p = withComposedEdit(inner);
    const out = await p.editScene(input({ base: { bytes: await png(20, 40, 60, 640, 480), mime: 'image/png' }, itemImage: { bytes: await bunnyPhoto(), mime: 'image/jpeg' } }));
    expect(generations).toBe(0);
    expect(out.model).toContain('reference');
    expect(sniffImageMime(out.bytes)).toBe('image/png');
  });

  it('frameImage devuelve un PNG con esquinas transparentes y borde', async () => {
    const framed = await frameImage(await bunnyPhoto(), 200);
    const { data, info } = await sharp(Buffer.from(framed)).raw().toBuffer({ resolveWithObject: true });
    expect(data[3]).toBeLessThan(20); // esquina (0,0) transparente
    expect(data[(Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * 4 + 3]).toBe(255);
  });
});

describe('foto del elemento: subida del anfitrión y mezcla al ganar', () => {
  async function game(host: string) {
    const { room_code } = await createGame(ctx, host, { name: 'Con fotos', players: [{ name: 'Ana' }, { name: 'Beto' }] });
    return room_code;
  }
  const buy = async (room: string, host: string, playerName: string, itemId: string) => {
    const s = await getHostState(ctx, room, host);
    const a = await act(ctx, room, host, { type: 'auction.announce', item_id: itemId });
    const pid = playerByName(s, playerName).id;
    await act(ctx, room, host, { type: 'auction.bid', auction_id: a.snapshot.auction!.id, player_id: pid, amount_cents: 100, idempotency_key: key() });
    await act(ctx, room, host, { type: 'auction.award', auction_id: a.snapshot.auction!.id, expected_winner_id: pid, expected_price_cents: 100, idempotency_key: key() });
  };

  it('subir foto → al ganar el elemento la IA recibe la foto del elemento junto a la imagen; sin foto no', async () => {
    const seen: { base: string; item: string | null; name: string }[] = [];
    const recording: ImageGenerationProvider = {
      id: 'demo', capabilities: { edit: true },
      generateInitialScene: async () => { throw new Error('n/a'); }, generateItemImage: async () => { throw new Error('n/a'); },
      async editScene(i) { seen.push({ base: hex(i.base.bytes), item: i.itemImage ? hex(i.itemImage.bytes) : null, name: i.itemName }); return { bytes: await png(9, 9, 9), mime: 'image/png', prompt: 'x', model: 'rec' }; },
    };
    const host = newHost();
    const room = await game(host);
    const s0 = await getHostState(ctx, room, host);
    const [conejo, vaca] = [s0.items[0]!, s0.items[1]!];
    await act(ctx, room, host, { type: 'image.set_initial_all', catalog_id: 'house' });
    const photo = await png(255, 105, 180, 80, 80); // conejo rosa
    await uploadItemImage(ctx, room, host, conejo.id, photo);
    expect((await getHostState(ctx, room, host)).items.find((i) => i.id === conejo.id)!.image_path).toMatch(new RegExp(`/items/${conejo.id}/`));
    await act(ctx, room, host, { type: 'game.start' });
    await buy(room, host, 'Ana', conejo.id);
    await buy(room, host, 'Beto', vaca.id);
    await processImageJobs({ ...ctx, provider: recording }, { gameId: s0.game.id, maxJobs: 1 });
    await processImageJobs({ ...ctx, provider: recording }, { gameId: s0.game.id, maxJobs: 1 });
    const withPhoto = seen.find((x) => x.name === conejo.name)!;
    expect(withPhoto.item).toBe(hex((await normalizeImage(photo, 'item')).bytes)); // la foto del conejo llega a la IA
    expect(seen.find((x) => x.name === vaca.name)!.item).toBeNull(); // sin foto: solo texto
  });

  it('la foto generada con IA para el catálogo (job «item») también se usa como referencia', async () => {
    const seen: (string | null)[] = [];
    const prov: ImageGenerationProvider = {
      id: 'demo', capabilities: { edit: true },
      generateInitialScene: async () => ({ bytes: await png(1, 1, 1), mime: 'image/png', prompt: 'i', model: 'rec' }),
      generateItemImage: async (i) => ({ bytes: await png(200, 10, 10), mime: 'image/png', prompt: `item ${i.itemName}: ${i.itemDescription}`, model: 'rec' }),
      async editScene(i) { seen.push(i.itemImage ? hex(i.itemImage.bytes) : null); return { bytes: await png(9, 9, 9), mime: 'image/png', prompt: 'x', model: 'rec' }; },
    };
    const c2 = { ...ctx, provider: prov };
    const host = newHost();
    const room = await game(host);
    const s0 = await getHostState(c2, room, host);
    const volcan = s0.items[2]!;
    await act(c2, room, host, { type: 'image.set_initial_all', catalog_id: 'house' });
    await act(c2, room, host, { type: 'image.request_item', item_id: volcan.id });
    await processImageJobs(c2, { gameId: s0.game.id });
    const generated = (await getHostState(c2, room, host)).items.find((i) => i.id === volcan.id)!;
    expect(generated.image_path).toBeTruthy();
    await act(c2, room, host, { type: 'game.start' });
    await buy(room, host, 'Ana', volcan.id);
    await processImageJobs(c2, { gameId: s0.game.id });
    expect(seen[0]).toBe(hex(ctx.storage.files.get(generated.image_path!)!.bytes));
  });

  it('solo el anfitrión sube; se valida el archivo; reemplazar borra la anterior; quitar la elimina', async () => {
    const host = newHost();
    const room = await game(host);
    const item = (await getHostState(ctx, room, host)).items[0]!;
    await expect(uploadItemImage(ctx, room, newHost(), item.id, await png(1, 1, 1))).rejects.toMatchObject({ code: 'not_host' });
    await expect(uploadItemImage(ctx, room, host, item.id, new Uint8Array([1, 2, 3]))).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(uploadItemImage(ctx, room, host, crypto.randomUUID(), await png(1, 1, 1))).rejects.toMatchObject({ code: 'item_not_found' });
    await uploadItemImage(ctx, room, host, item.id, await png(1, 1, 1));
    const first = (await getHostState(ctx, room, host)).items.find((i) => i.id === item.id)!.image_path!;
    await uploadItemImage(ctx, room, host, item.id, await png(2, 2, 2));
    const second = (await getHostState(ctx, room, host)).items.find((i) => i.id === item.id)!.image_path!;
    expect(second).not.toBe(first);
    expect(ctx.storage.files.has(first)).toBe(false);
    expect(ctx.storage.files.has(second)).toBe(true);
    const cleared = await act(ctx, room, host, { type: 'item.clear_image', item_id: item.id });
    expect(cleared.snapshot.items.find((i) => i.id === item.id)!.image_path).toBeNull();
    expect(ctx.storage.files.has(second)).toBe(false);
    expect((await getHostState(ctx, room, host)).events.some((e) => e.event_type === 'item_image_uploaded')).toBe(true);
  });
});
