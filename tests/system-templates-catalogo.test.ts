import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BUNDLE_FORMAT, isValidEmoji, parseBundle, validatePack, type BundleEntry } from '@/lib/domain/system-template-pack';
import { parseTemplate } from '@/lib/domain/template';
import { getSystemTemplate, listSystemTemplates } from '@/lib/services/system-template-service';
import { importSystemTemplates } from '@/lib/services/system-template-import';
import { loadBundleFile, loadSources, PACK_DIR } from '../scripts/templates/pack';
import { makeCtx, type TestCtx } from './helpers';

const bundle = loadBundleFile();
const entries = bundle.plantillas as BundleEntry[];

describe('catálogo de plantillas del sistema (docs/plantillas-sistema)', () => {
  it('hay al menos 30 plantillas, de varios tonos, y el lote es del formato esperado', () => {
    expect(bundle.formato).toBe(BUNDLE_FORMAT);
    expect(entries.length).toBeGreaterThanOrEqual(30);
    expect(new Set(entries.map((e) => e.tono)).size).toBeGreaterThanOrEqual(4);
  });

  it('cumple todas las reglas del validador (esquema real, 12–25 elementos, sin duplicados, sin fotos/URL/marcas)', () => {
    const r = validatePack(entries);
    expect(r.errors).toEqual([]);
  });

  it('cada <slug>.json es una plantilla válida del formato @1 y coincide con el lote; lote.json está al día con la fuente', () => {
    for (const e of entries) {
      const raw = readFileSync(path.join(PACK_DIR, `${e.slug}.json`), 'utf8');
      const p = parseTemplate(raw);
      expect(p.ok, e.slug).toBe(true);
      expect(JSON.parse(raw)).toEqual(e.plantilla);
    }
    const sueltos = readdirSync(PACK_DIR).filter((f) => f.endsWith('.json') && !['lote.json', 'indice.json'].includes(f));
    expect(sueltos.sort()).toEqual(entries.map((e) => `${e.slug}.json`).sort());
    expect(loadSources()).toEqual(entries);
  });

  it('todas las plantillas tienen etiquetas por elemento y ninguna foto', () => {
    for (const e of entries) {
      const items = (e.plantilla as { catalogo: { foto: string | null }[] }).catalogo;
      expect(e.etiquetas?.length, e.slug).toBe(items.length);
      expect(e.etiquetas!.every((t) => t.length >= 1), e.slug).toBe(true);
      expect(items.every((i) => !i.foto)).toBe(true);
    }
  });

  it('el validador detecta duplicados, URL, marcas y emojis inválidos', () => {
    const base = entries[0]!;
    const clon: BundleEntry = { ...base, slug: 'otra-copia', titulo: 'Otra copia' };
    expect(validatePack([base, clon]).errors.join('\n')).toMatch(/nombre repetido|ya existe|se parecen/);
    const mala = JSON.parse(JSON.stringify(entries[1])) as BundleEntry;
    const cat = (mala.plantilla as { catalogo: { titulo: string; descripcion: string; emoji: string; foto: string | null }[] }).catalogo;
    cat[0]!.foto = 'https://ejemplo.com/a.jpg';
    cat[1]!.emoji = 'ab';
    cat[2]!.descripcion = 'Visita www.ejemplo.com para más datos';
    cat[3]!.titulo = 'Caja de Lego';
    const msg = validatePack([mala]).errors.join('\n');
    expect(msg).toMatch(/no debe llevar foto/);
    expect(msg).toMatch(/emoji no válido/);
    expect(msg).toMatch(/enlace, correo o teléfono/);
    expect(msg).toMatch(/lego/i);
    expect(isValidEmoji('🏴‍☠️')).toBe(true);
    expect(isValidEmoji('x')).toBe(false);
  });

  it('parseBundle acepta lote y lista suelta, y rechaza basura', () => {
    expect(parseBundle(JSON.stringify(bundle)).ok).toBe(true);
    expect(parseBundle(JSON.stringify(entries.slice(0, 2))).ok).toBe(true);
    expect(parseBundle('no es json').ok).toBe(false);
    expect(parseBundle(JSON.stringify({ formato: 'otro', plantillas: [] })).ok).toBe(false);
  });
});

describe('variantes por edad, duración y jugadores', () => {
  const variants = entries.filter((e) => e.variante);
  const rules = (e: BundleEntry) => (e.plantilla as { reglas: { presupuesto: number; rondas_maximas: number } }).reglas;
  const items = (e: BundleEntry) => (e.plantilla as { catalogo: { titulo: string; descripcion: string }[] }).catalogo;
  const clone = (e: BundleEntry) => JSON.parse(JSON.stringify(e)) as BundleEntry;

  it('hay al menos 30 variantes, cada una con su base, y cubren todas las edades, duraciones y tramos de jugadores', () => {
    expect(variants.length).toBeGreaterThanOrEqual(30);
    const bases = new Map(entries.filter((e) => !e.variante).map((e) => [e.slug, e]));
    for (const v of variants) {
      const base = bases.get(v.variante!.base!);
      expect(base, v.slug).toBeDefined();
      expect((v.plantilla as { tematica: string }).tematica, v.slug).toBe((base!.plantilla as { tematica: string }).tematica);
    }
    for (const edad of ['infantil', 'familiar', 'adolescentes', 'adultos']) expect(variants.some((v) => v.variante!.edad === edad), edad).toBe(true);
    for (const d of ['corta', 'larga']) expect(variants.some((v) => v.variante!.duracion === d), d).toBe(true);
    for (const j of ['2-3', '4-6', '7-10']) expect(variants.some((v) => v.variante!.jugadores === j), j).toBe(true);
  });

  it('corta = 8 rondas, larga = 20 rondas con 20+ elementos y presupuestos proporcionados; ningún elemento se repite', () => {
    for (const v of variants) {
      const r = rules(v);
      if (v.variante!.duracion === 'corta') expect(r.rondas_maximas, v.slug).toBe(8);
      if (v.variante!.duracion === 'larga') { expect(r.rondas_maximas, v.slug).toBe(20); expect(items(v).length, v.slug).toBeGreaterThanOrEqual(20); }
      expect(r.presupuesto / r.rondas_maximas, v.slug).toBeGreaterThanOrEqual(1.5);
      expect(r.presupuesto / r.rondas_maximas, v.slug).toBeLessThanOrEqual(3.5);
    }
    const titles = entries.flatMap((e) => items(e).map((i) => i.titulo.toLowerCase()));
    expect(new Set(titles).size).toBe(titles.length); // por eso el límite del 25 % de solapamiento no hace falta relajarlo
  });

  it('infantil: descripciones sencillas y tono apto', () => {
    for (const v of variants.filter((x) => x.variante!.edad === 'infantil')) {
      expect(['familiar', 'educativo'], v.slug).toContain(v.tono);
      expect(items(v).every((i) => i.descripcion.length <= 100), v.slug).toBe(true);
    }
  });

  it('el validador rechaza variantes incoherentes', () => {
    const corta = clone(variants.find((v) => v.variante!.duracion === 'corta')!);
    (corta.plantilla as { reglas: { rondas_maximas: number } }).reglas.rondas_maximas = 10;
    expect(validatePack([corta]).errors.join('\n')).toMatch(/partida corta tiene 8 rondas/);

    const cara = clone(variants[0]!);
    (cara.plantilla as { reglas: { presupuesto: number } }).reglas.presupuesto = 500;
    expect(validatePack([cara]).errors.join('\n')).toMatch(/presupuesto incoherente/);

    const peques = clone(variants.find((v) => v.variante!.edad === 'infantil')!);
    items(peques)[0]!.descripcion = 'Una copa de vino para brindar con los mayores.';
    expect(validatePack([peques]).errors.join('\n')).toMatch(/no es apto para una variante infantil/);
    peques.tono = 'adultos';
    expect(validatePack([peques]).errors.join('\n')).toMatch(/no encaja con la edad/);

    const larga = clone(variants.find((v) => v.variante!.duracion === 'larga')!);
    (larga.plantilla as { catalogo: unknown[] }).catalogo = items(larga).slice(0, 15);
    larga.etiquetas = larga.etiquetas!.slice(0, 15);
    expect(validatePack([larga]).errors.join('\n')).toMatch(/partida larga necesita al menos 20 elementos/);

    const sinDato = clone(variants[0]!);
    sinDato.variante = {} as BundleEntry['variante'];
    expect(parseBundle(JSON.stringify({ formato: BUNDLE_FORMAT, plantillas: [sinDato] })).ok).toBe(false);
  });

  it('un lote antiguo sin «variante» sigue siendo válido', () => {
    const base = clone(entries.find((e) => !e.variante)!);
    expect('variante' in base).toBe(false);
    expect(parseBundle(JSON.stringify({ formato: BUNDLE_FORMAT, plantillas: [base] })).ok).toBe(true);
  });
});

describe('importador de plantillas del sistema (PGlite)', () => {
  let ctx: TestCtx;
  beforeAll(async () => { ctx = await makeCtx(); });
  afterAll(async () => { await ctx.db.close(); });

  it('ensayo: no guarda nada; importar crea borradores; repetir es idempotente; cambiar actualiza; --publish publica', async () => {
    const some = entries.slice(0, 5);
    const dry = await importSystemTemplates(ctx, 'test', some, { dryRun: true });
    expect(dry.every((r) => r.action === 'created')).toBe(true);
    expect(await listSystemTemplates(ctx, { admin: true })).toHaveLength(0);

    const first = await importSystemTemplates(ctx, 'test', some);
    expect(first.every((r) => r.action === 'created' && r.status === 'draft')).toBe(true);
    let list = await listSystemTemplates(ctx, { admin: true });
    expect(list).toHaveLength(5);
    expect(list.every((t) => t.status === 'draft')).toBe(true);
    // los anfitriones no ven borradores
    expect(await listSystemTemplates(ctx)).toHaveLength(0);

    const again = await importSystemTemplates(ctx, 'test', some);
    expect(again.every((r) => r.action === 'unchanged')).toBe(true);
    expect(await listSystemTemplates(ctx, { admin: true })).toHaveLength(5);

    const changed = JSON.parse(JSON.stringify(some[0])) as BundleEntry;
    changed.descripcion = 'Descripción nueva de la tarjeta, bastante más larga.';
    const upd = await importSystemTemplates(ctx, 'test', [changed]);
    expect(upd[0]!.action).toBe('updated');
    const t = await getSystemTemplate(ctx, changed.slug, { admin: true });
    expect(t.description).toContain('nueva');
    expect(t.data.catalogo!.length).toBeGreaterThanOrEqual(12);

    const pub = await importSystemTemplates(ctx, 'test', some.slice(0, 2), { publish: true });
    expect(pub.every((r) => r.status === 'published')).toBe(true);
    list = await listSystemTemplates(ctx);
    expect(list.map((x) => x.slug).sort()).toEqual(some.slice(0, 2).map((x) => x.slug).sort());
    // reimportar una publicada sin --publish no la retira
    const keep = await importSystemTemplates(ctx, 'test', some.slice(0, 1));
    expect(keep[0]!.status).toBe('published');
  });

  it('un error en una plantilla no impide importar el resto', async () => {
    const good = entries[10]!;
    const bad: BundleEntry = { slug: 'rota', titulo: 'Rota', descripcion: '', plantilla: { formato: 'x' } };
    const r = await importSystemTemplates(ctx, 'test', [bad, good]);
    expect(r[0]!.action).toBe('error');
    expect(r[1]!.action).toBe('created');
  });

  it('importa todo el catálogo (base y variantes) completo', async () => {
    const all = await importSystemTemplates(ctx, 'test', entries);
    expect(all.filter((r) => r.action === 'error')).toEqual([]);
    expect((await listSystemTemplates(ctx, { admin: true })).length).toBeGreaterThanOrEqual(entries.length);
  });
});
