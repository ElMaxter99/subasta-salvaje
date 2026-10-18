import { handle, json, limit } from '@/lib/api';
import { requireHost } from '@/lib/auth/host';
import { DomainError } from '@/lib/domain/errors';
import { isLibraryRole } from '@/lib/library/taxonomy';
import { getContext } from '@/lib/services/context';
import { listPickableImages } from '@/lib/services/library-pick-service';

/**
 * Selector de imágenes de la biblioteca para anfitriones (solo lectura, paginado). `role` es obligatorio (`start` = foto de inicio de partida,
 * `product` = producto de catálogo); solo se devuelven imágenes revisadas por el superadmin, sin datos de gestión.
 */
export const GET = handle(async (req: Request) => {
  const host = await requireHost();
  limit(req, 'library-images', host.id, 120);
  const url = new URL(req.url);
  const role = url.searchParams.get('role');
  if (!isLibraryRole(role)) throw new DomainError('invalid_input', 'Falta el rol de la imagen (start o product).');
  const num = (k: string) => { const v = Number(url.searchParams.get(k)); return Number.isFinite(v) && v > 0 ? Math.floor(v) : undefined; };
  return json(await listPickableImages(await getContext(), {
    role, q: (url.searchParams.get('q') ?? '').slice(0, 80), category: (url.searchParams.get('category') ?? '').slice(0, 60) || null,
    limit: Math.min(num('limit') ?? 24, 60), offset: num('offset') ?? 0,
  }));
});
