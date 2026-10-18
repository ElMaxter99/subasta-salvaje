import { ApiError } from './api';
import { adminPost } from './admin-api';
import { shrinkForUpload } from './image-shrink';
import type { CollectionCount, DuplicateGroup, ImageListResult, ItemBulkChange, LibraryImage, LibraryItem, LibraryItemInput, NearImage } from '@/lib/services/library-service';
import type { CoverageReport } from '@/lib/library/coverage';
import type { LibraryRole } from '@/lib/library/taxonomy';

export type { CollectionCount, CoverageReport, DuplicateGroup, ItemBulkChange, LibraryImage, LibraryItem, LibraryItemInput, NearImage };

export interface UploadMeta {
  collection: string; tags: string; credit: string; kind: 'item' | 'scene';
  /** Si se indica, sustituye al título sacado del nombre del archivo. */ title?: string;
  /** Roles de la imagen; sin indicar, el servidor los deduce del tipo. Lista vacía = sin rol. */ roles?: LibraryRole[];
  /** Categoría/temática; sin indicar, la colección. */ category?: string;
}

export type StagedImage = import('@/lib/services/library-service').StagedImage;
export type StageResult = { existed: true; image: LibraryImage } | { existed: false; staged: StagedImage; near: NearImage[] };

/** Fase 1: prepara UNA imagen (el servidor la normaliza y la deja lista en GitHub, sin crear commit). */
export async function stageLibraryImageRequest(file: File, meta: UploadMeta): Promise<StageResult> {
  const form = new FormData();
  form.set('collection', meta.collection);
  form.set('tags', meta.tags);
  form.set('credit', meta.credit);
  form.set('kind', meta.kind);
  form.set('title', meta.title ?? '');
  form.set('category', meta.category ?? '');
  if (meta.roles) form.set('roles', meta.roles.join(','));
  // El título sale del nombre original (la reducción en el navegador puede cambiar la extensión).
  const small = await shrinkForUpload(file);
  form.set('file', new File([small], file.name.replace(/\.[^.]+$/, '') + small.name.slice(small.name.lastIndexOf('.')), { type: small.type }));
  const res = await fetch('/api/admin/library/stage', { method: 'POST', body: form });
  const data = (await res.json().catch(() => null)) as (StageResult & { error?: { code: string; message: string } }) | null;
  if (!res.ok || !data) throw new ApiError(data?.error?.code ?? 'internal', data?.error?.message ?? `Error ${res.status}`, res.status);
  return data;
}

/** Fase 2: publica todas las imágenes preparadas en UN solo commit y las registra. */
export const commitLibraryRequest = (staged: StagedImage[]) => adminPost<{ commit: string; added: number; existed: number; images: LibraryImage[] }>('library/commit', { staged });

export interface GeneratedItemImage { item: LibraryItem; image: LibraryImage; provider: string; model: string | null; notes: string | null }
/** Genera con IA la imagen de un producto del catálogo general (consume cuota diaria) y la deja asociada. */
export const generateItemImageRequest = (item: Pick<LibraryItem, 'id' | 'name' | 'description' | 'emoji' | 'collection'>) => adminPost<GeneratedItemImage>('library/generate', item);

export type ImageList = ImageListResult & { uploadsEnabled: boolean };
export type ImagePatch = Partial<{ title: string; collection: string; category: string; tags: string[]; credit: string; reviewed: boolean; roles: LibraryRole[]; tags_add: string[]; tags_remove: string[]; roles_add: LibraryRole[]; roles_remove: LibraryRole[] }>;
export interface ItemList { total: number; items: LibraryItem[]; collections: CollectionCount[] }

const post = <T>(body: unknown) => adminPost<T>('library', body);

export const libraryApi = {
  images: (q: { q?: string; collection?: string | null; category?: string | null; role?: LibraryRole | 'none' | null; limit?: number; offset?: number; noCredit?: boolean; unreviewed?: boolean }) => post<ImageList>({ op: 'images.list', ...q }),
  updateImages: (ids: string[], patch: ImagePatch) => post<{ updated: number }>({ op: 'images.update', ids, patch }),
  similar: () => post<{ pairs: { distance: number; a: LibraryImage; b: LibraryImage }[] }>({ op: 'images.similar' }),
  backfillHashes: () => post<{ done: number; failed: number; remaining: number }>({ op: 'images.backfill_hashes' }),
  coverage: () => post<CoverageReport>({ op: 'coverage' }),
  duplicates: () => post<{ groups: DuplicateGroup[] }>({ op: 'images.duplicates' }),
  deleteImages: (ids: string[]) => post<{ deleted: number }>({ op: 'images.delete', ids }),
  items: (q: { q?: string; collection?: string | null; limit?: number; offset?: number }) => post<ItemList>({ op: 'items.list', ...q }),
  addItems: (items: LibraryItemInput[]) => post<{ added: number; skipped: number; ids: string[] }>({ op: 'items.add', items }),
  updateItem: (id: string, patch: Partial<{ name: string; description: string; emoji: string | null; collection: string; image_id: string | null; credit: string }>) => post<LibraryItem>({ op: 'items.update', id, patch }),
  updateItems: (ids: string[], change: ItemBulkChange) => post<{ changed: number; skipped: number }>({ op: 'items.update_many', ids, change }),
  deleteItems: (ids: string[]) => post<{ deleted: number }>({ op: 'items.delete', ids }),
};

/** Catálogo general para anfitriones (importar productos al configurar una partida). */
export async function listLibraryItemsRequest(q: { q?: string; collection?: string | null; limit?: number } = {}): Promise<ItemList> {
  const params = new URLSearchParams();
  if (q.q) params.set('q', q.q);
  if (q.collection) params.set('collection', q.collection);
  if (q.limit) params.set('limit', String(q.limit));
  const res = await fetch(`/api/library/items?${params}`);
  const data = (await res.json().catch(() => null)) as (ItemList & { error?: { code: string; message: string } }) | null;
  if (!res.ok || !data) throw new ApiError(data?.error?.code ?? 'internal', data?.error?.message ?? `Error ${res.status}`, res.status);
  return data;
}
