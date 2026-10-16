import { assertSameOrigin, handle, json, limit } from '@/lib/api';
import { requireHost } from '@/lib/auth/host';
import { DomainError } from '@/lib/domain/errors';
import { getContext } from '@/lib/services/context';
import { uploadItemImage } from '@/lib/services/game-service';

const MAX = 7 * 1024 * 1024;

/** multipart/form-data: item_id (uuid) + file (PNG/JPEG/WebP, máx. 7 MB). Sólo el anfitrión propietario. */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ code: string }> }) => {
  assertSameOrigin(req);
  const { code } = await params;
  const host = await requireHost();
  limit(req, 'upload', host.id, 30);
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > MAX + 64 * 1024) throw new DomainError('invalid_input', 'La imagen supera el máximo de 7 MB.');
  const form = await req.formData().catch(() => null);
  const itemId = form?.get('item_id');
  const file = form?.get('file');
  if (typeof itemId !== 'string' || !/^[0-9a-f-]{36}$/i.test(itemId) || !(file instanceof File)) throw new DomainError('invalid_input');
  if (file.size > MAX) throw new DomainError('invalid_input', 'La imagen supera el máximo de 7 MB.');
  return json(await uploadItemImage(await getContext(), code, host.id, itemId, new Uint8Array(await file.arrayBuffer())));
});
