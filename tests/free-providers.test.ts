import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { createAiHordeProvider } from '@/lib/ai/aihorde';
import { createHuggingFaceProvider } from '@/lib/ai/huggingface';
import { createProviderChain } from '@/lib/ai/chain';
import { aiHordeConfig, DEFAULT_HF_MODELS, getImageProviderIds, huggingFaceConfig } from '@/lib/config/env';
import { ProviderError } from '@/lib/ai/types';
import { redactSecrets } from '@/lib/security/redact';

const HF = ['hf', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6'].join('_'); // FALSO, partido para el escáner
const png = async () => new Uint8Array(await sharp({ create: { width: 16, height: 16, channels: 3, background: '#2288cc' } }).png().toBuffer());
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
const input = { theme: 'playa', sceneDescription: 'una casa', playerName: 'Ana' };
const item = { theme: 'playa', itemName: 'sombrilla', itemDescription: 'roja', itemEmoji: null };
const hordeCfg = { ...aiHordeConfig({} as never), maxWaitMs: 30_000 };

describe('AI Horde (fetch simulado)', () => {
  function horde(opts: { checks?: object[]; status?: object; submit?: Response } = {}) {
    const calls: { path: string; method: string; body?: string; headers: Record<string, string> }[] = [];
    let k = 0;
    const f = vi.fn(async (url: string, init: RequestInit) => {
      const path = url.replace('https://aihorde.net/api/v2', '');
      calls.push({ path, method: init.method ?? 'GET', body: init.body as string | undefined, headers: init.headers as Record<string, string> });
      if (path === '/generate/async') return opts.submit ?? json({ id: 'job-1', kudos: 4 }, 202);
      if (path.startsWith('/generate/check/')) return json((opts.checks ?? [{ done: true }])[Math.min(k++, (opts.checks ?? [1]).length - 1)]);
      if (path.startsWith('/generate/status/') && init.method === 'DELETE') return json({});
      if (path.startsWith('/generate/status/')) return json(opts.status ?? {});
      throw new Error(`ruta inesperada ${path}`);
    });
    return { f, calls };
  }

  it('envía la petición asíncrona con clave anónima y Client-Agent, sondea y decodifica la imagen en base64', async () => {
    const b64 = Buffer.from(await png()).toString('base64');
    const { f, calls } = horde({ checks: [{ done: false, is_possible: true }, { done: true }], status: { generations: [{ img: b64, model: 'stable_diffusion' }] } });
    const sleep = vi.fn(async () => undefined);
    const out = await createAiHordeProvider({ ...hordeCfg, fetchImpl: f as never, sleep }).generateInitialScene(input);
    expect(out.bytes.length).toBeGreaterThan(10);
    expect(sleep).toHaveBeenCalledTimes(1);
    const submit = calls[0]!;
    expect(submit).toMatchObject({ path: '/generate/async', method: 'POST' });
    expect(submit.headers.apikey).toBe('0000000000');
    expect(submit.headers['Client-Agent']).toMatch(/^subasta-salvaje:1\.0:/);
    const body = JSON.parse(submit.body!);
    expect(body).toMatchObject({ nsfw: false, censor_nsfw: true, r2: false, params: { width: 768, height: 512, n: 1 } });
    expect(body.prompt).toContain(' ### '); // prompt negativo
    expect(body.prompt.length).toBeLessThanOrEqual(900 + 200);
  });

  it('una imagen censurada, una petición fallida o un trabajo imposible se explican y no gastan', async () => {
    const censored = horde({ status: { generations: [{ img: 'AAAA', censored: true }] } });
    await expect(createAiHordeProvider({ ...hordeCfg, fetchImpl: censored.f as never }).generateItemImage(item)).rejects.toMatchObject({ kind: 'moderation' });
    const faulted = horde({ checks: [{ faulted: true }] });
    await expect(createAiHordeProvider({ ...hordeCfg, fetchImpl: faulted.f as never }).generateItemImage(item)).rejects.toMatchObject({ kind: 'server', consumed: false });
    const impossible = horde({ checks: [{ done: false, is_possible: false }] });
    const err = await createAiHordeProvider({ ...hordeCfg, fetchImpl: impossible.f as never }).generateItemImage(item).catch((e) => e);
    expect(err.kind).toBe('unsupported');
    expect(impossible.calls.some((c) => c.method === 'DELETE')).toBe(true); // se cancela en la cola
  });

  it('si la cola tarda demasiado se rinde, cancela y conserva la imagen anterior', async () => {
    let t = 0;
    const { f, calls } = horde({ checks: [{ done: false, is_possible: true }] });
    const err = await createAiHordeProvider({ ...hordeCfg, maxWaitMs: 10_000, fetchImpl: f as never, sleep: async () => undefined, now: () => (t += 6000) }).generateInitialScene(input).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({ kind: 'server', retryable: true, consumed: false });
    expect(err.message).toMatch(/no terminó/);
    expect(calls.some((c) => c.method === 'DELETE')).toBe(true);
  });

  it('errores HTTP: clave rechazada, límite de ritmo y servidor caído; sin filtrar la clave', async () => {
    const mk = (status: number) => createAiHordeProvider({ ...hordeCfg, apiKey: 'clave-secreta-1234', fetchImpl: (async () => new Response('fallo clave-secreta-1234', { status })) as never });
    for (const [status, kind] of [[401, 'auth'], [429, 'rate_limit'], [503, 'server'], [400, 'input']] as const) {
      const err = await mk(status).generateItemImage(item).catch((e) => e);
      expect(err.kind).toBe(kind);
    }
    const net = await createAiHordeProvider({ ...hordeCfg, fetchImpl: (async () => { throw new Error('boom'); }) as never }).generateItemImage(item).catch((e) => e);
    expect(net).toMatchObject({ kind: 'network', consumed: false });
  });

  it('solo genera: editar falla sin gasto, y la cadena la usa con composición', async () => {
    const p = createAiHordeProvider({ ...hordeCfg, fetchImpl: horde().f as never });
    expect(p.capabilities.edit).toBe(false);
    await expect(p.editScene({ base: { bytes: await png(), mime: 'image/png' }, theme: 't', itemName: 'x', itemDescription: '', itemEmoji: null, previousItems: [] })).rejects.toMatchObject({ kind: 'unsupported', consumed: false });
  });

  it('configuración: clave anónima por defecto, tamaño múltiplo de 64 y límites', () => {
    expect(aiHordeConfig({} as never)).toMatchObject({ apiKey: '0000000000', width: 768, height: 512, steps: 25, maxWaitMs: 90_000, models: [] });
    expect(aiHordeConfig({ AI_HORDE_API_KEY: 'mia', AI_HORDE_SIZE: '1000x700', AI_HORDE_MODELS: 'a, b', AI_HORDE_MAX_WAIT_SECONDS: '5' } as never)).toMatchObject({ apiKey: 'mia', width: 1024, height: 704, models: ['a', 'b'], maxWaitMs: 90_000 });
  });
});

describe('Hugging Face (fetch simulado)', () => {
  const cfg = { token: HF, model: 'black-forest-labs/FLUX.1-schnell' };
  it('POST con Bearer y {inputs}, y devuelve los bytes de la imagen', async () => {
    const bytes = await png();
    const f = vi.fn(async () => new Response(bytes as BodyInit, { status: 200, headers: { 'content-type': 'image/png' } }));
    const out = await createHuggingFaceProvider({ ...cfg, fetchImpl: f as never }).generateItemImage(item);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${HF}`);
    expect(JSON.parse(init.body as string)).toHaveProperty('inputs');
    expect(out).toMatchObject({ mime: 'image/png', model: cfg.model });
    expect(out.bytes.length).toBe(bytes.length);
  });

  it('un modelo retirado (410) se salta y prueba el siguiente; si no queda ninguno, el error es saltable y la cadena sigue con otro proveedor', async () => {
    const bytes = await png();
    const calls: string[] = [];
    const f = (async (u: string) => {
      calls.push(u.split('/models/')[1]!);
      return calls.at(-1) === 'viejo/modelo'
        ? new Response('{"error":"The requested model is deprecated and no longer supported by provider hf-inference"}', { status: 410 })
        : new Response(bytes as BodyInit, { status: 200, headers: { 'content-type': 'image/png' } });
    }) as never;
    const p = createHuggingFaceProvider({ token: HF, model: 'viejo/modelo, nuevo/modelo', fetchImpl: f });
    expect((await p.generateItemImage(item)).model).toBe('nuevo/modelo');
    await p.generateItemImage(item);
    expect(calls).toEqual(['viejo/modelo', 'nuevo/modelo', 'nuevo/modelo']); // el retirado no se vuelve a pedir

    const dead = createHuggingFaceProvider({ token: HF, model: 'viejo/modelo', fetchImpl: (async () => new Response('{"error":"deprecated"}', { status: 410 })) as never });
    const err = await dead.generateInitialScene(input).catch((e) => e);
    expect(err.kind).toBe('unsupported'); // saltable: no tumba la generación
    expect(err.message).toMatch(/HF_IMAGE_MODEL/);
    // En la cadena, el siguiente proveedor responde en su lugar
    const chain = createProviderChain([dead, { id: 'pollinations', capabilities: { edit: false }, generateInitialScene: async () => ({ bytes, mime: 'image/png', prompt: 'p', model: 'm' }), generateItemImage: async () => ({ bytes, mime: 'image/png', prompt: 'p', model: 'm' }), editScene: async () => { throw new Error('x'); } } as never]);
    expect((await chain.generateInitialScene(input)).provider).toBe('pollinations');
  });

  it.each([[401, 'auth', false], [402, 'quota', false], [429, 'rate_limit', false], [503, 'server', false], [500, 'server', true], [400, 'input', false]] as const)('HTTP %s → %s (consumida: %s) sin filtrar el token', async (status, kind, consumed) => {
    const p = createHuggingFaceProvider({ ...cfg, fetchImpl: (async () => new Response(`error ${HF}`, { status, headers: { 'content-type': 'application/json' } })) as never });
    const err = await p.generateInitialScene(input).catch((e) => e);
    expect(err.kind).toBe(kind);
    expect(err.consumed).toBe(consumed);
    expect(err.message).not.toContain(HF);
  });

  it('configuración y redacción del token', () => {
    expect(huggingFaceConfig({} as never)).toBeNull();
    expect(huggingFaceConfig({ HF_TOKEN: HF } as never)).toEqual({ token: HF, model: DEFAULT_HF_MODELS });
    expect(huggingFaceConfig({ HUGGINGFACE_API_KEY: HF, HF_IMAGE_MODEL: 'otro/modelo' } as never)).toMatchObject({ model: 'otro/modelo' });
    expect(redactSecrets(`x ${HF} y`, {} as never)).not.toContain(HF);
  });
});

describe('la cadena con los nuevos proveedores', () => {
  it('AI Horde solo entra si se pide; Hugging Face necesita token; openai sigue sin poder ir en una lista', () => {
    expect(getImageProviderIds({ AI_HORDE_API_KEY: 'x' } as never)).toEqual([]);
    expect(getImageProviderIds({ IMAGE_PROVIDERS: 'aihorde' } as never)).toEqual(['aihorde']);
    expect(getImageProviderIds({ IMAGE_PROVIDERS: 'huggingface' } as never)).toEqual([]);
    expect(getImageProviderIds({ IMAGE_PROVIDERS: 'cloudflare, aihorde,huggingface', HF_TOKEN: HF, CLOUDFLARE_ACCOUNT_ID: 'a', CLOUDFLARE_API_TOKEN: 'b' } as never)).toEqual(['cloudflare', 'aihorde', 'huggingface']);
    expect(getImageProviderIds({ IMAGE_PROVIDERS: 'openai,aihorde', OPENAI_API_KEY: 'sk-x'.padEnd(30, 'x') } as never)).toEqual(['aihorde']);
  });

  it('cuando el primero se queda sin cuota, la cadena pasa a AI Horde', async () => {
    const quota = { id: 'cloudflare' as const, capabilities: { edit: false }, generateInitialScene: async () => { throw new ProviderError('cuota', false, false, 'quota'); }, generateItemImage: async () => { throw new ProviderError('cuota', false, false, 'quota'); }, editScene: async () => { throw new ProviderError('x', false, false, 'quota'); } };
    const b64 = Buffer.from(await png()).toString('base64');
    const f = vi.fn(async (url: string) => (url.endsWith('/generate/async') ? json({ id: 'j' }) : url.includes('/check/') ? json({ done: true }) : json({ generations: [{ img: b64 }] })));
    const chain = createProviderChain([quota, createAiHordeProvider({ ...hordeCfg, fetchImpl: f as never })]);
    const r = await chain.generateInitialScene(input);
    expect(r.provider).toBe('aihorde');
  });
});
