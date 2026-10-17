import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { cooldownUntil, createProviderChain } from '@/lib/ai/chain';
import { getImageProviderIds } from '@/lib/config/env';
import { ProviderError, type EditSceneInput, type GeneratedImage, type ImageGenerationProvider, type ProviderErrorKind } from '@/lib/ai/types';

const png = async (color: string, w = 64, h = 48) => new Uint8Array(await sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer());
const img = async (tag: string): Promise<GeneratedImage> => ({ bytes: await png('#336699'), mime: 'image/png', prompt: tag, model: tag });

interface Fake extends ImageGenerationProvider {
  calls: string[];
}
function fake(id: string, opts: { edit?: boolean; fail?: ProviderErrorKind | null } = {}): Fake {
  const calls: string[] = [];
  const go = async (op: string) => {
    calls.push(op);
    if (opts.fail) throw new ProviderError(`${id} falla: ${opts.fail}`, false, false, opts.fail);
    return img(`${id}:${op}`);
  };
  return {
    id: id as never,
    calls,
    capabilities: { edit: opts.edit ?? false },
    generateInitialScene: () => go('initial'),
    generateItemImage: () => go('item'),
    editScene: () => go('edit'),
  };
}
const editInput = async (): Promise<EditSceneInput> => ({ base: { bytes: await png('#ffffff', 256, 192), mime: 'image/png' }, theme: 't', itemName: 'x', itemDescription: '', itemEmoji: null, previousItems: [] });

describe('cadena de proveedores', () => {
  it('con un solo proveedor devuelve ese mismo proveedor', () => {
    const a = fake('cloudflare');
    expect(createProviderChain([a])).toBe(a);
  });

  it('usa el primero y registra qué proveedor respondió', async () => {
    const a = fake('cloudflare'), b = fake('openai');
    const out = await createProviderChain([a, b]).generateInitialScene({ theme: 't', sceneDescription: 's', playerName: 'p' });
    expect(out.provider).toBe('cloudflare');
    expect(b.calls).toEqual([]);
  });

  it.each(['quota', 'rate_limit', 'auth', 'network', 'server'] as const)('salta al siguiente por %s', async (kind) => {
    const a = fake('a', { fail: kind }), b = fake('b');
    const skips: string[] = [];
    const chain = createProviderChain([a, b], { onSkip: (s) => skips.push(s.provider) });
    const out = await chain.generateItemImage({ theme: 't', itemName: 'x', itemDescription: '', itemEmoji: null });
    expect(out.provider).toBe('b');
    expect(skips).toEqual(['a']);
  });

  it('la moderación y la entrada inválida NO saltan a otro proveedor', async () => {
    for (const kind of ['moderation', 'input', 'unknown'] as const) {
      const a = fake('a', { fail: kind }), b = fake('b');
      await expect(createProviderChain([a, b]).generateInitialScene({ theme: 't', sceneDescription: 's', playerName: 'p' })).rejects.toThrow(/falla/);
      expect(b.calls).toEqual([]);
    }
  });

  it('enfría al proveedor fallido y lo vuelve a probar al terminar el enfriamiento', async () => {
    let t = Date.UTC(2026, 0, 1, 10);
    const a = fake('a', { fail: 'rate_limit' }), b = fake('b');
    const chain = createProviderChain([a, b], { now: () => t });
    const gen = () => chain.generateInitialScene({ theme: 't', sceneDescription: 's', playerName: 'p' });
    await gen();
    await gen();
    expect(a.calls).toHaveLength(1); // la segunda vez ni se intenta
    t += 61_000;
    await gen();
    expect(a.calls).toHaveLength(2);
  });

  it('la cuota diaria enfría hasta las 00:00 UTC', () => {
    const now = Date.UTC(2026, 5, 10, 15, 30);
    expect(cooldownUntil('quota', now)).toBe(Date.UTC(2026, 5, 11));
  });

  it('todos fallan: lanza el último error y no inventa imagen', async () => {
    const chain = createProviderChain([fake('a', { fail: 'quota' }), fake('b', { fail: 'network' })]);
    await expect(chain.generateInitialScene({ theme: 't', sceneDescription: 's', playerName: 'p' })).rejects.toMatchObject({ kind: 'network' });
  });

  it('edita con el primer proveedor que edita', async () => {
    const a = fake('a'), b = fake('b', { edit: true });
    const out = await createProviderChain([a, b]).editScene(await editInput());
    expect(out.provider).toBe('b');
    expect(a.calls).toEqual([]);
  });

  it('sin proveedor que edite, usa la composición con el objeto del siguiente que genere', async () => {
    const a = fake('a', { fail: 'quota' }), b = fake('b');
    // el objeto aislado sobre fondo liso para poder recortarlo
    b.generateItemImage = async () => {
      b.calls.push('item');
      const bytes = new Uint8Array(await sharp({ create: { width: 200, height: 200, channels: 3, background: '#ffffff' } }).composite([{ input: await sharp({ create: { width: 80, height: 80, channels: 3, background: '#cc2200' } }).png().toBuffer(), left: 60, top: 60 }]).png().toBuffer());
      return { bytes, mime: 'image/png', prompt: 'obj', model: 'b' };
    };
    const out = await createProviderChain([a, b]).editScene(await editInput());
    expect(out.model).toContain('+compose');
    expect(out.provider).toBe('b');
    expect(b.calls).toEqual(['item']);
  });

  it('si el editor falla por cuota cae a la composición; si falla por moderación, no', async () => {
    const editorQuota = fake('a', { edit: true, fail: 'quota' }), gen = fake('b');
    gen.generateItemImage = async () => ({ bytes: new Uint8Array(await sharp({ create: { width: 200, height: 200, channels: 3, background: '#ffffff' } }).composite([{ input: await sharp({ create: { width: 80, height: 80, channels: 3, background: '#00aa44' } }).png().toBuffer(), left: 60, top: 60 }]).png().toBuffer()), mime: 'image/png', prompt: 'o', model: 'b' });
    expect((await createProviderChain([editorQuota, gen]).editScene(await editInput())).model).toContain('+compose');
    const editorMod = fake('a', { edit: true, fail: 'moderation' });
    await expect(createProviderChain([editorMod, fake('b')]).editScene(await editInput())).rejects.toMatchObject({ kind: 'moderation' });
  });
});

describe('configuración de la cadena', () => {
  const cf = { CLOUDFLARE_ACCOUNT_ID: 'acc', CLOUDFLARE_API_TOKEN: 'cfut_xxxxxxxxxxxxxxxxxxxx' };
  it('IMAGE_PROVIDER (uno) sigue funcionando y exige credenciales', () => {
    expect(getImageProviderIds({ IMAGE_PROVIDER: 'cloudflare', ...cf } as never)).toEqual(['cloudflare']);
    expect(getImageProviderIds({ IMAGE_PROVIDER: 'cloudflare' } as never)).toEqual([]);
    expect(getImageProviderIds({ ...cf } as never)).toEqual([]);
  });
  it('un proveedor de pago no entra en una lista de varios', () => {
    expect(getImageProviderIds({ IMAGE_PROVIDERS: 'openai,cloudflare', OPENAI_API_KEY: 'sk-test-xxxxxxxxxxxxxxxxxxxx', ...cf } as never)).toEqual(['cloudflare']);
    expect(getImageProviderIds({ IMAGE_PROVIDERS: 'openai', OPENAI_API_KEY: 'sk-test-xxxxxxxxxxxxxxxxxxxx' } as never)).toEqual(['openai']);
  });
  it('IMAGE_AI_DISABLED lo apaga todo', () => {
    expect(getImageProviderIds({ IMAGE_PROVIDERS: 'cloudflare', IMAGE_AI_DISABLED: 'true', ...cf } as never)).toEqual([]);
  });
});
