import { z } from 'zod';
import { parseTemplate, TEMPLATE_FORMAT, TEMPLATE_LIMITS, type Template } from './template';

/**
 * Lote de plantillas del sistema (`subasta-salvaje/lote-plantillas@1`): varias plantillas `subasta-salvaje/plantilla@1` con los datos de
 * ficha que necesita la tabla `system_templates` (identificador, título de la tarjeta, descripción, orden). Se usa en el catálogo de
 * `docs/plantillas-sistema/`, en el importador (`npm run templates:import`) y en la subida de varias a la vez de `/admin/plantillas`.
 * Es entrada NO confiable: cada plantilla se vuelve a validar con el esquema real (`parseTemplate`) al guardarla.
 */
export const BUNDLE_FORMAT = 'subasta-salvaje/lote-plantillas@1';
export const BUNDLE_MAX_TEMPLATES = 100;
export const BUNDLE_MAX_BYTES = 2 * 1024 * 1024;
export const PACK_ITEMS = { min: 12, max: 25 } as const;
export const PACK_TONES = ['familiar', 'adultos', 'humor', 'humor negro suave', 'educativo'] as const;

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const bundleEntrySchema = z.object({
  slug: z.string().trim().toLowerCase().regex(SLUG, 'El identificador solo admite minúsculas, números y guiones').min(2).max(60),
  titulo: z.string().trim().min(1, 'Falta el título').max(80),
  descripcion: z.string().trim().max(300).default(''),
  orden: z.number().int().min(0).max(100000).optional(),
  /** Informativo (no se guarda en la base de datos). */
  tono: z.string().trim().max(40).optional(),
  /** Etiquetas de búsqueda (en inglés) por elemento, en el mismo orden que el catálogo: sirven para casar con la biblioteca de medios. No se guardan. */
  etiquetas: z.array(z.array(z.string().trim().min(1).max(60)).max(6)).max(TEMPLATE_LIMITS.items).optional(),
  plantilla: z.unknown(),
});
export type BundleEntry = z.infer<typeof bundleEntrySchema>;

export const bundleSchema = z.object({
  formato: z.literal(BUNDLE_FORMAT, { error: `«formato» debe ser exactamente "${BUNDLE_FORMAT}"` }),
  plantillas: z.array(bundleEntrySchema).min(1, 'El lote no trae ninguna plantilla').max(BUNDLE_MAX_TEMPLATES, `Como máximo ${BUNDLE_MAX_TEMPLATES} plantillas por lote`),
});
export type Bundle = z.infer<typeof bundleSchema>;

/** Lee un lote desde texto JSON. Acepta también una lista suelta de entradas. */
export function parseBundle(raw: string): { ok: true; bundle: Bundle } | { ok: false; error: string } {
  if (raw.length > BUNDLE_MAX_BYTES) return { ok: false, error: `El archivo es demasiado grande (máximo ${BUNDLE_MAX_BYTES / 1024 / 1024} MB).` };
  let data: unknown;
  try {
    data = JSON.parse(raw.replace(/^﻿/, ''));
  } catch {
    return { ok: false, error: 'El archivo no es un JSON válido.' };
  }
  const r = bundleSchema.safeParse(Array.isArray(data) ? { formato: BUNDLE_FORMAT, plantillas: data } : data);
  if (!r.success) {
    const i = r.error.issues[0];
    const where = i?.path.length ? `${i.path.join('.')}: ` : '';
    return { ok: false, error: `Lote no válido. ${where}${i?.message ?? ''}`.trim() };
  }
  return { ok: true, bundle: r.data };
}

const EMOJI = /^(?:\p{Extended_Pictographic}(?:\uFE0F|\u200D|\p{Emoji_Modifier}|\p{Extended_Pictographic})*)+$/u;
export const isValidEmoji = (s: string) => EMOJI.test(s) && [...s].length <= 8;

/** Marcas y nombres propios que no deben aparecer en el catálogo (comprobación mínima, no sustituye a la revisión humana). */
const BANNED = ['pokémon', 'pokemon', 'nintendo', 'disney', 'marvel', 'netflix', 'lego', 'coca-cola', 'nutella', 'playstation', 'xbox', 'starbucks', 'ikea', 'amazon', 'google', 'whatsapp', 'instagram', 'tiktok', 'facebook', 'harry potter', 'star wars', 'batman', 'superman', 'spiderman', 'mario'];

const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

export interface PackReport { errors: string[]; warnings: string[] }

/**
 * Valida un conjunto de plantillas del sistema: esquema Zod real, límites del catálogo propio (12–25 elementos con título, descripción y
 * emoji), sin fotos ni URL, sin duplicados (identificadores, nombres, títulos de elementos y plantillas casi idénticas) y sin marcas.
 */
export function validatePack(entries: BundleEntry[]): PackReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const slugs = new Set<string>();
  const names = new Set<string>();
  const globalTitles = new Map<string, string>();
  const sets: { slug: string; titles: Set<string> }[] = [];

  for (const e of entries) {
    const at = `[${e.slug}]`;
    if (slugs.has(e.slug)) errors.push(`${at} identificador repetido`);
    slugs.add(e.slug);
    const parsed = parseTemplate(JSON.stringify(e.plantilla ?? null));
    if (!parsed.ok) {
      errors.push(...parsed.errors.map((m) => `${at} ${m}`));
      continue;
    }
    const t: Template = parsed.template;
    warnings.push(...parsed.warnings.map((m) => `${at} ${m}`));
    if (t.nombre.length > 60) warnings.push(`${at} el nombre es largo (${t.nombre.length} caracteres)`);
    if (names.has(norm(t.nombre))) errors.push(`${at} nombre repetido: «${t.nombre}»`);
    names.add(norm(t.nombre));
    if (e.tono && !PACK_TONES.includes(e.tono as (typeof PACK_TONES)[number])) errors.push(`${at} tono desconocido «${e.tono}»`);
    if (e.descripcion.length < 20) errors.push(`${at} la descripción de la tarjeta es demasiado corta`);
    if (t.portada || t.casa_inicial) errors.push(`${at} no debe llevar portada ni casa inicial (las aportan la biblioteca y el superadmin)`);
    if (t.jugadores.length) errors.push(`${at} no debe llevar nombres de jugadores (datos personales)`);
    const items = t.catalogo ?? [];
    if (items.length < PACK_ITEMS.min || items.length > PACK_ITEMS.max) errors.push(`${at} debe tener entre ${PACK_ITEMS.min} y ${PACK_ITEMS.max} elementos (tiene ${items.length})`);
    if (t.reglas.rondas_maximas && t.reglas.rondas_maximas > items.length) errors.push(`${at} las rondas superan los elementos`);
    if (e.etiquetas && e.etiquetas.length !== items.length) errors.push(`${at} hay ${e.etiquetas.length} juegos de etiquetas para ${items.length} elementos`);
    if (!e.etiquetas) warnings.push(`${at} sin etiquetas para la biblioteca`);

    const own = new Set<string>();
    items.forEach((it, i) => {
      const w = `${at} elemento ${i + 1} («${it.titulo}»)`;
      if (!it.descripcion || it.descripcion.length < 10) errors.push(`${w}: falta la descripción`);
      if (it.descripcion && it.descripcion.length > 140) errors.push(`${w}: descripción demasiado larga (${it.descripcion.length})`);
      if (it.titulo.length > 50) errors.push(`${w}: título demasiado largo`);
      if (!it.emoji) errors.push(`${w}: falta el emoji`);
      else if (!isValidEmoji(it.emoji)) errors.push(`${w}: emoji no válido «${it.emoji}»`);
      if (it.foto) errors.push(`${w}: no debe llevar foto`);
      if (it.credito) errors.push(`${w}: no debe llevar crédito`);
      const k = norm(it.titulo);
      if (own.has(k)) errors.push(`${w}: título repetido dentro de la plantilla`);
      own.add(k);
      const other = globalTitles.get(k);
      if (other && other !== e.slug) errors.push(`${w}: el título ya existe en «${other}»`);
      else globalTitles.set(k, e.slug);
      const blob = norm(`${it.titulo} ${it.descripcion}`);
      if (/https?:|www\.|@[a-z0-9]|\d{3}[ -]?\d{3}[ -]?\d{3}/.test(blob)) errors.push(`${w}: parece contener un enlace, correo o teléfono`);
      for (const b of BANNED) if (blob.includes(norm(b))) errors.push(`${w}: contiene la marca o nombre propio «${b}»`);
      if (/\s{2,}|^\s|\s$/.test(it.titulo)) errors.push(`${w}: espacios sobrantes`);
      if (!/[.!?…]$/.test(it.descripcion ?? '')) warnings.push(`${w}: la descripción no acaba en punto`);
    });
    sets.push({ slug: e.slug, titles: own });
    const nameBlob = norm(`${t.nombre} ${e.descripcion}`);
    for (const b of BANNED) if (nameBlob.includes(norm(b))) errors.push(`${at} el nombre o la descripción contiene la marca «${b}»`);
  }

  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      const a = sets[i]!;
      const b = sets[j]!;
      const common = [...a.titles].filter((x) => b.titles.has(x)).length;
      if (common / Math.min(a.titles.size, b.titles.size) > 0.25) errors.push(`«${a.slug}» y «${b.slug}» se parecen demasiado (${common} elementos iguales)`);
    }
  }
  return { errors, warnings };
}

export { TEMPLATE_FORMAT };
