import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createProviderChain } from '@/lib/ai/chain';
import { ProviderError, type GeneratedImage, type ImageGenerationProvider } from '@/lib/ai/types';
import { adminSetSetting } from '@/lib/services/admin-service';
import { createSettingsGate } from '@/lib/services/ai-gate';
import { invalidateSettings } from '@/lib/services/settings';
import { makeCtx, newHost, type TestCtx } from './helpers';
import { createGame } from '@/lib/services/game-service';

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await makeCtx();
});
afterAll(async () => {
  await ctx.db.close();
});

const img: GeneratedImage = { bytes: new Uint8Array([1, 2, 3]), mime: 'image/png', prompt: 'p', model: 'm' };
function fake(id: string): ImageGenerationProvider & { calls: number } {
  const f = { id: id as never, calls: 0, capabilities: { edit: false }, generateInitialScene: async () => (f.calls++, img), generateItemImage: async () => (f.calls++, img), editScene: async () => (f.calls++, img) };
  return f;
}
const set = (key: string, value: unknown) => adminSetSetting(ctx, 'test', { key, value });
const gen = (p: ImageGenerationProvider) => p.generateInitialScene({ theme: 't', sceneDescription: 's', playerName: 'p' });

describe('ajustes de proveedores de IA (SQL)', () => {
  it('valida ai_providers_off y ai_provider_limits', async () => {
    await expect(ctx.db.rpc('ss_settings_set', { key: 'ai_providers_off', value: ['nadie'] })).rejects.toThrow();
    await expect(ctx.db.rpc('ss_settings_set', { key: 'ai_provider_limits', value: { cloudflare: 0 } })).rejects.toThrow();
    await expect(ctx.db.rpc('ss_settings_set', { key: 'ai_provider_limits', value: { cloudflare: 1.5 } })).rejects.toThrow();
    await expect(adminSetSetting(ctx, 'test', { key: 'ai_providers_off', value: ['raro'] })).rejects.toThrow();
    const s = await set('ai_providers_off', ['pollinations']);
    expect(s.ai_providers_off).toEqual(['pollinations']);
    await set('ai_providers_off', []);
  });

  it('ss_provider_usage cuenta hoy por proveedor y ss_set_usage_provider reatribuye', async () => {
    const host = newHost();
    const { room_code } = await createGame(ctx, host, { name: 'Uso', integer_bids: false, players: [{ name: 'Ana' }] });
    const game = (await ctx.db.pg.query<{ id: string }>('select id from games where room_code = $1', [room_code])).rows[0]!;
    const job = (await ctx.db.pg.query<{ id: string }>("insert into image_jobs (game_id, kind) values ($1, 'base') returning id", [game.id]).catch(() => ({ rows: [] as { id: string }[] }))).rows[0];
    expect(job).toBeDefined();
    await ctx.db.rpc('ss_reserve_image_quota', { job_id: job!.id, provider: 'cloudflare', game_limit: 100, day_limit: 100 });
    expect(await ctx.db.rpc<Record<string, number>>('ss_provider_usage', {})).toMatchObject({ cloudflare: 1 });
    await ctx.db.rpc('ss_set_usage_provider', { job_id: job!.id, provider: 'pollinations' });
    const u = await ctx.db.rpc<Record<string, number>>('ss_provider_usage', {});
    expect(u.pollinations).toBe(1);
    expect(u.cloudflare ?? 0).toBe(0);
  });
});

describe('filtro de la cadena por ajustes', () => {
  it('un proveedor apagado se salta; al activarlo vuelve', async () => {
    const a = fake('cloudflare'), b = fake('pollinations');
    const chain = createProviderChain([a, b], { gate: createSettingsGate(ctx.db) });
    await set('ai_providers_off', ['cloudflare']);
    invalidateSettings(ctx.db);
    expect((await gen(chain)).provider).toBe('pollinations');
    expect(a.calls).toBe(0);
    await set('ai_providers_off', []);
    invalidateSettings(ctx.db);
    expect((await gen(chain)).provider).toBe('cloudflare');
  });

  it('con un solo proveedor, apagado no se llama y no gasta (error sin consumo)', async () => {
    const a = fake('cloudflare');
    const chain = createProviderChain([a], { gate: createSettingsGate(ctx.db) });
    await set('ai_providers_off', ['cloudflare']);
    invalidateSettings(ctx.db);
    await expect(gen(chain)).rejects.toMatchObject({ kind: 'quota', consumed: false });
    expect(a.calls).toBe(0);
    await set('ai_providers_off', []);
    invalidateSettings(ctx.db);
  });

  it('el tope diario por proveedor pasa al siguiente cuando se alcanza', async () => {
    const a = fake('cloudflare'), b = fake('pollinations');
    let t = 0;
    const gate = createSettingsGate(ctx.db, () => (t += 100_000)); // la caché de uso caduca siempre
    const chain = createProviderChain([a, b], { gate });
    await set('ai_provider_limits', { cloudflare: 1 });
    invalidateSettings(ctx.db);
    // simula un uso ya registrado hoy de cloudflare
    const orig = ctx.db.rpc.bind(ctx.db);
    const spy = { ...ctx.db, rpc: (fn: string, p: Record<string, unknown>) => (fn === 'ss_provider_usage' ? Promise.resolve({ cloudflare: 1 }) : orig(fn, p)) } as typeof ctx.db;
    const chain2 = createProviderChain([a, b], { gate: createSettingsGate(spy, () => (t += 100_000)) });
    expect((await gen(chain2)).provider).toBe('pollinations');
    expect(a.calls).toBe(0);
    void chain;
    await set('ai_provider_limits', {});
    invalidateSettings(ctx.db);
  });

  it('todos apagados: error sin consumo y se conserva la imagen', async () => {
    const chain = createProviderChain([fake('cloudflare'), fake('pollinations')], { gate: createSettingsGate(ctx.db) });
    await set('ai_providers_off', ['cloudflare', 'pollinations']);
    invalidateSettings(ctx.db);
    const err = await gen(chain).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.consumed).toBe(false);
    await set('ai_providers_off', []);
    invalidateSettings(ctx.db);
  });
});
