import { ApiError } from './api';
import type { CompareMetaInput, CompareResult } from '@/lib/services/compare-service';

export type { CompareMetaInput, CompareResult };

/** Lanza una comparación (multipart: `meta` + archivos `base`, `item0`, `item1`). Lanza ApiError con el mensaje del servidor. */
export async function compareModelsRequest(meta: CompareMetaInput, files: { base?: File | null; items: (File | null)[] }): Promise<{ results: CompareResult[] }> {
  const form = new FormData();
  form.set('meta', JSON.stringify(meta));
  if (files.base) form.set('base', files.base);
  files.items.forEach((f, i) => { if (f) form.set(`item${i}`, f); });
  const res = await fetch('/api/admin/ia/compare', { method: 'POST', body: form });
  const data = (await res.json().catch(() => null)) as ({ results: CompareResult[] } & { error?: { code: string; message: string } }) | null;
  if (!res.ok || !data) throw new ApiError(data?.error?.code ?? 'internal', data?.error?.message ?? `Error ${res.status}`, res.status);
  return data;
}
