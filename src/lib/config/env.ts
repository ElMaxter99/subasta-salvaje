/**
 * Detección del modo de ejecución. Se evalúa en cada llamada (no en import) para que
 * los tests puedan cambiar process.env.
 *
 *  - supabase:     producción real (Postgres + Auth + Storage + Realtime de Supabase)
 *  - demo:         desarrollo local sin credenciales (PGlite + disco + proveedor de IA de muestra)
 *  - unconfigured: producción sin credenciales -> pantalla de configuración
 */
export type RuntimeMode = 'supabase' | 'demo' | 'unconfigured';

export const SUPABASE_REQUIRED_VARS = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'] as const;

export function missingSupabaseVars(env: NodeJS.ProcessEnv = process.env): string[] {
  return SUPABASE_REQUIRED_VARS.filter((k) => !env[k]?.trim());
}

export function getRuntimeMode(env: NodeJS.ProcessEnv = process.env): RuntimeMode {
  if (missingSupabaseVars(env).length === 0 && env.FORCE_DEMO_MODE !== 'true') return 'supabase';
  if (env.NODE_ENV !== 'production' || env.ALLOW_DEMO_MODE === 'true') return 'demo';
  return 'unconfigured';
}

export function openAiKey(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.OPENAI_API_KEY?.trim() || null;
}

export type ImageProviderId = 'cloudflare' | 'pollinations' | 'openai';

export interface PollinationsConfig {
  apiKey: string;
  /** Modelo de generación (por defecto FLUX.1 schnell, el de la documentación de Pollinations). */
  model: string;
  /** Modelo de edición con imágenes de referencia (opcional; vacío = la edición no está disponible y se usa la composición). */
  editModel: string | null;
  size: string;
}

/** Pollinations (gratuito con clave gratuita; límites y términos SIN verificar: ver docs/PENDIENTE.md). */
export function pollinationsConfig(env: NodeJS.ProcessEnv = process.env): PollinationsConfig | null {
  const apiKey = env.POLLINATIONS_API_KEY?.trim();
  if (!apiKey) return null;
  const size = env.POLLINATIONS_IMAGE_SIZE?.trim();
  return {
    apiKey,
    model: env.POLLINATIONS_IMAGE_MODEL?.trim() || 'black-forest-labs/flux.1-schnell',
    editModel: /^(off|none|false|no)$/i.test(env.POLLINATIONS_EDIT_MODEL?.trim() ?? '') ? null : env.POLLINATIONS_EDIT_MODEL?.trim() || null,
    size: size && /^\d{3,4}x\d{3,4}$/.test(size) ? size : '1024x768',
  };
}

export interface CloudflareConfig {
  accountId: string;
  apiToken: string;
  /** Modelo de GENERACIÓN (por defecto el económico flux-1-schnell; no edita imágenes). */
  model: string;
  steps: number;
  /** Modelo de EDICIÓN con imagen de referencia (opcional). Vacío = la edición no está disponible. */
  editModel: string | null;
  width: number;
  height: number;
}

export const DEFAULT_CF_EDIT_MODEL = '@cf/black-forest-labs/flux-2-klein-4b';

export function cloudflareConfig(env: NodeJS.ProcessEnv = process.env): CloudflareConfig | null {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const apiToken = env.CLOUDFLARE_API_TOKEN?.trim();
  if (!accountId || !apiToken) return null;
  const int = (v: string | undefined, d: number, min: number, max: number) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= min && n <= max ? n : d;
  };
  return {
    accountId,
    apiToken,
    model: env.CLOUDFLARE_IMAGE_MODEL?.trim() || '@cf/black-forest-labs/flux-1-schnell',
    steps: int(env.CLOUDFLARE_IMAGE_STEPS, 4, 1, 8),
    // Edición real con imagen de referencia: FLUX.2 klein por defecto (≈85 neuronas por edición de 1024×768, dentro de la
    // cuota gratuita diaria). CLOUDFLARE_EDIT_MODEL=off la desactiva (queda la composición).
    editModel: /^(off|none|false|no)$/i.test(env.CLOUDFLARE_EDIT_MODEL?.trim() ?? '') ? null : env.CLOUDFLARE_EDIT_MODEL?.trim() || DEFAULT_CF_EDIT_MODEL,
    width: int(env.CLOUDFLARE_EDIT_WIDTH, 1024, 256, 2048),
    height: int(env.CLOUDFLARE_EDIT_HEIGHT, 768, 256, 2048),
  };
}

/**
 * Proveedor de IA REAL (para las partidas en modo «ai»). Las partidas en modo «stickers» no lo usan nunca.
 * Hay que pedirlo con IMAGE_PROVIDER=cloudflare|openai; ninguna credencial lo activa por sí sola (no se consume
 * cuota por accidente). Sin él (o con `demo`/vacío) la IA no está disponible y sólo existe el modo pegatinas.
 * Si se pide uno y faltan sus credenciales devuelve null: NUNCA se cambia solo a otro proveedor.
 */
export function getImageProviderId(env: NodeJS.ProcessEnv = process.env): ImageProviderId | null {
  // Interruptor de seguridad: IMAGE_AI_DISABLED=true apaga TODA la IA real sin tocar credenciales ni partidas.
  if (/^(1|true|yes)$/i.test(env.IMAGE_AI_DISABLED?.trim() ?? '')) return null;
  return getImageProviderIds(env)[0] ?? null;
}

/**
 * Cadena de proveedores: `IMAGE_PROVIDERS=cloudflare,…` (orden de preferencia) o, como hasta ahora, `IMAGE_PROVIDER=…` (uno solo).
 * Solo entran los pedidos explícitamente y con credenciales. Un proveedor de PAGO (openai) solo se admite como único
 * (no puede ser fallback silencioso de otro: exigiría un tope de gasto, ver docs/PLAN-PROVEEDORES-IA.md fase 5).
 */
export function getImageProviderIds(env: NodeJS.ProcessEnv = process.env): ImageProviderId[] {
  if (/^(1|true|yes)$/i.test(env.IMAGE_AI_DISABLED?.trim() ?? '')) return [];
  const wanted = (env.IMAGE_PROVIDERS?.trim() ? env.IMAGE_PROVIDERS : (env.IMAGE_PROVIDER ?? '')).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const out: ImageProviderId[] = [];
  for (const w of wanted) {
    if (w === 'cloudflare' && cloudflareConfig(env) && !out.includes('cloudflare')) out.push('cloudflare');
    else if (w === 'pollinations' && pollinationsConfig(env) && !out.includes('pollinations')) out.push('pollinations');
    else if (w === 'openai' && openAiKey(env) && wanted.length === 1) out.push('openai');
  }
  return out;
}

export interface QuotaConfig {
  perGame: number;
  perDay: number;
}

/** Límites de generaciones REALES (no cuenta el proveedor demo). Valores enteros positivos. */
export function quotaConfig(env: NodeJS.ProcessEnv = process.env): QuotaConfig {
  const pos = (v: string | undefined, d: number) => {
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : d;
  };
  return { perGame: pos(env.IMAGE_QUOTA_PER_GAME, 10), perDay: pos(env.IMAGE_QUOTA_PER_DAY, 50) };
}

export function getSupabaseConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    url: env.NEXT_PUBLIC_SUPABASE_URL!.trim().replace(/\/$/, ''),
    anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim(),
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY!.trim(),
    bucket: env.SUPABASE_STORAGE_BUCKET?.trim() || 'game-images',
  };
}

/** Horas de INACTIVIDAD tras las que una partida se borra sola (por defecto 168 = 7 días; mínimo 1). El superadmin puede cambiarlo en caliente. */
export function gameTtlHours(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.GAME_TTL_HOURS);
  return Number.isInteger(n) && n >= 1 && n <= 24 * 90 ? n : 168;
}
