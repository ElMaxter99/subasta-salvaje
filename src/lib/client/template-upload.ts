import { ApiError } from './api';
import { shrinkForUpload } from './image-shrink';

export interface UploadedTemplateImage { url: string; path: string; kind: 'cover' | 'scene' | 'item'; width: number; height: number; bytes: number; existed: boolean }

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

/**
 * Al GUARDAR la plantilla: publica en UN solo commit las imágenes preparadas y borra las que ya no se usan
 * (`keepUrls` = los enlaces https que el formulario conserva). `commit` es null si no había nada que publicar.
 */
export async function commitTemplateImagesRequest(input: { slug: string; templateId: string | null; staged: StagedTemplateImage[]; keepUrls: string[] }): Promise<{ commit: string | null; files: UploadedTemplateImage[]; deleted: string[] }> {
  const res = await fetch('/api/admin/system-templates/commit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  const data = (await res.json().catch(() => null)) as ({ commit: string | null; files: UploadedTemplateImage[]; deleted: string[] } & { error?: { code: string; message: string } }) | null;
  if (!res.ok || !data) throw new ApiError(data?.error?.code ?? 'internal', data?.error?.message ?? `Error ${res.status}`, res.status);
  return data;
}
