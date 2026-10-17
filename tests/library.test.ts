import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GithubAssets } from '@/lib/storage/github-assets';
import {
  addLibraryItems, deleteLibraryImages, deleteLibraryItems, listLibraryImages, listLibraryItems, parseItemLines, titleFromFilename,
  updateLibraryImages, updateLibraryItem, uploadLibraryImage,
} from '@/lib/services/library-service';
import { makeCtx, type TestCtx } from './helpers';

let ctx: TestCtx;
beforeAll(async () => { ctx = await makeCtx(); });
afterAll(async () => { await ctx.db.close(); });

const photo = (r: number, g: number, b: number) => sharp({ create: { width: 900, height: 700, channels: 3, background: { r, g, b } } }).jpeg().toBuffer();
const puts: string[] = [];
const assets: GithubAssets = {
  async put(path) {
    puts.push(path);
    return { path, url: `https://cdn.jsdelivr.net/gh/e2e/fotos@sha${puts.length}/${path}`, sha: `sha${puts.length}`, existed: false };
  },
};
const up = async (name: string, color: [number, number, number], extra: Record<string, unknown> = {}) =>
  uploadLibraryImage(ctx, 'admin@test', { name, bytes: new Uint8Array(await photo(...color)), ...extra }, assets);

describe('biblioteca de medios: imágenes', () => {
  it('sube, registra con colección y etiquetas, y no duplica la misma foto', async () => {
    const a = await up('calabaza_naranja.jpg', [220, 120, 20], { collection: 'Halloween', tags: ['Fruta', ' otoño '] });
    expect(a.existed).toBe(false);
    expect(a.image).toMatchObject({ title: 'Calabaza naranja', collection: 'Halloween', tags: ['fruta', 'otoño'] });
    expect(a.image.path).toMatch(/^biblioteca\/halloween\/calabaza-naranja-[0-9a-f]{16}\.webp$/);
    expect(a.image.url).toContain('cdn.jsdelivr.net');
    const again = await up('otro-nombre.jpg', [220, 120, 20], { collection: 'Otra' });
    expect(again.existed).toBe(true);
    expect(again.image.id).toBe(a.image.id);
    expect(puts).toHaveLength(1); // la segunda no llegó a GitHub
  });

  it('lista con búsqueda, colección y paginación; cambia colección y borra en bloque', async () => {
    await up('fantasma.jpg', [240, 240, 250], { collection: 'Halloween' });
    await up('bombon.jpg', [90, 40, 20], { collection: 'Chocolates', tags: ['dulce'] });
    await up('playa.jpg', [20, 160, 220], { collection: 'Paisajes', kind: 'scene' });
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
    await expect(uploadLibraryImage(ctx, 'a', { name: 'x.jpg', bytes: new Uint8Array([1, 2, 3]) }, assets)).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(uploadLibraryImage(ctx, 'a', { name: 'x.jpg', bytes: new Uint8Array(await photo(1, 2, 3)) }, null)).rejects.toMatchObject({ code: 'invalid_input' });
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
