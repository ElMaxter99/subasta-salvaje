import { handle, json } from '@/lib/api';
import { requireHost } from '@/lib/auth/host';
import { getContext } from '@/lib/services/context';
import { listSystemTemplates } from '@/lib/services/system-template-service';

/** «Partidas del sistema» publicadas por el superadmin (los borradores no se listan). Cualquier anfitrión con sesión. */
export const GET = handle(async () => {
  await requireHost();
  return json({ templates: await listSystemTemplates(await getContext()) });
});
