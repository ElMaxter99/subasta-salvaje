import { z } from 'zod';
import { assertSameOrigin, handle, json, limit } from '@/lib/api';
import { requireSuperadmin } from '@/lib/auth/host';
import { assetCdnHosts } from '@/lib/config/env';
import { DomainError } from '@/lib/domain/errors';
import { getContext } from '@/lib/services/context';
import { checkTemplateImages, deleteSystemTemplate, getSystemTemplate, listSystemTemplates, saveSystemTemplate, setSystemTemplateStatus, validateSystemTemplateData } from '@/lib/services/system-template-service';

export const maxDuration = 60;

/** Todas las plantillas del sistema (incluye borradores). Solo superadmin. */
export const GET = handle(async () => {
  await requireSuperadmin();
  return json({ templates: await listSystemTemplates(await getContext(), { admin: true }), cdnHosts: assetCdnHosts() });
});

const opSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('save') }).passthrough(),
  z.object({ op: z.literal('status'), id: z.string().uuid(), status: z.enum(['draft', 'published']) }),
  z.object({ op: z.literal('delete'), id: z.string().uuid() }),
  z.object({ op: z.literal('get'), id: z.string().uuid() }),
  z.object({ op: z.literal('check'), id: z.string().uuid() }),
]);

/** Guardar (borrador), publicar/retirar, borrar, leer completa o comprobar las imágenes. Solo superadmin. */
export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  const admin = await requireSuperadmin();
  limit(req, 'admin-system-templates', admin.id, 40);
  const raw = await req.json().catch(() => null);
  const body = opSchema.safeParse(raw);
  if (!body.success) throw new DomainError('invalid_input');
  const ctx = await getContext();
  const actor = admin.email ?? 'superadmin';
  switch (body.data.op) {
    case 'save': {
      const { op: _op, ...rest } = raw as Record<string, unknown>;
      void _op;
      return json(await saveSystemTemplate(ctx, actor, rest));
    }
    case 'status':
      return json(await setSystemTemplateStatus(ctx, actor, body.data.id, body.data.status));
    case 'delete':
      await deleteSystemTemplate(ctx, actor, body.data.id);
      return json({ ok: true });
    case 'get':
      return json(await getSystemTemplate(ctx, body.data.id, { admin: true }));
    case 'check': {
      const t = await getSystemTemplate(ctx, body.data.id, { admin: true });
      return json({ checks: await checkTemplateImages(validateSystemTemplateData(t.data)) });
    }
  }
});
