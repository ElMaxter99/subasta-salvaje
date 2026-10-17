import { z } from 'zod';
import { assertSameOrigin, handle, json, limit } from '@/lib/api';
import { requireSuperadmin } from '@/lib/auth/host';
import { DomainError } from '@/lib/domain/errors';
import { getContext } from '@/lib/services/context';
import { commitLibraryImages } from '@/lib/services/library-service';

export const maxDuration = 60;

/** Subida masiva, fase 2: publica TODAS las imágenes preparadas en UN solo commit y las registra. Solo superadmin. */
export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  const admin = await requireSuperadmin();
  limit(req, 'admin-library-commit', admin.id, 60, 600_000);
  const body = z.object({ staged: z.unknown() }).safeParse(await req.json().catch(() => null));
  if (!body.success) throw new DomainError('invalid_input');
  return json(await commitLibraryImages(await getContext(), admin.email ?? 'superadmin', body.data.staged));
});
