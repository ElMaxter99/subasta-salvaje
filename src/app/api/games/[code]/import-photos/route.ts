import { z } from 'zod';
import { assertSameOrigin, handle, json, limit } from '@/lib/api';
import { requireHost } from '@/lib/auth/host';
import { DomainError } from '@/lib/domain/errors';
import { getContext } from '@/lib/services/context';
import { importInitialImage, importItemPhotos } from '@/lib/services/template-service';

export const maxDuration = 60;

const bodySchema = z
  .object({
    photos: z.array(z.object({ name: z.string().trim().min(1).max(80), url: z.string().trim().min(1).max(500) })).max(100).default([]),
    /** Imagen inicial de la casa (plantillas del sistema). */
    initial: z.string().trim().min(1).max(500).optional(),
  })
  .refine((b) => b.photos.length > 0 || b.initial);

/**
 * Fotos de una plantilla. Las ya alojadas en nuestro repositorio de fotos se usan por enlace (sin descargarlas); las de otros
 * servidores se descargan (https, con defensas SSRF) y se normalizan. Solo el anfitrión propietario.
 */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ code: string }> }) => {
  assertSameOrigin(req);
  const { code } = await params;
  const host = await requireHost();
  limit(req, 'import-photos', host.id, 6, 600_000);
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) throw new DomainError('invalid_input');
  const ctx = await getContext();
  const result = body.data.photos.length ? await importItemPhotos(ctx, code, host.id, body.data.photos) : { imported: 0, failed: [] };
  // La casa inicial va DESPUÉS de las fotos de los elementos (la partida sigue en la sala de espera).
  const initial = body.data.initial ? await importInitialImage(ctx, code, host.id, body.data.initial) : undefined;
  return json({ ...result, ...(initial ? { initial } : {}) });
});
