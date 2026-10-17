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
  const cf = { CLOUDFLARE_ACCOUNT_ID: 'acc', CLOUDFLARE_API_TOKEN: ['cfut', 'x'.repeat(20)].join('_') };
  it('IMAGE_PROVIDER (uno) sigue funcionando y exige credenciales', () => {
    expect(getImageProviderIds({ IMAGE_PROVIDER: 'cloudflare', ...cf } as never)).toEqual(['cloudflare']);
    expect(getImageProviderIds({ IMAGE_PROVIDER: 'cloudflare' } as never)).toEqual([]);
    expect(getImageProviderIds({ ...cf } as never)).toEqual([]);
  });
  it('un proveedor de pago no entra en una lista de varios', () => {
    expect(getImageProviderIds({ IMAGE_PROVIDERS: 'openai,cloudflare', OPENAI_API_KEY: ['sk', 'test', 'x'.repeat(20)].join('-'), ...cf } as never)).toEqual(['cloudflare']);
    expect(getImageProviderIds({ IMAGE_PROVIDERS: 'openai', OPENAI_API_KEY: ['sk', 'test', 'x'.repeat(20)].join('-') } as never)).toEqual(['openai']);
  });
  it('IMAGE_AI_DISABLED lo apaga todo', () => {
    expect(getImageProviderIds({ IMAGE_PROVIDERS: 'cloudflare', IMAGE_AI_DISABLED: 'true', ...cf } as never)).toEqual([]);
  });
});

describe('la cadena explica por qué no usó a un proveedor y permite forzar uno', () => {
  it('anota el fallo, luego el enfriamiento y el apagado por el superadmin en `notes`', async () => {
    const t = Date.parse('2026-10-17T10:00:00Z');
    const a = fake('cloudflare', { edit: true, fail: 'quota' }), b = fake('pollinations', { edit: true });
    const chain = createProviderChain([a, b], { now: () => t });
    const first = await chain.editScene(await editInput());
    expect(first.provider).toBe('pollinations');
    expect(first.notes).toMatch(/^edición real: cloudflare → pollinations; cloudflare falló \(quota: cloudflare falla: quota\); respondió pollinations \(2\.º de 2\)$/);
    const second = await chain.editScene(await editInput()); // cloudflare ya está en enfriamiento hasta las 00:00 UTC
    expect(second.notes).toMatch(/cloudflare en enfriamiento \(quota: /);
    // Sin fallos también se explica: quién va primero y quién respondió
    const ok = await createProviderChain([fake('cloudflare', { edit: true }), b]).editScene(await editInput());
    expect(ok.notes).toBe('edición real: cloudflare → pollinations; respondió cloudflare (1.º de 2)');
    // Si fallan todos, el error explica la cadena
    const all = createProviderChain([fake('cloudflare', { edit: true, fail: 'quota' }), fake('pollinations', { edit: true, fail: 'rate_limit' })], { now: () => t });
    await expect(all.generateItemImage({ theme: 't', itemName: 'x', itemDescription: '', itemEmoji: null })).rejects.toThrow(/\[generar desde cero: cloudflare → pollinations; cloudflare falló \(quota.*pollinations falló \(rate_limit/);
    // Apagado por el superadmin
    const gated = createProviderChain([fake('cloudflare', { edit: true }), b], { gate: async (id) => (id === 'cloudflare' ? { ok: false, reason: 'disabled' } : { ok: true }) });
    const g = await gated.editScene(await editInput());
    expect(g.provider).toBe('pollinations');
    expect(g.notes).toMatch(/cloudflare apagado o con el tope diario alcanzado/);
    expect(t).toBeGreaterThan(0);
  });

  it('asigna tareas: generar desde cero prueba antes a los que solo generan; editar solo usa a los que editan de verdad', async () => {
    const gen = (id: string, fail?: ProviderErrorKind): Fake => ({ ...fake(id, { edit: true, fail: fail ?? null }), realEdit: false });
    const ed = (id: string, fail?: ProviderErrorKind): Fake => ({ ...fake(id, { edit: true, fail: fail ?? null }), realEdit: true });
    const item = { theme: 't', itemName: 'x', itemDescription: '', itemEmoji: null };
    // La cadena está configurada con el editor primero, pero para generar manda quien solo genera
    const horde = gen('aihorde'), cf = ed('cloudflare');
    const r = await createProviderChain([cf, horde]).generateItemImage(item);
    expect(r.provider).toBe('aihorde');
    expect(cf.calls).toEqual([]);
    expect(r.notes).toBe('generar desde cero: aihorde → cloudflare; respondió aihorde (1.º de 2)');
    // Si el que solo genera falla (por cuota, etc.) se llega a los que sirven para todo
    const horde2 = gen('aihorde', 'quota'), hf2 = gen('huggingface', 'rate_limit'), cf2 = ed('cloudflare');
    const r2 = await createProviderChain([cf2, horde2, hf2]).generateInitialScene({ theme: 't', houseStyle: 'x' } as never);
    expect(r2.provider).toBe('cloudflare');
    expect(horde2.calls).toEqual(['initial']);
    expect(hf2.calls).toEqual(['initial']);
    // Editar: los que solo generan no se llaman nunca
    const horde3 = gen('aihorde'), cf3 = ed('cloudflare', 'server'), pol3 = ed('pollinations');
    const r3 = await createProviderChain([horde3, cf3, pol3]).editScene(await editInput());
    expect(r3.provider).toBe('pollinations');
    expect(horde3.calls).toEqual([]);
    expect(r3.notes).toMatch(/^edición real: cloudflare → pollinations;/);
    // `only` fuerza a un proveedor concreto aunque solo genere
    const horde4 = gen('aihorde');
    await createProviderChain([cf, horde4]).only!('aihorde')!.generateItemImage(item);
    expect(horde4.calls).toEqual(['item']);
  });

  it('`only(id)` devuelve ese proveedor solo (respetando los ajustes) o null si no está en la cadena', async () => {
    const a = fake('cloudflare', { edit: true }), b = fake('pollinations', { edit: true });
    const chain = createProviderChain([a, b]);
    const only = chain.only!('cloudflare')!;
    await only.editScene(await editInput());
    expect(a.calls).toEqual(['edit']);
    expect(b.calls).toEqual([]);
    expect(chain.only!('aihorde')).toBeNull();
    const blocked = createProviderChain([a, b], { gate: async () => ({ ok: false, reason: 'disabled' }) }).only!('cloudflare')!;
    await expect(blocked.editScene(await editInput())).rejects.toThrow(/apagado por el superadmin/);
  });
});
