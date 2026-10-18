import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GithubBatchAssets } from '@/lib/storage/github-assets';
import {
  addLibraryItems, commitLibraryImages, deleteLibraryImages, generateLibraryItemImage, deleteLibraryItems, listLibraryImages, listLibraryItems, parseItemLines, stageLibraryImage, titleFromFilename,
  updateLibraryImages, updateLibraryItem,
} from '@/lib/services/library-service';
import { invalidateSettings } from '@/lib/services/settings';
import { makeCtx, type TestCtx } from './helpers';

let ctx: TestCtx;
beforeAll(async () => { ctx = await makeCtx(); });
afterAll(async () => { await ctx.db.close(); });

const photo = (r: number, g: number, b: number) => sharp({ create: { width: 900, height: 700, channels: 3, background: { r, g, b } } }).jpeg().toBuffer();
const blobs: string[] = [];
const commits: { files: string[]; message: string }[] = [];
const assets: GithubBatchAssets = {
  async listFolder() { return []; },
  async stageBlob() { blobs.push('x'); return (blobs.length.toString(16).padStart(40, '0')); },
  async commitMany(files, message) {
    commits.push({ files: files.map((f) => f.path), message });
    const sha = `c${commits.length}`.padEnd(40, '0');
    return { sha, files: files.map((f) => ({ path: f.path, url: `https://cdn.jsdelivr.net/gh/e2e/fotos@${sha}/${f.path}`, sha, existed: false })) };
  },
};
/** Prepara y publica un lote (como hace la pantalla): devuelve las imágenes registradas. */
async function uploadBatch(files: { name: string; color: [number, number, number]; extra?: Record<string, unknown> }[]) {
  const staged = [];
  for (const f of files) {
    const r = await stageLibraryImage(ctx, { name: f.name, bytes: new Uint8Array(await photo(...f.color)), ...f.extra }, assets);
    if (!r.existed) staged.push(r.staged);
  }
  return commitLibraryImages(ctx, 'admin@test', staged, assets);
}
const up = async (name: string, color: [number, number, number], extra: Record<string, unknown> = {}) => (await uploadBatch([{ name, color, extra }])).images[0]!;

describe('biblioteca de medios: imágenes', () => {
  it('un lote entero entra en UN solo commit; la misma foto no se duplica ni llega a GitHub', async () => {
    const before = commits.length;
    const r = await uploadBatch([
      { name: 'calabaza_naranja.jpg', color: [220, 120, 20], extra: { collection: 'Halloween', tags: ['Fruta', ' otoño '] } },
      { name: 'fantasma.jpg', color: [240, 240, 250], extra: { collection: 'Halloween' } },
      { name: 'bombon.jpg', color: [90, 40, 20], extra: { collection: 'Chocolates', tags: ['dulce'] } },
      { name: 'playa.jpg', color: [20, 160, 220], extra: { collection: 'Paisajes', kind: 'scene' } },
    ]);
    expect(commits.length - before).toBe(1); // cuatro imágenes, un commit
    expect(commits.at(-1)!.files).toHaveLength(4);
    expect(r).toMatchObject({ added: 4, existed: 0 });
    const cal = r.images.find((i) => i.title === 'Calabaza naranja')!;
    expect(cal).toMatchObject({ collection: 'Halloween', tags: ['fruta', 'otoño'] });
    expect(cal.path).toMatch(/^biblioteca\/halloween\/calabaza-naranja-[0-9a-f]{16}\.webp$/);
    expect(cal.url).toContain(`@${r.commit}/`);

    const blobsBefore = blobs.length;
    const again = await stageLibraryImage(ctx, { name: 'otro-nombre.jpg', bytes: new Uint8Array(await photo(220, 120, 20)), collection: 'Otra' }, assets);
    expect(again.existed).toBe(true);
    expect(blobs.length).toBe(blobsBefore); // la repetida no se prepara en GitHub
  });

  it('el commit rechaza listas no válidas y, si GitHub falla, no registra nada', async () => {
    await expect(commitLibraryImages(ctx, 'a', [], assets)).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(commitLibraryImages(ctx, 'a', [{ path: '../x.webp', blobSha: 'z', hash: 'q' }], assets)).rejects.toMatchObject({ code: 'invalid_input' });
    const r = await stageLibraryImage(ctx, { name: 'nuevo.jpg', bytes: new Uint8Array(await photo(5, 6, 7)) }, assets);
    if (r.existed) throw new Error('debería ser nueva');
    const broken: GithubBatchAssets = { ...assets, commitMany: async () => { throw new (await import('@/lib/storage/github-assets')).AssetUploadError('GitHub caído', 'network'); } };
    await expect(commitLibraryImages(ctx, 'a', [r.staged], broken)).rejects.toMatchObject({ code: 'invalid_input' });
    expect((await listLibraryImages(ctx, { q: 'nuevo' })).total).toBe(0);
    expect((await commitLibraryImages(ctx, 'a', [r.staged], assets)).added).toBe(1); // reintento con la misma lista
  });

  it('lista con búsqueda, colección y paginación; cambia colección y borra en bloque', async () => {
    const all = await listLibraryImages(ctx);
    expect(all.total).toBeGreaterThanOrEqual(4);
    expect(all.collections.map((c) => c.name)).toEqual(expect.arrayContaining(['Halloween', 'Chocolates', 'Paisajes']));
    expect((await listLibraryImages(ctx, { collection: 'Halloween' })).images.every((i) => i.collection === 'Halloween')).toBe(true);
    expect((await listLibraryImages(ctx, { q: 'dulce' })).images.map((i) => i.title)).toEqual(['Bombon']);
    expect((await listLibraryImages(ctx, { limit: 2 })).images).toHaveLength(2);
    expect((await listLibraryImages(ctx, { limit: 2, offset: 2 })).images.length).toBeGreaterThan(0);

    const bombon = (await listLibraryImages(ctx, { q: 'bombon' })).images[0]!;
    expect(await updateLibraryImages(ctx, 'admin@test', { ids: [bombon.id], patch: { collection: 'Dulces', tags: ['choco'] } })).toEqual({ updated: 1 });
    expect((await listLibraryImages(ctx, { collection: 'Dulces' })).images[0]).toMatchObject({ title: 'Bombon', tags: ['choco'] });
    await updateLibraryImages(ctx, 'admin@test', { ids: [bombon.id], patch: { title: 'Bombón' } }); // un parche parcial no borra lo demás
    expect((await listLibraryImages(ctx, { collection: 'Dulces' })).images[0]).toMatchObject({ title: 'Bombón', tags: ['choco'], collection: 'Dulces' });
    await expect(updateLibraryImages(ctx, 'a', { ids: [], patch: { title: 'x' } })).rejects.toMatchObject({ code: 'invalid_input' });
    expect(await deleteLibraryImages(ctx, 'admin@test', [bombon.id])).toEqual({ deleted: 1 });
    expect((await listLibraryImages(ctx, { collection: 'Dulces' })).total).toBe(0);
  });

  it('rechaza lo que no es una imagen y sin configuración no sube nada', async () => {
    await expect(stageLibraryImage(ctx, { name: 'x.jpg', bytes: new Uint8Array([1, 2, 3]) }, assets)).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(stageLibraryImage(ctx, { name: 'x.jpg', bytes: new Uint8Array(await photo(1, 2, 3)) }, null)).rejects.toMatchObject({ code: 'invalid_input' });
  });
});

describe('biblioteca de medios: catálogo general de productos', () => {
  it('crea productos en bloque enlazando fotos por nombre, omite repetidos y los lee con su foto', async () => {
    const imgs = (await listLibraryImages(ctx, { collection: 'Halloween' })).images;
    const { items, ignored } = parseItemLines('Calabaza naranja; Una calabaza enorme; 🎃\nFantasma\n\n; sin nombre\nMurciélago;;🦇', imgs, 'Halloween');
    expect(items).toHaveLength(3);
    expect(ignored).toHaveLength(1);
    expect(items[0]).toMatchObject({ name: 'Calabaza naranja', emoji: '🎃' });
    expect(items[0]!.image_id).toBe(imgs.find((i) => i.title === 'Calabaza naranja')!.id);
    expect(items[2]!.image_id).toBeNull();

    const r = await addLibraryItems(ctx, 'admin@test', items);
    expect(r).toMatchObject({ added: 3, skipped: 0 });
    expect(await addLibraryItems(ctx, 'admin@test', [{ name: 'CALABAZA NARANJA', collection: 'Halloween' }])).toMatchObject({ added: 0, skipped: 1 });
    await addLibraryItems(ctx, 'admin@test', [{ name: 'Calabaza naranja', collection: 'Otra colección' }]); // mismo nombre en otra colección: permitido

    const list = await listLibraryItems(ctx, { collection: 'Halloween' });
    expect(list.total).toBe(3);
    const cal = list.items.find((i) => i.name === 'Calabaza naranja')!;
    expect(cal.photo_url).toContain('cdn.jsdelivr.net');
    expect((await listLibraryItems(ctx, { q: 'enorme' })).items.map((i) => i.name)).toEqual(['Calabaza naranja']);
    expect((await listLibraryItems(ctx)).collections.map((c) => c.name)).toEqual(expect.arrayContaining(['Halloween', 'Otra colección']));
  });

  it('edita y borra productos; borrar la imagen deja el producto sin foto', async () => {
    const [cal] = (await listLibraryItems(ctx, { q: 'calabaza', collection: 'Halloween' })).items;
    const upd = await updateLibraryItem(ctx, 'admin@test', cal!.id, { description: 'Con vela dentro', emoji: '🕯️' });
    expect(upd).toMatchObject({ description: 'Con vela dentro', emoji: '🕯️' });
    await expect(updateLibraryItem(ctx, 'a', '00000000-0000-4000-8000-000000000000', { name: 'x' })).rejects.toMatchObject({ code: 'library_not_found' });
    await deleteLibraryImages(ctx, 'a', [cal!.image_id!]);
    expect((await listLibraryItems(ctx, { q: 'calabaza', collection: 'Halloween' })).items[0]).toMatchObject({ photo_url: null, image_id: null });
    expect(await deleteLibraryItems(ctx, 'a', [cal!.id])).toEqual({ deleted: 1 });
    await expect(addLibraryItems(ctx, 'a', [{ name: '' }])).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('títulos a partir del nombre del archivo', () => {
    expect(titleFromFilename('sombrilla_roja-01.JPG')).toBe('Sombrilla roja 01');
    expect(titleFromFilename('IMG_0001.jpg')).toBe('IMG 0001');
  });
});

describe('cliente de GitHub: lote en un solo commit (API de datos de Git, fetch simulado)', () => {
  const CFG = { repo: 'yo/fotos', token: ['github', 'pat', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4'].join('_'), branch: 'master' };
  const res = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

  it('prepara blobs sin commit y publica todos con blobs → árbol → UN commit → mover la rama', async () => {
    const { createGithubAssets } = await import('@/lib/storage/github-assets');
    const calls: string[] = [];
    let blob = 0;
    const f = async (url: string, init: RequestInit = {}) => {
      const m = init.method ?? 'GET';
      const path = url.replace('https://api.github.com/repos/yo/fotos', '');
      calls.push(`${m} ${path}`);
      if (m === 'POST' && path === '/git/blobs') return res({ sha: String(++blob).padStart(40, 'a') }, 201);
      if (m === 'GET' && path === '/commits/master') return res({ sha: 'h'.repeat(40) });
      if (m === 'GET' && path.startsWith('/git/commits/')) return res({ tree: { sha: 't'.repeat(40) } });
      if (m === 'POST' && path === '/git/trees') { const b = JSON.parse(init.body as string); expect(b.tree).toHaveLength(3); expect(b.base_tree).toBe('t'.repeat(40)); return res({ sha: 'n'.repeat(40) }, 201); }
      if (m === 'POST' && path === '/git/commits') { const b = JSON.parse(init.body as string); expect(b.parents).toEqual(['h'.repeat(40)]); return res({ sha: 'c'.repeat(40) }, 201); }
      if (m === 'PATCH' && path === '/git/refs/heads/master') return res({});
      return res({}, 404);
    };
    const gh = createGithubAssets(CFG, f as never);
    const shas = [await gh.stageBlob(new Uint8Array([1])), await gh.stageBlob(new Uint8Array([2])), await gh.stageBlob(new Uint8Array([3]))];
    expect(calls.filter((c) => c.includes('/git/commits')).length).toBe(0); // preparar no crea commits
    const r = await gh.commitMany(shas.map((blobSha, i) => ({ path: `biblioteca/x/f${i}-0000000000000000.webp`, blobSha })), 'Biblioteca: 3 imágenes');
    expect(r.sha).toBe('c'.repeat(40));
    expect(r.files[1]!.url).toBe(`https://cdn.jsdelivr.net/gh/yo/fotos@${'c'.repeat(40)}/biblioteca/x/f1-0000000000000000.webp`);
    expect(calls.filter((c) => c === 'POST /git/commits')).toHaveLength(1);
  });

  it('si la rama se movió (422) rehace el commit sobre la nueva cabeza', async () => {
    const { createGithubAssets } = await import('@/lib/storage/github-assets');
    let heads = 0, patches = 0;
    const f = async (url: string, init: RequestInit = {}) => {
      const m = init.method ?? 'GET';
      const path = url.replace('https://api.github.com/repos/yo/fotos', '');
      if (m === 'GET' && path === '/commits/master') return res({ sha: String(++heads).padStart(40, 'h') });
      if (m === 'GET' && path.startsWith('/git/commits/')) return res({ tree: { sha: 't'.repeat(40) } });
      if (m === 'POST' && path === '/git/trees') return res({ sha: 'n'.repeat(40) }, 201);
      if (m === 'POST' && path === '/git/commits') return res({ sha: `c${heads}`.padEnd(40, '0') }, 201);
      if (m === 'PATCH') return ++patches === 1 ? res({ message: 'Update is not a fast forward' }, 422) : res({});
      return res({}, 404);
    };
    const r = await createGithubAssets(CFG, f as never).commitMany([{ path: 'biblioteca/x/a-0000000000000000.webp', blobSha: 'a'.repeat(40) }], 'm');
    expect(heads).toBe(2);
    expect(r.sha.startsWith('c2')).toBe(true);
  });
});

describe('biblioteca: imagen de un producto generada con IA', () => {
  const provider = (fail = false) => ({
    id: 'pollinations' as const, capabilities: { edit: false },
    generateInitialScene: async () => { throw new Error('no aplica'); },
    editScene: async () => { throw new Error('no aplica'); },
    generateItemImage: async () => {
      if (fail) throw new Error('proveedor caído');
      return { bytes: new Uint8Array(await photo(10, 200, 90)), mime: 'image/jpeg', prompt: 'p', model: 'modelo-x', provider: 'pollinations' as const, notes: 'semilla 1' };
    },
  });

  it('genera, publica la imagen en la biblioteca y la asocia al producto; cuenta en el tope diario', async () => {
    const r = await addLibraryItems(ctx, 'admin@test', [{ name: 'Seta mágica', description: 'Roja con puntos', emoji: '🍄', collection: 'Bosque' }]);
    const item = (await listLibraryItems(ctx, { q: 'Seta mágica' })).items[0]!;
    expect(r.added).toBe(1);
    const before = commits.length;
    const g = await generateLibraryItemImage({ db: ctx.db, provider: provider() }, 'admin@test', { id: item.id, name: item.name, description: item.description, emoji: item.emoji, collection: item.collection }, assets);
    expect(commits.length - before).toBe(1);
    expect(g.item.image_id).toBe(g.image.id);
    expect(g.image).toMatchObject({ collection: 'Bosque', tags: ['ia'] });
    expect(g.image.credit).toContain('modelo-x');
    expect(g.provider).toBe('pollinations');
    expect(await ctx.db.rpc<Record<string, number>>('ss_provider_usage', {})).toMatchObject({ pollinations: 1 });
  });

  it('si la IA falla, no se gasta cuota del día', async () => {
    const item = (await listLibraryItems(ctx, { q: 'Seta mágica' })).items[0]!;
    const before = (await ctx.db.rpc<Record<string, number>>('ss_provider_usage', {})).pollinations ?? 0;
    await expect(generateLibraryItemImage({ db: ctx.db, provider: provider(true) }, 'a', { id: item.id, name: item.name, collection: item.collection }, assets)).rejects.toThrow(/proveedor caído/);
    expect((await ctx.db.rpc<Record<string, number>>('ss_provider_usage', {})).pollinations ?? 0).toBe(before);
  });

  it('sin proveedor real no inventa nada, y si el tope diario se alcanza se niega', async () => {
    const item = (await listLibraryItems(ctx, { q: 'Seta mágica' })).items[0]!;
    const input = { id: item.id, name: item.name, collection: item.collection };
    await expect(generateLibraryItemImage({ db: ctx.db, provider: null }, 'a', input, assets)).rejects.toMatchObject({ code: 'ai_not_available' });
    await ctx.db.rpc('ss_settings_set', { key: 'quota_per_day', value: 1 });
    invalidateSettings(ctx.db);
    await expect(generateLibraryItemImage({ db: ctx.db, provider: provider() }, 'a', input, assets)).rejects.toThrow(/Cuota diaria/);
    await ctx.db.rpc('ss_settings_set', { key: 'quota_per_day', value: null });
    invalidateSettings(ctx.db);
  });
});
