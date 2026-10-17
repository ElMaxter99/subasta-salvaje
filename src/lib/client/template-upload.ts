import { ApiError } from './api';
import { shrinkForUpload } from './image-shrink';

export interface UploadedTemplateImage { url: string; path: string; kind: 'cover' | 'scene' | 'item'; width: number; height: number; bytes: number; existed: boolean }

/** Sube UNA imagen de una plantilla del sistema (el servidor la normaliza y la publica en el repositorio de fotos). */
export async function uploadTemplateImageRequest(slug: string, kind: 'cover' | 'scene' | 'item', file: File): Promise<UploadedTemplateImage> {
  const form = new FormData();
  form.set('slug', slug);
  form.set('kind', kind);
  form.set('file', await shrinkForUpload(file));
  const res = await fetch('/api/admin/system-templates/upload', { method: 'POST', body: form });
  const data = (await res.json().catch(() => null)) as (UploadedTemplateImage & { error?: { code: string; message: string } }) | null;
  if (!res.ok || !data) throw new ApiError(data?.error?.code ?? 'internal', data?.error?.message ?? `Error ${res.status}`, res.status);
  return data;
}

export interface StagedTemplateImage { path: string; blobSha: string; kind: 'cover' | 'scene' | 'item'; width: number; height: number; bytes: number }

/** Varias imágenes, fase 1: el servidor normaliza UNA y la deja preparada en GitHub (sin commit). */
export async function stageTemplateImageRequest(slug: string, kind: 'cover' | 'scene' | 'item', file: File): Promise<StagedTemplateImage> {
  const form = new FormData();
  form.set('slug', slug);
  form.set('kind', kind);
  form.set('file', await shrinkForUpload(file));
  const res = await fetch('/api/admin/system-templates/stage', { method: 'POST', body: form });
  const data = (await res.json().catch(() => null)) as (StagedTemplateImage & { error?: { code: string; message: string } }) | null;
  if (!res.ok || !data) throw new ApiError(data?.error?.code ?? 'internal', data?.error?.message ?? `Error ${res.status}`, res.status);
  return data;
}

/** Varias imágenes, fase 2: publica todas las preparadas en UN solo commit y devuelve sus enlaces. */
export async function commitTemplateImagesRequest(staged: StagedTemplateImage[]): Promise<{ commit: string; files: (UploadedTemplateImage)[] }> {
  const res = await fetch('/api/admin/system-templates/commit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ staged }) });
  const data = (await res.json().catch(() => null)) as ({ commit: string; files: UploadedTemplateImage[] } & { error?: { code: string; message: string } }) | null;
  if (!res.ok || !data) throw new ApiError(data?.error?.code ?? 'internal', data?.error?.message ?? `Error ${res.status}`, res.status);
  return data;
}
