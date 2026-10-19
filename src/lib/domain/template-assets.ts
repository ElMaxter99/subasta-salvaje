import type { Template } from './template';

/**
 * Qué hace una imagen soltada en el editor de plantillas del superadmin: a qué campo va.
 * Se decide por el NOMBRE del archivo: «portada…», «casa…/inicial…» (nombres admitidos para la imagen inicial) o el título de un elemento del catálogo
 * (sin tildes ni mayúsculas, p. ej. «sombrilla-roja.jpg» → «Sombrilla roja»). Lo que no encaja queda sin asignar.
 */
export type AssetTarget = { kind: 'cover' } | { kind: 'scene' } | { kind: 'item'; index: number };

export const slugify = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export function matchTarget(filename: string, t: Pick<Template, 'catalogo'>): AssetTarget | null {
  const base = slugify(filename.replace(/\.[^.]+$/, ''));
  if (!base) return null;
  if (/^(portada|cover)(-|$)/.test(base)) return { kind: 'cover' };
  if (/^(casa|inicial|escena|casa-inicial)(-|$)/.test(base)) return { kind: 'scene' };
  const items = t.catalogo ?? [];
  const exact = items.findIndex((i) => slugify(i.titulo) === base);
  if (exact >= 0) return { kind: 'item', index: exact };
  const loose = items.map((i, index) => ({ index, slug: slugify(i.titulo) })).filter((x) => x.slug && (base.startsWith(x.slug) || x.slug.startsWith(base)));
  // Varios elementos encajan (p. ej. «hamaca» y «hamaca doble» para «hamaca-doble-2»): gana el título más largo, si es único.
  const longest = Math.max(0, ...loose.map((x) => x.slug.length));
  const best = loose.filter((x) => x.slug.length === longest);
  return best.length === 1 ? { kind: 'item', index: best[0]!.index } : null;
}

/** Devuelve una copia de la plantilla con la URL puesta en el campo que corresponde. */
export function applyAsset(t: Template, target: AssetTarget, url: string): Template {
  if (target.kind === 'cover') return { ...t, portada: url };
  if (target.kind === 'scene') return { ...t, casa_inicial: url };
  return { ...t, catalogo: (t.catalogo ?? []).map((it, i) => (i === target.index ? { ...it, foto: url } : it)) };
}

export const targetLabel = (t: AssetTarget, tpl: Pick<Template, 'catalogo'>): string =>
  t.kind === 'cover' ? 'Portada' : t.kind === 'scene' ? 'Imagen inicial' : `Elemento · ${tpl.catalogo?.[t.index]?.titulo ?? t.index + 1}`;
