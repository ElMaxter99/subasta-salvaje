import { newSeed } from './seed';
import type { HuggingFaceConfig } from '@/lib/config/env';
import { redactSecrets } from '@/lib/security/redact';
import { buildInitialScenePrompt, buildItemImagePrompt } from './prompts';
import { ProviderError, type EditSceneInput, type GeneratedImage, type ImageGenerationProvider, type InitialSceneInput, type ItemImageInput } from './types';

/**
 * Proveedor Hugging Face Inference Providers: POST https://router.huggingface.co/hf-inference/models/{modelo} con
 * `Authorization: Bearer hf_…` y `{ "inputs": prompt }`; responde con los BYTES de la imagen. Cuenta gratuita = crédito mensual
 * pequeño (cifra sin verificar): sirve de respaldo marginal. 402 = crédito agotado; 503 = el modelo se está cargando.
 * SIN PROBAR contra el servicio real. Solo GENERA (la edición pasa por composición).
 */
const BASE = 'https://router.huggingface.co/hf-inference/models';
const MAX_PROMPT = 1500;

export interface HuggingFaceProviderOptions extends HuggingFaceConfig {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  baseUrl?: string;
}

export function createHuggingFaceProvider(cfg: HuggingFaceProviderOptions): ImageGenerationProvider {
  const doFetch = cfg.fetchImpl ?? fetch;
  const base = cfg.baseUrl ?? BASE;

  /** Modelos configurados en orden (HF_IMAGE_MODEL admite varios separados por comas). */
  const models = cfg.model.split(',').map((m) => m.trim()).filter(Boolean);
  /** Modelos que el servicio ya ha dado por retirados (404/410): no se vuelven a pedir mientras viva este proceso. */
  const retired = new Set<string>();

  /** Una petición a UN modelo. `retiredModel` = el modelo ya no existe en hf-inference (hay que probar el siguiente). */
  async function attempt(model: string, text: string, seed: number): Promise<GeneratedImage | { retiredModel: string }> {
    let res: Response;
    try {
      res = await doFetch(`${base}/${model}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json', Accept: 'image/*' },
        body: JSON.stringify({ inputs: text, parameters: { seed } }),
        signal: AbortSignal.timeout(cfg.timeoutMs ?? 90_000),
      });
    } catch (e) {
      throw new ProviderError(`No se pudo contactar con Hugging Face: ${redactSecrets((e as Error).message)}`, true, false, 'network');
    }
    const contentType = res.headers.get('content-type') ?? '';
    if (res.ok && contentType.startsWith('image/')) {
      return { bytes: new Uint8Array(await res.arrayBuffer()), mime: contentType.split(';')[0]!, prompt: text, model, notes: `semilla ${seed}` };
    }
    const body = redactSecrets((await res.text().catch(() => '')).slice(0, 300));
    if (res.ok) throw new ProviderError('Hugging Face no devolvió una imagen', true, true, 'server');
    // 404/410: el modelo ya no se sirve (p. ej. «deprecated and no longer supported by provider hf-inference»). No es un fallo de la petición.
    if (res.status === 404 || res.status === 410) return { retiredModel: `${model} (${res.status}: ${body.slice(0, 160)})` };
    if (res.status === 401 || res.status === 403) throw new ProviderError(`Hugging Face ${res.status}: ${body}. Revisa HF_TOKEN (token con permiso para Inference Providers).`, false, false, 'auth');
    if (res.status === 402) throw new ProviderError(`Hugging Face: crédito gratuito agotado (${body}). Se conserva la imagen anterior; esta app no añade ningún pago.`, false, false, 'quota');
    if (res.status === 429) throw new ProviderError(`Hugging Face 429: límite de ritmo (${body})`, true, false, 'rate_limit');
    if (res.status === 503) throw new ProviderError(`Hugging Face 503: el modelo se está cargando o no está disponible (${body})`, true, false, 'server');
    if (res.status >= 500 || res.status === 408) throw new ProviderError(`Hugging Face ${res.status}: ${body}`, true, true, 'server');
    throw new ProviderError(`Hugging Face ${res.status}: ${body}`, false, false, /safety|nsfw|content/i.test(body) ? 'moderation' : 'input');
  }

  async function generate(prompt: string): Promise<GeneratedImage> {
    const text = prompt.slice(0, MAX_PROMPT);
    const seed = newSeed();
    const dead: string[] = [];
    for (const model of models) {
      if (retired.has(model)) { dead.push(`${model} (retirado)`); continue; }
      const r = await attempt(model, text, seed);
      if ('retiredModel' in r) { retired.add(model); dead.push(r.retiredModel); continue; }
      return r;
    }
    // Ningún modelo disponible: se salta al siguiente proveedor de la cadena (no es un error de la petición ni de la cuota).
    throw new ProviderError(
      `Hugging Face: ${dead.length ? `modelo retirado o inexistente en hf-inference: ${dead.join('; ')}` : 'no hay ningún modelo configurado'}. Define HF_IMAGE_MODEL con uno vigente (varios separados por comas); lista: huggingface.co/models?inference_provider=hf-inference&pipeline_tag=text-to-image.`,
      false,
      false,
      'unsupported',
    );
  }

  return {
    id: 'huggingface',
    capabilities: { edit: false },
    generateInitialScene: (input: InitialSceneInput) => generate(buildInitialScenePrompt(input)),
    generateItemImage: (input: ItemImageInput) => generate(buildItemImagePrompt(input)),
    async editScene(input: EditSceneInput): Promise<GeneratedImage> {
      void input;
      throw new ProviderError('Hugging Face solo genera imágenes nuevas y no edita la imagen existente (la edición pasa por composición).', false, false, 'unsupported');
    },
  };
}
