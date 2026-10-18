import { z } from 'zod';
import { assertSameOrigin, handle, json, limit } from '@/lib/api';
import { requireSuperadmin } from '@/lib/auth/host';
import { assetCdnHosts } from '@/lib/config/env';
import { DomainError } from '@/lib/domain/errors';
import { getContext } from '@/lib/services/context';
import { parseBundle } from '@/lib/domain/system-template-pack';
import { importSystemTemplates } from '@/lib/services/system-template-import';
import { applyMatchPicks, proposeForTemplate } from '@/lib/services/library-match-service';
import { checkTemplateImages, createTemplateFromCollection, deleteSystemTemplate, getSystemTemplate, listSystemTemplates, saveSystemTemplate, setSystemTemplateStatus, validateSystemTemplateData } from '@/lib/services/system-template-service';

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
  z.object({ op: z.literal('import_many') }).passthrough(),
  z.object({ op: z.literal('match_propose'), id: z.string().uuid() }),
  z.object({ op: z.literal('match_apply'), id: z.string().uuid(), picks: z.array(z.object({ index: z.number().int(), image_id: z.string() })).max(100) }),
  z.object({ op: z.literal('from_collection'), collection: z.string(), house_image_id: z.string().uuid().nullish(), cover_item_id: z.string().uuid().nullish() }),
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
    case 'import_many': {
      // Varias plantillas a la vez (lote .json): siempre en BORRADOR; publicar es una acción manual aparte.
      const r = parseBundle(JSON.stringify((raw as { lote?: unknown }).lote ?? null));
      if (!r.ok) throw new DomainError('invalid_input', r.error);
      return json({ results: await importSystemTemplates(ctx, actor, r.bundle.plantillas, { publish: false }) });
    }
    case 'from_collection': {
      const { op: _o, ...rest } = body.data;
      void _o;
      return json(await createTemplateFromCollection(ctx, actor, rest));
    }
    case 'match_propose':
      limit(req, 'admin-template-match', admin.id, 15);
      return json(await proposeForTemplate(ctx, body.data.id));
    case 'match_apply':
      limit(req, 'admin-template-match-apply', admin.id, 20);
      return json(await applyMatchPicks(ctx, actor, { id: body.data.id, picks: body.data.picks }));
    case 'check': {
      const t = await getSystemTemplate(ctx, body.data.id, { admin: true });
      return json({ checks: await checkTemplateImages(validateSystemTemplateData(t.data)) });
    }
  }
});
