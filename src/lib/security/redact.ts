/** Patrones de credenciales conocidas (Cloudflare, Supabase, OpenAI, JWT, cabeceras Bearer). */
const PATTERNS: RegExp[] = [
  /cfut_[A-Za-z0-9_-]{16,}/g, // token de usuario de Cloudflare
  /cfat_[A-Za-z0-9_-]{16,}/g, // token de cuenta de Cloudflare
  /sb_secret_[A-Za-z0-9_-]{8,}/g,
  /sb_publishable_[A-Za-z0-9_-]{8,}/g,
  /sk-[A-Za-z0-9_-]{16,}/g,
  /re_[A-Za-z0-9_]{16,}/g, // clave de Resend
  /\bsk_[A-Za-z0-9]{16,}/g, // clave de Pollinations
  /github_pat_[A-Za-z0-9_]{20,}/g, // token fino de GitHub
  /\bgh[pousr]_[A-Za-z0-9]{30,}/g, // tokens clásicos de GitHub
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
];

const SECRET_ENV = ['CLOUDFLARE_API_TOKEN', 'OPENAI_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'CRON_SECRET', 'RESEND_API_KEY', 'POLLINATIONS_API_KEY', 'GITHUB_ASSETS_TOKEN'] as const;

/**
 * Elimina credenciales de un texto antes de guardarlo (errores de trabajos, logs, respuestas):
 * tanto por formato conocido como por el valor exacto de las variables de entorno secretas.
 */
export function redactSecrets(text: string, env: NodeJS.ProcessEnv = typeof process !== 'undefined' ? process.env : ({} as NodeJS.ProcessEnv)): string {
  let out = text;
  for (const name of SECRET_ENV) {
    const v = env[name]?.trim();
    if (v && v.length >= 8) out = out.split(v).join('[redactado]');
  }
  for (const re of PATTERNS) out = out.replace(re, '[redactado]');
  return out;
}
