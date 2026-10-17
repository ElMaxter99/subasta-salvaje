import { assertSameOrigin, handle, json, limit } from '@/lib/api';
import { requireSuperadmin } from '@/lib/auth/host';
import { DomainError } from '@/lib/domain/errors';
import { getContext } from '@/lib/services/context';
import { commitTemplateImages } from '@/lib/services/system-template-service';

export const maxDuration = 60;

/**
 * Imágenes de una plantilla, fase 2 (al GUARDAR, nunca antes): publica en UN solo commit las preparadas y borra las que la
 * plantilla ya no usa. Solo superadmin.
 */
export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  const admin = await requireSuperadmin();
  limit(req, 'admin-template-commit', admin.id, 60, 600_000);
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') throw new DomainError('invalid_input');
  return json(await commitTemplateImages(await getContext(), admin.email ?? 'superadmin', body));
});
