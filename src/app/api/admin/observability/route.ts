import { assertSameOrigin, handle, json, limit } from '@/lib/api';
import { requireSuperadmin } from '@/lib/auth/host';
import { getContext } from '@/lib/services/context';
import { observabilityOp } from '@/lib/services/observability-service';

/** Acciones de la observabilidad (marcar visto/resuelto, ajustes, purga manual). Solo superadmin; todas auditadas. */
export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  const admin = await requireSuperadmin();
  limit(req, 'admin', admin.id, 60);
  return json(await observabilityOp(await getContext(), admin.email ?? 'superadmin', await req.json().catch(() => null)));
});
