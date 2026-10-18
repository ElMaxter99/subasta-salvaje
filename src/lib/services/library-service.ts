import { createHash } from 'node:crypto';
import { z } from 'zod';
import { validateImage } from '@/lib/ai/image-validation';
import { githubAssetsConfig } from '@/lib/config/env';
import { DomainError } from '@/lib/domain/errors';
import { slugify } from '@/lib/domain/template-assets';
import { normalizeImage, NormalizeError } from '@/lib/images/normalize';
import { perceptualHash } from '@/lib/library/phash';
import { buildCoverage, type CoverageRaw, type CoverageReport } from '@/lib/library/coverage';
import { defaultRolesForKind, isLibraryRole, NEAR_DUPLICATE_DISTANCE, parseRoles, type LibraryRole } from '@/lib/library/taxonomy';
import { fetchImageBytes } from '@/lib/security/safe-fetch';
import { AssetUploadError, createGithubAssets, type GithubBatchAssets } from '@/lib/storage/github-assets';
import type { AppContext } from './context';
import { effectiveQuota, getSettings } from './settings';

type Ctx = Pick<AppContext, 'db'>;

/**
 * Biblioteca de medios del superadmin: imágenes generales subidas en bloque al repositorio público de fotos (GitHub + jsDelivr)
 * y catálogo general de productos reutilizable en cualquier partida. En la base de datos solo hay metadatos y enlaces.
 */
export const LIBRARY_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

export interface LibraryImage {
  id: string;
  url: string;
  path: string;
  title: string;
  collection: string;
  tags: string[];
  credit: string;
  width: number | null;
  height: number | null;
  bytes: number | null;
  created_at: string;
  /** Moderación: el superadmin ya la ha mirado. Solo las revisadas se ofrecen a los anfitriones en el selector. */
  reviewed: boolean;
  /** Para qué sirve (puede ser más de una cosa; vacío = sin rol, no se ofrece a los anfitriones). */
  roles: LibraryRole[];
  /** Temática (Halloween, Paisajes…); distinta de `collection`, que es la carpeta física en el repositorio de fotos. */
  category: string;
  /** ¿Tiene huella perceptual (detección de imágenes parecidas)? Las anteriores a la versión de etiquetas no. */
  has_phash?: boolean;
}

/** Imagen tal y como la ve un anfitrión en el selector: sin ruta interna, huella ni datos de gestión. */
export interface LibraryPickImage { id: string; url: string; title: string; collection: string; category: string; tags: string[]; roles: LibraryRole[]; credit: string; width: number | null; height: number | null }

export interface LibraryItem {
  id: string;
  name: string;
  description: string;
  emoji: string | null;
  collection: string;
  tags: string[];
  credit: string;
  image_id: string | null;
  photo_url: string | null;
  photo_credit: string | null;
}

export interface CollectionCount { name: string; count: number }
/** Imagen ya registrada que se parece a otra (distancia de Hamming de la huella perceptual, 0–64). */
export type NearImage = LibraryImage & { distance: number };

const defaultAssets = (): GithubBatchAssets | null => {
  const c = githubAssetsConfig();
  return c ? createGithubAssets(c, fetch, c.apiBase) : null;
};

export function libraryUploadsEnabled(): boolean {
  return githubAssetsConfig() !== null;
}

/** «sombrilla_roja-01.JPG» → «Sombrilla roja 01». */
export function titleFromFilename(name: string): string {
  const base = name.replace(/\.[^.]+$/, '').replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim();
  return (base.charAt(0).toUpperCase() + base.slice(1)).slice(0, 120);
}

const tagsSchema = z.array(z.string().trim().max(30)).max(20).default([]);
const textShort = (max: number) => z.string().trim().max(max).default('');

export const uploadMetaSchema = z.object({
  collection: textShort(60),
  tags: tagsSchema,
  credit: textShort(200),
  title: textShort(120),
  kind: z.enum(['item', 'scene']).default('item'),
  /** Sin indicar: sale del tipo (escena → start, objeto → product). Una lista vacía significa «sin rol». */
  roles: z.array(z.string()).max(10).optional().transform((r) => (r === undefined ? undefined : parseRoles(r))),
  /** Sin indicar: la colección. */
  category: textShort(60),
});

/** Imagen ya normalizada y preparada en GitHub (blob), pendiente de entrar en el commit del lote. */
export const stagedSchema = z.object({
  path: z.string().regex(/^biblioteca\/[a-z0-9]+(-[a-z0-9]+)*\/[a-z0-9]+(-[a-z0-9]+)*-[0-9a-f]{16}\.webp$/).max(240),
  blobSha: z.string().regex(/^[0-9a-f]{40}$/),
  hash: z.string().regex(/^[0-9a-f]{16}$/),
  title: z.string().trim().max(120),
  collection: z.string().trim().max(60),
  tags: z.array(z.string().trim().max(30)).max(20),
  credit: z.string().trim().max(200),
  width: z.number().int().positive().max(10_000),
  height: z.number().int().positive().max(10_000),
  bytes: z.number().int().positive().max(5_000_000),
  roles: z.array(z.string()).max(10).optional().transform((r) => (r === undefined ? undefined : parseRoles(r))),
  category: z.string().trim().max(60).optional(),
  phash: z.string().regex(/^[0-9a-f]{16}$/).optional(),
});
export type StagedImage = z.infer<typeof stagedSchema>;

/**
 * Fase 1 (una llamada por foto): normaliza la imagen (formato interno), mira si ya está registrada (mismo hash tras normalizar:
 * entonces no se toca GitHub) y, si es nueva, la PREPARA en GitHub como blob (sin crear ningún commit).
 */
export async function stageLibraryImage(
  ctx: Ctx,
  input: { name: string; bytes: Uint8Array } & Partial<z.input<typeof uploadMetaSchema>>,
  assets: GithubBatchAssets | null = defaultAssets(),
): Promise<{ existed: true; image: LibraryImage } | { existed: false; staged: StagedImage; near: NearImage[] }> {
  if (!assets) throw new DomainError('invalid_input', 'La subida de imágenes no está configurada (GITHUB_ASSETS_REPO y GITHUB_ASSETS_TOKEN).');
  const meta = uploadMetaSchema.parse(input);
  let n;
  try {
    validateImage(input.bytes, { maxBytes: LIBRARY_UPLOAD_MAX_BYTES });
    n = await normalizeImage(input.bytes, meta.kind);
  } catch (e) {
    throw new DomainError('invalid_input', e instanceof NormalizeError || e instanceof Error ? e.message : 'Imagen no válida');
  }
  const hash = createHash('sha256').update(n.bytes).digest('hex').slice(0, 16);
  const already = await ctx.db.rpc<LibraryImage | null>('ss_admin_library_image_by_hash', { hash });
  if (already) return { existed: true, image: already };
  // Huella perceptual: avisa de imágenes MUY PARECIDAS ya registradas (no bloquea: el superadmin decide).
  const phash = await perceptualHash(n.bytes).catch(() => undefined);
  const near = phash ? await ctx.db.rpc<NearImage[]>('ss_admin_library_image_near', { phash, max_distance: NEAR_DUPLICATE_DISTANCE }) : [];
  const title = meta.title || titleFromFilename(input.name);
  const folder = slugify(meta.collection) || 'general';
  const label = slugify(title).slice(0, 40) || 'imagen';
  let blobSha: string;
  try {
    blobSha = await assets.stageBlob(n.bytes);
  } catch (e) {
    if (e instanceof AssetUploadError) throw new DomainError('invalid_input', e.message, e.kind === 'rate' ? 429 : 502);
    throw e;
  }
  const roles = meta.roles ?? defaultRolesForKind(meta.kind);
  const staged: StagedImage = {
    path: `biblioteca/${folder}/${label}-${hash}.webp`, blobSha, hash, title, collection: meta.collection, tags: meta.tags, credit: meta.credit,
    width: n.width, height: n.height, bytes: n.bytes.length, roles, category: meta.category || meta.collection, ...(phash ? { phash } : {}),
  };
  return { existed: false, staged, near };
}

/**
 * Fase 2 (UNA llamada para todo el lote): publica todas las imágenes preparadas en UN solo commit y las registra con su enlace
 * fijado a ese commit. Si algo falla antes de terminar no se registra nada y se puede reintentar con la misma lista.
 */
export async function commitLibraryImages(
  ctx: Ctx,
  actor: string,
  rawStaged: unknown,
  assets: GithubBatchAssets | null = defaultAssets(),
): Promise<{ commit: string; added: number; existed: number; images: LibraryImage[] }> {
  if (!assets) throw new DomainError('invalid_input', 'La subida de imágenes no está configurada (GITHUB_ASSETS_REPO y GITHUB_ASSETS_TOKEN).');
  const parsed = z.array(stagedSchema).min(1).max(500).safeParse(rawStaged);
  if (!parsed.success) throw new DomainError('invalid_input', 'La lista de imágenes preparadas no es válida.');
  const unique = [...new Map(parsed.data.map((s) => [s.hash, s])).values()];
  let commit;
  try {
    commit = await assets.commitMany(unique.map((s) => ({ path: s.path, blobSha: s.blobSha })), `Biblioteca: ${unique.length} ${unique.length === 1 ? 'imagen' : 'imágenes'}`);
  } catch (e) {
    if (e instanceof AssetUploadError) throw new DomainError('invalid_input', e.message, e.kind === 'rate' ? 429 : 502);
    throw e;
  }
  const images: LibraryImage[] = [];
  let existed = 0;
  for (const [i, s] of unique.entries()) {
    const r = await ctx.db.rpc<{ existed: boolean; image: LibraryImage }>('ss_admin_library_image_add', {
      actor, hash: s.hash, path: s.path, url: commit.files[i]!.url, sha: commit.sha, title: s.title, collection: s.collection, tags: s.tags, credit: s.credit,
      width: s.width, height: s.height, bytes: s.bytes,
      ...(s.roles ? { roles: s.roles } : {}), ...(s.category !== undefined ? { category: s.category } : {}), ...(s.phash ? { phash: s.phash } : {}),
    });
    if (r.existed) existed++;
    images.push(r.image);
  }
  return { commit: commit.sha, added: images.length - existed, existed, images };
}

/* ---------- Imágenes ---------- */

/** `role`: 'start' | 'product' | 'none' (sin rol). `category`: coincidencia exacta sin distinguir mayúsculas. */
export interface ImageQuery { q?: string; collection?: string | null; category?: string | null; role?: LibraryRole | 'none' | null; limit?: number; offset?: number; noCredit?: boolean; unreviewed?: boolean }
export interface ImageListResult {
  total: number; images: LibraryImage[]; collections: CollectionCount[]; categories: CollectionCount[];
  counts: { no_credit: number; unreviewed: number; start: number; product: number; none: number };
}

export async function listLibraryImages(ctx: Ctx, query: ImageQuery = {}): Promise<ImageListResult> {
  return ctx.db.rpc('ss_admin_library_image_list', {
    q: query.q ?? '', collection: query.collection ?? null, category: query.category ?? null, role: query.role ?? null,
    limit: query.limit ?? 60, offset: query.offset ?? 0, no_credit: Boolean(query.noCredit), unreviewed: Boolean(query.unreviewed),
  });
}

/** Pares de imágenes registradas que se parecen por su CONTENIDO (huella perceptual), de menor a mayor distancia. */
export async function listSimilarImages(ctx: Ctx, maxDistance: number = NEAR_DUPLICATE_DISTANCE): Promise<{ distance: number; a: LibraryImage; b: LibraryImage }[]> {
  return ctx.db.rpc('ss_admin_library_similar', { max_distance: maxDistance, limit: 100 });
}

/** Cobertura: cuántas imágenes (todas y publicadas) hay por rol y categoría frente al objetivo de LIBRARY_CATEGORIES. */
export async function libraryCoverage(ctx: Ctx): Promise<CoverageReport> {
  return buildCoverage(await ctx.db.rpc<CoverageRaw>('ss_admin_library_coverage', {}));
}

/**
 * Calcula la huella de las imágenes anteriores que no la tienen (descarga cada una desde su enlace con las defensas SSRF habituales).
 * Procesa un lote pequeño por llamada; repetir hasta que `remaining` sea 0. Un fallo en una imagen no detiene las demás.
 */
export async function backfillLibraryPhashes(
  ctx: Ctx,
  limit = 20,
  download: (url: string) => Promise<Uint8Array> = (u) => fetchImageBytes(u),
): Promise<{ done: number; failed: number; remaining: number }> {
  const todo = await ctx.db.rpc<{ remaining: number; images: { id: string; url: string }[] }>('ss_admin_library_phash_missing', { limit: Math.min(Math.max(limit, 1), 50) });
  let done = 0, failed = 0;
  for (const img of todo.images) {
    try {
      await ctx.db.rpc('ss_admin_library_phash_set', { id: img.id, phash: await perceptualHash(await download(img.url)) });
      done++;
    } catch {
      failed++;
    }
  }
  return { done, failed, remaining: Math.max(todo.remaining - done, 0) };
}

export interface DuplicateGroup { collection: string; title: string; images: LibraryImage[] }

/** Imágenes con el mismo título dentro de una misma colección (no compara el contenido). */
export async function listLibraryDuplicates(ctx: Ctx): Promise<DuplicateGroup[]> {
  return ctx.db.rpc('ss_admin_library_duplicates', {});
}

const idsSchema = z.array(z.string().uuid()).min(1).max(500);
const rolesSchema = z.array(z.string().refine(isLibraryRole, 'Rol no válido')).max(10);
const tagList = z.array(z.string().trim().max(30)).max(20);
/** Parche de imágenes (individual o en bloque). `roles`/`tags` REEMPLAZAN; `*_add`/`*_remove` ajustan sin pisar lo demás. */
const imagePatchSchema = z.object({
  title: z.string().trim().max(120), collection: z.string().trim().max(60), category: z.string().trim().max(60), credit: z.string().trim().max(200), reviewed: z.boolean(),
  tags: tagList, tags_add: tagList, tags_remove: tagList, roles: rolesSchema, roles_add: rolesSchema, roles_remove: rolesSchema,
}).partial();

export async function updateLibraryImages(ctx: Ctx, actor: string, raw: { ids: unknown; patch: unknown }): Promise<{ updated: number }> {
  const ids = idsSchema.safeParse(raw.ids);
  const patch = imagePatchSchema.safeParse(raw.patch);
  if (!ids.success || !patch.success || Object.keys(patch.data).length === 0) throw new DomainError('invalid_input');
  return ctx.db.rpc('ss_admin_library_image_update', { actor, ids: ids.data, patch: patch.data });
}

export async function deleteLibraryImages(ctx: Ctx, actor: string, rawIds: unknown): Promise<{ deleted: number }> {
  const ids = idsSchema.safeParse(rawIds);
  if (!ids.success) throw new DomainError('invalid_input');
  return ctx.db.rpc('ss_admin_library_image_delete', { actor, ids: ids.data });
}

/* ---------- Productos del catálogo general ---------- */

export interface ItemQuery { q?: string; collection?: string | null; limit?: number; offset?: number }

export async function listLibraryItems(ctx: Ctx, query: ItemQuery = {}): Promise<{ total: number; items: LibraryItem[]; collections: CollectionCount[] }> {
  return ctx.db.rpc('ss_library_item_list', { q: query.q ?? '', collection: query.collection ?? null, limit: query.limit ?? 100, offset: query.offset ?? 0 });
}

const itemSchema = z.object({
  name: z.string().trim().min(1, 'Falta el nombre').max(80),
  description: z.string().trim().max(500).default(''),
  emoji: z.string().trim().max(8).nullish(),
  image_id: z.string().uuid().nullish(),
  collection: z.string().trim().max(60).default(''),
  tags: tagsSchema,
  credit: z.string().trim().max(120).default(''),
});
/** Sin valores por defecto: un parche solo cambia los campos que trae. */
const itemPatchSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500),
  emoji: z.string().trim().max(8).nullable(),
  image_id: z.string().uuid().nullable(),
  collection: z.string().trim().max(60),
  tags: z.array(z.string().trim().max(30)).max(20),
  credit: z.string().trim().max(120),
}).partial();
export type LibraryItemInput = z.input<typeof itemSchema>;

export async function addLibraryItems(ctx: Ctx, actor: string, raw: unknown): Promise<{ added: number; skipped: number; ids: string[] }> {
  const parsed = z.array(itemSchema).min(1).max(500).safeParse(raw);
  if (!parsed.success) throw new DomainError('invalid_input', parsed.error.issues[0]?.message ?? 'Productos no válidos');
  return ctx.db.rpc('ss_admin_library_item_add_many', { actor, items: parsed.data });
}

export async function updateLibraryItem(ctx: Ctx, actor: string, id: unknown, rawPatch: unknown): Promise<LibraryItem> {
  const idOk = z.string().uuid().safeParse(id);
  const patch = itemPatchSchema.safeParse(rawPatch);
  if (!idOk.success || !patch.success || Object.keys(patch.data).length === 0) throw new DomainError('invalid_input');
  return ctx.db.rpc('ss_admin_library_item_update', { actor, id: idOk.data, patch: patch.data });
}

const bulkChangeSchema = z.union([
  z.object({ collection: z.string().trim().max(60) }).strict(),
  z.object({ emoji: z.string().trim().max(8).nullable() }).strict(),
  z.object({ image_id: z.null() }).strict(),
  z.object({ delete: z.literal(true) }).strict(),
]);
export type ItemBulkChange = z.infer<typeof bulkChangeSchema>;

/** Edición en bloque (hasta 200 productos) en una sola transacción SQL con una sola entrada de auditoría. */
export async function updateLibraryItems(ctx: Ctx, actor: string, raw: { ids: unknown; change: unknown }): Promise<{ changed: number; skipped: number }> {
  const ids = z.array(z.string().uuid()).min(1).max(200).safeParse(raw.ids);
  const change = bulkChangeSchema.safeParse(raw.change);
  if (!ids.success || !change.success) throw new DomainError('invalid_input');
  return ctx.db.rpc('ss_admin_library_item_update_many', { actor, ids: ids.data, change: change.data });
}

export async function deleteLibraryItems(ctx: Ctx, actor: string, rawIds: unknown): Promise<{ deleted: number }> {
  const ids = idsSchema.safeParse(rawIds);
  if (!ids.success) throw new DomainError('invalid_input');
  return ctx.db.rpc('ss_admin_library_item_delete', { actor, ids: ids.data });
}

const generateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).default(''),
  emoji: z.string().trim().max(8).nullish(),
  collection: z.string().trim().max(60).default(''),
});

/**
 * Genera con IA la imagen de un producto del catálogo general (solo superadmin). Usa la misma cadena de proveedores (gratuitos) y los mismos
 * ajustes que las partidas; cuenta en el tope diario global. La imagen generada es la ÚNICA que se guarda: se publica en la biblioteca
 * (repositorio de fotos, un commit) y se asocia al producto. Si la IA no está configurada o falla, no se inventa nada.
 */
export async function generateLibraryItemImage(
  ctx: Pick<AppContext, 'db' | 'provider'>,
  actor: string,
  raw: unknown,
  assets: GithubBatchAssets | null = defaultAssets(),
): Promise<{ item: LibraryItem; image: LibraryImage; provider: string; model: string | null; notes: string | null }> {
  const input = generateSchema.safeParse(raw);
  if (!input.success) throw new DomainError('invalid_input');
  if (!assets) throw new DomainError('invalid_input', 'La subida de imágenes no está configurada (GITHUB_ASSETS_REPO y GITHUB_ASSETS_TOKEN).');
  const settings = await getSettings(ctx.db);
  if (!ctx.provider || ctx.provider.id === 'demo' || !settings.ai_enabled) throw new DomainError('ai_not_available');
  const q = effectiveQuota(settings);
  const quota = await ctx.db.rpc<{ ok: boolean; used?: number; limit?: number }>('ss_reserve_admin_image_quota', { provider: ctx.provider.id, day_limit: q.perDay });
  if (!quota.ok) throw new DomainError('invalid_input', `Cuota diaria de generaciones alcanzada (${quota.used}/${quota.limit}); se renueva a las 00:00 UTC.`, 429);
  let gen;
  try {
    gen = await ctx.provider.generateItemImage({ theme: input.data.collection || 'objeto', itemName: input.data.name, itemDescription: input.data.description, itemEmoji: input.data.emoji ?? null });
  } catch (e) {
    // La generación falló: no se gasta cuota (como en las partidas).
    await ctx.db.rpc('ss_release_admin_image_quota', { provider: ctx.provider.id }).catch(() => undefined);
    throw e;
  }
  const credit = `Generada con IA (${gen.provider ?? ctx.provider.id}${gen.model ? ` · ${gen.model}` : ''})`.slice(0, 200);
  const staged = await stageLibraryImage(ctx, { name: `${input.data.name}.png`, bytes: gen.bytes, collection: input.data.collection, tags: ['ia'], credit, title: input.data.name, kind: 'item' }, assets);
  const image = staged.existed ? staged.image : (await commitLibraryImages(ctx, actor, [staged.staged], assets)).images[0]!;
  const item = await updateLibraryItem(ctx, actor, input.data.id, { image_id: image.id });
  return { item, image, provider: gen.provider ?? ctx.provider.id, model: gen.model ?? null, notes: gen.notes ?? null };
}

export { parseItemLines } from './library-parse';
