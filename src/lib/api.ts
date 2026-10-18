import { NextResponse } from 'next/server';
import { DomainError, isDomainError, toDomainError } from '@/lib/domain/errors';
import { redactSecrets } from '@/lib/security/redact';
import { rateLimit } from '@/lib/auth/rate-limit';
import { observeRequest } from '@/lib/observability/record';

export const noStore = { 'Cache-Control': 'no-store, max-age=0' };

export function json(data: unknown, init: ResponseInit = {}): NextResponse {
  return NextResponse.json(data, { ...init, headers: { ...noStore, ...(init.headers ?? {}) } });
}

export function errorResponse(err: unknown): NextResponse {
  const e = toDomainError(err);
  return json({ error: { code: e.code, message: e.message } }, { status: e.status });
}

/** Defensa CSRF adicional: las peticiones que modifican datos deben venir del mismo origen. */
export function assertSameOrigin(req: Request): void {
  const origin = req.headers.get('origin');
  if (!origin) return; // llamadas de servidor a servidor / curl sin navegador (siguen necesitando credenciales)
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  let originHost: string | null = null;
  try {
    originHost = new URL(origin).host;
  } catch {
    /* Origin: null u otro valor no válido */
  }
  if (!host || originHost !== host) throw new DomainError('not_host', 'Origen no permitido.', 403);
}

export function limit(_req: Request, bucket: string, id: string, max: number, windowMs = 60_000): void {
  if (!rateLimit(`${bucket}:${id}`, max, windowMs)) throw new DomainError('rate_limited');
}

/** Clave de sala normalizada (mayúsculas, sin espacios) para límites y cookies: «abcd», «ABCD» y «ABCD%20» son la misma sala. */
export function roomKey(code: string): string {
  return code.trim().toUpperCase();
}

/** Lee un cuerpo JSON pequeño con tope de tamaño (las rutas de jugador solo reciben unos pocos campos). Devuelve null si no es JSON. */
export async function readJson(req: Request, maxBytes = 2048): Promise<unknown> {
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > maxBytes) throw new DomainError('invalid_input', undefined, 413);
  const text = await req.text().catch(() => '');
  if (text.length > maxBytes) throw new DomainError('invalid_input', undefined, 413);
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Envuelve un handler: traduce errores de dominio a JSON con el código HTTP adecuado. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    const startedAt = Date.now();
    const req = args[0] instanceof Request ? args[0] : undefined;
    try {
      const res = await fn(...args);
      observeRequest(req, res.status, startedAt); // métricas agregadas: síncrono, barato y a prueba de fallos
      return res;
    } catch (err) {
      if (!isDomainError(err)) console.error('[api]', redactSecrets(err instanceof Error ? `${err.name}: ${err.message}` : String(err)));
      const res = errorResponse(err);
      // Los errores de dominio esperados (400/409/429…) solo se cuentan; los 5xx se guardan agrupados en app_errors.
      observeRequest(req, res.status, startedAt, err);
      return res;
    }
  };
}
