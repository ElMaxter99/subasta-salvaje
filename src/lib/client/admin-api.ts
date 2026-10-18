import { ApiError } from './api';

/** POST JSON a /api/admin/*. Lanza ApiError con el mensaje del servidor. */
export async function adminPost<T = Record<string, unknown>>(resource: 'settings' | 'users' | 'invites' | 'games' | 'system-templates' | 'library' | 'library/commit' | 'library/generate' | 'observability', body: unknown): Promise<T> {
  const res = await fetch(`/api/admin/${resource}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
  if (!res.ok) throw new ApiError(data?.error?.code ?? 'internal', data?.error?.message ?? `Error ${res.status}`, res.status);
  return data as T;
}
