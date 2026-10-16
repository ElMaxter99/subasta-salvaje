import type { CloudflareConfig } from '@/lib/config/env';
import { buildEditPrompt, buildInitialScenePrompt, buildItemImagePrompt } from './prompts';
import { ProviderError, type EditSceneInput, type GeneratedImage, type ImageGenerationProvider, type InitialSceneInput, type ItemImageInput } from './types';

/**
 * Proveedor Cloudflare Workers AI (API REST: POST /client/v4/accounts/{id}/ai/run/{modelo}).
 *
 * Verificado en la documentación oficial (ver README, «Cloudflare Workers AI»):
 *  - `@cf/black-forest-labs/flux-1-schnell`: SÓLO texto→imagen. Entrada `prompt` (1–2048 caracteres) y `steps`
 *    (1–8, por defecto 4). Respuesta: imagen en base64 en el campo `image`. NO admite imagen de referencia: no edita.
 *  - `@cf/black-forest-labs/flux-2-klein-4b` (u otro FLUX.2 klein): admite edición multi-referencia. Entrada
 *    multipart/form-data con `prompt`, `width`, `height` e `input_image_0..3` (cada entrada < 512×512);
 *    4 pasos fijos; respuesta con la imagen en base64.
 * La edición sólo se activa si defines CLOUDFLARE_EDIT_MODEL. Sin él, `editScene` falla con un error claro y no
 * reintentable: la imagen anterior se conserva y la partida sigue.
 */
const MAX_PROMPT = 2048;
const REF_MAX_SIDE = 480; // las imágenes de referencia deben ser menores que 512×512

export interface CloudflareProviderOptions extends CloudflareConfig {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Redimensiona la imagen base (inyectable en tests). */
  resizeForReference?: (bytes: Uint8Array) => Promise<Uint8Array>;
}

async function defaultResize(bytes: Uint8Array): Promise<Uint8Array> {
  const { default: sharp } = await import('sharp');
  const out = await sharp(Buffer.from(bytes)).resize({ width: REF_MAX_SIDE, height: REF_MAX_SIDE, fit: 'inside' }).png().toBuffer();
  return new Uint8Array(out);
}

export function createCloudflareProvider(cfg: CloudflareProviderOptions): ImageGenerationProvider {
  const doFetch = cfg.fetchImpl ?? fetch;
  const timeout = cfg.timeoutMs ?? 120_000;
  const resize = cfg.resizeForReference ?? defaultResize;
  const base = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(cfg.accountId)}/ai/run`;

  async function run(model: string, init: { json?: unknown; form?: FormData }): Promise<Uint8Array> {
    let res: Response;
    try {
      res = await doFetch(`${base}/${model}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.apiToken}`, ...(init.json ? { 'Content-Type': 'application/json' } : {}) },
        body: init.form ?? JSON.stringify(init.json),
        signal: AbortSignal.timeout(timeout),
      });
    } catch (e) {
      throw new ProviderError(`No se pudo contactar con Cloudflare: ${(e as Error).message}`, true);
    }

    const contentType = res.headers.get('content-type') ?? '';
    if (res.ok && contentType.startsWith('image/')) return new Uint8Array(await res.arrayBuffer());

    const text = await res.text();
    let json: { success?: boolean; result?: { image?: string }; image?: string; errors?: { code?: number; message?: string }[] } | null = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* no es JSON */
    }
    if (!res.ok || json?.success === false) {
      const first = json?.errors?.[0];
      const detail = first?.message ?? text.slice(0, 300);
      // Cuota gratuita agotada: no tiene sentido reintentar y NO se pasa a un proveedor de pago.
      if (/daily free allocation|neurons|exceeded.*(quota|allocation)/i.test(detail)) {
        throw new ProviderError(`Cloudflare: cuota diaria gratuita agotada (${detail}). La partida sigue con la imagen anterior; se renueva a las 00:00 UTC. No se activa ningún plan de pago automáticamente.`, false);
      }
      if (res.status === 401 || res.status === 403) {
        throw new ProviderError(`Cloudflare ${res.status}: ${detail}. Revisa CLOUDFLARE_API_TOKEN (permiso Workers AI) y que tu plan admita este modelo.`, false);
      }
      const retryable = res.status === 429 || res.status >= 500 || res.status === 408;
      throw new ProviderError(`Cloudflare ${res.status}${first?.code ? ` (código ${first.code})` : ''}: ${detail}`, retryable);
    }
    // Respuesta típica: { result: { image: "<base64>" }, success: true }. También se admite { image } sin envoltorio.
    const b64 = json?.result?.image ?? json?.image;
    if (!b64 || typeof b64 !== 'string') throw new ProviderError('Cloudflare no devolvió ninguna imagen', true);
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }

  async function generate(prompt: string): Promise<GeneratedImage> {
    const text = prompt.slice(0, MAX_PROMPT);
    const bytes = await run(cfg.model, { json: { prompt: text, steps: cfg.steps } });
    // La mime real se detecta por bytes en jobs-service (flux-1-schnell devuelve JPEG).
    return { bytes, mime: 'image/jpeg', prompt: text, model: cfg.model };
  }

  return {
    id: 'cloudflare',
    capabilities: { edit: Boolean(cfg.editModel) },
    generateInitialScene: (input: InitialSceneInput) => generate(buildInitialScenePrompt(input)),
    generateItemImage: (input: ItemImageInput) => generate(buildItemImagePrompt(input)),
    async editScene(input: EditSceneInput): Promise<GeneratedImage> {
      if (!cfg.editModel) {
        throw new ProviderError(
          `El modelo de Cloudflare configurado (${cfg.model}) sólo genera imágenes nuevas y no puede editar la casa existente. Se conserva la imagen anterior. Define CLOUDFLARE_EDIT_MODEL (p. ej. @cf/black-forest-labs/flux-2-klein-4b) o usa otro proveedor con edición.`,
          false,
        );
      }
      const prompt = `Image 0 is the existing scene. ${buildEditPrompt(input)}`.slice(0, MAX_PROMPT);
      let ref: Uint8Array;
      try {
        ref = await resize(input.base.bytes);
      } catch (e) {
        throw new ProviderError(`No se pudo preparar la imagen de referencia: ${(e as Error).message}`, false);
      }
      const form = new FormData();
      form.set('prompt', prompt);
      form.set('width', String(cfg.width));
      form.set('height', String(cfg.height));
      form.set('input_image_0', new Blob([ref as BlobPart], { type: 'image/png' }), 'scene.png');
      const bytes = await run(cfg.editModel, { form });
      return { bytes, mime: 'image/jpeg', prompt, model: cfg.editModel };
    },
  };
}
