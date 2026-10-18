import { assertSameOrigin, handle, json, limit } from '@/lib/api';
import { requireSuperadmin } from '@/lib/auth/host';
import { DomainError } from '@/lib/domain/errors';
import { getContext } from '@/lib/services/context';
import { COMPARE_UPLOAD_MAX_BYTES, compareMetaSchema, compareModels, readLibraryImage } from '@/lib/services/compare-service';

export const maxDuration = 60;

/**
 * Comparador de modelos: multipart con `meta` (JSON: proveedores, tema, nombres, ids de biblioteca) y los archivos `base`, `item0`, `item1`
 * (cada imagen es un archivo subido o un id de la biblioteca; nunca una URL). Solo superadmin; cada llamada real gasta cuota diaria.
 */
export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  const admin = await requireSuperadmin();
  limit(req, 'admin-ai-compare', admin.id, 10, 600_000);
  const form = await req.formData().catch(() => null);
  if (!form) throw new DomainError('invalid_input');
  let raw: unknown;
  try { raw = JSON.parse(String(form.get('meta') ?? '')); } catch { throw new DomainError('invalid_input'); }
  const meta = compareMetaSchema.safeParse(raw);
  if (!meta.success) throw new DomainError('invalid_input', meta.error.issues[0]?.message ?? 'Datos no válidos');
  const ctx = await getContext();

  const pick = async (field: string, libraryId: string | null | undefined, what: string): Promise<Uint8Array> => {
    const file = form.get(field);
    if (file instanceof File && file.size > 0) {
      if (file.size > COMPARE_UPLOAD_MAX_BYTES) throw new DomainError('invalid_input', `${what}: supera los 10 MB.`);
      return new Uint8Array(await file.arrayBuffer());
    }
    if (libraryId) return readLibraryImage(ctx, libraryId);
    throw new DomainError('invalid_input', `${what}: sube una imagen o elige una de la biblioteca.`);
  };

  const base = await pick('base', meta.data.baseLibraryId, 'Imagen base');
  const items = await Promise.all(meta.data.items.map(async (it, i) => ({ ...it, bytes: await pick(`item${i}`, meta.data.itemLibraryIds[i], `Elemento ${i + 1}`) })));
  return json(await compareModels(ctx, admin.email ?? 'superadmin', { base, items, theme: meta.data.theme, providers: meta.data.providers }));
});
