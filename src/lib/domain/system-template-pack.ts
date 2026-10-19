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

/**
 * Variante de una plantilla base (campo OPCIONAL de la entrada del lote, no de `plantilla@1`; informativo, no se guarda en la base de datos).
 * Un lote antiguo sin `variante` sigue siendo válido. Al menos uno de `edad`, `duracion` o `jugadores`.
 */
export const VARIANT_AGES = ['infantil', 'familiar', 'adolescentes', 'adultos'] as const;
export const VARIANT_DURATIONS = ['corta', 'media', 'larga'] as const;
export const VARIANT_PLAYERS = ['2-3', '4-6', '7-10'] as const;
/** Rondas fijas de las partidas corta y larga. */
export const VARIANT_ROUNDS = { corta: 8, larga: 20 } as const;
/** Presupuesto por ronda admitido (Ohros/ronda) para que la partida sea jugable: ni se acaba el dinero al principio ni sobra. */
export const VARIANT_BUDGET_PER_ROUND = { min: 1.5, max: 3.5 } as const;

export const variantSchema = z
  .object({
    /** Identificador de la plantilla base de la que parte (misma temática). */
    base: z.string().trim().toLowerCase().regex(SLUG).max(60).optional(),
    edad: z.enum(VARIANT_AGES).optional(),
    duracion: z.enum(VARIANT_DURATIONS).optional(),
    jugadores: z.enum(VARIANT_PLAYERS).optional(),
  })
  .refine((v) => v.edad || v.duracion || v.jugadores, { message: 'La variante debe indicar edad, duración o jugadores' });
export type Variant = z.infer<typeof variantSchema>;

export const bundleEntrySchema = z.object({
  slug: z.string().trim().toLowerCase().regex(SLUG, 'El identificador solo admite minúsculas, números y guiones').min(2).max(60),
  titulo: z.string().trim().min(1, 'Falta el título').max(80),
  descripcion: z.string().trim().max(300).default(''),
  orden: z.number().int().min(0).max(100000).optional(),
  /** Informativo (no se guarda en la base de datos). */
  tono: z.string().trim().max(40).optional(),
  /** Etiquetas de búsqueda (en inglés) por elemento, en el mismo orden que el catálogo: sirven para casar con la biblioteca de medios. No se guardan. */
  etiquetas: z.array(z.array(z.string().trim().min(1).max(60)).max(6)).max(TEMPLATE_LIMITS.items).optional(),
  /** Solo en variantes de una plantilla base (ver `variantSchema`). */
  variante: variantSchema.optional(),
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

/** Palabras que no encajan en una variante infantil (6–10 años). Comprobación mínima, no sustituye a la revisión humana. */
const NOT_FOR_KIDS = ['alcohol', 'cerveza', 'vino', 'whisky', 'licor', 'cóctel', 'coctel', 'resaca', 'borrach', 'tabaco', 'cigarr', 'apuesta', 'casino', 'sangre', 'muerte', 'muerto', 'matar', 'pistola', 'cadáver', 'cadaver', 'droga', 'sexo', 'desnud'];
const TONES_BY_AGE: Record<(typeof VARIANT_AGES)[number], readonly string[]> = {
  infantil: ['familiar', 'educativo'],
  familiar: ['familiar', 'educativo'],
  adolescentes: ['familiar', 'humor', 'educativo'],
  adultos: ['adultos', 'humor', 'humor negro suave'],
};

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
    if (t.portada || t.casa_inicial) errors.push(`${at} no debe llevar portada ni imagen inicial (las aportan la biblioteca y el superadmin)`);
    if (t.jugadores.length) errors.push(`${at} no debe llevar nombres de jugadores (datos personales)`);
    const items = t.catalogo ?? [];
    if (items.length < PACK_ITEMS.min || items.length > PACK_ITEMS.max) errors.push(`${at} debe tener entre ${PACK_ITEMS.min} y ${PACK_ITEMS.max} elementos (tiene ${items.length})`);
    if (t.reglas.rondas_maximas && t.reglas.rondas_maximas > items.length) errors.push(`${at} las rondas superan los elementos`);
    if (e.etiquetas && e.etiquetas.length !== items.length) errors.push(`${at} hay ${e.etiquetas.length} juegos de etiquetas para ${items.length} elementos`);
    if (!e.etiquetas) warnings.push(`${at} sin etiquetas para la biblioteca`);

    if (e.variante) errors.push(...validateVariant(e, t, items.length).map((m) => `${at} ${m}`));

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
      if (e.variante?.edad === 'infantil') {
        if ((it.descripcion ?? '').length > 100) errors.push(`${w}: en una variante infantil la descripción debe ser sencilla (máx. 100 caracteres)`);
        for (const b of NOT_FOR_KIDS) if (blob.includes(norm(b))) errors.push(`${w}: «${b}» no es apto para una variante infantil`);
      }
      if (!/[.!?…]$/.test(it.descripcion ?? '')) warnings.push(`${w}: la descripción no acaba en punto`);
    });
    sets.push({ slug: e.slug, titles: own });
    const nameBlob = norm(`${t.nombre} ${e.descripcion}`);
    for (const b of BANNED) if (nameBlob.includes(norm(b))) errors.push(`${at} el nombre o la descripción contiene la marca «${b}»`);
  }

  // Una variante debe partir de una base existente (si la base viaja en el mismo lote) con la misma temática
  const bySlug = new Map(entries.map((x) => [x.slug, x]));
  for (const e of entries) {
    const base = e.variante?.base ? bySlug.get(e.variante.base) : undefined;
    if (!base) continue;
    if (base.variante) errors.push(`[${e.slug}] la base «${base.slug}» es a su vez una variante`);
    else {
      const a = (e.plantilla as { tematica?: string } | null)?.tematica;
      const b = (base.plantilla as { tematica?: string } | null)?.tematica;
      if (a !== b) errors.push(`[${e.slug}] la temática («${a}») no coincide con la de su base «${base.slug}» («${b}»)`);
    }
  }

  // Los títulos son únicos en TODO el catálogo (también entre variantes de una misma base), así que el solapamiento entre pares solo
  // puede venir de títulos repetidos, que ya se rechazan arriba: no hace falta relajar el límite del 25 %.
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

/** Reglas propias de las variantes: coherencia entre edad, duración y jugadores y las reglas de la partida (rondas, presupuesto). */
function validateVariant(e: BundleEntry, t: Template, nItems: number): string[] {
  const v = e.variante!;
  const out: string[] = [];
  const rounds = t.reglas.rondas_maximas;
  const budget = t.reglas.presupuesto;
  if (!rounds || budget === undefined) return ['una variante debe fijar «presupuesto» y «rondas» en las reglas'];
  const perRound = budget / rounds;
  if (perRound < VARIANT_BUDGET_PER_ROUND.min || perRound > VARIANT_BUDGET_PER_ROUND.max) out.push(`presupuesto incoherente con las rondas (${budget} Ohros en ${rounds} rondas = ${perRound.toFixed(2)} por ronda; admitido ${VARIANT_BUDGET_PER_ROUND.min}–${VARIANT_BUDGET_PER_ROUND.max})`);
  if (v.duracion === 'corta' && rounds !== VARIANT_ROUNDS.corta) out.push(`una partida corta tiene ${VARIANT_ROUNDS.corta} rondas (tiene ${rounds})`);
  if (v.duracion === 'larga') {
    if (rounds !== VARIANT_ROUNDS.larga) out.push(`una partida larga tiene ${VARIANT_ROUNDS.larga} rondas (tiene ${rounds})`);
    if (nItems < VARIANT_ROUNDS.larga) out.push(`una partida larga necesita al menos ${VARIANT_ROUNDS.larga} elementos (tiene ${nItems})`);
  }
  if (v.duracion === 'media' && (rounds < 9 || rounds > 15)) out.push('una partida media tiene entre 9 y 15 rondas');
  if (v.jugadores === '2-3' && rounds > 10) out.push('con 2–3 jugadores las rondas no pasan de 10');
  if (v.jugadores === '4-6' && (rounds < 8 || rounds > 12)) out.push('con 4–6 jugadores las rondas van de 8 a 12');
  if (v.jugadores === '7-10' && rounds < 12) out.push('con 7–10 jugadores hacen falta al menos 12 rondas para que todos ganen algo');
  if (v.edad) {
    if (e.tono && !TONES_BY_AGE[v.edad].includes(e.tono)) out.push(`el tono «${e.tono}» no encaja con la edad «${v.edad}» (admitidos: ${TONES_BY_AGE[v.edad].join(', ')})`);
    if (v.edad === 'infantil' && rounds > 10) out.push('una variante infantil no pasa de 10 rondas');
  }
  return out;
}

export { TEMPLATE_FORMAT };
