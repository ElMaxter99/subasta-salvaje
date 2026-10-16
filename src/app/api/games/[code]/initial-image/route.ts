import { assertSameOrigin, handle, json, limit } from '@/lib/api';
import { requireHost } from '@/lib/auth/host';
import { DomainError } from '@/lib/domain/errors';
import { getContext } from '@/lib/services/context';
import { uploadInitialImage } from '@/lib/services/game-service';

const MAX = 8 * 1024 * 1024;

/** multipart/form-data: player_id + file (PNG/JPEG/WebP, máx. 8 MB). */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ code: string }> }) => {
  assertSameOrigin(req);
  const { code } = await params;
  const host = await requireHost();
  limit(req, 'upload', host.id, 20);
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > MAX + 64 * 1024) throw new DomainError('invalid_input', 'La imagen supera el máximo de 8 MB.');
  const form = await req.formData().catch(() => null);
  const playerId = form?.get('player_id');
  const file = form?.get('file');
  if (typeof playerId !== 'string' || !(file instanceof File)) throw new DomainError('invalid_input');
  if (file.size > MAX) throw new DomainError('invalid_input', 'La imagen supera el máximo de 8 MB.');
  const ctx = await getContext();
  return json(await uploadInitialImage(ctx, code, host.id, playerId, new Uint8Array(await file.arrayBuffer())));
});
