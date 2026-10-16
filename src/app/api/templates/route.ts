import { assertSameOrigin, handle, json, limit } from '@/lib/api';
import { requireHost } from '@/lib/auth/host';
import { getContext } from '@/lib/services/context';
import { listTemplates, saveTemplate } from '@/lib/services/template-store';

/** Plantillas guardadas del anfitrión (máx. 20). */
export const GET = handle(async () => {
  const host = await requireHost();
  return json({ templates: await listTemplates(await getContext(), host.id) });
});

export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  const host = await requireHost();
  limit(req, 'template-save', host.id, 30);
  const body = (await req.json().catch(() => null)) as { name?: unknown; template?: unknown } | null;
  return json(await saveTemplate(await getContext(), host.id, body?.name, body?.template), { status: 201 });
});
