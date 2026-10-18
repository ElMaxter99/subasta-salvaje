import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildCoverage } from '@/lib/library/coverage';
import { perceptualHash } from '@/lib/library/phash';
import { hammingHex, parseRoles } from '@/lib/library/taxonomy';
import type { GithubBatchAssets } from '@/lib/storage/github-assets';
import { createGame, getHostState } from '@/lib/services/game-service';
import { applyLibraryImage, listPickableImages } from '@/lib/services/library-pick-service';
import {
  backfillLibraryPhashes, commitLibraryImages, libraryCoverage, listLibraryImages, listSimilarImages, stageLibraryImage, updateLibraryImages, type LibraryImage,
} from '@/lib/services/library-service';
import { makeCtx, newHost, type TestCtx } from './helpers';

const REPO = 'yo/fotos';
let ctx: TestCtx;
beforeAll(async () => {
  vi.stubEnv('GITHUB_ASSETS_REPO', REPO);
  vi.stubEnv('GITHUB_ASSETS_TOKEN', ['github', 'pat', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4'].join('_'));
  ctx = await makeCtx();
});
afterAll(async () => { vi.unstubAllEnvs(); await ctx.db.close(); });

/** Imagen con ESTRUCTURA (un rectángulo en una posición): las lisas darían todas la misma huella. */
const shape = (x: number, y: number, size = 900, w = 900, h = 700) =>
  sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#223"/><circle cx="${x}" cy="${y}" r="${size / 6}" fill="#fc3"/><rect x="${w - x}" y="${h - y}" width="90" height="140" fill="#3cf"/></svg>`)).jpeg().toBuffer();

let n = 0;
const assets: GithubBatchAssets = {
  async listFolder() { return []; },
  async stageBlob() { return (++n).toString(16).padStart(40, '0'); },
  async commitMany(files) {
    const sha = `d${++n}`.padEnd(40, '0');
    return { sha, files: files.map((f) => ({ path: f.path, url: `https://cdn.jsdelivr.net/gh/${REPO}@${sha}/${f.path}`, sha, existed: false })) };
  },
};
async function upload(name: string, bytes: Buffer, extra: Record<string, unknown> = {}): Promise<{ image: LibraryImage; near: { distance: number; title: string }[] }> {
  const r = await stageLibraryImage(ctx, { name, bytes: new Uint8Array(bytes), ...extra }, assets);
  if (r.existed) throw new Error('debería ser nueva');
  const c = await commitLibraryImages(ctx, 'admin@test', [r.staged], assets);
  return { image: c.images[0]!, near: r.near.map((x) => ({ distance: x.distance, title: x.title })) };
}

describe('taxonomía', () => {
  it('parseRoles acepta separadores variados, descarta lo desconocido y ordena', () => {
    expect(parseRoles('product|start')).toEqual(['start', 'product']);
    expect(parseRoles('start; casa , start')).toEqual(['start']);
    expect(parseRoles([])).toEqual([]);
    expect(parseRoles(undefined)).toEqual([]);
  });
  it('hammingHex cuenta bits distintos', () => {
    expect(hammingHex('0000000000000000', '0000000000000000')).toBe(0);
    expect(hammingHex('ffffffffffffffff', '0000000000000000')).toBe(64);
    expect(hammingHex('000000000000000f', '0000000000000000')).toBe(4);
  });
});

describe('roles, categoría y etiquetas', () => {
  it('sin roles indicados se deducen del tipo (escena → inicio, objeto → producto); la categoría por defecto es la colección', async () => {
    const scene = await upload('paisaje.jpg', await shape(300, 200, 900, 1800, 1200), { kind: 'scene', collection: 'Paisajes' });
    expect(scene.image).toMatchObject({ roles: ['start'], category: 'Paisajes', reviewed: false });
    const item = await upload('tetera.jpg', await shape(500, 100), { collection: 'Objetos del hogar' });
    expect(item.image).toMatchObject({ roles: ['product'], category: 'Objetos del hogar' });
  });

  it('roles y categoría explícitos (ambos roles, o ninguno) se guardan; roles desconocidos se descartan', async () => {
    const both = await upload('isla.jpg', await shape(120, 500), { collection: 'Playa', category: 'Playa y verano', roles: ['product', 'start', 'raro'] });
    expect(both.image).toMatchObject({ roles: ['start', 'product'], category: 'Playa y verano' });
    const none = await upload('sin_rol.jpg', await shape(700, 90), { roles: [] });
    expect(none.image.roles).toEqual([]);
  });

  it('filtra por rol, categoría y texto (también en categoría y etiquetas) y cuenta por rol', async () => {
    const all = await listLibraryImages(ctx);
    expect(all.counts.start).toBeGreaterThanOrEqual(2);
    expect(all.counts.none).toBeGreaterThanOrEqual(1);
    expect((await listLibraryImages(ctx, { role: 'start' })).images.every((i) => i.roles.includes('start'))).toBe(true);
    expect((await listLibraryImages(ctx, { role: 'none' })).images.every((i) => i.roles.length === 0)).toBe(true);
    expect((await listLibraryImages(ctx, { category: 'playa y verano' })).images.map((i) => i.title)).toEqual(['Isla']); // sin distinguir mayúsculas
    expect((await listLibraryImages(ctx, { q: 'objetos del' })).images.map((i) => i.title)).toEqual(['Tetera']); // el texto busca en la categoría
    expect(all.categories.map((c) => c.name)).toEqual(expect.arrayContaining(['Paisajes', 'Playa y verano']));
    await expect(listLibraryImages(ctx, { role: 'otro' as never })).rejects.toBeTruthy();
  });

  it('edición en bloque: reemplazar y ajustar (añadir/quitar) roles y etiquetas sin pisar lo demás; valida', async () => {
    const imgs = (await listLibraryImages(ctx, { limit: 50 })).images;
    const ids = imgs.slice(0, 2).map((i) => i.id);
    expect(await updateLibraryImages(ctx, 'a@b', { ids, patch: { tags_add: ['Verano', 'sol'], roles_add: ['start', 'product'] } })).toEqual({ updated: 2 });
    for (const id of ids) {
      const i = (await listLibraryImages(ctx, { limit: 50 })).images.find((x) => x.id === id)!;
      expect(i.roles).toEqual(['start', 'product']);
      expect(i.tags).toEqual(expect.arrayContaining(['verano', 'sol']));
    }
    await updateLibraryImages(ctx, 'a@b', { ids, patch: { tags_remove: ['sol'], roles_remove: ['product'], category: 'Cat nueva' } });
    for (const id of ids) {
      const i = (await listLibraryImages(ctx, { limit: 50 })).images.find((x) => x.id === id)!;
      expect(i.roles).toEqual(['start']);
      expect(i.tags).toContain('verano');
      expect(i.tags).not.toContain('sol');
      expect(i.category).toBe('Cat nueva');
    }
    await updateLibraryImages(ctx, 'a@b', { ids, patch: { roles: [], tags: [] } }); // reemplazo
    expect((await listLibraryImages(ctx, { role: 'none', limit: 50 })).images.map((i) => i.id)).toEqual(expect.arrayContaining(ids));
    await expect(updateLibraryImages(ctx, 'a@b', { ids, patch: { roles: ['inventado'] } })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(ctx.db.rpc('ss_admin_library_image_update', { actor: 'a', ids, patch: { roles: 'start' } })).rejects.toBeTruthy();
    // dejar un estado conocido para los tests siguientes
    await updateLibraryImages(ctx, 'a@b', { ids, patch: { roles: ['product'], category: 'Restaurada' } });
  });
});

describe('selector de los anfitriones', () => {
  it('solo ofrece imágenes REVISADAS con el rol pedido, sin datos de gestión; filtra, pagina y exige un rol válido', async () => {
    const start = await listPickableImages(ctx, { role: 'start' });
    expect(start.total).toBe(0); // nada revisado todavía
    const all = (await listLibraryImages(ctx, { limit: 50 })).images;
    await updateLibraryImages(ctx, 'a@b', { ids: all.map((i) => i.id), patch: { reviewed: true } });
    const unrev = await upload('sin_revisar.jpg', await shape(60, 60), { roles: ['product'], collection: 'Pendiente' });

    const products = await listPickableImages(ctx, { role: 'product' });
    expect(products.images.every((i) => i.roles.includes('product'))).toBe(true);
    expect(products.images.map((i) => i.id)).not.toContain(unrev.image.id); // sin revisar: no se ofrece
    expect(Object.keys(products.images[0]!).sort()).toEqual(['category', 'collection', 'credit', 'height', 'id', 'roles', 'tags', 'title', 'url', 'width'].sort());
    expect((await listPickableImages(ctx, { role: 'product', q: 'tetera' })).images.map((i) => i.title)).toEqual(['Tetera']);
    expect((await listPickableImages(ctx, { role: 'product', category: 'objetos del hogar' })).total).toBe(1);
    expect((await listPickableImages(ctx, { role: 'product', limit: 1 })).images).toHaveLength(1);
    expect((await listPickableImages(ctx, { role: 'product', limit: 1, offset: 1 })).images).toHaveLength(1);
    expect((await listPickableImages(ctx, { role: 'start' })).images.every((i) => i.roles.includes('start'))).toBe(true);
    await expect(listPickableImages(ctx, { role: 'otro' as never })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('aplica una imagen de inicio y una de producto a una partida por enlace (sin copiar), y rechaza rol equivocado, sin revisar o ajena', async () => {
    const host = newHost();
    const { room_code } = await createGame(ctx, host, { name: 'Biblioteca', players: [{ name: 'Ana' }, { name: 'Beto' }], items: [{ name: 'Tetera', description: '' }] });
    const start = (await listPickableImages(ctx, { role: 'start' })).images[0]!;
    const product = (await listPickableImages(ctx, { role: 'product', q: 'tetera' })).images[0]!;
    const before = ctx.storage.files.size;

    const r = await applyLibraryImage(ctx, room_code, host, { target: 'initial', image_id: start.id });
    expect(r.snapshot.players.every((p) => p.current_image?.url === start.url)).toBe(true);
    const item = (await getHostState(ctx, room_code, host)).items[0]!;
    await applyLibraryImage(ctx, room_code, host, { target: 'item', image_id: product.id, item_id: item.id });
    expect((await getHostState(ctx, room_code, host)).items[0]!.image_url).toBe(product.url);
    expect(ctx.storage.files.size).toBe(before); // nada copiado

    // El rol cuenta: un producto (solo `product`) no se acepta como foto de inicio; una sin revisar tampoco.
    await expect(applyLibraryImage(ctx, room_code, host, { target: 'initial', image_id: product.id })).rejects.toMatchObject({ code: 'library_not_found' });
    const pending = (await listLibraryImages(ctx, { unreviewed: true })).images[0]!;
    await expect(applyLibraryImage(ctx, room_code, host, { target: 'item', image_id: pending.id, item_id: item.id })).rejects.toMatchObject({ code: 'library_not_found' });
    // Otro anfitrión no puede tocar mi partida
    await expect(applyLibraryImage(ctx, room_code, newHost(), { target: 'item', image_id: product.id, item_id: item.id })).rejects.toBeTruthy();
    await expect(applyLibraryImage(ctx, room_code, host, { target: 'initial', image_id: 'no-uuid' })).rejects.toMatchObject({ code: 'invalid_input' });
  });
});

describe('detección de imágenes parecidas (huella perceptual simple)', () => {
  it('la misma imagen recomprimida o reescalada queda a pocos bits; una distinta, lejos', async () => {
    const a = await perceptualHash(await shape(300, 250));
    const resized = await perceptualHash(await sharp(await shape(300, 250)).resize(450, 350).webp({ quality: 40 }).toBuffer());
    const other = await perceptualHash(await shape(780, 80));
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(hammingHex(a, resized)).toBeLessThanOrEqual(6);
    expect(hammingHex(a, other)).toBeGreaterThan(6);
  });

  it('al subir avisa de las parecidas (sin bloquear) y el panel lista los pares; las distintas no avisan', async () => {
    const first = await upload('original.jpg', await shape(300, 250), { collection: 'Huellas' });
    expect(first.near).toEqual([]);
    const variant = await sharp(await shape(300, 250)).resize(1000, 778).jpeg({ quality: 50 }).toBuffer(); // otro tamaño y compresión → otro hash de contenido
    const dup = await upload('variante.jpg', variant, { collection: 'Huellas' });
    expect(dup.near.map((x) => x.title)).toContain('Original');
    expect(dup.near[0]!.distance).toBeLessThanOrEqual(6);
    const far = await upload('distinta.jpg', await shape(800, 70), { collection: 'Huellas' });
    expect(far.near.map((x) => x.title)).not.toContain('Original');
    const pairs = await listSimilarImages(ctx);
    expect(pairs.some((p) => [p.a.title, p.b.title].sort().join() === 'Original,Variante')).toBe(true);
  });

  it('completa la huella de las imágenes anteriores (un fallo no detiene el resto)', async () => {
    await ctx.db.rpc('ss_admin_library_phash_set', { id: (await listLibraryImages(ctx, { q: 'distinta' })).images[0]!.id, phash: '0000000000000000' });
    await ctx.db.pg.query("update library_images set phash = null where title in ('Tetera', 'Isla')");
    const bytes = await shape(100, 100);
    let calls = 0;
    const r = await backfillLibraryPhashes(ctx, 10, async () => { if (++calls === 1) throw new Error('404'); return new Uint8Array(bytes); });
    expect(r.failed).toBe(1);
    expect(r.done).toBe(1);
    expect(r.remaining).toBe(1);
  });
});

describe('cobertura', () => {
  it('buildCoverage une recuentos y objetivos: las categorías planificadas salen aunque estén vacías y lo que falta no es negativo', () => {
    const rep = buildCoverage({
      total: 12, published: 9, no_role: 1, no_category: 0, no_credit: 3, no_phash: 2,
      categories: [
        { name: 'halloween', total: 12, start: 2, product: 11, published: 9, pub_start: 2, pub_product: 50 },
        { name: 'Mi tema', total: 1, start: 0, product: 1, published: 0, pub_start: 0, pub_product: 0 },
      ],
    });
    const hal = rep.rows.find((r) => r.name === 'halloween')!;
    expect(hal).toMatchObject({ planned: true, target_product: 40, missing_product: 0, missing_start: 13 }); // la categoría se encuentra sin distinguir mayúsculas
    expect(rep.rows.find((r) => r.name === 'Navidad')).toMatchObject({ planned: true, product: 0, missing_product: 40 });
    expect(rep.rows.find((r) => r.name === 'Mi tema')).toMatchObject({ planned: false, total: 1 });
    expect(rep.rows.filter((r) => r.name.toLowerCase() === 'halloween')).toHaveLength(1);
  });

  it('el recuento en SQL cuenta por rol y por publicadas', async () => {
    const rep = await libraryCoverage(ctx);
    expect(rep.totals.total).toBeGreaterThan(0);
    expect(rep.totals.published).toBeLessThan(rep.totals.total); // hay sin revisar
    const sum = rep.rows.reduce((a, r) => a + r.total, 0);
    expect(sum).toBe(rep.totals.total - rep.totals.no_category);
  });
});

describe('migración de lo existente', () => {
  it('el relleno de la migración da categoría = colección y rol por tamaño o por uso en un producto', async () => {
    const { readFileSync } = await import('node:fs');
    const sql = readFileSync('supabase/migrations/20260101009600_library_tags.sql', 'utf8');
    const backfill = sql.split(/\n/).join('\n').match(/update library_images set category[\s\S]*?\n(?=\n)/)![0]; // las dos sentencias update
    const row = (hash: string, w: number) => ctx.db.pg.query(`insert into library_images (hash, path, url, title, collection, width) values ('${hash}', 'biblioteca/x/${hash}.webp', 'https://x/${hash}.webp', '${hash}', 'Vieja', ${w})`);
    await row('aaaaaaaaaaaa', 1536); await row('bbbbbbbbbbbb', 768); await row('cccccccccccc', 1536);
    await ctx.db.pg.query("insert into library_items (name, image_id) select 'Con foto grande', id from library_images where hash = 'cccccccccccc'");
    await ctx.db.pg.query("update library_images set roles = '{}', category = '' where collection = 'Vieja'");
    await ctx.db.pg.exec(backfill);
    const r = await ctx.db.pg.query<{ hash: string; roles: string[]; category: string }>("select hash, roles, category from library_images where collection = 'Vieja' order by hash");
    expect(r.rows.map((x) => [x.hash, x.roles, x.category])).toEqual([
      ['aaaaaaaaaaaa', ['start'], 'Vieja'],            // escena → foto de inicio
      ['bbbbbbbbbbbb', ['product'], 'Vieja'],          // objeto → producto
      ['cccccccccccc', ['start', 'product'], 'Vieja'], // escena que ya usa un producto → ambos
    ]);
  });
});
