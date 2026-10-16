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

export function getImageProviderId(env: NodeJS.ProcessEnv = process.env): 'openai' | 'demo' | null {
  if (openAiKey(env)) return 'openai';
  return getRuntimeMode(env) === 'demo' ? 'demo' : null;
}

export function getSupabaseConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    url: env.NEXT_PUBLIC_SUPABASE_URL!.trim().replace(/\/$/, ''),
    anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim(),
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY!.trim(),
    bucket: env.SUPABASE_STORAGE_BUCKET?.trim() || 'game-images',
  };
}
