import { describe, expect, it } from 'vitest';
import { concept, concepts, coverageOf, isMatchable, matchTemplate, normText, rankCandidates, stem, type MatchImage } from '@/lib/library/match';

const img = (id: string, title: string, tags: string[] = [], category = ''): MatchImage => ({ id, url: `https://cdn.ejemplo.com/${id}.webp`, title, tags, category });

describe('normalización', () => {
  it('quita tildes, signos y mayúsculas', () => {
    expect(normText('  ¡Pirámide DORADA! ')).toBe('piramide dorada');
  });
  it('plurales y género simples dan la misma raíz', () => {
    expect(stem('lamparas')).toBe(stem('lampara'));
    expect(stem('relojes')).toBe(stem('reloj'));
    expect(stem('tigres')).toBe(stem('tigre'));
    expect(stem('gata')).toBe(stem('gato'));
    expect(stem('cherries')).toBe(stem('cherry'));
    expect(stem('luces')).toBe(stem('luz'));
  });
  it('sinónimos ES↔EN: el mismo concepto en los dos idiomas', () => {
    expect(concept('camello')).toBe(concept('camel'));
    expect(concept('Lámparas')).toBe(concept('lamp'));
    expect(concept('gatos')).toBe(concept('cats'));
    expect(concepts('Pirámide de Giza').has(concept('pyramid'))).toBe(true);
  });
});

describe('puntuación y orden', () => {
  const lib = [
    img('a', 'Pirámide dorada', ['pyramid', 'egypt']),
    img('b', 'IMG 2231', ['pyramid']),
    img('c', 'Camello en el desierto', ['camel', 'desert']),
    img('d', 'Taza de café', ['cup', 'coffee']),
  ];
  it('título idéntico gana y explica por qué; las no relacionadas no salen', () => {
    const r = rankCandidates({ title: 'Pirámide dorada', tags: ['pyramid'] }, lib);
    expect(r[0]!.image.id).toBe('a');
    expect(r[0]!.confidence).toBe('alta');
    expect(r[0]!.reasons.join(' ')).toContain('mismo título');
    expect(r.map((c) => c.image.id)).toEqual(['a', 'b']);
  });
  it('casa por etiquetas inglesas aunque el título esté en español', () => {
    const r = rankCandidates({ title: 'Camello de caravana', tags: ['camel desert'] }, lib);
    expect(r[0]!.image.id).toBe('c');
    expect(r[0]!.score).toBeGreaterThanOrEqual(0.7);
  });
  it('sin etiquetas del elemento usa el título (con sinónimos) y el emoji', () => {
    expect(rankCandidates({ title: 'Taza de café' }, lib)[0]!.image.id).toBe('d');
    expect(rankCandidates({ title: 'Joroba', emoji: '🐫' }, lib)[0]!.image.id).toBe('c');
  });
  it('la categoría suma', () => {
    const l = [img('x', 'Foto', ['pyramid'], 'Egipto'), img('y', 'Foto', ['pyramid'], 'Otra')];
    const r = rankCandidates({ title: 'Pirámide', tags: ['pyramid'] }, l, { context: 'Egipto' });
    expect(r[0]!.image.id).toBe('x');
    expect(r[0]!.score).toBeGreaterThan(r[1]!.score);
  });
  it('es determinista y los empates se rompen por id', () => {
    const l = [img('z2', 'Gato', ['cat']), img('z1', 'Gato', ['cat'])];
    const a = rankCandidates({ title: 'Gato', tags: ['cat'] }, l).map((c) => c.image.id);
    const b = rankCandidates({ title: 'Gato', tags: ['cat'] }, [...l].reverse()).map((c) => c.image.id);
    expect(a).toEqual(['z1', 'z2']);
    expect(b).toEqual(a);
  });
});

describe('matchTemplate', () => {
  it('no repite foto: el elemento con peor ajuste usa la siguiente mejor o se queda sin ella', () => {
    const lib = [img('g1', 'Gato negro', ['cat', 'black']), img('g2', 'Gato', ['cat'])];
    const items = [{ title: 'Gato negro', tags: ['black cat'] }, { title: 'Estatuilla de gato', tags: ['cat statue'] }];
    const m = matchTemplate(items, lib);
    expect(m[0]!.best!.image.id).toBe('g1');
    expect(m[1]!.best!.image.id).toBe('g2');
    const solo = matchTemplate([{ title: 'Gato', tags: ['cat'] }, { title: 'Gata', tags: ['cat'] }], [img('u', 'Gato', ['cat'])]);
    expect(solo.filter((x) => x.best)).toHaveLength(1);
    const loser = solo.find((x) => !x.best)!;
    expect(loser.candidates[0]!.usedBy).toBeDefined();
    expect(loser.candidates[0]!.reasons.join(' ')).toContain('penalizada');
  });
  it('respeta el umbral de confianza', () => {
    const lib = [img('p', 'IMG 1', ['pyramid'])];
    const item = { title: 'Pirámide dorada', tags: ['pyramid'] };
    expect(matchTemplate([item], lib)[0]!.best).not.toBeNull();
    expect(matchTemplate([item], lib, { minScore: 0.95 })[0]!.best).toBeNull();
  });
  it('sin candidatas: biblioteca vacía o sin relación; informa de lo que falta', () => {
    const vacia = matchTemplate([{ title: 'Esfinge vigilante', tags: ['sphinx'] }], []);
    expect(vacia[0]!.best).toBeNull();
    expect(vacia[0]!.missing).toContain('sphinx');
    const otra = matchTemplate([{ title: 'Esfinge vigilante', tags: ['sphinx'] }], [img('t', 'Taza', ['cup'])]);
    expect(otra[0]!.candidates).toEqual([]);
  });
  it('cobertura y huecos', () => {
    const lib = [img('a', 'Pirámide dorada', ['pyramid'])];
    const c = coverageOf(matchTemplate([{ title: 'Pirámide dorada', tags: ['pyramid'] }, { title: 'Cobra real', tags: ['cobra'] }], lib));
    expect(c).toMatchObject({ total: 2, matched: 1, high: 1, pct: 50 });
    expect(c.gaps).toEqual([{ index: 1, title: 'Cobra real', tags: ['cobra'], missing: ['cobra'] }]);
  });
  it('solo son candidatas las fotos revisadas con rol product', () => {
    expect(isMatchable({ roles: ['product'], reviewed: true, url: 'https://a/b.webp' })).toBe(true);
    expect(isMatchable({ roles: ['start'], reviewed: true, url: 'https://a/b.webp' })).toBe(false);
    expect(isMatchable({ roles: ['product'], reviewed: false, url: 'https://a/b.webp' })).toBe(false);
    expect(isMatchable({ roles: ['product', 'start'], reviewed: true, url: 'http://a/b.webp' })).toBe(false);
  });
});

describe('con el lote real y una biblioteca sintética', () => {
  it('una foto por elemento (etiquetas del propio elemento) se casa con su elemento y sin repetir', async () => {
    const { loadBundleFile } = await import('../scripts/templates/pack');
    const { itemsFrom } = await import('@/lib/services/library-match-service');
    let total = 0, ok = 0;
    for (const e of loadBundleFile().plantillas) {
      const items = itemsFrom((e.plantilla as { catalogo: never }).catalogo, e.etiquetas);
      const images = items.map((it, i) => img(`${e.slug}-${i}`, (it.tags ?? []).join(' '), [...(it.tags ?? [])]));
      const res = matchTemplate(items, images);
      const used = new Set<string>();
      res.forEach((r, i) => { total++; if (r.best?.image.id === images[i]!.id) ok++; if (r.best) { expect(used.has(r.best.image.id)).toBe(false); used.add(r.best.image.id); } });
    }
    expect(total).toBeGreaterThan(300);
    expect(ok / total).toBeGreaterThan(0.95);
  });
  it('una biblioteca ajena (fotos de otros temas) no genera propuestas de confianza alta', async () => {
    const { loadBundleFile } = await import('../scripts/templates/pack');
    const { itemsFrom } = await import('@/lib/services/library-match-service');
    const e = loadBundleFile().plantillas[0]!;
    const items = itemsFrom((e.plantilla as { catalogo: never }).catalogo, e.etiquetas);
    const res = matchTemplate(items, [img('x1', 'Taza de café', ['coffee', 'cup']), img('x2', 'Bicicleta roja', ['bicycle']), img('x3', 'Paraguas', ['umbrella'])]);
    expect(res.filter((r) => r.best?.confidence === 'alta')).toHaveLength(0);
  });
});
