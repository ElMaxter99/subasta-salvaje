import { NextResponse } from 'next/server';
import { DomainError, toDomainError } from '@/lib/domain/errors';
import { clientIp, rateLimit } from '@/lib/auth/rate-limit';

export const noStore = { 'Cache-Control': 'no-store, max-age=0' };

export function json(data: unknown, init: ResponseInit = {}): NextResponse {
  return NextResponse.json(data, { ...init, headers: { ...noStore, ...(init.headers ?? {}) } });
}

export function errorResponse(err: unknown): NextResponse {
  const e = err instanceof DomainError ? err : toDomainError(err);
  return json({ error: { code: e.code, message: e.message } }, { status: e.status });
}

/** Defensa CSRF adicional: las peticiones que modifican datos deben venir del mismo origen. */
export function assertSameOrigin(req: Request): void {
  const origin = req.headers.get('origin');
  if (!origin) return; // llamadas de servidor a servidor / curl sin navegador (siguen necesitando credenciales)
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (!host || new URL(origin).host !== host) throw new DomainError('not_host', 'Origen no permitido.', 403);
}

export function limit(req: Request, bucket: string, id: string, max: number, windowMs = 60_000): void {
  if (!rateLimit(`${bucket}:${id}:${clientIp(req.headers)}`, max, windowMs)) throw new DomainError('rate_limited');
}

/** Envuelve un handler: traduce errores de dominio a JSON con el código HTTP adecuado. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      if (!(err instanceof DomainError)) console.error('[api]', err);
      return errorResponse(err);
    }
  };
}
