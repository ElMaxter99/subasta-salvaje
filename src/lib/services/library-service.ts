import { createHash } from 'node:crypto';
import { z } from 'zod';
import { validateImage } from '@/lib/ai/image-validation';
import { githubAssetsConfig } from '@/lib/config/env';
import { DomainError } from '@/lib/domain/errors';
import { slugify } from '@/lib/domain/template-assets';
import { normalizeImage, NormalizeError } from '@/lib/images/normalize';
import { AssetUploadError, createGithubAssets, type GithubBatchAssets } from '@/lib/storage/github-assets';
import type { AppContext } from './context';

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
}

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
): Promise<{ existed: true; image: LibraryImage } | { existed: false; staged: StagedImage }> {
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
  return { existed: false, staged: { path: `biblioteca/${folder}/${label}-${hash}.webp`, blobSha, hash, title, collection: meta.collection, tags: meta.tags, credit: meta.credit, width: n.width, height: n.height, bytes: n.bytes.length } };
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
    });
    if (r.existed) existed++;
    images.push(r.image);
  }
  return { commit: commit.sha, added: images.length - existed, existed, images };
}

/* ---------- Imágenes ---------- */

export interface ImageQuery { q?: string; collection?: string | null; limit?: number; offset?: number }

export async function listLibraryImages(ctx: Ctx, query: ImageQuery = {}): Promise<{ total: number; images: LibraryImage[]; collections: CollectionCount[] }> {
  return ctx.db.rpc('ss_admin_library_image_list', { q: query.q ?? '', collection: query.collection ?? null, limit: query.limit ?? 60, offset: query.offset ?? 0 });
}

const idsSchema = z.array(z.string().uuid()).min(1).max(500);
const imagePatchSchema = z.object({ title: z.string().trim().max(120), collection: z.string().trim().max(60), tags: z.array(z.string().trim().max(30)).max(20), credit: z.string().trim().max(200) }).partial();

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

export async function deleteLibraryItems(ctx: Ctx, actor: string, rawIds: unknown): Promise<{ deleted: number }> {
  const ids = idsSchema.safeParse(rawIds);
  if (!ids.success) throw new DomainError('invalid_input');
  return ctx.db.rpc('ss_admin_library_item_delete', { actor, ids: ids.data });
}

export { parseItemLines } from './library-parse';
