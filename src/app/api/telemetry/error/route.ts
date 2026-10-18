import { z } from 'zod';
import { assertSameOrigin, handle, limit, readJson } from '@/lib/api';
import { clientIp } from '@/lib/auth/rate-limit';
import { DomainError } from '@/lib/domain/errors';
import { background, recordError } from '@/lib/observability/record';
import { createHash } from 'node:crypto';

export const dynamic = 'force-dynamic';

const body = z.object({
  message: z.string().max(600),
  stack: z.string().max(2500).optional(),
  route: z.string().max(200).optional(),
  kind: z.enum(['error', 'unhandledrejection', 'boundary']).optional(),
  digest: z.string().max(60).optional(),
});

/**
 * Reporter de errores del navegador (ver docs/OBSERVABILIDAD.md). Sin cookies ni almacenamiento: el cliente solo envía mensaje, pila y ruta.
 * Límites: mismo origen, cuerpo ≤ 4 KB, y tasa estricta por cliente (la IP solo se usa como clave EN MEMORIA del limitador, hasheada; no se guarda)
 * más un tope global por instancia. La respuesta es siempre 204 salvo abuso.
 */
export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  limit(req, 'telemetry-global', 'all', 120);
  const who = createHash('sha256').update(clientIp(req.headers)).digest('hex').slice(0, 16);
  limit(req, 'telemetry', who, 6);
  const parsed = body.safeParse(await readJson(req, 4096));
  if (!parsed.success) throw new DomainError('invalid_input');
  const b = parsed.data;
  background(() => recordError({
    source: 'client',
    route: b.route ?? '',
    code: b.kind === 'boundary' ? 'client_boundary' : b.kind === 'unhandledrejection' ? 'client_rejection' : 'client_error',
    message: b.message,
    stack: `${b.digest ? `digest ${b.digest}\n` : ''}${b.stack ?? ''}`,
    severity: b.kind === 'boundary' ? 'high' : 'low',
  }));
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
});
