import { assertSameOrigin, handle, json, limit } from '@/lib/api';
import { requireSuperadmin } from '@/lib/auth/host';
import { DomainError } from '@/lib/domain/errors';
import { getContext } from '@/lib/services/context';
import { LIBRARY_UPLOAD_MAX_BYTES, stageLibraryImage, uploadMetaSchema } from '@/lib/services/library-service';

export const maxDuration = 60;

/**
 * Subida masiva, fase 1: prepara UNA imagen (se normaliza, se comprueba si ya está registrada y, si es nueva, se deja lista en
 * GitHub sin crear commit). Después, /api/admin/library/commit publica todo el lote en un único commit. Solo superadmin.
 */
export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  const admin = await requireSuperadmin();
  limit(req, 'admin-library-stage', admin.id, 600, 600_000);
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) throw new DomainError('invalid_input');
  if (file.size > LIBRARY_UPLOAD_MAX_BYTES) throw new DomainError('invalid_input', 'La imagen supera los 10 MB.');
  const tags = String(form?.get('tags') ?? '').split(',').map((t) => t.trim()).filter(Boolean);
  const meta = uploadMetaSchema.safeParse({
    collection: String(form?.get('collection') ?? ''),
    credit: String(form?.get('credit') ?? ''),
    title: String(form?.get('title') ?? ''),
    kind: String(form?.get('kind') ?? 'item'),
    tags,
  });
  if (!meta.success) throw new DomainError('invalid_input', meta.error.issues[0]?.message ?? 'Datos no válidos');
  return json(await stageLibraryImage(await getContext(), { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()), ...meta.data }));
});
