import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GithubBatchAssets } from '@/lib/storage/github-assets';
import { buildMatchReport, consoleSummary, gapsCsv, rowsCsv } from '@/lib/library/match-report';
import { applyMatchPicks, loadMatchableImages, proposeForCatalog, proposeForTemplate } from '@/lib/services/library-match-service';
import { commitLibraryImages, updateLibraryImages, type LibraryImage } from '@/lib/services/library-service';
import { getSystemTemplate, saveSystemTemplate } from '@/lib/services/system-template-service';
import { makeCtx, type TestCtx } from './helpers';

const REPO = 'yo/fotos';
let ctx: TestCtx;
let tplId: string;
let n = 0;
const assets: GithubBatchAssets = {
  async listFolder() { return []; },
  async stageBlob() { return (++n).toString(16).padStart(40, '0'); },
  async commitMany(files) {
    const sha = `d${++n}`.padEnd(40, '0');
    return { sha, files: files.map((f) => ({ path: f.path, url: `https://cdn.jsdelivr.net/gh/${REPO}@${sha}/${f.path}`, sha, existed: false })) };
  },
};
const hex = (i: number) => i.toString(16).padStart(16, '0');
async function add(title: string, tags: string[], over: Record<string, unknown> = {}, review = true): Promise<LibraryImage> {
  const i = ++n;
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const r = await commitLibraryImages(ctx, 'test', [{ path: `biblioteca/general/${slug}-${hex(i)}.webp`, blobSha: i.toString(16).padStart(40, '0'), hash: hex(i), title, collection: 'general', tags, credit: 'Ana B. · CC0', width: 768, height: 768, bytes: 20000, roles: ['product'], category: 'Egipto', ...over }], assets);
  const img = r.images[0]!;
  if (review) await updateLibraryImages(ctx, 'test', { ids: [img.id], patch: { reviewed: true } });
  return img;
}

beforeAll(async () => {
  ctx = await makeCtx();
  await add('Pirámide dorada', ['pyramid', 'egypt']);
  await add('Camello en el desierto', ['camello', 'desert']);
  await add('Gato de piedra', ['cat', 'statue']);
  await add('Cobra real', ['cobra'], {}, false); // sin revisar: no debe ofrecerse
  await add('Paisaje de dunas', ['dunes'], { roles: ['start'] }); // rol start: no es de producto
  const t = await saveSystemTemplate(ctx, 'test', {
    slug: 'egipto-prueba', title: 'Egipto de prueba', description: 'Plantilla para probar el casamiento',
    data: {
      formato: 'subasta-salvaje/plantilla@1', nombre: 'Egipto de prueba', tematica: 'Egipto', reglas: { presupuesto: 20, puja_minima: 1, rondas_maximas: 3, modo_imagenes: 'pegatinas' },
      catalogo: [
        { titulo: 'Pirámide dorada', descripcion: 'Resiste milenios.', emoji: '🔺', foto: null },
        { titulo: 'Camello de caravana', descripcion: 'Cruza el desierto.', emoji: '🐫', foto: null },
        { titulo: 'Cobra real', descripcion: 'Siseo elegante.', emoji: '🐍', foto: null },
      ],
    },
  });
  tplId = t.id;
});
afterAll(async () => { await ctx.db.close(); });

const TAGS = new Map([['piramide dorada', ['pyramid']], ['camello de caravana', ['camel desert']], ['cobra real', ['cobra']]]);

describe('casamiento con la biblioteca (servicio)', () => {
  it('solo carga fotos de producto revisadas', async () => {
    const imgs = await loadMatchableImages(ctx);
    expect(imgs.map((i) => i.title).sort()).toEqual(['Camello en el desierto', 'Gato de piedra', 'Pirámide dorada']);
  });

  it('propone por título y etiquetas; el elemento sin foto revisada queda como hueco', async () => {
    const p = await proposeForTemplate(ctx, 'egipto-prueba', { tags: TAGS });
    expect(p.items[0]!.best!.image.title).toBe('Pirámide dorada');
    expect(p.items[1]!.best!.image.title).toBe('Camello en el desierto');
    expect(p.items[2]!.best).toBeNull();
    expect(p.coverage).toMatchObject({ total: 3, matched: 2 });
    expect(p.coverage.gaps[0]).toMatchObject({ title: 'Cobra real', missing: ['cobra'] });
  });

  it('aplica en borrador: enlace + crédito, sin publicar, sin pisar fotos y sin repetir', async () => {
    const p = await proposeForTemplate(ctx, tplId, { tags: TAGS });
    const picks = p.items.filter((i) => i.best).map((i) => ({ index: i.index, image_id: i.best!.image.id }));
    const r = await applyMatchPicks(ctx, 'test', { id: tplId, picks });
    expect(r.applied).toHaveLength(2);
    const t = await getSystemTemplate(ctx, tplId, { admin: true });
    expect(t.status).toBe('draft');
    expect(t.data.catalogo![0]!.foto).toMatch(/^https:\/\/cdn\.jsdelivr\.net\/gh\/yo\/fotos@/);
    expect(t.data.catalogo![0]!.credito).toBe('Ana B. · CC0');
    expect(t.data.catalogo![2]!.foto).toBeFalsy();
    // segunda vez: ya tienen foto → no se pisa
    const again = await applyMatchPicks(ctx, 'test', { id: tplId, picks });
    expect(again.applied).toHaveLength(0);
    expect(again.skipped.every((s) => s.reason.includes('ya tiene foto'))).toBe(true);
    // los elementos con foto no se vuelven a proponer y su foto no se ofrece a otro
    const p2 = await proposeForTemplate(ctx, tplId, { tags: TAGS });
    expect(p2.items[0]!.hasPhoto).toBe(true);
    expect(p2.coverage.total).toBe(1);
    // misma foto en dos elementos: rechazada
    const gato = (await loadMatchableImages(ctx)).find((i) => i.title === 'Gato de piedra')!;
    const x = await applyMatchPicks(ctx, 'test', { id: tplId, picks: [{ index: 2, image_id: gato.id }, { index: 2, image_id: gato.id }] });
    expect(x.applied).toHaveLength(1);
    expect(x.skipped[0]!.reason).toContain('repetido');
  });

  it('rechaza fotos sin revisar o de otro rol, índices fuera de rango y plantillas publicadas', async () => {
    const t = await saveSystemTemplate(ctx, 'test', { slug: 'vacia-prueba', title: 'Otra', description: '', data: { formato: 'subasta-salvaje/plantilla@1', nombre: 'Otra', tematica: 'Otra', reglas: { presupuesto: 20, puja_minima: 1, rondas_maximas: 1, modo_imagenes: 'pegatinas' }, catalogo: [{ titulo: 'Cosa', descripcion: 'x', emoji: '🔺', foto: null }] } });
    const sinRevisar = await add('Sin revisar extra', ['cosa'], {}, false);
    const start = await add('Foto de inicio', ['cosa'], { roles: ['start'] });
    const r = await applyMatchPicks(ctx, 'test', { id: t.id, picks: [{ index: 0, image_id: sinRevisar.id }, { index: 7, image_id: start.id }] });
    expect(r.applied).toEqual([]);
    expect(r.skipped.map((s) => s.reason)).toEqual(['la foto no existe, no está revisada o no es de producto', 'el elemento no existe']);
    await expect(applyMatchPicks(ctx, 'test', { id: 'no-uuid', picks: [] })).rejects.toThrow();
    await ctx.db.rpc('ss_admin_system_template_set_status', { id: t.id, status: 'published', actor: 'test' });
    await expect(applyMatchPicks(ctx, 'test', { id: t.id, picks: [{ index: 0, image_id: start.id }] })).rejects.toThrow(/borrador/);
  });

  it('biblioteca vacía: cobertura 0 % y huecos; el informe incluye CSV y resumen', () => {
    const cat = [{ titulo: 'Esfinge vigilante', descripcion: 'x', emoji: '🗿', foto: null }, { titulo: 'Cobra real', descripcion: 'x', emoji: '🐍', foto: null }];
    const p = proposeForCatalog({ slug: 'a', title: 'A' }, 'Egipto', cat, [['sphinx'], ['cobra']], []);
    expect(p.coverage).toMatchObject({ matched: 0, pct: 0 });
    const rep = buildMatchReport([p]);
    expect(rep.gaps.map((g) => g.tag)).toEqual(['cobra', 'sphinx']);
    expect(rowsCsv(rep)).toContain('sin candidata');
    expect(gapsCsv(rep)).toContain('sphinx,1');
    expect(consoleSummary(rep)).toContain('TOTAL: 0/2');
  });
});
