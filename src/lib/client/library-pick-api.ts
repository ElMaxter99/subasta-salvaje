import { ApiError, type ActionResponse } from './api';
import type { CollectionCount, LibraryPickImage } from '@/lib/services/library-service';
import type { LibraryRole } from '@/lib/library/taxonomy';

export type { LibraryPickImage };
export interface PickList { total: number; images: LibraryPickImage[]; categories: CollectionCount[] }

async function parse<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => null)) as (T & { error?: { code: string; message: string } }) | null;
  if (!res.ok || !data) throw new ApiError(data?.error?.code ?? 'internal', data?.error?.message ?? `Error ${res.status}`, res.status);
  return data;
}

/** Imágenes de la biblioteca que un anfitrión puede elegir (solo las revisadas y con el rol pedido). */
export async function listPickableImagesRequest(q: { role: LibraryRole; q?: string; category?: string | null; limit?: number; offset?: number }): Promise<PickList> {
  const params = new URLSearchParams({ role: q.role });
  if (q.q) params.set('q', q.q);
  if (q.category) params.set('category', q.category);
  if (q.limit) params.set('limit', String(q.limit));
  if (q.offset) params.set('offset', String(q.offset));
  return parse<PickList>(await fetch(`/api/library/images?${params}`));
}

/** Aplica una imagen de la biblioteca a la imagen inicial común o a la foto de un elemento de la partida. */
export async function applyLibraryImageRequest(roomCode: string, body: { target: 'initial'; image_id: string; scope_current: boolean; scope_new: boolean } | { target: 'item'; image_id: string; item_id: string }): Promise<ActionResponse> {
  const res = await fetch(`/api/games/${roomCode}/library-image`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return parse<ActionResponse>(res);
}
