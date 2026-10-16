import { assertSameOrigin, handle, json, limit } from '@/lib/api';
import { requireHost } from '@/lib/auth/host';
import { DomainError } from '@/lib/domain/errors';
import { getContext } from '@/lib/services/context';
import { deleteTemplate, getTemplate } from '@/lib/services/template-store';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  if (!UUID.test(id)) throw new DomainError('template_not_found');
  const host = await requireHost();
  return json(await getTemplate(await getContext(), host.id, id));
});

export const DELETE = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const { id } = await params;
  if (!UUID.test(id)) throw new DomainError('template_not_found');
  const host = await requireHost();
  limit(req, 'template-delete', host.id, 30);
  await deleteTemplate(await getContext(), host.id, id);
  return json({ ok: true });
});
