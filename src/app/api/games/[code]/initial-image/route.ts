import { assertSameOrigin, handle, json, limit } from '@/lib/api';
import { requireHost } from '@/lib/auth/host';
import { DomainError } from '@/lib/domain/errors';
import { getContext } from '@/lib/services/context';
import { uploadInitialImage, uploadInitialImageForAll } from '@/lib/services/game-service';

const MAX = 7 * 1024 * 1024;

/** multipart/form-data: player_id (uuid o 'all') + file (PNG/JPEG/WebP, máx. 7 MB). */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ code: string }> }) => {
  assertSameOrigin(req);
  const { code } = await params;
  const host = await requireHost();
  limit(req, 'upload', host.id, 20);
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > MAX + 64 * 1024) throw new DomainError('invalid_input', 'La imagen supera el máximo de 7 MB.');
  const form = await req.formData().catch(() => null);
  const playerId = form?.get('player_id');
  const file = form?.get('file');
  if (typeof playerId !== 'string' || !(file instanceof File)) throw new DomainError('invalid_input');
  if (file.size > MAX) throw new DomainError('invalid_input', 'La imagen supera el máximo de 7 MB.');
  const ctx = await getContext();
  const bytes = new Uint8Array(await file.arrayBuffer());
  // player_id = 'all' aplica la misma imagen a todos los jugadores.
  if (playerId === 'all') return json(await uploadInitialImageForAll(ctx, code, host.id, bytes));
  return json(await uploadInitialImage(ctx, code, host.id, playerId, bytes));
});
