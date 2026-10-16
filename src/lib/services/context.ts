import path from 'node:path';
import { cloudflareConfig, getImageProviderId, getRuntimeMode, getSupabaseConfig, openAiKey } from '@/lib/config/env';
import { createCloudflareProvider } from '@/lib/ai/cloudflare';
import { createDemoProvider } from '@/lib/ai/demo';
import { createOpenAiProvider } from '@/lib/ai/openai';
import type { ImageGenerationProvider } from '@/lib/ai/types';
import { createPgliteDb } from '@/lib/db/pglite';
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

export const demoDataDir = () => process.env.DEMO_DATA_DIR || path.join(process.cwd(), '.demo-data');

const g = globalThis as unknown as { __ssCtx?: Promise<AppContext> };

function buildProvider(): ImageGenerationProvider | null {
  const id = getImageProviderId();
  if (id === 'openai') {
    const e = process.env;
    return createOpenAiProvider({
      apiKey: openAiKey()!,
      baseUrl: e.OPENAI_BASE_URL || undefined,
      model: e.OPENAI_IMAGE_MODEL || undefined,
      size: e.OPENAI_IMAGE_SIZE || undefined,
      quality: e.OPENAI_IMAGE_QUALITY || undefined,
      inputFidelity: (e.OPENAI_IMAGE_INPUT_FIDELITY as 'high' | 'low' | 'off' | undefined) || undefined,
    });
  }
  if (id === 'cloudflare') return createCloudflareProvider(cloudflareConfig()!);
  return null;
}

async function build(): Promise<AppContext> {
  const mode = getRuntimeMode();
  if (mode === 'unconfigured') throw new DomainError('internal', 'La aplicación no está configurada. Visita /setup.');
  if (mode === 'supabase') {
    return { mode, db: createSupabaseDb(), storage: createSupabaseStorage(), publisher: createSupabasePublisher(), provider: buildProvider(), stickers: createDemoProvider() };
  }
  const db = await createPgliteDb(path.join(demoDataDir(), 'pgdata'));
  return { mode, db, storage: createLocalStorage(path.join(demoDataDir(), 'images')), publisher: noopPublisher, provider: buildProvider(), stickers: createDemoProvider() };
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
