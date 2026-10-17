import { describe, expect, it } from 'vitest';
import { parseTemplate, type Template } from '@/lib/domain/template';
import { addItem, emptyToNull, moveItem, removeItem, updateItem } from '@/lib/domain/template-edit';

const base = (): Template => ({
  formato: 'subasta-salvaje/plantilla@1', nombre: 'X', tematica: 'Casa', reglas: {}, jugadores: [],
  catalogo: [{ titulo: 'A', descripcion: '' }, { titulo: 'B', descripcion: '' }, { titulo: 'C', descripcion: '' }],
});
const titles = (t: Template) => (t.catalogo ?? []).map((i) => i.titulo);

describe('editor visual: operaciones del catálogo', () => {
  it('añadir, quitar y mover mantienen el orden y no mutan el original', () => {
    const t = base();
    expect(titles(addItem(t))).toEqual(['A', 'B', 'C', 'Elemento 4']);
    expect(titles(removeItem(t, 1))).toEqual(['A', 'C']);
    expect(titles(moveItem(t, 2, -1))).toEqual(['A', 'C', 'B']);
    expect(titles(moveItem(t, 0, 1))).toEqual(['B', 'A', 'C']);
    expect(titles(moveItem(t, 0, -1))).toEqual(['A', 'B', 'C']); // en el borde no hace nada
    expect(titles(moveItem(t, 2, 1))).toEqual(['A', 'B', 'C']);
    expect(titles(t)).toEqual(['A', 'B', 'C']);
  });
  it('actualizar un elemento solo cambia ese', () => {
    const r = updateItem(base(), 1, { titulo: 'Nuevo', foto: 'https://cdn.x/a.webp', credito: 'Autor' });
    expect(r.catalogo![1]).toMatchObject({ titulo: 'Nuevo', foto: 'https://cdn.x/a.webp', credito: 'Autor' });
    expect(titles(r)).toEqual(['A', 'Nuevo', 'C']);
  });
  it('una plantilla sin catálogo también se puede editar', () => {
    const t = { ...base(), catalogo: undefined };
    expect(titles(addItem(t))).toEqual(['Elemento 1']);
    expect(emptyToNull('  ')).toBeNull();
    expect(emptyToNull(' x ')).toBe('x');
  });
});

describe('créditos de las imágenes en el formato de plantilla', () => {
  it('se aceptan (plantilla y elemento), se limpian y se limitan', () => {
    const ok = parseTemplate(JSON.stringify({ ...base(), creditos: '  Wikimedia   Commons ', catalogo: [{ titulo: 'A', credito: 'Autor · CC BY' }] }));
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.template.creditos).toBe('Wikimedia Commons');
      expect(ok.template.catalogo![0]!.credito).toBe('Autor · CC BY');
      expect(ok.warnings.join(' ')).not.toMatch(/desconocido/);
    }
    expect(parseTemplate(JSON.stringify({ ...base(), creditos: 'x'.repeat(201) })).ok).toBe(false);
    expect(parseTemplate(JSON.stringify({ ...base(), catalogo: [{ titulo: 'A', credito: 'y'.repeat(121) }] })).ok).toBe(false);
  });
});
