import { newSeed } from './seed';
import type { AiHordeConfig } from '@/lib/config/env';
import { redactSecrets } from '@/lib/security/redact';
import { fetchImageBytes } from '@/lib/security/safe-fetch';
import { buildInitialScenePrompt, buildItemImagePrompt } from './prompts';
import { ProviderError, type EditSceneInput, type GeneratedImage, type ImageGenerationProvider, type InitialSceneInput, type ItemImageInput } from './types';

/**
 * Proveedor AI Horde (API REST en https://aihorde.net/api/v2): GPU de voluntarios, gratuita y SIN tarjeta.
 * Flujo asíncrono: POST /generate/async → GET /generate/check/{id} (sondeo) → GET /generate/status/{id}; si se agota la espera
 * se cancela con DELETE /generate/status/{id}. Clave anónima `0000000000` (menor prioridad en la cola); cabecera `Client-Agent`.
 *
 * SIN PROBAR contra el servicio real (no se pudo leer su documentación oficial desde este entorno: los nombres de campo vienen
 * de la API conocida y de la documentación del SDK). Solo GENERA: no edita, así que la «edición» pasa por composición.
 * Restricciones honestas: la cola puede tardar de segundos a minutos; hay filtro de contenido (censura) y el texto y las
 * imágenes pasan por equipos de voluntarios, no por una empresa: no envíes datos personales.
 */
const BASE = 'https://aihorde.net/api/v2';
const MAX_PROMPT = 900; // la Horda limita el prompt (≈1000 caracteres)
const NEGATIVE = 'text, watermark, logo, blurry, low quality, deformed, people, faces';

export interface AiHordeProviderOptions extends AiHordeConfig {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  pollMs?: number;
  baseUrl?: string;
  /** Descarga de URLs de resultado (solo si la Horda devuelve un enlace en vez de la imagen): inyectable en tests. */
  downloadImage?: (url: string) => Promise<Uint8Array>;
}

export function createAiHordeProvider(cfg: AiHordeProviderOptions): ImageGenerationProvider {
  const doFetch = cfg.fetchImpl ?? fetch;
  const sleep = cfg.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = cfg.now ?? Date.now;
  const poll = cfg.pollMs ?? 4000;
  const base = cfg.baseUrl ?? BASE;
  const download = cfg.downloadImage ?? ((u: string) => fetchImageBytes(u));
  const headers = { apikey: cfg.apiKey, 'Client-Agent': 'subasta-salvaje:1.0:github.com/ElMaxter99', 'Content-Type': 'application/json' };

  async function call(path: string, init: RequestInit = {}): Promise<unknown> {
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, { ...init, headers: { ...headers, ...(init.headers as Record<string, string> | undefined) }, signal: AbortSignal.timeout(20_000) });
    } catch (e) {
      throw new ProviderError(`No se pudo contactar con AI Horde: ${redactSecrets((e as Error).message)}`, true, false, 'network');
    }
    const text = await res.text();
    if (!res.ok) {
      const detail = redactSecrets(text.slice(0, 300));
      if (res.status === 401 || res.status === 403) throw new ProviderError(`AI Horde ${res.status}: ${detail}. Revisa AI_HORDE_API_KEY (o usa la anónima).`, false, false, 'auth');
      if (res.status === 429) throw new ProviderError(`AI Horde 429: demasiadas peticiones (${detail})`, true, false, 'rate_limit');
      if (res.status === 402) throw new ProviderError(`AI Horde 402: sin kudos suficientes (${detail})`, false, false, 'quota');
      if (res.status >= 500) throw new ProviderError(`AI Horde ${res.status}: ${detail}`, true, false, 'server');
      throw new ProviderError(`AI Horde ${res.status}: ${detail}`, false, false, /censor|nsfw|unsafe|filter/i.test(detail) ? 'moderation' : 'input');
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new ProviderError('AI Horde devolvió una respuesta que no es JSON', true, false, 'server');
    }
  }

  async function generate(prompt: string): Promise<GeneratedImage> {
    const text = prompt.slice(0, MAX_PROMPT);
    const seed = newSeed();
    const submitted = (await call('/generate/async', {
      method: 'POST',
      body: JSON.stringify({
        prompt: `${text} ### ${NEGATIVE}`,
        params: { width: cfg.width, height: cfg.height, steps: cfg.steps, cfg_scale: 7, sampler_name: 'k_euler_a', n: 1, seed: String(seed) },
        nsfw: false,
        censor_nsfw: true,
        r2: false, // imagen en base64 dentro de la respuesta (así no se descarga nada de un servidor externo)
        shared: false,
        ...(cfg.models.length ? { models: cfg.models } : {}),
      }),
    })) as { id?: string };
    const id = submitted.id;
    if (!id || typeof id !== 'string') throw new ProviderError('AI Horde no devolvió el identificador de la petición', true, false, 'server');

    const deadline = now() + cfg.maxWaitMs;
    for (;;) {
      const c = (await call(`/generate/check/${encodeURIComponent(id)}`)) as { done?: boolean; faulted?: boolean; is_possible?: boolean };
      if (c.faulted) throw new ProviderError('AI Horde marcó la petición como fallida', true, false, 'server');
      if (c.is_possible === false) {
        await cancel(id);
        throw new ProviderError('Ningún trabajador de AI Horde puede atender esta petición ahora (tamaño o modelo no disponibles)', true, false, 'unsupported');
      }
      if (c.done) break;
      if (now() >= deadline) {
        await cancel(id);
        throw new ProviderError(`AI Horde no terminó en ${Math.round(cfg.maxWaitMs / 1000)} s (cola larga). Se conserva la imagen anterior.`, true, false, 'server');
      }
      await sleep(poll);
    }

    const status = (await call(`/generate/status/${encodeURIComponent(id)}`)) as { generations?: { img?: string; censored?: boolean; model?: string }[] };
    const gen = status.generations?.[0];
    if (!gen?.img) throw new ProviderError('AI Horde no devolvió ninguna imagen', true, true, 'server');
    if (gen.censored) throw new ProviderError('AI Horde censuró la imagen (filtro de contenido)', false, true, 'moderation');
    let bytes: Uint8Array;
    if (/^https:\/\//i.test(gen.img)) {
      try {
        bytes = await download(gen.img);
      } catch (e) {
        throw new ProviderError(`No se pudo descargar la imagen de AI Horde: ${redactSecrets((e as Error).message)}`, true, true, 'server');
      }
    } else {
      bytes = new Uint8Array(Buffer.from(gen.img, 'base64'));
    }
    // La Horda entrega WebP: la mime real se detecta por bytes en jobs-service.
    return { bytes, mime: 'image/webp', prompt: text, model: gen.model ?? (cfg.models[0] || 'ai-horde'), notes: `semilla ${seed}` };
  }

  async function cancel(id: string): Promise<void> {
    await call(`/generate/status/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => undefined);
  }

  return {
    id: 'aihorde',
    capabilities: { edit: false },
    generateInitialScene: (input: InitialSceneInput) => generate(buildInitialScenePrompt(input)),
    generateItemImage: (input: ItemImageInput) => generate(buildItemImagePrompt(input)),
    async editScene(input: EditSceneInput): Promise<GeneratedImage> {
      void input;
      throw new ProviderError('AI Horde solo genera imágenes nuevas y no edita la imagen existente (la edición pasa por composición).', false, false, 'unsupported');
    },
  };
}
