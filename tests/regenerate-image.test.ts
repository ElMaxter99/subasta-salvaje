import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ImageGenerationProvider } from '@/lib/ai/types';
import { createProviderChain } from '@/lib/ai/chain';
import { createGame, getHostState, uploadInitialImageForAll } from '@/lib/services/game-service';
import { processImageJobs } from '@/lib/services/jobs-service';
import { act, key, makeCtx, newHost, playerByName, type TestCtx } from './helpers';

let ctx: TestCtx;
beforeAll(async () => { ctx = await makeCtx(); });
afterAll(async () => { await ctx.db.close(); });

const png = async (r: number, g: number, b: number) => new Uint8Array(await sharp({ create: { width: 64, height: 64, channels: 3, background: { r, g, b } } }).png().toBuffer());

describe('regenerar la versión actual (para probar otro modelo o prompt sobre la misma compra)', () => {
  it('vuelve a generar partiendo de la versión anterior, conserva la anterior en el historial y no toca saldos ni compras', async () => {
    let n = 0;
    const models = ['modelo-A', 'modelo-B'];
    const provider: ImageGenerationProvider = {
      id: 'demo', capabilities: { edit: true },
      generateInitialScene: async () => { throw new Error('no aplica'); },
      generateItemImage: async () => { throw new Error('no aplica'); },
      editScene: async (i) => { const k = n++; return { bytes: await png(50 + k * 80, 10, 10), mime: 'image/png', prompt: `intento ${k + 1} de ${i.itemName}`, model: models[k] ?? 'otro' }; },
    };
    const host = newHost();
    const { room_code } = await createGame(ctx, host, { name: 'Regenerar', players: [{ name: 'Ana' }, { name: 'Beto' }] });
    await uploadInitialImageForAll(ctx, room_code, host, await png(1, 2, 3), { current: true, new: true });
    await act(ctx, room_code, host, { type: 'game.start' });
    const buy = async () => {
      const s = await getHostState(ctx, room_code, host);
      const pid = playerByName(s, 'Ana').id;
      const a = await act(ctx, room_code, host, { type: 'auction.announce', item_id: s.items.filter((i) => i.status === 'available')[0]!.id });
      await act(ctx, room_code, host, { type: 'auction.bid', auction_id: a.snapshot.auction!.id, player_id: pid, amount_cents: 100, idempotency_key: key() });
      await act(ctx, room_code, host, { type: 'auction.award', auction_id: a.snapshot.auction!.id, expected_winner_id: pid, expected_price_cents: 100, idempotency_key: key() });
    };
    await buy();
    const gameId = (await getHostState(ctx, room_code, host)).game.id;
    await processImageJobs({ ...ctx, provider }, { gameId, maxJobs: 1 });
    const s1 = await getHostState(ctx, room_code, host);
    const ana = playerByName(s1, 'Ana');
    const chain1 = s1.versions.filter((v) => v.player_id === ana.id);
    expect(chain1.map((v) => v.origin)).toEqual(['uploaded', 'edit']);
    const first = chain1[1]!;
    expect(ana.current_image_version_id).toBe(first.id);

    // Regenerar la actual
    await act(ctx, room_code, host, { type: 'image.regenerate', player_id: ana.id, version_id: first.id });
    // Mientras está en cola, pedirlo otra vez no duplica nada
    expect((await act(ctx, room_code, host, { type: 'image.regenerate', player_id: ana.id, version_id: first.id })).result).toBeTruthy();
    await processImageJobs({ ...ctx, provider }, { gameId, maxJobs: 1 });

    const s2 = await getHostState(ctx, room_code, host);
    const ana2 = playerByName(s2, 'Ana');
    const chain2 = s2.versions.filter((v) => v.player_id === ana2.id);
    expect(chain2.map((v) => v.origin)).toEqual(['uploaded', 'edit', 'edit']); // la anterior se conserva
    expect(chain2[2]!.parent_version_id).toBe(chain1[0]!.id); // parte de la misma versión anterior
    expect(chain2[2]!.model).toBe('modelo-B');
    expect(chain2[1]!.model).toBe('modelo-A');
    expect(ana2.current_image_version_id).toBe(chain2[2]!.id);
    expect(ana2.balance_cents).toBe(ana.balance_cents); // sin cobros
    expect(ana2.purchases).toHaveLength(1);
    expect(s2.events.filter((e) => e.event_type === 'image_regenerated')).toHaveLength(1);
  });

  it('solo se puede regenerar la versión ACTUAL y si es una edición completada', async () => {
    const provider: ImageGenerationProvider = {
      id: 'demo', capabilities: { edit: true },
      generateInitialScene: async () => { throw new Error('no aplica'); },
      generateItemImage: async () => { throw new Error('no aplica'); },
      editScene: async () => ({ bytes: await png(9, 9, 9), mime: 'image/png', prompt: 'p', model: 'm' }),
    };
    const host = newHost();
    const { room_code } = await createGame(ctx, host, { name: 'Reglas', players: [{ name: 'Ana' }, { name: 'Beto' }] });
    await uploadInitialImageForAll(ctx, room_code, host, await png(1, 2, 3), { current: true, new: true });
    await act(ctx, room_code, host, { type: 'game.start' });
    for (let k = 0; k < 2; k++) {
      const s = await getHostState(ctx, room_code, host);
      const pid = playerByName(s, 'Ana').id;
      const a = await act(ctx, room_code, host, { type: 'auction.announce', item_id: s.items.filter((i) => i.status === 'available')[0]!.id });
      await act(ctx, room_code, host, { type: 'auction.bid', auction_id: a.snapshot.auction!.id, player_id: pid, amount_cents: 100, idempotency_key: key() });
      await act(ctx, room_code, host, { type: 'auction.award', auction_id: a.snapshot.auction!.id, expected_winner_id: pid, expected_price_cents: 100, idempotency_key: key() });
      await processImageJobs({ ...ctx, provider }, { gameId: (await getHostState(ctx, room_code, host)).game.id, maxJobs: 1 });
    }
    const s = await getHostState(ctx, room_code, host);
    const ana = playerByName(s, 'Ana');
    const [uploaded, v1] = s.versions.filter((v) => v.player_id === ana.id);
    const regen = (version_id: string, player_id = ana.id) => act(ctx, room_code, host, { type: 'image.regenerate', player_id, version_id });
    await expect(regen(uploaded!.id)).rejects.toMatchObject({ code: 'version_not_regenerable' }); // la subida no se regenera
    await expect(regen(v1!.id)).rejects.toMatchObject({ code: 'version_not_regenerable' }); // no es la actual (hay una compra posterior)
    await expect(regen(ana.current_image_version_id!, playerByName(s, 'Beto').id)).rejects.toMatchObject({ code: 'version_not_found' });
  });
});

describe('regenerar forzando un proveedor (para comparar Cloudflare y Pollinations sobre la misma compra)', () => {
  const mk = (id: 'cloudflare' | 'pollinations', log: string[]): ImageGenerationProvider => ({
    id, capabilities: { edit: true },
    generateInitialScene: async () => { throw new Error('no aplica'); },
    generateItemImage: async () => { throw new Error('no aplica'); },
    editScene: async () => { log.push(id); return { bytes: await png(id === 'cloudflare' ? 200 : 20, 40, 60), mime: 'image/png', prompt: `edit con ${id}`, model: `${id}-modelo` }; },
  });

  it('con «Solo Cloudflare» se usa ese proveedor aunque la cadena empiece por Pollinations; la nota queda en el historial', async () => {
    const log: string[] = [];
    const chain = createProviderChain([mk('pollinations', log), mk('cloudflare', log)]);
    const host = newHost();
    const { room_code } = await createGame(ctx, host, { name: 'Forzar', players: [{ name: 'Ana' }, { name: 'Beto' }] });
    await uploadInitialImageForAll(ctx, room_code, host, await png(1, 2, 3), { current: true, new: true });
    await act(ctx, room_code, host, { type: 'game.start' });
    const s = await getHostState(ctx, room_code, host);
    const pid = playerByName(s, 'Ana').id;
    const a = await act(ctx, room_code, host, { type: 'auction.announce', item_id: s.items[0]!.id });
    await act(ctx, room_code, host, { type: 'auction.bid', auction_id: a.snapshot.auction!.id, player_id: pid, amount_cents: 100, idempotency_key: key() });
    await act(ctx, room_code, host, { type: 'auction.award', auction_id: a.snapshot.auction!.id, expected_winner_id: pid, expected_price_cents: 100, idempotency_key: key() });
    const gameId = (await getHostState(ctx, room_code, host)).game.id;
    await processImageJobs({ ...ctx, provider: chain }, { gameId, maxJobs: 1 });
    expect(log).toEqual(['pollinations']); // la cadena usa el primero
    const v1 = playerByName(await getHostState(ctx, room_code, host), 'Ana').current_image_version_id!;

    await act(ctx, room_code, host, { type: 'image.regenerate', player_id: pid, version_id: v1, provider: 'cloudflare' });
    await processImageJobs({ ...ctx, provider: chain }, { gameId, maxJobs: 1 });
    expect(log).toEqual(['pollinations', 'cloudflare']);
    const after = await getHostState(ctx, room_code, host);
    const chainV = after.versions.filter((v) => v.player_id === pid);
    expect(chainV.at(-1)).toMatchObject({ provider: 'cloudflare', model: 'cloudflare-modelo' });
    expect(chainV.at(-1)!.provider_note).toBe('Regenerado forzando cloudflare (se ignora la cadena)');
    expect(chainV[1]!.provider_note).toBe('cadena: pollinations → cloudflare; respondió pollinations (1.º de 2)'); // generación normal: queda explicado también

    // Sin proveedor forzado vuelve a mandar la cadena
    await act(ctx, room_code, host, { type: 'image.regenerate', player_id: pid, version_id: chainV.at(-1)!.id });
    await processImageJobs({ ...ctx, provider: chain }, { gameId, maxJobs: 1 });
    expect(log.at(-1)).toBe('pollinations');
  });

  it('si el proveedor forzado no está configurado, el trabajo falla con un mensaje claro y la imagen se conserva', async () => {
    const log: string[] = [];
    const chain = createProviderChain([mk('pollinations', log), mk('pollinations', log)]); // sin Cloudflare
    const host = newHost();
    const { room_code } = await createGame(ctx, host, { name: 'No config', players: [{ name: 'Ana' }, { name: 'Beto' }] });
    await uploadInitialImageForAll(ctx, room_code, host, await png(1, 2, 3), { current: true, new: true });
    await act(ctx, room_code, host, { type: 'game.start' });
    const s = await getHostState(ctx, room_code, host);
    const pid = playerByName(s, 'Ana').id;
    const a = await act(ctx, room_code, host, { type: 'auction.announce', item_id: s.items[0]!.id });
    await act(ctx, room_code, host, { type: 'auction.bid', auction_id: a.snapshot.auction!.id, player_id: pid, amount_cents: 100, idempotency_key: key() });
    await act(ctx, room_code, host, { type: 'auction.award', auction_id: a.snapshot.auction!.id, expected_winner_id: pid, expected_price_cents: 100, idempotency_key: key() });
    const gameId = (await getHostState(ctx, room_code, host)).game.id;
    await processImageJobs({ ...ctx, provider: chain }, { gameId, maxJobs: 1 });
    const v1 = playerByName(await getHostState(ctx, room_code, host), 'Ana').current_image_version_id!;
    await act(ctx, room_code, host, { type: 'image.regenerate', player_id: pid, version_id: v1, provider: 'cloudflare' });
    await processImageJobs({ ...ctx, provider: chain }, { gameId, maxJobs: 1 });
    const after = await getHostState(ctx, room_code, host);
    const job = after.jobs.find((j) => j.kind === 'edit')!;
    expect(job.status).toBe('failed');
    expect(job.error_message).toMatch(/cloudflare no está configurado/);
    const vs = after.versions.filter((v) => v.player_id === pid);
    expect(vs.map((v) => v.generation_status)).toEqual(['completed', 'completed', 'failed']); // la fallida queda registrada y la actual no cambia
    expect(playerByName(after, 'Ana').current_image_version_id).toBe(vs[0]!.id === v1 ? vs[0]!.id : vs[1]!.parent_version_id);
  });
});
