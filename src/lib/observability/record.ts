import { after } from 'next/server';
import { isDomainError } from '@/lib/domain/errors';
import { LATENCY_BOUNDS, latencyBucket, normalizeRoute, roomFromPath, routeFamily, sanitizeText, statusClass } from './sanitize';

/**
 * Captura de errores y métricas. REGLA: la observabilidad nunca rompe ni ralentiza el juego.
 *  · todo va dentro de try/catch y se ignora si falla;
 *  · nada se espera dentro de la petición: se ejecuta con `after()` (o suelto si no hay contexto de petición);
 *  · los contadores se acumulan en memoria y se vuelcan por lotes (un upsert por lote, no por petición).
 * La lógica de agregación vive en SQL (`ss_obs_*`); aquí solo se prepara el dato.
 */
type DbLike = { rpc<T = unknown>(fn: string, params: Record<string, unknown>): Promise<T> };

export interface ErrorInput {
  source: 'server' | 'client' | 'job' | 'cron';
  route?: string;
  code?: string;
  message?: string;
  stack?: string;
  room_code?: string | null;
  severity?: 'high' | 'low';
}

const release = () => (process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.APP_RELEASE ?? '').slice(0, 12);
const envName = () => process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? '';

/** Ejecuta `fn` sin bloquear la respuesta y sin propagar nunca un fallo. */
export function background(fn: () => Promise<unknown>): void {
  const safe = () => fn().catch(() => undefined);
  try {
    after(safe);
  } catch {
    void safe();
  }
}

async function defaultDb(): Promise<DbLike> {
  const { getContext } = await import('@/lib/services/context');
  return (await getContext()).db;
}

/** Guarda un error ya preparado (saneado y truncado aquí). Devuelve null si falló: nunca lanza. */
export async function recordError(input: ErrorInput, db?: DbLike): Promise<{ fingerprint: string; is_new: boolean; reopened: boolean; severity: string } | null> {
  try {
    const d = db ?? (await defaultDb());
    const res = await d.rpc<{ fingerprint: string; is_new: boolean; reopened: boolean; severity: string }>('ss_obs_error_record', {
      source: input.source,
      route: normalizeRoute(input.route ?? ''),
      code: input.code ?? 'internal',
      message: sanitizeText(input.message ?? '', 400),
      stack: sanitizeText(input.stack ?? '', 1500),
      room_code: input.room_code ?? null,
      release: release(),
      env: envName(),
      ...(input.severity ? { severity: input.severity } : {}),
    });
    if (res.is_new || res.reopened) {
      if (res.severity === 'high') {
        const { maybeSendAlert } = await import('@/lib/observability/alerts');
        await maybeSendAlert(d);
      }
    }
    return res;
  } catch {
    return null;
  }
}

/* ---------------- Métricas de peticiones (acumulador en memoria) ---------------- */
const buf = new Map<string, number>();
let lastFlush = Date.now();
let flushing = false;
const FLUSH_MS = 10_000;
const FLUSH_SIZE = 150;

export function bump(metric: string, n = 1): void {
  buf.set(metric, (buf.get(metric) ?? 0) + n);
}

/** Vuelca el acumulador a la base de datos. Si falla, se descarta (las métricas son aproximadas). */
export async function flushMetrics(db?: DbLike): Promise<boolean> {
  if (buf.size === 0) return true;
  const metrics = Object.fromEntries(buf);
  buf.clear();
  lastFlush = Date.now();
  try {
    const d = db ?? (await defaultDb());
    await d.rpc('ss_obs_incr', { metrics });
    return true;
  } catch {
    return false;
  }
}

export function resetMetricsBuffer(): void {
  buf.clear();
  lastFlush = Date.now();
}
export const pendingMetrics = (): Record<string, number> => Object.fromEntries(buf);

/** Anota una petición terminada. Síncrono y barato; el volcado a la BD es perezoso y en segundo plano. */
export function observeRequest(req: Request | undefined, status: number, startedAt: number, err?: unknown): void {
  try {
    const path = req ? new URL(req.url).pathname : '';
    const fam = routeFamily(path);
    const ms = Date.now() - startedAt;
    bump(`req.${fam}.${statusClass(status)}`);
    bump(`lat.${fam}.${latencyBucket(ms)}`);
    if (err !== undefined && isDomainError(err) && status < 500 && /^[a-z0-9_]{1,40}$/.test(err.code)) bump(`derr.${err.code}`);
    if (status >= 500 && err !== undefined) {
      const e = err as { name?: unknown; message?: unknown; stack?: unknown; code?: unknown };
      const code = isDomainError(err) ? err.code : 'internal';
      const source = path.startsWith('/api/jobs/') ? 'cron' : 'server';
      background(() => recordError({
        source,
        route: path,
        code,
        message: `${typeof e.name === 'string' ? e.name : 'Error'}: ${typeof e.message === 'string' ? e.message : String(err)}`,
        stack: typeof e.stack === 'string' ? e.stack : '',
        room_code: roomFromPath(path),
      }));
    }
    if (!flushing && (buf.size >= FLUSH_SIZE || Date.now() - lastFlush >= FLUSH_MS)) {
      flushing = true;
      background(async () => {
        try {
          await flushMetrics();
        } finally {
          flushing = false;
        }
      });
    }
  } catch {
    /* la observabilidad nunca rompe la petición */
  }
}

export { LATENCY_BOUNDS };
