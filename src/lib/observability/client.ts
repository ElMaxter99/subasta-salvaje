/**
 * Reporter de errores del navegador, mínimo y SIN almacenamiento propio (ni cookies, ni localStorage): solo memoria de la pestaña.
 * Envía mensaje, pila y la ruta SIN consulta ni código de sala. Deduplicado (misma huella solo una vez por carga) y con tope de 5 por carga.
 */
const seen = new Set<string>();
let sent = 0;
const MAX_PER_LOAD = 5;

/** Ruta sin consulta/fragmento y con el código de sala sustituido (quien lo conoce puede entrar a la partida). */
export function safeRoute(pathname: string): string {
  return pathname.replace(/^\/game\/[^/]+/, '/game/:code').replace(/^\/join\/[^/]+/, '/join/:code').slice(0, 120);
}

export function reportClientError(kind: 'error' | 'unhandledrejection' | 'boundary', err: unknown, extra: { digest?: string } = {}): void {
  try {
    if (sent >= MAX_PER_LOAD || typeof window === 'undefined') return;
    const e = err as { message?: unknown; stack?: unknown } | null;
    const message = String(typeof e?.message === 'string' ? e.message : err ?? 'Error').slice(0, 500);
    const stack = typeof e?.stack === 'string' ? e.stack.slice(0, 2000) : '';
    const key = `${kind}|${message}|${stack.split('\n')[1] ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    sent++;
    void fetch('/api/telemetry/error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, stack, kind, route: safeRoute(window.location.pathname), ...(extra.digest ? { digest: extra.digest } : {}) }),
      keepalive: true,
      credentials: 'omit',
    }).catch(() => undefined);
  } catch {
    /* nunca debe romper la página */
  }
}
