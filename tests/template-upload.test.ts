import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { applyAsset, matchTarget, slugify } from '@/lib/domain/template-assets';
import { githubAssetsConfig } from '@/lib/config/env';
import { redactSecrets } from '@/lib/security/redact';
import { AssetUploadError, createGithubAssets, type GithubBatchAssets } from '@/lib/storage/github-assets';
import { commitTemplateImages, saveSystemTemplate, stageTemplateImage } from '@/lib/services/system-template-service';
import { makeCtx } from './helpers';

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
  it('por nombre de archivo: portada, imagen inicial y elementos (sin tildes ni mayúsculas)', () => {
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

describe('imágenes de una plantilla: se preparan al guardar y entran en UN solo commit', () => {
  const img = async (c: string) => new Uint8Array(await sharp({ create: { width: 900, height: 600, channels: 3, background: c } }).jpeg().toBuffer());
  const SHA = 'c'.repeat(40);
  const make = (existing: string[] = []) => {
    const log: { files: string[]; deletes: string[]; message: string }[] = [];
    let n = 0;
    const assets: GithubBatchAssets = {
      stageBlob: async () => String(++n).padStart(40, 'b'),
      listFolder: async () => existing,
      commitMany: async (files, message, deletes = []) => {
        log.push({ files: files.map((f) => f.path), deletes, message });
        return { sha: SHA, files: files.map((f) => ({ path: f.path, url: `https://cdn.jsdelivr.net/gh/yo/fotos@${SHA}/${f.path}`, sha: SHA, existed: false })) };
      },
    };
    return { assets, log };
  };

  it('prepara sin commit: normaliza a WebP, nombra por hash y no toca Supabase Storage', async () => {
    const ctx = await makeCtx();
    const { assets, log } = make();
    const a = await stageTemplateImage({ slug: 'Noche Luna', kind: 'scene', name: 'Casa Inicial.JPG', bytes: await img('#2288cc') }, assets);
    expect(a.path).toMatch(/^plantillas\/noche-luna\/scene-casa-inicial-[0-9a-f]{12}\.webp$/);
    expect(a).toMatchObject({ kind: 'scene', width: 900 });
    expect(log).toHaveLength(0); // preparar no crea commits
    expect(ctx.storage.files.size).toBe(0);
    await ctx.db.close();
  });

  it('sin configuración, sin slug o con una imagen no válida falla con un mensaje claro', async () => {
    const { assets } = make();
    await expect(stageTemplateImage({ slug: 'x-y', kind: 'item', name: 'a.jpg', bytes: await img('#fff') }, null)).rejects.toThrow(/no está configurada/);
    await expect(stageTemplateImage({ slug: '', kind: 'item', name: 'a.jpg', bytes: await img('#fff') }, assets)).rejects.toThrow(/identificador/);
    await expect(stageTemplateImage({ slug: 'x-y', kind: 'item', name: 'a.svg', bytes: new TextEncoder().encode('<svg/>') }, assets)).rejects.toMatchObject({ code: 'invalid_input' });
    const failing: GithubBatchAssets = { ...assets, stageBlob: async () => { throw new AssetUploadError('GitHub rechazó el token (401).', 'auth'); } };
    await expect(stageTemplateImage({ slug: 'x-y', kind: 'item', name: 'a.jpg', bytes: await img('#fff') }, failing)).rejects.toThrow(/rechazó el token/);
  });

  it('un solo commit con las nuevas; sin cambios no hay commit; rutas ajenas se rechazan', async () => {
    const ctx = await makeCtx();
    const { assets, log } = make();
    const a = await stageTemplateImage({ slug: 'Luna', kind: 'cover', name: 'portada.jpg', bytes: await img('#ff0000') }, assets);
    const b = await stageTemplateImage({ slug: 'Luna', kind: 'item', name: 'rover.jpg', bytes: await img('#00ff00') }, assets);
    const r = await commitTemplateImages(ctx, 'admin', { slug: 'luna', staged: [a, b], keepUrls: [] }, assets);
    expect(log).toHaveLength(1);
    expect(log[0]!.files).toHaveLength(2);
    expect(r.files.map((f) => f.kind)).toEqual(['cover', 'item']);
    expect(r.files[0]!.url).toContain(`@${SHA}/plantillas/luna/`);
    expect(await commitTemplateImages(ctx, 'admin', { slug: 'luna', staged: [], keepUrls: [] }, assets)).toEqual({ commit: null, files: [], deleted: [] });
    expect(log).toHaveLength(1);
    await expect(commitTemplateImages(ctx, 'admin', { slug: 'luna', staged: [{ ...a, path: 'otra-carpeta/x.webp' }], keepUrls: [] }, assets)).rejects.toMatchObject({ code: 'invalid_input' });
    await ctx.db.close();
  });

  it('al guardar una plantilla existente borra SOLO las imágenes de su carpeta que ya no usa (sobrescribir = añadir la nueva y quitar la vieja)', async () => {
    vi.stubEnv('GITHUB_ASSETS_REPO', 'yo/fotos');
    vi.stubEnv('GITHUB_ASSETS_TOKEN', ['github', 'pat', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4'].join('_'));
    const ctx = await makeCtx();
    const url = (p: string) => `https://cdn.jsdelivr.net/gh/yo/fotos@${'a'.repeat(40)}/${p}`;
    const oldCover = 'plantillas/luna/cover-portada-aaaaaaaaaaaa.webp';
    const oldItem = 'plantillas/luna/item-rover-bbbbbbbbbbbb.webp';
    const keptItem = 'plantillas/luna/item-cráter-cccccccccccc.webp'.replace('á', 'a');
    const library = 'biblioteca/halloween/calabaza-0123456789abcdef.webp';
    const saved = await saveSystemTemplate(ctx, 'admin', {
      slug: 'luna', title: 'Luna', description: '',
      data: { formato: 'subasta-salvaje/plantilla@1', nombre: 'Luna', tematica: 'Casa', reglas: {}, jugadores: [], portada: url(oldCover), casa_inicial: url(library), catalogo: [
        { titulo: 'Rover', descripcion: '', foto: url(oldItem) }, { titulo: 'Crater', descripcion: '', foto: url(keptItem) }] },
    });
    const { assets, log } = make([oldCover, oldItem, keptItem]);
    const newCover = await stageTemplateImage({ slug: 'luna', kind: 'cover', name: 'portada.jpg', bytes: await img('#123456') }, assets);
    // La portada se sustituye, la foto del Rover se quita, la del cráter y la de la biblioteca se conservan
    const r = await commitTemplateImages(ctx, 'admin', { slug: 'luna', templateId: saved.id, staged: [newCover], keepUrls: [url(keptItem), url(library)] }, assets);
    expect(log).toHaveLength(1);
    expect(log[0]!.deletes.sort()).toEqual([oldCover, oldItem].sort());
    expect(r.deleted.sort()).toEqual([oldCover, oldItem].sort());
    expect(log[0]!.deletes).not.toContain(library); // nunca toca la biblioteca
    // Solo quitar una imagen también genera un commit (de borrado)
    const { assets: a2, log: l2 } = make([keptItem]);
    const r2 = await commitTemplateImages(ctx, 'admin', { slug: 'luna', templateId: saved.id, staged: [], keepUrls: [url(library)] }, a2);
    expect(l2[0]!.files).toEqual([]);
    expect(r2.deleted).toEqual([keptItem]);
    // Lo que ya no existe en la rama no se intenta borrar (evita un error de GitHub)
    const { assets: a3, log: l3 } = make([]);
    expect((await commitTemplateImages(ctx, 'admin', { slug: 'luna', templateId: saved.id, staged: [], keepUrls: [] }, a3)).commit).toBeNull();
    expect(l3).toHaveLength(0);
    vi.unstubAllEnvs();
    await ctx.db.close();
  });
});
