import { assertSameOrigin, handle, json, limit } from '@/lib/api';
import { requireSuperadmin } from '@/lib/auth/host';
import { getContext } from '@/lib/services/context';
import { adminInvite } from '@/lib/services/admin-service';
import { z } from 'zod';
import { DomainError } from '@/lib/domain/errors';
import { sendAppInvite } from '@/lib/services/auth-mail';
import { getAuthMailDeps } from '@/lib/services/auth-mail-context';

const notifySchema = z.object({ op: z.literal('notify'), email: z.string().trim().email().max(200) });

/** Crea o elimina una invitación. Solo superadmin (comprobado en el servidor en cada petición). */
export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  const admin = await requireSuperadmin();
  limit(req, 'admin', admin.id, 60);
  const raw = await req.json().catch(() => null);
  const notify = notifySchema.safeParse(raw);
  if (notify.success) {
    // Solo a correos que ya tienen invitación (no se puede usar para enviar correo a cualquiera).
    const ctx = await getContext();
    const known = await ctx.db.rpc<{ invites: { email: string }[] }>('ss_admin_users', {});
    if (!known.invites.some((i) => i.email.toLowerCase() === notify.data.email.toLowerCase())) throw new DomainError('invalid_input', 'Ese correo no tiene invitación.', 400);
    await sendAppInvite(notify.data.email, getAuthMailDeps());
    return json({ ok: true });
  }
  return json(await adminInvite(await getContext(), admin.email ?? 'superadmin', raw));
});
