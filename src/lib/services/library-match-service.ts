import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { DomainError } from '@/lib/domain/errors';
import type { BundleEntry } from '@/lib/domain/system-template-pack';
import type { Template } from '@/lib/domain/template';
import { coverageOf, matchTemplate, normText, type Coverage, type ItemMatch, type MatchImage, type MatchItem, type MatchOptions } from '@/lib/library/match';
import type { LibraryPickImage } from './library-service';
import type { AppContext } from './context';
import { getSystemTemplate, saveSystemTemplate, validateSystemTemplateData, type SystemTemplate } from './system-template-service';

type Ctx = Pick<AppContext, 'db'>;

/**
 * Casamiento de fotos de la biblioteca con los elementos de las plantillas del sistema (motor puro: `src/lib/library/match.ts`).
 * Este servicio solo carga datos (por las funciones SQL de LECTURA ya existentes) y aplica lo elegido guardando la plantilla por el servicio
 * de siempre (`saveSystemTemplate` → `ss_admin_system_template_upsert`). Reglas: nunca publica, nunca copia ni sube imágenes (se guarda el
 * enlace de la biblioteca), nunca pisa una foto que el elemento ya tenga, solo borradores, nada de IA ni de red.
 */

const PAGE = 60;
const MAX_IMAGES = 5000;

/** Todas las fotos candidatas: rol `product` y revisadas (las mismas que ve un anfitrión en el selector). */
export async function loadMatchableImages(ctx: Pick<AppContext, 'db'>): Promise<MatchImage[]> {
  const out: MatchImage[] = [];
  for (let offset = 0; offset < MAX_IMAGES; offset += PAGE) {
    const page = await ctx.db.rpc<{ total: number; images: LibraryPickImage[] }>('ss_library_pick_list', { role: 'product', q: '', category: null, limit: PAGE, offset });
    for (const i of page.images) out.push({ id: i.id, url: i.url, title: i.title, category: i.category, tags: i.tags, credit: i.credit });
    if (offset + PAGE >= page.total || page.images.length === 0) break;
  }
  return out;
}

/** Etiquetas del lote (por título de elemento normalizado) de una plantilla; vacío si no hay lote o no está esa plantilla. */
export function loteTagsBySlug(slug: string, file = path.join(process.cwd(), 'docs', 'plantillas-sistema', 'lote.json')): Map<string, string[]> {
  const map = new Map<string, string[]>();
  try {
    if (!existsSync(file)) return map;
    const lote = JSON.parse(readFileSync(file, 'utf8')) as { plantillas?: BundleEntry[] };
    const e = lote.plantillas?.find((p) => p.slug === slug);
    const cat = (e?.plantilla as { catalogo?: { titulo: string }[] } | undefined)?.catalogo ?? [];
    cat.forEach((it, i) => { if (e?.etiquetas?.[i]) map.set(normText(it.titulo), e.etiquetas[i]!); });
  } catch {
    /* sin lote disponible (p. ej. en Vercel): se casa solo por título, descripción y emoji */
  }
  return map;
}

export interface ProposalItem extends ItemMatch {
  /** El elemento ya lleva foto: no se propone nada (no se pisa). */
  hasPhoto: boolean;
}
export interface Proposal {
  template: { id?: string; slug: string; title: string; status?: 'draft' | 'published' };
  items: ProposalItem[];
  coverage: Coverage;
  /** Cuántas fotos candidatas había (0 = biblioteca vacía o sin revisar). */
  library: number;
}

/** Elementos de un catálogo con sus etiquetas (por índice si vienen del lote, o por título). */
export function itemsFrom(catalogo: Template['catalogo'], tags: readonly (readonly string[])[] | Map<string, string[]> | undefined): MatchItem[] {
  return (catalogo ?? []).map((it, i) => ({
    title: it.titulo, description: it.descripcion, emoji: it.emoji,
    tags: tags instanceof Map ? tags.get(normText(it.titulo)) ?? [] : tags?.[i] ?? [],
  }));
}

/** Propuesta para un catálogo concreto (puro salvo que ya se le pasan las fotos). Los elementos con foto no entran en el reparto. */
export function proposeForCatalog(
  meta: Proposal['template'], tematica: string | null, catalogo: Template['catalogo'], tags: readonly (readonly string[])[] | Map<string, string[]> | undefined,
  images: readonly MatchImage[], opts: MatchOptions = {},
): Proposal {
  const all = itemsFrom(catalogo, tags);
  const has = (catalogo ?? []).map((it) => Boolean(it.foto));
  const todo = all.map((it, index) => ({ it, index })).filter((x) => !has[x.index]);
  // Las fotos que ya usan otros elementos de la plantilla no se vuelven a ofrecer.
  const used = new Set((catalogo ?? []).map((it) => it.foto).filter(Boolean));
  const pool = images.filter((i) => !used.has(i.url));
  const res = matchTemplate(todo.map((x) => x.it), pool, { context: tematica, ...opts });
  const byIndex = new Map(res.map((r, k) => [todo[k]!.index, { ...r, index: todo[k]!.index }]));
  const items: ProposalItem[] = all.map((item, index) => byIndex.get(index) as ProposalItem | undefined ?? { index, item, best: null, candidates: [], missing: [], hasPhoto: true }).map((r) => ({ ...r, hasPhoto: has[r.index]! }));
  return { template: meta, items, coverage: coverageOf(items.filter((i) => !i.hasPhoto)), library: images.length };
}

/** Propuesta para una plantilla del sistema guardada (por id o slug). Solo lectura. */
export async function proposeForTemplate(ctx: Ctx, idOrSlug: string, opts: MatchOptions & { images?: MatchImage[]; tags?: Map<string, string[]> } = {}): Promise<Proposal> {
  const t = await getSystemTemplate(ctx, idOrSlug, { admin: true });
  const images = opts.images ?? (await loadMatchableImages(ctx));
  return proposeForCatalog({ id: t.id, slug: t.slug, title: t.title, status: t.status }, t.data.tematica ?? null, t.data.catalogo, opts.tags ?? loteTagsBySlug(t.slug), images, opts);
}

const applySchema = z.object({
  id: z.string().uuid(),
  picks: z.array(z.object({ index: z.number().int().min(0).max(99), image_id: z.string().uuid() })).min(1).max(100),
});

export interface ApplyResult { template: SystemTemplate['slug']; applied: { index: number; title: string; image_id: string; url: string }[]; skipped: { index: number; reason: string }[] }

/**
 * Aplica fotos elegidas a una plantilla en BORRADOR. Cada foto se vuelve a leer por `ss_library_pick_get` (existe, revisada, rol `product`),
 * el elemento no debe tener ya foto, ninguna foto se repite en la plantilla y se guarda el enlace (y el crédito) con `saveSystemTemplate`
 * (que revalida todo y respeta la lista de servidores de fotos). La plantilla sigue siendo borrador: publicar es una acción manual aparte.
 */
export async function applyMatchPicks(ctx: Ctx, actor: string, raw: unknown): Promise<ApplyResult> {
  const input = applySchema.safeParse(raw);
  if (!input.success) throw new DomainError('invalid_input');
  const t = await getSystemTemplate(ctx, input.data.id, { admin: true });
  if (t.status !== 'draft') throw new DomainError('invalid_input', 'Solo se aplican fotos a plantillas en borrador: retírala primero.');
  const data = structuredClone(t.data) as Template;
  const cat = data.catalogo ?? [];
  const used = new Set(cat.map((i) => i.foto).filter(Boolean));
  const applied: ApplyResult['applied'] = [];
  const skipped: ApplyResult['skipped'] = [];
  const seenIdx = new Set<number>();
  for (const p of input.data.picks) {
    const it = cat[p.index];
    if (!it) { skipped.push({ index: p.index, reason: 'el elemento no existe' }); continue; }
    if (seenIdx.has(p.index)) { skipped.push({ index: p.index, reason: 'elemento repetido en la petición' }); continue; }
    seenIdx.add(p.index);
    if (it.foto) { skipped.push({ index: p.index, reason: 'ya tiene foto (no se pisa)' }); continue; }
    const image = await ctx.db.rpc<LibraryPickImage>('ss_library_pick_get', { id: p.image_id, role: 'product' }).catch(() => null);
    if (!image) { skipped.push({ index: p.index, reason: 'la foto no existe, no está revisada o no es de producto' }); continue; }
    if (used.has(image.url)) { skipped.push({ index: p.index, reason: 'esa foto ya la usa otro elemento de la plantilla' }); continue; }
    used.add(image.url);
    it.foto = image.url;
    if (image.credit) it.credito = image.credit.slice(0, 120);
    applied.push({ index: p.index, title: it.titulo, image_id: image.id, url: image.url });
  }
  if (applied.length) {
    validateSystemTemplateData(data);
    await saveSystemTemplate(ctx, actor, { id: t.id, slug: t.slug, title: t.title, description: t.description, sort_order: t.sort_order, data });
    await ctx.db.rpc('ss_admin_audit_event', { actor, action: 'system_template_photos_matched', target_type: 'system_template', target_id: t.id, payload: { count: applied.length, slug: t.slug } }).catch(() => undefined);
  }
  return { template: t.slug, applied, skipped };
}
