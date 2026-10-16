import { buildEditPrompt, buildInitialScenePrompt, buildItemImagePrompt } from './prompts';
import {
  ProviderError,
  type EditSceneInput,
  type GeneratedImage,
  type ImageGenerationProvider,
  type InitialSceneInput,
  type ItemImageInput,
} from './types';

export interface OpenAiProviderConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  size?: string;
  quality?: string;
  inputFidelity?: 'high' | 'low' | 'off';
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Proveedor real: API de imágenes de OpenAI (`gpt-image-1`).
 *  - /v1/images/generations -> escena inicial e imágenes de elementos
 *  - /v1/images/edits       -> edición con imagen de referencia (input_fidelity=high para conservar detalles)
 */
export function createOpenAiProvider(cfg: OpenAiProviderConfig): ImageGenerationProvider {
  const base = (cfg.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = cfg.model ?? 'gpt-image-1';
  const size = cfg.size ?? '1536x1024';
  const quality = cfg.quality ?? 'medium';
  const fidelity = cfg.inputFidelity ?? 'high';
  const timeout = cfg.timeoutMs ?? 170_000;
  const doFetch = cfg.fetchImpl ?? fetch;

  async function call(path: string, init: RequestInit): Promise<Uint8Array> {
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${cfg.apiKey}`, ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(timeout),
      });
    } catch (e) {
      throw new ProviderError(`No se pudo contactar con OpenAI: ${(e as Error).message}`, true);
    }
    const text = await res.text();
    if (!res.ok) {
      let detail = text.slice(0, 300);
      let code = '';
      try {
        const j = JSON.parse(text) as { error?: { message?: string; code?: string } };
        detail = j.error?.message ?? detail;
        code = j.error?.code ?? '';
      } catch {
        /* texto plano */
      }
      const retryable = res.status === 429 || res.status >= 500 || res.status === 408;
      const moderation = code === 'moderation_blocked' || /safety system/i.test(detail);
      throw new ProviderError(`OpenAI ${res.status}${code ? ` (${code})` : ''}: ${detail}`, retryable && !moderation);
    }
    let json: { data?: { b64_json?: string }[] };
    try {
      json = JSON.parse(text);
    } catch {
      throw new ProviderError('Respuesta de OpenAI no válida (no es JSON)', true);
    }
    const b64 = json.data?.[0]?.b64_json;
    if (!b64) throw new ProviderError('OpenAI no devolvió ninguna imagen', true);
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }

  async function generate(prompt: string): Promise<GeneratedImage> {
    const bytes = await call('/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, size, quality, n: 1, output_format: 'png' }),
    });
    return { bytes, mime: 'image/png', prompt, model };
  }

  return {
    id: 'openai',
    capabilities: { edit: true },
    generateInitialScene: (input: InitialSceneInput) => generate(buildInitialScenePrompt(input)),
    generateItemImage: (input: ItemImageInput) => generate(buildItemImagePrompt(input)),
    async editScene(input: EditSceneInput): Promise<GeneratedImage> {
      const prompt = buildEditPrompt(input);
      const form = new FormData();
      form.set('model', model);
      form.set('prompt', prompt);
      form.set('size', size);
      form.set('quality', quality);
      form.set('n', '1');
      form.set('output_format', 'png');
      if (fidelity !== 'off') form.set('input_fidelity', fidelity);
      const ext = input.base.mime === 'image/jpeg' ? 'jpg' : input.base.mime === 'image/webp' ? 'webp' : 'png';
      form.set('image', new Blob([input.base.bytes as BlobPart], { type: input.base.mime }), `scene.${ext}`);
      const bytes = await call('/images/edits', { method: 'POST', body: form });
      return { bytes, mime: 'image/png', prompt, model };
    },
  };
}
