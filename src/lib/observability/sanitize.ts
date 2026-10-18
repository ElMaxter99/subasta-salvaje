import { redactSecrets } from '@/lib/security/redact';

/**
 * Saneado de todo texto que entra en la observabilidad. Se quita lo que pudiera identificar a una persona o dar acceso:
 * credenciales conocidas (`redactSecrets`), correos, IPv4, cookies/tokens `nombre=valor`, y la consulta/fragmento de las URL.
 * Después se trunca. La base de datos aplica una segunda barrera parecida (`ss_obs_clean`).
 */
export function sanitizeText(text: string, max: number): string {
  let t = redactSecrets(String(text ?? ''));
  t = t.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[correo]');
  t = t.replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[ip]');
  t = t.replace(/\b(sb-[\w-]+|ss_[a-z_]+|access_token|refresh_token|token|apikey|api_key|password|secret|authorization)\s*[=:]\s*[^\s;,&"']+/gi, '$1=[redactado]');
  t = t.replace(/([a-z][a-z0-9+.-]*:\/\/[^\s"'<>?#]*|\/[\w./-]*)[?#][^\s"'<>)]*/gi, '$1?…');
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

const ID_SEGMENT = /^(?:(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d+|[0-9a-f]{16,})|[A-Z0-9]{4,12})$/i;
const ROOM_CODE = /^[A-Z0-9]{4,12}$/;
const FIXED = new Set(['api', 'game', 'admin', 'screen', 'host', 'play', 'new-game', 'join', 'login', 'setup', 'auth', 'jobs', 'process', 'purge', 'telemetry', 'error', 'games', 'actions', 'library', 'templates', 'system-templates', 'public', 'catalog', 'ia', 'users', 'settings', 'invites', 'observabilidad', 'estadisticas', 'partidas', 'plantillas', 'biblioteca', 'ajustes', 'auditoria', 'usuarios', 'health', 'runtime', 'dev', 'initial', 'podium', 'jobs', 'vote', 'react', 'yield', 'bid', 'export', 'results', 'gallery']);

/** Ruta sin consulta ni identificadores: `/game/ABCD/play` -> `/game/:id/play`. El código de sala nunca llega a la ruta guardada. */
export function normalizeRoute(path: string): string {
  const clean = String(path ?? '').split(/[?#]/)[0] ?? '';
  const parts = clean.split('/').filter(Boolean).slice(0, 8).map((seg) => {
    if (FIXED.has(seg.toLowerCase())) return seg;
    if (ROOM_CODE.test(seg) || (ID_SEGMENT.test(seg) && !/^[a-z]+$/i.test(seg)) || seg.length > 24) return ':id';
    return seg.length > 30 ? ':id' : seg;
  });
  return `/${parts.join('/')}`.slice(0, 120);
}

/** Código de sala si la ruta es /game/<CODE>/… o /api/…/<CODE>/… (se guarda aparte, es público para quien está en la partida). */
export function roomFromPath(path: string): string | null {
  const m = /^\/(?:game|api\/(?:games|play|public\/games))\/([A-Za-z0-9]{4,12})(?:\/|$)/.exec(String(path ?? '').split(/[?#]/)[0] ?? '');
  return m?.[1] ? m[1].toUpperCase() : null;
}

const FAMILIES = new Set(['play', 'games', 'admin', 'auth', 'jobs', 'library', 'templates', 'system-templates', 'catalog', 'public', 'runtime', 'telemetry', 'health']);

/** Familia de rutas API para las métricas: /api/play/ABCD/bid -> «play». Lo desconocido va a «other» (cardinalidad acotada). */
export function routeFamily(path: string): string {
  const m = /^\/api\/([a-z-]+)/.exec(path);
  if (m?.[1] && FAMILIES.has(m[1])) return m[1];
  return /^\/api\//.test(path) ? 'other' : 'pages';
}

export function statusClass(status: number): '2xx' | '3xx' | '4xx' | '429' | '5xx' {
  if (status === 429) return '429';
  if (status >= 500) return '5xx';
  if (status >= 400) return '4xx';
  if (status >= 300) return '3xx';
  return '2xx';
}

export const LATENCY_BOUNDS = [50, 100, 250, 500, 1000, 2500, 5000] as const;
export function latencyBucket(ms: number): string {
  for (const b of LATENCY_BOUNDS) if (ms <= b) return String(b);
  return 'max';
}
