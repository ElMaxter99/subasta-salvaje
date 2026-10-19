import path from 'node:path';
import { createSettingsGate } from './ai-gate';
import { createProviderChain } from '@/lib/ai/chain';
import { cloudflareConfig, aiHordeConfig, getImageProviderIds, huggingFaceConfig, pollinationsConfig, type ImageProviderId, getRuntimeMode, getSupabaseConfig, openAiKey } from '@/lib/config/env';
import { createCloudflareProvider } from '@/lib/ai/cloudflare';
import { withEditFallback } from '@/lib/ai/compose';
import { createDemoProvider } from '@/lib/ai/demo';
import { createOpenAiProvider } from '@/lib/ai/openai';
import { createAiHordeProvider } from '@/lib/ai/aihorde';
import { createHuggingFaceProvider } from '@/lib/ai/huggingface';
import { createPollinationsProvider } from '@/lib/ai/pollinations';
import type { ImageGenerationProvider } from '@/lib/ai/types';
import { createSupabaseDb } from '@/lib/db/supabase';
import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { createSupabasePublisher, noopPublisher, type Publisher } from '@/lib/realtime/publish';
import { createLocalStorage } from '@/lib/storage/local';
import { createSupabaseStorage } from '@/lib/storage/supabase';
import type { ImageStorage } from '@/lib/storage/types';
import type { RuntimeInfo } from '@/lib/domain/types';

export interface AppContext {
  mode: 'supabase' | 'demo';
  db: Db;
  storage: ImageStorage;
  publisher: Publisher;
  /** Proveedor de IA REAL para el modo «ai» (null = no configurado: esos trabajos quedan en cola, nada se simula). */
  provider: ImageGenerationProvider | null;
  /** Modo «stickers»: pegatinas con emojis, locales y sin IA. Siempre disponible. Si falta (tests) se usa `provider`. */
  stickers?: ImageGenerationProvider;
}

export const demoDataDir = () => process.env.DEMO_DATA_DIR || path.join(/* turbopackIgnore: true */ process.cwd(), '.demo-data');

const g = globalThis as unknown as { __ssCtx?: Promise<AppContext> };

function buildOne(id: ImageProviderId): ImageGenerationProvider {
  if (id === 'openai') {
    const e = process.env;
    return { ...createOpenAiProvider({
      apiKey: openAiKey()!,
      baseUrl: e.OPENAI_BASE_URL || undefined,
      model: e.OPENAI_IMAGE_MODEL || undefined,
      size: e.OPENAI_IMAGE_SIZE || undefined,
      quality: e.OPENAI_IMAGE_QUALITY || undefined,
      inputFidelity: (e.OPENAI_IMAGE_INPUT_FIDELITY as 'high' | 'low' | 'off' | undefined) || undefined,
    }), realEdit: true };
  }
  if (id === 'pollinations') { const inner = createPollinationsProvider(pollinationsConfig()!); return { ...withEditFallback(inner), realEdit: inner.capabilities.edit }; }
  // Solo generan: la «edición» de la imagen pasa por composición (gratis, con el objeto generado por el siguiente proveedor disponible).
  if (id === 'aihorde') return { ...withEditFallback(createAiHordeProvider(aiHordeConfig())), realEdit: false };
  if (id === 'huggingface') return { ...withEditFallback(createHuggingFaceProvider(huggingFaceConfig()!)), realEdit: false };
  const cf = createCloudflareProvider(cloudflareConfig()!);
  // Edición real con foto de referencia (FLUX.2 klein). Si el modelo la rechaza, o no hay modelo de edición,
  // se usa la composición (gratis, misma cuota). IMAGE_EDIT_COMPOSE=false desactiva ese plan B.
  return { ...(/^(0|false|no)$/i.test(process.env.IMAGE_EDIT_COMPOSE?.trim() ?? '') ? cf : withEditFallback(cf)), realEdit: cf.capabilities.edit };
}

function buildProvider(db?: Db): ImageGenerationProvider | null {
  const ids = getImageProviderIds();
  if (ids.length === 0) return null;
  // Con un solo proveedor la cadena devuelve ese mismo proveedor (sin cambios de comportamiento).
  return createProviderChain(ids.map(buildOne), { ...(db ? { gate: createSettingsGate(db) } : {}), onSkip: (s) => console.warn(`[ai-chain] salto de ${s.provider} (${s.kind})`) });
}

async function build(): Promise<AppContext> {
  const mode = getRuntimeMode();
  if (mode === 'unconfigured') throw new DomainError('internal', 'La aplicación no está configurada. Visita /setup.');
  if (mode === 'supabase') {
    const db = createSupabaseDb();
    return { mode, db, storage: createSupabaseStorage(), publisher: createSupabasePublisher(), provider: buildProvider(db), stickers: createDemoProvider() };
  }
  // PGlite (Postgres WASM) solo se carga en modo demo: en producción no está ni desplegado (ahorra 27 MB por función).
  const { createPgliteDb } = await import('@/lib/db/pglite');
  const db = await createPgliteDb(path.join(demoDataDir(), 'pgdata'));
  return { mode, db, storage: createLocalStorage(path.join(demoDataDir(), 'images')), publisher: noopPublisher, provider: buildProvider(db), stickers: createDemoProvider() };
}

/** Contexto singleton por proceso (se reutiliza entre peticiones y recargas en desarrollo). */
export function getContext(): Promise<AppContext> {
  g.__ssCtx ??= build().catch((e) => {
    g.__ssCtx = undefined;
    throw e;
  });
  return g.__ssCtx;
}

export function getRuntimeInfo(ctx?: Pick<AppContext, 'mode' | 'provider'>): RuntimeInfo {
  const mode = getRuntimeMode();
  const provider = ctx ? ctx.provider : buildProvider();
  const m = mode === 'supabase' ? 'supabase' : 'demo';
  return {
    mode: m,
    aiConfigured: provider !== null,
    aiProvider: provider?.id ?? 'demo',
    aiCanEdit: provider?.capabilities.edit ?? false,
    ...(m === 'supabase' ? { supabaseUrl: getSupabaseConfig().url, supabaseAnonKey: getSupabaseConfig().anonKey } : {}),
  };
}
