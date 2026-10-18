import { describe, expect, it } from 'vitest';
import { createCloudflareProvider } from '@/lib/ai/cloudflare';
import { createHuggingFaceProvider } from '@/lib/ai/huggingface';
import { createPollinationsProvider } from '@/lib/ai/pollinations';
import { REAL_JPEG_B64 } from './helpers';

const item = { theme: 't', itemName: 'Seta', itemDescription: '', itemEmoji: null };
const seedsOf = async (make: (f: typeof fetch) => { generateItemImage: (i: typeof item) => Promise<{ notes?: string }> }, body: (init: RequestInit) => unknown, reply: () => Response) => {
  const sent: unknown[] = [];
  const f = (async (_u: string, init: RequestInit) => { sent.push(body(init)); return reply(); }) as unknown as typeof fetch;
  const p = make(f);
  const notes = [(await p.generateItemImage(item)).notes, (await p.generateItemImage(item)).notes];
  return { sent, notes };
};

describe('semilla aleatoria en cada llamada (sin ella algunos proveedores repiten la misma imagen)', () => {
  it('Cloudflare envía una semilla nueva y la anota en la versión', async () => {
    const { sent, notes } = await seedsOf(
      (f) => createCloudflareProvider({ accountId: 'a', apiToken: 't', model: '@cf/black-forest-labs/flux-1-schnell', steps: 4, editModel: null, width: 1024, height: 768, fetchImpl: f }),
      (i) => JSON.parse(String(i.body)),
      () => new Response(JSON.stringify({ result: { image: REAL_JPEG_B64 }, success: true })),
    );
    const [a, b] = sent as { seed: number }[];
    expect(Number.isInteger(a!.seed)).toBe(true);
    expect(a!.seed).not.toBe(b!.seed);
    expect(notes[0]).toBe(`semilla ${a!.seed}`);
  });

  it('Hugging Face envía parameters.seed y Pollinations el campo seed', async () => {
    const hf = await seedsOf(
      (f) => createHuggingFaceProvider({ token: 'x', model: 'black-forest-labs/FLUX.1-schnell', fetchImpl: f } as never),
      (i) => JSON.parse(String(i.body)),
      () => new Response(Buffer.from(REAL_JPEG_B64, 'base64'), { headers: { 'content-type': 'image/jpeg' } }),
    );
    const [a, b] = hf.sent as { parameters: { seed: number } }[];
    expect(a!.parameters.seed).not.toBe(b!.parameters.seed);
    const pol = await seedsOf(
      (f) => createPollinationsProvider({ apiKey: 'k', model: 'flux', size: '1024x1024', editModel: null, fetchImpl: f } as never),
      (i) => JSON.parse(String(i.body)),
      () => new Response(JSON.stringify({ data: [{ b64_json: REAL_JPEG_B64 }] })),
    );
    const [c, d] = pol.sent as { seed: number }[];
    expect(c!.seed).not.toBe(d!.seed);
    expect(pol.notes[0]).toBe(`semilla ${c!.seed}`);
  });
});
