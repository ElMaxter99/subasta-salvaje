/**
 * Vercel Web Analytics: qué se envía. La analítica mide visitas a páginas, pero NUNCA debe llevar datos que den acceso:
 *  · se descartan la consulta (?…) y el fragmento (#…) — pueden traer tokens de enlaces de correo, `next`, etc.;
 *  · el código de la partida (/game/ABC123/play) se sustituye por «[code]» — quien lo conoce puede entrar a jugar;
 *  · las páginas de administración y de segundo factor no se miden.
 * Devuelve null para no enviar el evento.
 */
export function sanitizeAnalyticsUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw, 'https://app.invalid');
  } catch {
    return null;
  }
  if (/^\/(admin|seguridad-admin)(\/|$)/.test(u.pathname)) return null;
  const path = u.pathname.replace(/^\/game\/[^/]+(?=\/|$)/, '/game/[code]');
  const isAbsolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw);
  return isAbsolute ? `${u.origin}${path}` : path;
}

/** Opt-out del navegador (Do Not Track / Global Privacy Control) y del propietario (NEXT_PUBLIC_DISABLE_ANALYTICS=true). */
export function analyticsDisabled(env: Record<string, string | undefined> = process.env): boolean {
  return /^(1|true|yes)$/i.test(env.NEXT_PUBLIC_DISABLE_ANALYTICS?.trim() ?? '');
}
