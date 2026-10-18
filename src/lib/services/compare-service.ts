import { z } from 'zod';
import { createSettingsGate } from './ai-gate';
import { editWithGuard, finalizeProviderImage } from '@/lib/ai/edit-pipeline';
import { validateImage } from '@/lib/ai/image-validation';
import { ProviderError, type ImageGenerationProvider } from '@/lib/ai/types';
import { getImageProviderIds } from '@/lib/config/env';
import { DomainError } from '@/lib/domain/errors';
import { normalizeImage } from '@/lib/images/normalize';
import { redactSecrets } from '@/lib/security/redact';
import { fetchImageBytes } from '@/lib/security/safe-fetch';
import { isHostedImage } from '@/lib/storage/hosted';
import type { AppContext } from './context';
import { effectiveQuota, getSettings } from './settings';

/**
 * Comparador de modelos de IA (solo superadmin): la misma edición (imagen base + 1 o 2 elementos) con varios proveedores a la vez, para
 * ver los resultados lado a lado. Usa la MISMA tubería que una compra real (`edit-pipeline`: prompt, tamaños, guardia de zona) y los
 * mismos ajustes (apagado y tope diario por proveedor). Cada llamada real cuenta en la cuota diaria global y se devuelve si falla.
 * NADA se guarda: los resultados viajan como data URL al navegador. Nunca se simula un resultado.
 */
export const MAX_COMPARE_PROVIDERS = 4;
export const COMPARE_TIMEOUT_MS = 55_000;
export const COMPARE_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
/** Solo proveedores gratuitos de la cadena: ni `demo` (pegatinas, sin IA) ni `openai` (de pago, descartado). */
const COMPARABLE = ['cloudflare', 'pollinations', 'aihorde', 'huggingface'] as const;

type Ctx = Pick<AppContext, 'db' | 'provider'>;

export const compareMetaSchema = z.object({
  providers: z.array(z.enum(COMPARABLE)).min(1, 'Marca al menos un proveedor.').max(MAX_COMPARE_PROVIDERS, `Máximo ${MAX_COMPARE_PROVIDERS} proveedores por comparación.`),
  theme: z.string().trim().max(60).default(''),
  items: z.array(z.object({ name: z.string().trim().min(1, 'Falta el nombre del elemento.').max(80), description: z.string().trim().max(200).default('') })).min(1).max(2),
  /** Biblioteca: id de imagen (nunca una URL). `null` = viene como archivo subido. */
  baseLibraryId: z.string().uuid().nullish(),
  itemLibraryIds: z.array(z.string().uuid().nullable()).max(2).default([]),
});
export type CompareMetaInput = z.input<typeof compareMetaSchema>;

export interface CompareResult {
  provider: string;
  ok: boolean;
  model: string | null;
  /** Semilla y recorrido por la cadena (`notes` del proveedor). */
  notes: string | null;
  ms: number;
  /** Imagen resultante como data URL (no se guarda en ningún sitio). */
  dataUrl: string | null;
  /** Prompt enviado en cada paso (uno por elemento): útil para depurar. */
  prompts: string[];
  /** ¿Edita de verdad con imagen de referencia o es composición (collage)? */
  realEdit: boolean;
  error: string | null;
}

export interface CompareInput {
  base: Uint8Array;
  items: { name: string; description?: string; bytes: Uint8Array }[];
  theme: string;
  providers: readonly string[];
}

export interface CompareOptions {
  /** Ids configurados en la cadena (por defecto `IMAGE_PROVIDERS`). */
  configured?: readonly string[];
  timeoutMs?: number;
}

/** Proveedores que se pueden comparar ahora: los de la cadena, gratuitos y reales. */
export function comparableProviders(configured: readonly string[] = getImageProviderIds()): string[] {
  return configured.filter((id) => (COMPARABLE as readonly string[]).includes(id));
}

function resolveProvider(chain: ImageGenerationProvider, id: string): ImageGenerationProvider | null {
  return chain.only?.(id) ?? (chain.id === id ? chain : null);
}

async function prepare(bytes: Uint8Array, kind: 'scene' | 'item', what: string): Promise<Uint8Array> {
  try {
    validateImage(bytes, { maxBytes: COMPARE_UPLOAD_MAX_BYTES });
    return (await normalizeImage(bytes, kind)).bytes;
  } catch (e) {
    throw new DomainError('invalid_input', `${what}: ${e instanceof Error ? e.message : 'imagen no válida'}`);
  }
}

/** Lee una imagen de la biblioteca por id (solo enlaces de NUESTRO repositorio de fotos; nunca una URL que escriba la persona). */
export async function readLibraryImage(ctx: Pick<AppContext, 'db'>, id: string): Promise<Uint8Array> {
  const img = await ctx.db.rpc<{ url: string }>('ss_admin_library_image_get', { id });
  if (!isHostedImage(img.url)) throw new DomainError('invalid_input', 'Esa imagen de la biblioteca no está alojada en el repositorio de fotos.');
  try {
    return await fetchImageBytes(img.url);
  } catch (e) {
    throw new DomainError('invalid_input', `No se pudo leer la imagen de la biblioteca: ${e instanceof Error ? e.message : 'error de red'}`, 502);
  }
}

const withTimeout = <T>(work: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new ProviderError(`Tiempo agotado (${Math.round(ms / 1000)} s) esperando al proveedor.`, true, true, 'network')), ms);
    work.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });

/** Lanza la comparación. Nunca rechaza por un proveedor: cada resultado trae su `error` explicado. El orden de salida es el pedido. */
export async function compareModels(ctx: Ctx, actor: string, input: CompareInput, opts: CompareOptions = {}): Promise<{ results: CompareResult[] }> {
  const providers = [...new Set(input.providers)];
  if (providers.length === 0) throw new DomainError('invalid_input', 'Marca al menos un proveedor.');
  if (providers.length > MAX_COMPARE_PROVIDERS) throw new DomainError('invalid_input', `Máximo ${MAX_COMPARE_PROVIDERS} proveedores por comparación.`);
  if (input.items.length < 1 || input.items.length > 2) throw new DomainError('invalid_input', 'Añade uno o dos elementos.');
  const settings = await getSettings(ctx.db);
  const available = comparableProviders(opts.configured);
  if (!ctx.provider || available.length === 0 || !settings.ai_enabled) {
    throw new DomainError('ai_not_available', !settings.ai_enabled
      ? 'La IA está apagada en los ajustes del superadmin: no hay nada que comparar.'
      : 'No hay ningún proveedor de IA real configurado (IMAGE_PROVIDERS y credenciales). Nada se simula: configura al menos uno para comparar.');
  }
  const unknown = providers.filter((p) => !available.includes(p));
  if (unknown.length) throw new DomainError('invalid_input', `Proveedor no configurado en la cadena: ${unknown.join(', ')}.`);

  const chain = ctx.provider;
  const gate = createSettingsGate(ctx.db);
  const dayLimit = effectiveQuota(settings).perDay;
  const timeoutMs = opts.timeoutMs ?? COMPARE_TIMEOUT_MS;
  const base = await prepare(input.base, 'scene', 'Imagen base');
  const items = await Promise.all(input.items.map(async (it, i) => ({ ...it, bytes: await prepare(it.bytes, 'item', `Elemento ${i + 1}`) })));

  async function runOne(id: string): Promise<CompareResult> {
    const t0 = Date.now();
    const out: CompareResult = { provider: id, ok: false, model: null, notes: null, ms: 0, dataUrl: null, prompts: [], realEdit: false, error: null };
    const deadline = t0 + timeoutMs;
    try {
      const provider = resolveProvider(chain, id);
      if (!provider) throw new ProviderError(`El proveedor ${id} no está disponible en la cadena (faltan credenciales).`, false, false, 'unsupported');
      out.realEdit = provider.realEdit ?? provider.capabilities.edit;
      const g = await gate(id);
      if (!g.ok) throw new ProviderError(g.reason === 'disabled' ? `El proveedor ${id} está apagado por el superadmin (Ajustes). No se ha gastado nada.` : `El proveedor ${id} ha alcanzado su tope diario (Ajustes). No se ha gastado nada; se renueva a las 00:00 UTC.`, false, false, 'quota');
      let current: { bytes: Uint8Array; mime: string } = { bytes: base, mime: 'image/webp' };
      const previous: string[] = [];
      for (const [i, it] of items.entries()) {
        // Cada llamada real cuenta en la cuota diaria global (la misma que las partidas) y se devuelve si falla.
        const q = await ctx.db.rpc<{ ok: boolean; used?: number; limit?: number }>('ss_reserve_admin_image_quota', { provider: id, day_limit: dayLimit });
        if (!q.ok) throw new ProviderError(`Cuota diaria de generaciones alcanzada (${q.used}/${q.limit}); se renueva a las 00:00 UTC.`, false, false, 'quota');
        let timedOut = false;
        try {
          const left = deadline - Date.now();
          if (left <= 0) throw new ProviderError('Tiempo agotado antes de lanzar el siguiente paso.', true, true, 'network');
          const edited = await withTimeout(
            editWithGuard(provider, { base: current, itemImage: { bytes: it.bytes, mime: 'image/webp' }, theme: input.theme || 'free', itemName: it.name, itemDescription: it.description ?? '', itemEmoji: null, previousItems: [...previous] }),
            left,
          ).catch((e) => { timedOut = e instanceof ProviderError && e.message.startsWith('Tiempo agotado'); throw e; });
          const fin = await finalizeProviderImage(edited, 'scene', false);
          out.prompts.push(edited.prompt);
          out.model = edited.model;
          out.notes = [out.notes, items.length > 1 ? `paso ${i + 1}: ${edited.notes ?? '—'}` : edited.notes].filter(Boolean).join(' | ') || null;
          current = { bytes: fin.image.bytes, mime: fin.mime };
          previous.push(it.name);
        } catch (e) {
          // Si falla se devuelve la unidad reservada. Con tiempo agotado no se sabe si el proveedor llegó a gastarla: se deja contada.
          if (!timedOut) await ctx.db.rpc('ss_release_admin_image_quota', { provider: id }).catch(() => undefined);
          throw e;
        }
      }
      out.dataUrl = `data:${current.mime};base64,${Buffer.from(current.bytes).toString('base64')}`;
      out.ok = true;
    } catch (e) {
      out.error = redactSecrets(e instanceof Error ? e.message : String(e)).slice(0, 900);
    }
    out.ms = Date.now() - t0;
    return out;
  }

  const results = await Promise.all(providers.map(runOne)); // en paralelo; runOne nunca rechaza
  // Anotación en el historial de auditoría: quién, qué proveedores y cómo salió (sin imágenes ni prompts).
  await ctx.db.rpc('ss_admin_log', {
    actor, action: 'ai_compare', target_type: 'ai', target_id: 'compare',
    payload: { providers, ok: results.filter((r) => r.ok).map((r) => r.provider), failed: results.filter((r) => !r.ok).map((r) => r.provider), items: items.length, theme: input.theme.slice(0, 60) },
  }).catch((e) => console.error('[compare] no se pudo anotar la auditoría', redactSecrets(String(e))));
  return { results };
}
