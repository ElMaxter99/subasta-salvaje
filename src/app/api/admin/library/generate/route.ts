import { assertSameOrigin, handle, json, limit } from '@/lib/api';
import { requireSuperadmin } from '@/lib/auth/host';
import { getContext } from '@/lib/services/context';
import { generateLibraryItemImage } from '@/lib/services/library-service';

export const maxDuration = 60;

/** Genera con IA la imagen de un producto del catálogo general y la publica en la biblioteca. Solo superadmin; consume cuota diaria. */
export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  const admin = await requireSuperadmin();
  limit(req, 'admin-library-generate', admin.id, 20, 600_000);
  return json(await generateLibraryItemImage(await getContext(), admin.email ?? 'superadmin', await req.json().catch(() => null)));
});
