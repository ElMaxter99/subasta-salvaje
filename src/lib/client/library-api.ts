import { ApiError } from './api';
import { adminPost } from './admin-api';
import { shrinkForUpload } from './image-shrink';
import type { CollectionCount, LibraryImage, LibraryItem, LibraryItemInput } from '@/lib/services/library-service';

export type { CollectionCount, LibraryImage, LibraryItem, LibraryItemInput };

export interface UploadMeta { collection: string; tags: string; credit: string; kind: 'item' | 'scene' }

/** Sube UNA imagen a la biblioteca (el servidor la normaliza y la publica en el repositorio de fotos). */
export async function uploadLibraryImageRequest(file: File, meta: UploadMeta): Promise<{ existed: boolean; image: LibraryImage }> {
  const form = new FormData();
  form.set('collection', meta.collection);
  form.set('tags', meta.tags);
  form.set('credit', meta.credit);
  form.set('kind', meta.kind);
  form.set('title', '');
  // El título sale del nombre original (la reducción en el navegador puede cambiar la extensión).
  const small = await shrinkForUpload(file);
  form.set('file', new File([small], file.name.replace(/\.[^.]+$/, '') + small.name.slice(small.name.lastIndexOf('.')), { type: small.type }));
  const res = await fetch('/api/admin/library/upload', { method: 'POST', body: form });
  const data = (await res.json().catch(() => null)) as ({ existed: boolean; image: LibraryImage } & { error?: { code: string; message: string } }) | null;
  if (!res.ok || !data) throw new ApiError(data?.error?.code ?? 'internal', data?.error?.message ?? `Error ${res.status}`, res.status);
  return data;
}

export interface ImageList { total: number; images: LibraryImage[]; collections: CollectionCount[]; uploadsEnabled: boolean }
export interface ItemList { total: number; items: LibraryItem[]; collections: CollectionCount[] }

const post = <T>(body: unknown) => adminPost<T>('library', body);

export const libraryApi = {
  images: (q: { q?: string; collection?: string | null; limit?: number; offset?: number }) => post<ImageList>({ op: 'images.list', ...q }),
  updateImages: (ids: string[], patch: Partial<{ title: string; collection: string; tags: string[]; credit: string }>) => post<{ updated: number }>({ op: 'images.update', ids, patch }),
  deleteImages: (ids: string[]) => post<{ deleted: number }>({ op: 'images.delete', ids }),
  items: (q: { q?: string; collection?: string | null; limit?: number; offset?: number }) => post<ItemList>({ op: 'items.list', ...q }),
  addItems: (items: LibraryItemInput[]) => post<{ added: number; skipped: number; ids: string[] }>({ op: 'items.add', items }),
  updateItem: (id: string, patch: Partial<{ name: string; description: string; emoji: string | null; collection: string; image_id: string | null; credit: string }>) => post<LibraryItem>({ op: 'items.update', id, patch }),
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
