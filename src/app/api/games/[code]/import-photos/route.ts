import { z } from 'zod';
import { assertSameOrigin, handle, json, limit } from '@/lib/api';
import { requireHost } from '@/lib/auth/host';
import { DomainError } from '@/lib/domain/errors';
import { getContext } from '@/lib/services/context';
import { importItemPhotos } from '@/lib/services/template-service';

export const maxDuration = 60;

const bodySchema = z.object({ photos: z.array(z.object({ name: z.string().trim().min(1).max(80), url: z.string().trim().min(1).max(500) })).min(1).max(100) });

/** Fotos de una plantilla: descarga cada URL (https, con defensas SSRF) y la pone en el elemento del catálogo. Solo el anfitrión propietario. */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ code: string }> }) => {
  assertSameOrigin(req);
  const { code } = await params;
  const host = await requireHost();
  limit(req, 'import-photos', host.id, 6, 600_000);
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) throw new DomainError('invalid_input');
  return json(await importItemPhotos(await getContext(), code, host.id, body.data.photos));
});
