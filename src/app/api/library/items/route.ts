import { handle, json, limit } from '@/lib/api';
import { requireHost } from '@/lib/auth/host';
import { getContext } from '@/lib/services/context';
import { listLibraryItems } from '@/lib/services/library-service';

/** Catálogo general de productos (para importarlos al configurar una partida). Cualquier anfitrión con sesión. */
export const GET = handle(async (req: Request) => {
  const host = await requireHost();
  limit(req, 'library-items', host.id, 120);
  const url = new URL(req.url);
  const num = (k: string) => { const v = Number(url.searchParams.get(k)); return Number.isFinite(v) && v > 0 ? v : undefined; };
  return json(await listLibraryItems(await getContext(), { q: (url.searchParams.get('q') ?? '').slice(0, 80), collection: url.searchParams.get('collection') || null, ...(num('limit') ? { limit: Math.min(num('limit')!, 500) } : {}), offset: num('offset') ?? 0 }));
});
