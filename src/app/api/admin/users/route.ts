import { assertSameOrigin, handle, json, limit } from '@/lib/api';
import { requireSuperadmin } from '@/lib/auth/host';
import { getContext } from '@/lib/services/context';
import { adminUserOp } from '@/lib/services/admin-service';

/** Bloquear/desbloquear, permitir la IA o borrar por completo a un usuario. Solo superadmin. */
export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  const admin = await requireSuperadmin();
  limit(req, 'admin', admin.id, 60);
  return json(await adminUserOp(await getContext(), { id: admin.id, email: admin.email ?? 'superadmin' }, await req.json().catch(() => null)));
});
