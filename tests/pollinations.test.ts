import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { createPollinationsProvider } from '@/lib/ai/pollinations';
import { getImageProviderIds, pollinationsConfig } from '@/lib/config/env';
import { ProviderError } from '@/lib/ai/types';
import { redactSecrets } from '@/lib/security/redact';

const KEY = ['sk', 'abcdefghijklmnopqrstuvwx'].join('_'); // clave FALSA partida para el escáner
const cfg = { apiKey: KEY, model: 'black-forest-labs/flux.1-schnell', editModel: 'black-forest-labs/flux.2-klein-4b' as string | null, size: '1024x768' };
const png = async () => new Uint8Array(await sharp({ create: { width: 32, height: 32, channels: 3, background: '#ff8800' } }).png().toBuffer());
const ok = async () => new Response(JSON.stringify({ data: [{ b64_json: Buffer.from(await png()).toString('base64') }] }), { status: 200 });

describe('proveedor Pollinations (fetch simulado)', () => {
  it('genera: petición bien formada y decodifica base64', async () => {
    const f = vi.fn(ok);
    const out = await createPollinationsProvider({ ...cfg, fetchImpl: f as never }).generateInitialScene({ theme: 'playa', sceneDescription: 'una casa', playerName: 'Ana' });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://gen.pollinations.ai/v1/images/generations');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(init.body as string)).toMatchObject({ model: cfg.model, size: '1024x768', response_format: 'b64_json' });
    expect(out.bytes.length).toBeGreaterThan(10);
  });

  it('edita con multipart: casa + elemento como imágenes de referencia', async () => {
    const f = vi.fn(ok);
    const p = createPollinationsProvider({ ...cfg, fetchImpl: f as never });
    expect(p.capabilities.edit).toBe(true);
    await p.editScene({ base: { bytes: await png(), mime: 'image/png' }, itemImage: { bytes: await png(), mime: 'image/png' }, theme: 't', itemName: 'x', itemDescription: '', itemEmoji: null, previousItems: [] });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://gen.pollinations.ai/v1/images/edits');
    const form = init.body as FormData;
    expect(form.getAll('image')).toHaveLength(2);
    expect(form.get('model')).toBe(cfg.editModel);
  });

  it('sin modelo de edición no edita (error no reintentable y sin gasto)', async () => {
    const p = createPollinationsProvider({ ...cfg, editModel: null, fetchImpl: vi.fn() as never });
    expect(p.capabilities.edit).toBe(false);
    await expect(p.editScene({ base: { bytes: await png(), mime: 'image/png' }, theme: 't', itemName: 'x', itemDescription: '', itemEmoji: null, previousItems: [] })).rejects.toMatchObject({ kind: 'unsupported', consumed: false });
  });

  it.each([
    [401, 'auth', false], [402, 'quota', false], [429, 'rate_limit', false], [503, 'server', true], [400, 'input', false],
  ] as const)('HTTP %s → kind %s', async (status, kind, consumed) => {
    const p = createPollinationsProvider({ ...cfg, fetchImpl: (async () => new Response(`error ${KEY}`, { status })) as never });
    const err = await p.generateItemImage({ theme: 't', itemName: 'x', itemDescription: '', itemEmoji: null }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.kind).toBe(kind);
    expect(err.consumed).toBe(consumed);
    expect(err.message).not.toContain(KEY);
  });

  it('una respuesta solo con URL se rechaza (no se descarga)', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ data: [{ url: 'https://evil.example/x.png' }] }), { status: 200 }));
    await expect(createPollinationsProvider({ ...cfg, fetchImpl: f as never }).generateItemImage({ theme: 't', itemName: 'x', itemDescription: '', itemEmoji: null })).rejects.toThrow(/URL/);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('error de red: reintentable y sin gasto', async () => {
    const p = createPollinationsProvider({ ...cfg, fetchImpl: (async () => { throw new Error(`fallo ${KEY}`); }) as never });
    const err = await p.generateItemImage({ theme: 't', itemName: 'x', itemDescription: '', itemEmoji: null }).catch((e) => e);
    expect(err).toMatchObject({ kind: 'network', retryable: true, consumed: false });
    expect(err.message).not.toContain(KEY);
  });
});

describe('configuración de Pollinations', () => {
  it('necesita clave y entra en la cadena solo si se pide', () => {
    expect(pollinationsConfig({} as never)).toBeNull();
    expect(pollinationsConfig({ POLLINATIONS_API_KEY: KEY } as never)).toMatchObject({ model: 'black-forest-labs/flux.1-schnell', editModel: null, size: '1024x768' });
    expect(getImageProviderIds({ POLLINATIONS_API_KEY: KEY } as never)).toEqual([]);
    expect(getImageProviderIds({ IMAGE_PROVIDERS: 'pollinations', POLLINATIONS_API_KEY: KEY } as never)).toEqual(['pollinations']);
  });
  it('redacta la clave', () => {
    expect(redactSecrets(`x ${KEY} y`, {} as never)).not.toContain(KEY);
  });
});
