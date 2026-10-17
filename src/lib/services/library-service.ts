import { createHash } from 'node:crypto';
import { z } from 'zod';
import { validateImage } from '@/lib/ai/image-validation';
import { githubAssetsConfig } from '@/lib/config/env';
import { DomainError } from '@/lib/domain/errors';
import { slugify } from '@/lib/domain/template-assets';
import { normalizeImage, NormalizeError } from '@/lib/images/normalize';
import { AssetUploadError, createGithubAssets, type GithubAssets } from '@/lib/storage/github-assets';
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

const defaultAssets = (): GithubAssets | null => {
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

/**
 * Normaliza la imagen (formato interno), la sube a `biblioteca/<colección>/…` del repositorio de fotos y la registra.
 * Idempotente por contenido: la misma foto (mismo hash tras normalizar) no se vuelve a subir ni a registrar.
 */
export async function uploadLibraryImage(
  ctx: Ctx,
  actor: string,
  input: { name: string; bytes: Uint8Array } & Partial<z.input<typeof uploadMetaSchema>>,
  assets: GithubAssets | null = defaultAssets(),
): Promise<{ existed: boolean; image: LibraryImage }> {
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
  // Ya registrada (mismo contenido): no se toca GitHub.
  const already = await ctx.db.rpc<LibraryImage | null>('ss_admin_library_image_by_hash', { hash });
  if (already) return { existed: true, image: already };
  const title = meta.title || titleFromFilename(input.name);
  const folder = slugify(meta.collection) || 'general';
  const label = slugify(title).slice(0, 40) || 'imagen';
  const path = `biblioteca/${folder}/${label}-${hash}.webp`;
  let up;
  try {
    up = await assets.put(path, n.bytes, `Biblioteca: ${folder}/${label}`);
  } catch (e) {
    if (e instanceof AssetUploadError) throw new DomainError('invalid_input', e.message, e.kind === 'rate' ? 429 : 502);
    throw e;
  }
  return ctx.db.rpc<{ existed: boolean; image: LibraryImage }>('ss_admin_library_image_add', {
    actor, hash, path: up.path, url: up.url, sha: up.sha, title, collection: meta.collection, tags: meta.tags, credit: meta.credit,
    width: n.width, height: n.height, bytes: n.bytes.length,
  });
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
