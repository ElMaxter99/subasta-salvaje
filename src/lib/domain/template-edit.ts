import type { Template, TemplateItem } from './template';

/** Operaciones puras del editor visual de plantillas (el estado real sigue siendo el JSON validado). */
type Items = NonNullable<Template['catalogo']>;
const items = (t: Template): Items => t.catalogo ?? [];

export function addItem(t: Template): Template {
  return { ...t, catalogo: [...items(t), { titulo: `Elemento ${items(t).length + 1}`, descripcion: '', emoji: null, foto: null }] };
}

export function removeItem(t: Template, index: number): Template {
  return { ...t, catalogo: items(t).filter((_, i) => i !== index) };
}

export function moveItem(t: Template, index: number, delta: -1 | 1): Template {
  const list = [...items(t)];
  const to = index + delta;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return t;
  [list[index], list[to]] = [list[to]!, list[index]!];
  return { ...t, catalogo: list };
}

export function updateItem(t: Template, index: number, patch: Partial<TemplateItem>): Template {
  return { ...t, catalogo: items(t).map((it, i) => (i === index ? { ...it, ...patch } : it)) };
}

/** Una cadena vacía se guarda como «sin valor» (null) en los campos opcionales de texto/URL. */
export const emptyToNull = (s: string): string | null => (s.trim() === '' ? null : s.trim());
