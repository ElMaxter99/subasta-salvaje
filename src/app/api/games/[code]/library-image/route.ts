import { assertSameOrigin, handle, json, limit } from '@/lib/api';
import { requireHost } from '@/lib/auth/host';
import { DomainError } from '@/lib/domain/errors';
import { getContext } from '@/lib/services/context';
import { applyLibraryImage } from '@/lib/services/library-pick-service';

/**
 * Aplica una imagen elegida de la biblioteca a la partida: `{ target: 'initial', image_id, scope_current?, scope_new? }` (casa inicial común)
 * o `{ target: 'item', image_id, item_id }` (foto de un elemento). Solo el anfitrión propietario; no es IA ni toca saldos.
 */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ code: string }> }) => {
  assertSameOrigin(req);
  const { code } = await params;
  const host = await requireHost();
  limit(req, 'library-apply', host.id, 40);
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') throw new DomainError('invalid_input');
  return json(await applyLibraryImage(await getContext(), code, host.id, body));
});
