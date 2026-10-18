import { EMOJI_CONCEPTS, SYNONYMS } from './match-lexicon';

/**
 * Motor de casamiento entre ELEMENTOS de plantilla del sistema y FOTOS de la biblioteca de medios.
 * Puro y determinista: sin IA, sin red, sin base de datos (recibe los datos ya cargados). Lo usan el script `npm run templates:match`,
 * el servicio `library-match-service` y el panel de administración. Detalle y límites: docs/CASAR-FOTOS-PLANTILLAS.md.
 *
 * Idea: cada texto se reduce a «conceptos» (palabras sin tildes, sin plurales ni género simples y con ES↔EN unificado por el léxico).
 * La puntuación (0–1) suma componentes EXPLICABLES, cada uno visible en `reasons`:
 *   A título del elemento ↔ título de la foto (coeficiente de Dice)            0,15 (0,30 sin etiquetas)
 *   B conceptos del título del elemento presentes en título/etiquetas de la foto 0,15 (0,25)
 *   C etiquetas del elemento presentes en título/etiquetas de la foto           0,55 (0,30; sin etiquetas, se usa B)
 *   D categoría de la foto coincide con el elemento o con la temática            0,10
 *   E conceptos de las etiquetas de la foto presentes en la descripción          0,05
 * Título idéntico (normalizado) = mínimo 0,85. Una foto ya asignada a otro elemento de la misma plantilla se penaliza (−0,5) para no repetirla.
 */

export type Confidence = 'alta' | 'media' | 'baja';

export interface MatchItem {
  title: string;
  description?: string | null;
  emoji?: string | null;
  /** Etiquetas de búsqueda (normalmente en inglés, del lote). */
  tags?: readonly string[] | null;
  /** Categoría de biblioteca deseada, si se conoce (opcional). */
  category?: string | null;
}

export interface MatchImage {
  id: string;
  url: string;
  title: string;
  category?: string | null;
  tags?: readonly string[] | null;
  credit?: string | null;
}

export interface MatchOptions {
  /** Puntuación mínima para proponer una candidata (por defecto 0,40). */
  minScore?: number;
  /** Puntuación desde la que la confianza es «alta» (0,70) y «media» (0,50). */
  highScore?: number;
  mediumScore?: number;
  /** Nº máximo de candidatas por elemento en el informe (5). */
  maxCandidates?: number;
  /** Penalización por foto ya asignada a otro elemento de la plantilla (0,5). */
  repeatPenalty?: number;
  /** Temática de la plantilla (p. ej. «Egipto»): ayuda a la categoría. */
  context?: string | null;
}

export const MATCH_DEFAULTS = { minScore: 0.4, highScore: 0.7, mediumScore: 0.5, maxCandidates: 5, repeatPenalty: 0.5 } as const;

export interface ScoreParts { title: number; titleRecall: number; tags: number; category: number; description: number }

export interface Candidate {
  image: MatchImage;
  /** Puntuación final 0–1 (3 decimales), ya con la penalización por repetición. */
  score: number;
  /** Puntuación antes de penalizar. */
  base: number;
  confidence: Confidence;
  parts: ScoreParts;
  /** Frases en español que explican la puntuación. */
  reasons: string[];
  /** Si la foto se la queda otro elemento de la plantilla (índice) esta candidata no es la elegida. */
  usedBy?: number;
}

export interface ItemMatch {
  index: number;
  item: MatchItem;
  /** Candidata elegida (la mejor que no repite foto y supera el umbral), o `null`. */
  best: Candidate | null;
  candidates: Candidate[];
  /** Conceptos del elemento que ninguna foto cubre (alimenta los huecos del plan de relleno). */
  missing: string[];
}

/* ----------------------------- normalización ----------------------------- */

const STOP = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas', 'y', 'e', 'o', 'con', 'sin', 'en', 'al', 'a', 'para', 'por', 'que', 'su', 'sus', 'lo', 'of', 'the', 'and', 'with', 'in', 'for', 'a', 'an', 'on', 'to', 'at']);

/** Minúsculas, sin tildes ni signos; palabras sueltas. «Pirámide de Giza» → ['piramide', 'de', 'giza']. */
export function words(s: string): string[] {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9ñ]+/g, ' ').trim().split(' ').filter(Boolean);
}

/** Texto normalizado para comparar títulos completos. */
export const normText = (s: string): string => words(s).join(' ');

/** Raíz sencilla: quita plural (-s, -es, -ies, -ces) y la vocal final (género: gato/gata). Palabras de ≤ 3 letras no se tocan. */
export function stem(w: string): string {
  let s = w;
  if (s.length > 4 && s.endsWith('ies')) s = `${s.slice(0, -3)}y`;
  else if (s.length > 4 && s.endsWith('ces')) s = `${s.slice(0, -3)}z`;
  else if (s.length > 3 && s.endsWith('s') && !s.endsWith('ss')) s = s.slice(0, -1);
  if (s.length > 3 && /[aeo]$/.test(s)) s = s.slice(0, -1);
  return s;
}

/** Concepto de una palabra: la raíz, unificada ES→EN si el léxico la conoce. */
export const concept = (w: string): string => {
  const st = stem(words(w)[0] ?? '');
  return SYNONYMS.get(st) ?? st;
};

/** Conjunto de conceptos de un texto (sin palabras vacías ni números sueltos). */
export function concepts(s: string | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const w of words(s ?? '')) if (!STOP.has(w) && !/^\d+$/.test(w) && w.length > 1) out.add(concept(w));
  return out;
}
const conceptsOf = (list: readonly string[] | null | undefined): Set<string> => {
  const out = new Set<string>();
  for (const t of list ?? []) for (const c of concepts(t)) out.add(c);
  return out;
};
const emojiConcepts = (e: string | null | undefined): Set<string> => {
  const k = e ? EMOJI_CONCEPTS[e] ?? EMOJI_CONCEPTS[e.replace(/️/g, '')] : undefined;
  return k ? concepts(k) : new Set();
};

const inter = <T>(a: ReadonlySet<T>, b: ReadonlySet<T>): T[] => [...a].filter((x) => b.has(x));
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/* -------------------------------- puntuación ------------------------------- */

interface PreparedImage { image: MatchImage; titleNorm: string; title: Set<string>; all: Set<string>; tags: Set<string>; category: Set<string> }
interface PreparedItem { titleNorm: string; title: Set<string>; tags: Set<string>; hasTags: boolean; desc: Set<string>; ctx: Set<string>; wanted: Set<string> }

function prepareImage(image: MatchImage): PreparedImage {
  const title = concepts(image.title);
  const tags = conceptsOf(image.tags);
  return { image, titleNorm: normText(image.title), title, tags, all: new Set([...title, ...tags]), category: concepts(image.category) };
}
function prepareItem(item: MatchItem, context: string | null | undefined): PreparedItem {
  const title = concepts(item.title);
  const tags = conceptsOf(item.tags);
  // El emoji solo orienta cuando no hay etiquetas (con etiquetas diluiría la puntuación: 🔑 en «ankh»).
  if (tags.size === 0) for (const c of emojiConcepts(item.emoji)) tags.add(c);
  const ctx = concepts([context, item.category].filter(Boolean).join(' '));
  return { titleNorm: normText(item.title), title, tags, hasTags: tags.size > 0, desc: concepts(item.description), ctx, wanted: new Set([...title, ...tags]) };
}

export function confidenceOf(score: number, o: MatchOptions = {}): Confidence {
  return score >= (o.highScore ?? MATCH_DEFAULTS.highScore) ? 'alta' : score >= (o.mediumScore ?? MATCH_DEFAULTS.mediumScore) ? 'media' : 'baja';
}

/** Puntuación de UNA foto para UN elemento, con su explicación. */
export function scorePair(it: PreparedItem, im: PreparedImage): { base: number; parts: ScoreParts; reasons: string[] } {
  const common = inter(it.title, im.title);
  const dice = it.title.size + im.title.size === 0 ? 0 : (2 * common.length) / (it.title.size + im.title.size);
  const titleHit = inter(it.title, im.all);
  const titleRecall = it.title.size ? titleHit.length / it.title.size : 0;
  const tagHit = inter(it.tags, im.all);
  const tags = it.hasTags ? tagHit.length / it.tags.size : titleRecall;
  const catHit = inter(im.category, new Set([...it.wanted, ...it.ctx]));
  const category = im.category.size && catHit.length ? 1 : 0;
  const descHit = inter(im.tags, it.desc);
  const description = im.tags.size && descHit.length ? 1 : 0;
  const parts: ScoreParts = { title: r3(dice), titleRecall: r3(titleRecall), tags: r3(tags), category, description };
  // Con etiquetas del lote pesan más (resumen del elemento: el título suele traer palabras de adorno); sin ellas manda el título.
  const w = it.hasTags ? { a: 0.15, b: 0.15, c: 0.55 } : { a: 0.3, b: 0.25, c: 0.3 };
  let base = w.a * dice + w.b * titleRecall + w.c * tags + 0.1 * category + 0.05 * description;
  const reasons: string[] = [];
  if (it.titleNorm && it.titleNorm === im.titleNorm) {
    base = Math.max(base, 0.85);
    reasons.push('mismo título');
  } else if (common.length) reasons.push(`título comparte «${common.join(', ')}»`);
  const extraTitle = titleHit.filter((c) => !common.includes(c));
  if (extraTitle.length) reasons.push(`el título del elemento aparece en las etiquetas/título de la foto («${extraTitle.join(', ')}»)`);
  if (it.hasTags && tagHit.length) reasons.push(`etiquetas en común: ${tagHit.join(', ')} (${tagHit.length}/${it.tags.size})`);
  if (category) reasons.push(`categoría «${im.image.category}» encaja`);
  if (description) reasons.push('las etiquetas de la foto aparecen en la descripción');
  if (!reasons.length) reasons.push('sin coincidencias');
  return { base: Math.min(1, base), parts, reasons };
}

/* ------------------------------ casamiento ------------------------------- */

/**
 * Candidatas ordenadas para UN elemento (sin tener en cuenta las demás). Orden: puntuación ↓, luego título más parecido, luego `id` (desempate estable).
 * Solo se consideran las fotos que se le pasan: el llamante filtra rol `product`, revisadas y públicas (ver `isMatchable`).
 */
export function rankCandidates(item: MatchItem, images: readonly MatchImage[], opts: MatchOptions = {}): Candidate[] {
  const it = prepareItem(item, opts.context);
  return images
    .map(prepareImage)
    .map((im) => {
      const s = scorePair(it, im);
      const score = r3(s.base);
      return { image: im.image, score, base: score, confidence: confidenceOf(score, opts), parts: s.parts, reasons: s.reasons } satisfies Candidate;
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || b.parts.title - a.parts.title || a.image.id.localeCompare(b.image.id));
}

/**
 * Casa todos los elementos de UNA plantilla con la biblioteca. Una foto solo se asigna a un elemento: se reparte de forma voraz por puntuación
 * (los pares más seguros primero; empates por índice de elemento y `id` de foto), y a los demás elementos esa foto les sale penalizada
 * (`repeatPenalty`) con `usedBy`, de modo que la siguiente mejor pasa a ser la elegida.
 */
export function matchTemplate(items: readonly MatchItem[], images: readonly MatchImage[], opts: MatchOptions = {}): ItemMatch[] {
  const min = opts.minScore ?? MATCH_DEFAULTS.minScore;
  const penalty = opts.repeatPenalty ?? MATCH_DEFAULTS.repeatPenalty;
  const max = opts.maxCandidates ?? MATCH_DEFAULTS.maxCandidates;
  const ranked = items.map((it) => rankCandidates(it, images, opts));
  const pairs = ranked.flatMap((list, i) => list.filter((c) => c.score >= min).map((c) => ({ i, c })));
  pairs.sort((a, b) => b.c.score - a.c.score || a.i - b.i || a.c.image.id.localeCompare(b.c.image.id));
  const chosen = new Map<number, Candidate>();
  const owner = new Map<string, number>();
  for (const { i, c } of pairs) {
    if (chosen.has(i) || owner.has(c.image.id)) continue;
    chosen.set(i, c);
    owner.set(c.image.id, i);
  }
  return items.map((item, index) => {
    const candidates = ranked[index]!
      .map((c): Candidate => {
        const who = owner.get(c.image.id);
        if (who === undefined || who === index) return c;
        const score = r3(Math.max(0, c.base - penalty));
        return { ...c, score, confidence: confidenceOf(score, opts), usedBy: who, reasons: [...c.reasons, `penalizada: ya es la foto de «${items[who]!.title}»`] };
      })
      .sort((a, b) => b.score - a.score || b.parts.title - a.parts.title || a.image.id.localeCompare(b.image.id))
      .filter((c) => c.score >= min || c.base >= min)
      .slice(0, max);
    const best = chosen.get(index) ?? null;
    const covered = new Set<string>(best ? prepareImage(best.image).all : []);
    // Palabras legibles (no raíces): las etiquetas del lote si las hay (inglés), si no las del título.
    const src = item.tags?.length ? item.tags.join(' ') : item.title;
    const missing = best ? [] : [...new Set(words(src).filter((w) => !STOP.has(w) && w.length > 1 && !covered.has(concept(w))))];
    return { index, item, best, candidates, missing };
  });
}

/** Foto candidata válida: rol `product`, revisada (pública para los anfitriones) y con enlace https. */
export function isMatchable(img: { roles?: readonly string[] | null; reviewed?: boolean | null; url?: string | null }): boolean {
  return Boolean(img.reviewed) && (img.roles ?? []).includes('product') && /^https:\/\//i.test(img.url ?? '');
}

/* ------------------------------ cobertura ------------------------------- */

export interface Coverage {
  total: number;
  /** Elementos con foto propuesta (de cualquier confianza). */
  matched: number;
  high: number;
  medium: number;
  low: number;
  /** % de elementos con foto candidata (0–100, 1 decimal). */
  pct: number;
  /** Elementos sin candidata (título + etiquetas del inglés que faltan). */
  gaps: { index: number; title: string; tags: string[]; missing: string[] }[];
}

export function coverageOf(matches: readonly ItemMatch[]): Coverage {
  const got = matches.filter((m) => m.best);
  const n = (c: Confidence) => got.filter((m) => m.best!.confidence === c).length;
  return {
    total: matches.length, matched: got.length, high: n('alta'), medium: n('media'), low: n('baja'),
    pct: matches.length ? Math.round((got.length / matches.length) * 1000) / 10 : 0,
    gaps: matches.filter((m) => !m.best).map((m) => ({ index: m.index, title: m.item.title, tags: [...(m.item.tags ?? [])], missing: m.missing })),
  };
}
