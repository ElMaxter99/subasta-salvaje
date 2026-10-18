import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getAdminStats } from '@/lib/services/admin-stats-service';
import { createGame } from '@/lib/services/game-service';
import {
  addLibraryItems, listLibraryDuplicates, listLibraryImages, listLibraryItems, updateLibraryImages, updateLibraryItems, deleteLibraryImages,
} from '@/lib/services/library-service';
import { createTemplateFromCollection, getSystemTemplate, listSystemTemplates, setSystemTemplateStatus } from '@/lib/services/system-template-service';
import { makeCtx, newHost, type TestCtx } from './helpers';

let ctx: TestCtx;
beforeAll(async () => { ctx = await makeCtx(); });
afterAll(async () => { await ctx.db.close(); });

let n = 0;
/** Inserta una imagen de la biblioteca ya alojada por enlace (sin tocar GitHub). */
async function img(title: string, collection: string, credit = ''): Promise<string> {
  n += 1;
  const r = await ctx.db.pg.query<{ id: string }>(
    `insert into library_images (hash, path, url, sha, title, collection, credit) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [n.toString(16).padStart(40, '0'), `biblioteca/x/${n}.webp`, `https://cdn.jsdelivr.net/gh/e2e/fotos@abc/biblioteca/x/${n}.webp`, `s${n}`, title, collection, credit],
  );
  return r.rows[0]!.id;
}

describe('moderación de la biblioteca', () => {
  it('filtros sin crédito / sin revisar, marcar como revisadas y contadores', async () => {
    const a = await img('Foto A', 'Mod', 'Autora');
    const b = await img('Foto B', 'Mod', '');
    const noCred = await listLibraryImages(ctx, { collection: 'Mod', noCredit: true });
    expect(noCred.images.map((i) => i.id)).toEqual([b]);
    expect((await listLibraryImages(ctx, { collection: 'Mod', unreviewed: true })).total).toBe(2);
    expect(await updateLibraryImages(ctx, 'admin@test', { ids: [a], patch: { reviewed: true } })).toEqual({ updated: 1 });
    const unrev = await listLibraryImages(ctx, { collection: 'Mod', unreviewed: true });
    expect(unrev.images.map((i) => i.id)).toEqual([b]);
    expect(unrev.counts.unreviewed).toBeGreaterThanOrEqual(1);
    await expect(updateLibraryImages(ctx, 'a', { ids: [a], patch: { reviewed: 'sí' } })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('detecta títulos duplicados dentro de la misma colección (no entre colecciones) y se pueden borrar', async () => {
    const d1 = await img('Gato Negro', 'Dup');
    const d2 = await img('  gato negro ', 'Dup');
    await img('Gato negro', 'Otra');
    await img('Único', 'Dup');
    const groups = (await listLibraryDuplicates(ctx)).filter((g) => g.collection === 'Dup');
    expect(groups).toHaveLength(1);
    expect(groups[0]!.images.map((i) => i.id).sort()).toEqual([d1, d2].sort());
    await deleteLibraryImages(ctx, 'admin@test', [d2]);
    expect((await listLibraryDuplicates(ctx)).filter((g) => g.collection === 'Dup')).toHaveLength(0);
  });
});

describe('edición en bloque de productos', () => {
  it('mueve, fija/quita emoji, quita la foto y elimina; límite de 200 y auditoría única', async () => {
    const photo = await img('Foto lámpara', 'Casa');
    await addLibraryItems(ctx, 'admin@test', [
      { name: 'Lámpara', collection: 'Casa', image_id: photo, emoji: '💡' }, { name: 'Mesa', collection: 'Casa' }, { name: 'Mesa', collection: 'Destino' },
    ]);
    const ids = (await listLibraryItems(ctx, { collection: 'Casa' })).items.map((i) => i.id);
    expect(ids).toHaveLength(2);

    // Mover: "Mesa" choca con la de Destino y se omite; no revienta el resto
    expect(await updateLibraryItems(ctx, 'admin@test', { ids, change: { collection: 'Destino' } })).toEqual({ changed: 1, skipped: 1 });
    const dest = (await listLibraryItems(ctx, { collection: 'Destino' })).items;
    expect(dest.map((i) => i.name).sort()).toEqual(['Lámpara', 'Mesa']);
    const lamp = dest.find((i) => i.name === 'Lámpara')!;

    expect(await updateLibraryItems(ctx, 'a', { ids: [lamp.id], change: { emoji: '🛋️' } })).toMatchObject({ changed: 1 });
    expect(await updateLibraryItems(ctx, 'a', { ids: [lamp.id], change: { emoji: null } })).toMatchObject({ changed: 1 });
    expect((await listLibraryItems(ctx, { collection: 'Destino' })).items.find((i) => i.id === lamp.id)!.emoji).toBeNull();
    expect(lamp.photo_url).toBeTruthy();
    await updateLibraryItems(ctx, 'a', { ids: [lamp.id], change: { image_id: null } });
    expect((await listLibraryItems(ctx, { collection: 'Destino' })).items.find((i) => i.id === lamp.id)!.photo_url).toBeFalsy();

    const audits = await ctx.db.pg.query<{ n: number }>(`select count(*)::int n from admin_audit where action = 'library_items_bulk_updated'`);
    expect(audits.rows[0]!.n).toBe(4);

    expect(await updateLibraryItems(ctx, 'a', { ids: [lamp.id], change: { delete: true } })).toEqual({ changed: 1, skipped: 0 });
    // Validaciones
    const many = Array.from({ length: 201 }, () => '00000000-0000-4000-8000-000000000000');
    await expect(updateLibraryItems(ctx, 'a', { ids: many, change: { delete: true } })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(updateLibraryItems(ctx, 'a', { ids: [], change: { delete: true } })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(updateLibraryItems(ctx, 'a', { ids: [lamp.id], change: { image_id: 'x' } })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(updateLibraryItems(ctx, 'a', { ids: [lamp.id], change: { delete: true, emoji: 'x' } })).rejects.toMatchObject({ code: 'invalid_input' });
  });
});

describe('plantilla del sistema desde una colección', () => {
  it('crea un borrador con slug único, catálogo con fotos por enlace, portada y casa inicial', async () => {
    const p1 = await img('Foto sombrilla', 'Playa Verano', 'Autor X');
    const house = await img('Casa en la playa', 'Escenas');
    await addLibraryItems(ctx, 'admin@test', [
      { name: 'Sombrilla', description: 'Roja', emoji: '⛱️', collection: 'Playa Verano', image_id: p1 }, { name: 'Hamaca', collection: 'Playa Verano' },
    ]);
    const r = await createTemplateFromCollection(ctx, 'admin@test', { collection: 'Playa Verano', house_image_id: house });
    expect(r.template).toMatchObject({ slug: 'playa-verano', title: 'Playa Verano', status: 'draft' });
    const full = await getSystemTemplate(ctx, r.template.id, { admin: true });
    const data = full.data as { portada: string; casa_inicial: string; catalogo: { titulo: string; foto?: string }[] };
    expect(data.portada).toContain('cdn.jsdelivr.net');
    expect(data.casa_inicial).toContain('cdn.jsdelivr.net');
    expect(data.catalogo.map((c) => c.titulo)).toEqual(['Hamaca', 'Sombrilla']);
    expect(data.catalogo.find((c) => c.titulo === 'Sombrilla')!.foto).toContain('cdn.jsdelivr.net');
    // Un segundo intento no pisa el primero: slug distinto
    const r2 = await createTemplateFromCollection(ctx, 'admin@test', { collection: 'Playa Verano' });
    expect(r2.template.slug).toBe('playa-verano-2');
    // Errores
    await expect(createTemplateFromCollection(ctx, 'a', { collection: 'No existe' })).rejects.toMatchObject({ code: 'library_not_found' });
    await expect(createTemplateFromCollection(ctx, 'a', { collection: '' })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(createTemplateFromCollection(ctx, 'a', { collection: 'Playa Verano', house_image_id: '00000000-0000-4000-8000-000000000000' })).rejects.toMatchObject({ code: 'library_not_found' });
    expect((await listSystemTemplates(ctx, { admin: true })).map((t) => t.slug)).toEqual(expect.arrayContaining(['playa-verano', 'playa-verano-2']));
    void setSystemTemplateStatus;
  });
});

describe('estadísticas', () => {
  it('cuenta partidas por día/estado, plantillas jugadas (solo publicadas) y uso de IA', async () => {
    const host = newHost();
    const t = (await listSystemTemplates(ctx, { admin: true })).find((x) => x.slug === 'playa-verano')!;
    await ctx.db.pg.query(`update system_templates set status = 'published' where id = $1`, [t.id]);
    await createGame(ctx, host, { name: 'Con plantilla', theme: 'house', initial_budget_cents: 2000, template_slug: 'playa-verano' });
    await createGame(ctx, host, { name: 'Sin plantilla', theme: 'house', initial_budget_cents: 2000 });
    await createGame(ctx, host, { name: 'Slug falso', theme: 'house', initial_budget_cents: 2000, template_slug: 'no-existe' });
    const s = await getAdminStats(ctx);
    expect(s.games.total).toBe(3);
    expect(s.games.perDay).toHaveLength(30);
    expect(s.games.perDay.at(-1)!.count).toBe(3);
    expect(Object.values(s.games.byStatus).reduce((a, b) => a + b, 0)).toBe(3);
    expect(s.templates).toEqual([expect.objectContaining({ slug: 'playa-verano', games: 1 })]);
    expect(Array.isArray(s.ai.perDay)).toBe(true);
    expect(s.ai.usageTodayTotal).toBeGreaterThanOrEqual(0);
    expect(s.ai.dayLimit).toBeGreaterThan(0);
  });
});
