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

export type ImageProviderId = 'cloudflare' | 'pollinations' | 'aihorde' | 'huggingface' | 'openai';

export interface PollinationsConfig {
  apiKey: string;
  /** Modelo de generación (por defecto FLUX.1 schnell, el de la documentación de Pollinations). */
  model: string;
  /** Modelo de edición con imágenes de referencia (opcional; vacío = la edición no está disponible y se usa la composición). */
  editModel: string | null;
  size: string;
  /** true si el propietario fijó POLLINATIONS_IMAGE_SIZE: no se adapta a la proporción de la casa al editar. */
  sizeFixed?: boolean;
}

/**
 * AI Horde (https://aihorde.net): GPU comunitaria gratuita y sin tarjeta. Funciona con la clave anónima (`0000000000`, la de
 * menor prioridad en la cola); una clave propia (cuenta gratuita) mejora la prioridad. Solo GENERA (no edita). SIN verificar
 * contra el servicio real. No hay credencial que lo active: solo entra en la cadena si se pide en IMAGE_PROVIDERS.
 */
export interface AiHordeConfig {
  apiKey: string;
  /** Modelos concretos (opcional; vacío = el que ponga la Horda). */
  models: string[];
  width: number;
  height: number;
  steps: number;
  /** Máximo de espera total (cola + generación) antes de rendirse. */
  maxWaitMs: number;
}
export function aiHordeConfig(env: NodeJS.ProcessEnv = process.env): AiHordeConfig {
  const int = (v: string | undefined, d: number, min: number, max: number) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= min && n <= max ? n : d;
  };
  const size = /^(\d{3,4})x(\d{3,4})$/.exec(env.AI_HORDE_SIZE?.trim() ?? '');
  const round64 = (n: number) => Math.min(1024, Math.max(256, Math.round(n / 64) * 64));
  return {
    apiKey: env.AI_HORDE_API_KEY?.trim() || '0000000000',
    models: (env.AI_HORDE_MODELS ?? '').split(',').map((m) => m.trim()).filter(Boolean),
    width: size ? round64(Number(size[1])) : 768,
    height: size ? round64(Number(size[2])) : 512,
    steps: int(env.AI_HORDE_STEPS, 25, 5, 50),
    maxWaitMs: int(env.AI_HORDE_MAX_WAIT_SECONDS, 90, 20, 240) * 1000,
  };
}

/** Hugging Face Inference Providers (crédito gratuito mensual pequeño con cuenta gratuita; SIN verificar). Solo genera. */
export interface HuggingFaceConfig {
  token: string;
  model: string;
}
export function huggingFaceConfig(env: NodeJS.ProcessEnv = process.env): HuggingFaceConfig | null {
  const token = (env.HF_TOKEN ?? env.HUGGINGFACE_API_KEY)?.trim();
  if (!token) return null;
  return { token, model: env.HF_IMAGE_MODEL?.trim() || 'black-forest-labs/FLUX.1-schnell' };
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
    /** true si el propietario fijó POLLINATIONS_IMAGE_SIZE: entonces no se adapta a la proporción de la casa al editar. */
    sizeFixed: Boolean(size && /^\d{3,4}x\d{3,4}$/.test(size)),
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
    else if (w === 'aihorde' && !out.includes('aihorde')) out.push('aihorde'); // sin credencial: solo por petición explícita
    else if (w === 'huggingface' && huggingFaceConfig(env) && !out.includes('huggingface')) out.push('huggingface');
    else if (w === 'openai' && openAiKey(env) && wanted.length === 1) out.push('openai');
  }
  return out;
}

/**
 * Servidores (lista blanca) de los que se aceptan fotos para las plantillas del sistema: ASSET_CDN_HOSTS=cdn.midominio.com,otro.cdn.com
 * Vacía = se acepta cualquier https (las defensas de safe-fetch siguen aplicando); el panel avisa de que conviene definirla.
 */
export function assetCdnHosts(env: NodeJS.ProcessEnv = process.env): string[] {
  const hosts = (env.ASSET_CDN_HOSTS ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  // Con la subida a GitHub configurada, jsDelivr (donde se sirven esas fotos) se admite aunque no esté en la lista.
  if (hosts.length > 0 && githubAssetsConfig(env) && !hosts.includes('cdn.jsdelivr.net')) hosts.push('cdn.jsdelivr.net');
  return hosts;
}

/** Subida de fotos de plantillas a un repositorio de GitHub (servido por jsDelivr). Sin las tres variables, la subida no existe. */
export function githubAssetsConfig(env: NodeJS.ProcessEnv = process.env): { repo: string; token: string; branch: string; apiBase: string } | null {
  const repo = env.GITHUB_ASSETS_REPO?.trim();
  const token = env.GITHUB_ASSETS_TOKEN?.trim();
  if (!repo || !token) return null;
  // GITHUB_ASSETS_API_BASE solo existe para las pruebas (un servidor local simulado); cualquier otro valor se ignora.
  const base = env.GITHUB_ASSETS_API_BASE?.trim();
  const apiBase = base && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base) ? base : 'https://api.github.com';
  return { repo, token, branch: env.GITHUB_ASSETS_BRANCH?.trim() || 'main', apiBase };
}

export function urlAllowedByCdn(url: string, hosts: string[] = assetCdnHosts()): boolean {
  if (hosts.length === 0) return /^https:\/\//i.test(url);
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && hosts.includes(u.hostname.toLowerCase()) && !u.username && !u.password;
  } catch {
    return false;
  }
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
