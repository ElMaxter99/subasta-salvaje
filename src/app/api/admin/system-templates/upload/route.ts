import { assertSameOrigin, handle, json, limit } from '@/lib/api';
import { requireSuperadmin } from '@/lib/auth/host';
import { DomainError } from '@/lib/domain/errors';
import { getContext } from '@/lib/services/context';
import { TEMPLATE_UPLOAD_MAX_BYTES, uploadTemplateImage } from '@/lib/services/system-template-service';

export const maxDuration = 60;

const KINDS = new Set(['cover', 'scene', 'item']);

/**
 * Sube UNA imagen de una plantilla del sistema (arrastrar y soltar): se normaliza al formato interno y se publica en el
 * repositorio de fotos (GitHub + jsDelivr, NO en Supabase). Solo superadmin. El cliente envía de una en una.
 */
export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  const admin = await requireSuperadmin();
  limit(req, 'admin-template-upload', admin.id, 120, 600_000);
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  const kind = String(form?.get('kind') ?? '');
  const slug = String(form?.get('slug') ?? '');
  if (!(file instanceof File) || !KINDS.has(kind)) throw new DomainError('invalid_input');
  if (file.size > TEMPLATE_UPLOAD_MAX_BYTES) throw new DomainError('invalid_input', 'La imagen supera los 7 MB.');
  return json(await uploadTemplateImage(await getContext(), admin.email ?? 'superadmin', { slug, kind: kind as 'cover' | 'scene' | 'item', name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }), { status: 201 });
});
