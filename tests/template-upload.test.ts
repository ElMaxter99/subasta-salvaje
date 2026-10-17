import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { applyAsset, matchTarget, slugify } from '@/lib/domain/template-assets';
import { githubAssetsConfig } from '@/lib/config/env';
import { redactSecrets } from '@/lib/security/redact';
import { AssetUploadError, createGithubAssets, type GithubAssets } from '@/lib/storage/github-assets';
import { uploadTemplateImage } from '@/lib/services/system-template-service';
import { makeCtx, type TestCtx } from './helpers';

const TOKEN = ['github', 'pat', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4'].join('_'); // FALSO, partido para el escáner
const CFG = { repo: 'yo/fotos', token: TOKEN, branch: 'main' };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

describe('cliente de GitHub (fetch simulado)', () => {
  it('sube un archivo nuevo y devuelve un enlace de jsDelivr fijado al commit', async () => {
    const calls: { url: string; method: string; body?: string; auth?: string }[] = [];
    const f = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method ?? 'GET', body: init.body as string | undefined, auth: (init.headers as Record<string, string>).Authorization });
      if ((init.method ?? 'GET') === 'GET') return json({ message: 'Not Found' }, 404);
      return json({ commit: { sha: 'abc123def456' } }, 201);
    });
    const r = await createGithubAssets(CFG, f as never).put('plantillas/luna/item-cráter-1.webp'.replace('á', 'a'), new Uint8Array([1, 2, 3]), 'msg');
    expect(r).toMatchObject({ existed: false, sha: 'abc123def456', url: 'https://cdn.jsdelivr.net/gh/yo/fotos@abc123def456/plantillas/luna/item-crater-1.webp' });
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.url).toBe('https://api.github.com/repos/yo/fotos/contents/plantillas/luna/item-crater-1.webp');
    expect(JSON.parse(put.body!)).toMatchObject({ message: 'msg', branch: 'main', content: Buffer.from([1, 2, 3]).toString('base64') });
    expect(put.auth).toBe(`Bearer ${TOKEN}`);
  });

  it('si el archivo ya existe no lo vuelve a subir y fija el enlace al commit actual', async () => {
    const f = vi.fn(async (url: string, init: RequestInit) => {
      if (url.includes('/commits/')) return json({ sha: 'headsha1' });
      if ((init.method ?? 'GET') === 'GET') return json({ sha: 'blob' });
      throw new Error('no debe subir');
    });
    const r = await createGithubAssets(CFG, f as never).put('plantillas/a/b.webp', new Uint8Array([1]), 'm');
    expect(r).toMatchObject({ existed: true, sha: 'headsha1' });
  });

  it('reintenta ante un conflicto y explica los errores sin filtrar el token', async () => {
    let puts = 0;
    const conflict = vi.fn(async (_u: string, init: RequestInit) => {
      if ((init.method ?? 'GET') === 'GET') return json({}, 404);
      return ++puts < 2 ? json({ message: 'conflict' }, 409) : json({ commit: { sha: 'okok' } }, 201);
    });
    expect((await createGithubAssets(CFG, conflict as never).put('plantillas/a/b.webp', new Uint8Array([1]), 'm')).sha).toBe('okok');

    const denied = vi.fn(async (_u: string, init: RequestInit) => ((init.method ?? 'GET') === 'GET' ? json({}, 404) : new Response(`bad ${TOKEN}`, { status: 403 })));
    const err = await createGithubAssets(CFG, denied as never).put('plantillas/a/b.webp', new Uint8Array([1]), 'm').catch((e) => e);
    expect(err).toBeInstanceOf(AssetUploadError);
    expect(err.kind).toBe('auth');
    expect(err.message).not.toContain(TOKEN);

    const down = (async () => { throw new Error(`boom ${TOKEN}`); }) as never;
    const net = await createGithubAssets(CFG, down).put('plantillas/a/b.webp', new Uint8Array([1]), 'm').catch((e) => e);
    expect(net.kind).toBe('network');
    expect(net.message).not.toContain(TOKEN);
  });

  it('rechaza repositorios y rutas peligrosas', async () => {
    expect(() => createGithubAssets({ ...CFG, repo: 'no-valido' })).toThrow();
    const a = createGithubAssets(CFG, (async () => json({})) as never);
    for (const p of ['../secreto.webp', '/abs.webp', 'a//b.webp', 'A/Mayus.webp', '']) await expect(a.put(p, new Uint8Array([1]), 'm')).rejects.toBeInstanceOf(AssetUploadError);
  });

  it('configuración por entorno y redacción del token', () => {
    expect(githubAssetsConfig({} as never)).toBeNull();
    expect(githubAssetsConfig({ GITHUB_ASSETS_REPO: 'yo/fotos', GITHUB_ASSETS_TOKEN: TOKEN } as never)).toEqual({ repo: 'yo/fotos', token: TOKEN, branch: 'main', apiBase: 'https://api.github.com' });
    // la base de la API solo se admite para un servidor local de pruebas: un host externo se ignora (el token no sale de GitHub)
    expect(githubAssetsConfig({ GITHUB_ASSETS_REPO: 'yo/fotos', GITHUB_ASSETS_TOKEN: TOKEN, GITHUB_ASSETS_API_BASE: 'https://evil.com' } as never)!.apiBase).toBe('https://api.github.com');
    expect(githubAssetsConfig({ GITHUB_ASSETS_REPO: 'yo/fotos', GITHUB_ASSETS_TOKEN: TOKEN, GITHUB_ASSETS_API_BASE: 'http://127.0.0.1:3299' } as never)!.apiBase).toBe('http://127.0.0.1:3299');
    expect(redactSecrets(`x ${TOKEN} y`, {} as never)).not.toContain(TOKEN);
  });
});

describe('qué campo recibe cada imagen soltada', () => {
  const t = { catalogo: [{ titulo: 'Sombrilla roja', descripcion: '' }, { titulo: 'Hamaca', descripcion: '' }, { titulo: 'Hamaca doble', descripcion: '' }] };
  it('por nombre de archivo: portada, casa y elementos (sin tildes ni mayúsculas)', () => {
    expect(matchTarget('Portada.JPG', t)).toEqual({ kind: 'cover' });
    expect(matchTarget('casa-inicial.png', t)).toEqual({ kind: 'scene' });
    expect(matchTarget('Sombrilla_Roja.webp', t)).toEqual({ kind: 'item', index: 0 });
    expect(matchTarget('hamaca.jpg', t)).toEqual({ kind: 'item', index: 1 }); // exacta gana a «hamaca doble»
    expect(matchTarget('hamaca-doble-2.jpg', t)).toEqual({ kind: 'item', index: 2 });
    expect(matchTarget('IMG_0001.jpg', t)).toBeNull();
    expect(slugify('Cráter Ñandú!')).toBe('crater-nandu');
  });
  it('applyAsset pone la URL en el campo y no toca el resto', () => {
    const base = { formato: 'subasta-salvaje/plantilla@1', nombre: 'X', tematica: 'Casa', reglas: {}, jugadores: [], catalogo: t.catalogo } as never;
    expect(applyAsset(base, { kind: 'cover' }, 'https://u/c.webp')).toMatchObject({ portada: 'https://u/c.webp' });
    expect(applyAsset(base, { kind: 'scene' }, 'https://u/s.webp')).toMatchObject({ casa_inicial: 'https://u/s.webp' });
    const r = applyAsset(base, { kind: 'item', index: 1 }, 'https://u/h.webp') as { catalogo: { foto?: string }[] };
    expect(r.catalogo.map((i) => i.foto)).toEqual([undefined, 'https://u/h.webp', undefined]);
  });
});

describe('subida de la imagen de una plantilla (servicio)', () => {
  let ctx: TestCtx;
  let big: Uint8Array;
  beforeAll(async () => {
    ctx = await makeCtx();
    big = new Uint8Array(await sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#2288cc' } }).jpeg().toBuffer());
  });
  afterAll(async () => {
    await ctx.db.close();
  });

  it('normaliza a WebP, nombra por hash, sube a GitHub (no a Supabase) y deja constancia en la auditoría', async () => {
    const puts: { path: string; bytes: Uint8Array }[] = [];
    const assets: GithubAssets = { put: async (path, bytes) => (puts.push({ path, bytes }), { path, url: `https://cdn.jsdelivr.net/gh/yo/fotos@sha1/${path}`, sha: 'sha1', existed: false }) };
    const r = await uploadTemplateImage(ctx, 'admin@x.com', { slug: 'Noche Luna', kind: 'scene', name: 'Casa Inicial.JPG', bytes: big }, assets);
    expect(r.url).toMatch(/^https:\/\/cdn\.jsdelivr\.net\/gh\/yo\/fotos@sha1\/plantillas\/noche-luna\/scene-casa-inicial-[0-9a-f]{12}\.webp$/);
    expect(r).toMatchObject({ kind: 'scene', width: 1536, height: 1024 });
    expect((await sharp(Buffer.from(puts[0]!.bytes)).metadata()).format).toBe('webp');
    expect(ctx.storage.files.size).toBe(0); // nada en el Storage de Supabase
    const a = await ctx.db.pg.query<{ action: string }>("select action from admin_audit where action = 'system_template_image_uploaded'");
    expect(a.rows).toHaveLength(1);
  });

  it('sin configuración, sin slug o con una imagen no válida falla con un mensaje claro y no sube nada', async () => {
    const put = vi.fn();
    const assets = { put } as unknown as GithubAssets;
    await expect(uploadTemplateImage(ctx, 'a', { slug: 'x-y', kind: 'item', name: 'a.jpg', bytes: big }, null)).rejects.toThrow(/no está configurada/);
    await expect(uploadTemplateImage(ctx, 'a', { slug: '', kind: 'item', name: 'a.jpg', bytes: big }, assets)).rejects.toThrow(/identificador/);
    await expect(uploadTemplateImage(ctx, 'a', { slug: 'x-y', kind: 'item', name: 'a.svg', bytes: new TextEncoder().encode('<svg/>') }, assets)).rejects.toMatchObject({ code: 'invalid_input' });
    expect(put).not.toHaveBeenCalled();
  });

  it('un fallo de GitHub se traduce en un error con el motivo', async () => {
    const assets: GithubAssets = { put: async () => { throw new AssetUploadError('GitHub rechazó el token (401).', 'auth'); } };
    await expect(uploadTemplateImage(ctx, 'a', { slug: 'x-y', kind: 'item', name: 'a.jpg', bytes: big }, assets)).rejects.toThrow(/rechazó el token/);
  });
});

describe('varias imágenes de una plantilla: un solo commit', () => {
  it('prepara cada imagen sin commit y las publica juntas; rechaza rutas ajenas', async () => {
    const { stageTemplateImage, commitTemplateImages } = await import('@/lib/services/system-template-service');
    const ctx = await makeCtx();
    const commits: string[][] = [];
    let n = 0;
    const assets = {
      stageBlob: async () => String(++n).padStart(40, 'b'),
      commitMany: async (files: { path: string }[]) => { commits.push(files.map((f) => f.path)); return { sha: 'c'.repeat(40), files: files.map((f) => ({ path: f.path, url: `https://cdn.jsdelivr.net/gh/yo/fotos@${'c'.repeat(40)}/${f.path}`, sha: 'c'.repeat(40), existed: false })) }; },
    };
    const img = async (c: string) => new Uint8Array(await sharp({ create: { width: 900, height: 600, channels: 3, background: c } }).jpeg().toBuffer());
    const a = await stageTemplateImage({ slug: 'Luna', kind: 'cover', name: 'portada.jpg', bytes: await img('#ff0000') }, assets);
    const b = await stageTemplateImage({ slug: 'Luna', kind: 'item', name: 'rover.jpg', bytes: await img('#00ff00') }, assets);
    expect(commits).toHaveLength(0);
    expect(a.path).toMatch(/^plantillas\/luna\/cover-portada-[0-9a-f]{12}\.webp$/);
    const r = await commitTemplateImages(ctx, 'admin', [a, b], assets);
    expect(commits).toHaveLength(1);
    expect(commits[0]).toHaveLength(2);
    expect(r.files.map((f) => f.kind)).toEqual(['cover', 'item']);
    expect(r.files[0]!.url).toContain(`@${'c'.repeat(40)}/plantillas/luna/`);
    await expect(commitTemplateImages(ctx, 'admin', [{ ...a, path: 'otra-carpeta/x.webp' }], assets)).rejects.toMatchObject({ code: 'invalid_input' });
    await ctx.db.close();
  });
});
