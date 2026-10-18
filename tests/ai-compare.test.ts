import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { createProviderChain } from '@/lib/ai/chain';
import { ProviderError, type EditSceneInput, type GeneratedImage, type ImageGenerationProvider } from '@/lib/ai/types';
import { adminAudit, adminSetSetting } from '@/lib/services/admin-service';
import { createSettingsGate } from '@/lib/services/ai-gate';
import { COMPARE_TIMEOUT_MS, MAX_COMPARE_PROVIDERS, compareMetaSchema, compareModels, comparableProviders } from '@/lib/services/compare-service';
import { invalidateSettings } from '@/lib/services/settings';
import { makeCtx, type TestCtx } from './helpers';

let ctx: TestCtx;
beforeAll(async () => { ctx = await makeCtx(); });
afterAll(async () => { await ctx.db.close(); });

const png = async (color: string) => new Uint8Array(await sharp({ create: { width: 96, height: 64, channels: 3, background: color } }).png().toBuffer());
interface Fake extends ImageGenerationProvider { inputs: EditSceneInput[] }
function fake(id: string, opts: { fail?: ProviderError | Error; delay?: number } = {}): Fake {
  const inputs: EditSceneInput[] = [];
  return {
    id: id as never, inputs, capabilities: { edit: true }, realEdit: true,
    generateInitialScene: async () => { throw new Error('no se usa'); },
    generateItemImage: async () => { throw new Error('no se usa'); },
    editScene: async (i): Promise<GeneratedImage> => {
      inputs.push(i);
      if (opts.delay) await new Promise((r) => setTimeout(r, opts.delay));
      if (opts.fail) throw opts.fail;
      return { bytes: await png('#aa3366'), mime: 'image/png', prompt: `prompt de ${id}`, model: `${id}-modelo`, notes: 'semilla 42' };
    },
  };
}
const IDS = ['cloudflare', 'pollinations', 'aihorde', 'huggingface'];
const chainOf = (...p: Fake[]) => createProviderChain(p, { gate: createSettingsGate(ctx.db) });
const used = async () => (await ctx.db.rpc<Record<string, number>>('ss_provider_usage', {})) ?? {};
const input = async (providers: string[], items = 1) => ({
  base: await png('#ffffff'), theme: 'casa', providers,
  items: Array.from({ length: items }, (_, i) => ({ name: `Cosa ${i + 1}`, bytes: [undefined] as unknown as Uint8Array })),
});
async function full(providers: string[], items = 1) {
  const i = await input(providers, items);
  for (const it of i.items) it.bytes = await png('#00aa00');
  return i;
}
const run = (chain: ImageGenerationProvider | null, providers: string[], items = 1, opts = {}) =>
  full(providers, items).then((i) => compareModels({ db: ctx.db, provider: chain }, 'tester', i, { configured: IDS, ...opts }));

beforeEach(async () => {
  for (const [key, value] of [['ai_providers_off', []], ['ai_provider_limits', {}], ['ai_enabled', true], ['quota_per_day', 1000]] as const) await adminSetSetting(ctx, 'test', { key, value });
  invalidateSettings(ctx.db);
});

describe('comparador de modelos', () => {
  it('compara en el orden pedido, con modelo, notas, prompt y data URL; reserva cuota y anota la auditoría sin imágenes', async () => {
    const a = fake('cloudflare'), b = fake('pollinations');
    const before = await used();
    const { results } = await run(chainOf(a, b), ['pollinations', 'cloudflare']);
    expect(results.map((r) => r.provider)).toEqual(['pollinations', 'cloudflare']);
    expect(results.every((r) => r.ok && r.dataUrl!.startsWith('data:image/webp;base64,') && r.notes === 'semilla 42' && r.prompts[0]!.startsWith('prompt de'))).toBe(true);
    expect(results[0]!.model).toBe('pollinations-modelo');
    const after = await used();
    expect((after.pollinations ?? 0) - (before.pollinations ?? 0)).toBe(1);
    expect((after.cloudflare ?? 0) - (before.cloudflare ?? 0)).toBe(1);
    const log = (await adminAudit(ctx as never)).find((e) => e.action === 'ai_compare');
    expect(log).toBeTruthy();
    expect(JSON.stringify(log)).not.toMatch(/data:image|base64/);
    expect(log!.actor).toBe('tester');
  });

  it('un proveedor que falla no tumba al resto y su cuota se devuelve', async () => {
    const a = fake('cloudflare', { fail: new ProviderError('cloudflare: 429 demasiadas peticiones', true, false, 'rate_limit') }), b = fake('pollinations');
    const before = await used();
    const { results } = await run(chainOf(a, b), ['cloudflare', 'pollinations']);
    expect(results[0]).toMatchObject({ provider: 'cloudflare', ok: false, dataUrl: null });
    expect(results[0]!.error).toMatch(/429/);
    expect(results[1]).toMatchObject({ provider: 'pollinations', ok: true });
    const after = await used();
    expect(after.cloudflare ?? 0).toBe(before.cloudflare ?? 0);
    expect((after.pollinations ?? 0) - (before.pollinations ?? 0)).toBe(1);
  });

  it('con dos elementos encadena el resultado y pasa previousItems en orden (2 llamadas por proveedor)', async () => {
    const a = fake('cloudflare');
    const before = await used();
    const { results } = await run(chainOf(a, fake('pollinations')), ['cloudflare'], 2);
    expect(results[0]!.ok).toBe(true);
    expect(a.inputs.map((i) => i.previousItems)).toEqual([[], ['Cosa 1']]);
    expect(a.inputs[0]!.itemImage).toBeTruthy();
    expect(results[0]!.prompts).toHaveLength(2);
    expect(((await used()).cloudflare ?? 0) - (before.cloudflare ?? 0)).toBe(2);
  });

  it('proveedor apagado o con tope diario: no se llama, no se gasta nada y se explica', async () => {
    await adminSetSetting(ctx, 'test', { key: 'ai_providers_off', value: ['cloudflare'] });
    await adminSetSetting(ctx, 'test', { key: 'ai_provider_limits', value: { pollinations: 1 } });
    await ctx.db.rpc('ss_reserve_admin_image_quota', { provider: 'pollinations', day_limit: 1000 });
    invalidateSettings(ctx.db);
    const a = fake('cloudflare'), b = fake('pollinations'), c = fake('aihorde');
    const before = await used();
    const { results } = await run(chainOf(a, b, c), ['cloudflare', 'pollinations', 'aihorde']);
    expect(results[0]!.error).toMatch(/apagado por el superadmin/);
    expect(results[1]!.error).toMatch(/tope diario/);
    expect(results[2]!.ok).toBe(true);
    expect(a.inputs).toHaveLength(0);
    expect(b.inputs).toHaveLength(0);
    expect((await used()).cloudflare ?? 0).toBe(before.cloudflare ?? 0);
  });

  it('tope diario global: el proveedor queda sin llamar y se explica', async () => {
    await adminSetSetting(ctx, 'test', { key: 'quota_per_day', value: 1 });
    invalidateSettings(ctx.db);
    const today = Object.values(await used()).reduce((s, n) => s + n, 0);
    const a = fake('cloudflare');
    const { results } = await run(chainOf(a, fake('pollinations')), ['cloudflare']);
    expect(today).toBeGreaterThanOrEqual(1); // el tope ya está agotado por los usos anteriores del test
    expect(results[0]).toMatchObject({ ok: false });
    expect(results[0]!.error).toMatch(/Cuota diaria/);
    expect(a.inputs).toHaveLength(0);
  });

  it('tiempo máximo: el proveedor lento falla con un mensaje claro y el otro responde', async () => {
    const slow = fake('cloudflare', { delay: 400 }), ok = fake('pollinations');
    const { results } = await run(chainOf(slow, ok), ['cloudflare', 'pollinations'], 1, { timeoutMs: 100 });
    expect(results[0]!.error).toMatch(/Tiempo agotado/);
    expect(results[1]!.ok).toBe(true);
    expect(COMPARE_TIMEOUT_MS).toBeLessThan(60_000);
  });

  it('límite de 4 proveedores (esquema y servicio) y proveedores desconocidos o no comparables', async () => {
    expect(MAX_COMPARE_PROVIDERS).toBe(4);
    const meta = { providers: [...IDS, 'cloudflare'], items: [{ name: 'x' }] };
    expect(compareMetaSchema.safeParse(meta).success).toBe(false);
    expect(compareMetaSchema.safeParse({ providers: ['demo'], items: [{ name: 'x' }] }).success).toBe(false);
    expect(compareMetaSchema.safeParse({ providers: ['openai'], items: [{ name: 'x' }] }).success).toBe(false);
    expect(compareMetaSchema.safeParse({ providers: ['cloudflare'], items: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] }).success).toBe(false);
    await expect(run(chainOf(fake('cloudflare'), fake('pollinations')), ['cloudflare', 'pollinations', 'aihorde', 'huggingface', 'x'])).rejects.toThrow(/Máximo 4/);
    await expect(run(chainOf(fake('cloudflare'), fake('pollinations')), ['aihorde'], 1, { configured: ['cloudflare', 'pollinations'] })).rejects.toThrow(/no configurado/);
  });

  it('sin proveedor real configurado: error claro, sin simular nada (ni demo ni pegatinas)', async () => {
    await expect(run(null, ['cloudflare'], 1, { configured: [] })).rejects.toThrow(/ningún proveedor de IA real/);
    expect(comparableProviders(['demo', 'openai'])).toEqual([]);
    expect(comparableProviders(['cloudflare', 'openai', 'aihorde'])).toEqual(['cloudflare', 'aihorde']);
  });

  it('con la IA apagada en Ajustes no compara', async () => {
    await adminSetSetting(ctx, 'test', { key: 'ai_enabled', value: false });
    invalidateSettings(ctx.db);
    const a = fake('cloudflare');
    await expect(run(chainOf(a, fake('pollinations')), ['cloudflare'])).rejects.toThrow(/apagada/);
    expect(a.inputs).toHaveLength(0);
  });

  it('una imagen que no es imagen se rechaza antes de gastar nada', async () => {
    const a = fake('cloudflare');
    const i = await full(['cloudflare']);
    i.base = new Uint8Array([1, 2, 3]);
    await expect(compareModels({ db: ctx.db, provider: chainOf(a, fake('pollinations')) }, 'tester', i, { configured: IDS })).rejects.toThrow(/Imagen base/);
    expect(a.inputs).toHaveLength(0);
  });
});
