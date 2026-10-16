import { assertSameOrigin, handle, json, limit } from '@/lib/api';
import { requireSuperadmin } from '@/lib/auth/host';
import { getContext } from '@/lib/services/context';
import { adminGameOp } from '@/lib/services/admin-service';

/** Borra una partida o purga las caducadas. Solo superadmin (comprobado en el servidor en cada petición). */
export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  const admin = await requireSuperadmin();
  limit(req, 'admin', admin.id, 60);
  return json(await adminGameOp(await getContext(), admin.email ?? 'superadmin', await req.json().catch(() => null)));
});
