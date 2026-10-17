import type { PollinationsConfig } from '@/lib/config/env';
import { redactSecrets } from '@/lib/security/redact';
import { toReferencePng } from './reference';
import { buildEditPrompt, buildInitialScenePrompt, buildItemImagePrompt } from './prompts';
import { ProviderError, type EditSceneInput, type GeneratedImage, type ImageGenerationProvider, type InitialSceneInput, type ItemImageInput } from './types';

/**
 * Proveedor Pollinations (API OpenAI-compatible en https://gen.pollinations.ai).
 * Según su documentación oficial (APIDOCS.md del repositorio pollinations/pollinations):
 *  - `POST /v1/images/generations` (JSON: prompt, model, size, response_format) y `POST /v1/images/edits` (multipart: image, prompt, model, size);
 *  - autenticación `Authorization: Bearer <clave sk_…>`; 401 = clave inválida, 402 = presupuesto de la cuenta agotado, 429/503 con `Retry-After`;
 *  - `flux.2-klein-4b` admite varias imágenes de referencia en la edición.
 * SIN PROBAR contra el servicio real: el formato exacto de la respuesta se asume OpenAI (`data[0].b64_json`) porque la
 * documentación consultada lo recortaba; los límites gratuitos y los términos de uso NO están verificados.
 * Las respuestas con solo URL no se descargan (evita SSRF): se tratan como error.
 */
const BASE = 'https://gen.pollinations.ai';
const MAX_PROMPT = 2000;
const REF_MAX_SIDE = 1024;

export interface PollinationsProviderOptions extends PollinationsConfig {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  baseUrl?: string;
}

export function createPollinationsProvider(cfg: PollinationsProviderOptions): ImageGenerationProvider {
  const doFetch = cfg.fetchImpl ?? fetch;
  const timeout = cfg.timeoutMs ?? 90_000;
  const base = cfg.baseUrl ?? BASE;

  async function call(path: string, init: { json?: unknown; form?: FormData }): Promise<Uint8Array> {
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.apiKey}`, ...(init.json ? { 'Content-Type': 'application/json' } : {}) },
        body: init.form ?? JSON.stringify(init.json),
        signal: AbortSignal.timeout(timeout),
      });
    } catch (e) {
      throw new ProviderError(`No se pudo contactar con Pollinations: ${redactSecrets((e as Error).message)}`, true, false, 'network');
    }
    const text = await res.text();
    if (!res.ok) {
      const detail = redactSecrets(text.slice(0, 300));
      if (res.status === 401 || res.status === 403) throw new ProviderError(`Pollinations ${res.status}: ${detail}. Revisa POLLINATIONS_API_KEY.`, false, false, 'auth');
      if (res.status === 402) throw new ProviderError(`Pollinations: presupuesto de la cuenta agotado (${detail}). Se conserva la imagen anterior; no se añade ningún pago.`, false, false, 'quota');
      if (res.status === 429) throw new ProviderError(`Pollinations 429: límite de ritmo (${detail})`, true, false, 'rate_limit');
      if (res.status >= 500 || res.status === 408) throw new ProviderError(`Pollinations ${res.status}: ${detail}`, true, true, 'server');
      throw new ProviderError(`Pollinations ${res.status}: ${detail}`, false, false, /safety|moderat|content/i.test(detail) ? 'moderation' : 'input');
    }
    let json: { data?: { b64_json?: string; url?: string }[] } | null = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* no es JSON */
    }
    const b64 = json?.data?.[0]?.b64_json;
    if (!b64 || typeof b64 !== 'string') {
      throw new ProviderError(json?.data?.[0]?.url ? 'Pollinations devolvió una URL en lugar de la imagen (no se descarga por seguridad)' : 'Pollinations no devolvió ninguna imagen', true, true, 'server');
    }
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }

  async function generate(prompt: string): Promise<GeneratedImage> {
    const text = prompt.slice(0, MAX_PROMPT);
    const bytes = await call('/v1/images/generations', { json: { prompt: text, model: cfg.model, size: cfg.size, response_format: 'b64_json' } });
    return { bytes, mime: 'image/png', prompt: text, model: cfg.model };
  }

  return {
    id: 'pollinations',
    capabilities: { edit: Boolean(cfg.editModel) },
    generateInitialScene: (input: InitialSceneInput) => generate(buildInitialScenePrompt(input)),
    generateItemImage: (input: ItemImageInput) => generate(buildItemImagePrompt(input)),
    async editScene(input: EditSceneInput): Promise<GeneratedImage> {
      if (!cfg.editModel) {
        throw new ProviderError('Pollinations no tiene modelo de edición configurado (POLLINATIONS_EDIT_MODEL). Se conserva la imagen anterior.', false, false, 'unsupported');
      }
      const prompt = (input.itemImage ? buildEditPrompt(input) : `Image 0 is the existing scene. ${buildEditPrompt(input)}`).slice(0, MAX_PROMPT);
      const form = new FormData();
      form.set('prompt', prompt);
      form.set('model', cfg.editModel);
      form.set('size', cfg.size);
      form.set('response_format', 'b64_json');
      form.append('image', new Blob([(await toReferencePng(input.base, REF_MAX_SIDE)) as BlobPart], { type: 'image/png' }), 'scene.png');
      if (input.itemImage) form.append('image', new Blob([(await toReferencePng(input.itemImage, REF_MAX_SIDE)) as BlobPart], { type: 'image/png' }), 'item.png');
      const bytes = await call('/v1/images/edits', { form });
      return { bytes, mime: 'image/png', prompt, model: cfg.editModel };
    },
  };
}
