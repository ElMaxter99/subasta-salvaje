import { assertSameOrigin, handle, json, limit } from '@/lib/api';
import { requireSuperadmin } from '@/lib/auth/host';
import { DomainError } from '@/lib/domain/errors';
import { TEMPLATE_UPLOAD_MAX_BYTES, stageTemplateImage } from '@/lib/services/system-template-service';

export const maxDuration = 60;

const KINDS = new Set(['cover', 'scene', 'item']);

/** Varias imágenes de una plantilla, fase 1: prepara UNA (formato interno + blob en GitHub, sin commit). Solo superadmin. */
export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  const admin = await requireSuperadmin();
  limit(req, 'admin-template-stage', admin.id, 240, 600_000);
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  const kind = String(form?.get('kind') ?? '');
  if (!(file instanceof File) || !KINDS.has(kind)) throw new DomainError('invalid_input');
  if (file.size > TEMPLATE_UPLOAD_MAX_BYTES) throw new DomainError('invalid_input', 'La imagen supera los 7 MB.');
  return json(await stageTemplateImage({ slug: String(form?.get('slug') ?? ''), kind: kind as 'cover' | 'scene' | 'item', name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }));
});
