import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { compositeOnto, cutOutBackground, slotFor, withComposedEdit, withEditFallback } from '@/lib/ai/compose';
import { createCloudflareProvider } from '@/lib/ai/cloudflare';
import { sniffImageMime } from '@/lib/ai/image-validation';

const solid = (w: number, h: number, c: { r: number; g: number; b: number }) => sharp({ create: { width: w, height: h, channels: 3, background: c } });
async function itemOnWhite() {
  const red = await solid(200, 200, { r: 220, g: 30, b: 30 }).png().toBuffer();
  return new Uint8Array(await solid(512, 512, { r: 255, g: 255, b: 255 }).composite([{ input: red, left: 156, top: 156 }]).jpeg().toBuffer());
}

describe('edición gratuita por composición', () => {
  it('recorta el fondo liso y conserva el objeto', async () => {
    const cut = await cutOutBackground(await itemOnWhite());
    const m = await sharp(Buffer.from(cut)).metadata();
    expect(m.hasAlpha).toBe(true);
    expect(m.width!).toBeLessThan(260);
    expect(m.width!).toBeGreaterThan(150);
  });
  it('rechaza imágenes sin fondo liso recortable', async () => {
    const img = new Uint8Array(await solid(256, 256, { r: 255, g: 255, b: 255 }).png().toBuffer());
    await expect(cutOutBackground(img)).rejects.toMatchObject({ retryable: true });
  });
  it('pega sobre la base sin alterar el resto de píxeles', async () => {
    const base = new Uint8Array(await solid(800, 600, { r: 10, g: 120, b: 200 }).png().toBuffer());
    const out = await compositeOnto(base, await cutOutBackground(await itemOnWhite()), slotFor(0));
    expect(sniffImageMime(out)).toBe('image/png');
    const { data, info } = await sharp(Buffer.from(out)).raw().toBuffer({ resolveWithObject: true });
    expect(info.width).toBe(800);
    expect([data[0], data[1], data[2]]).toEqual([10, 120, 200]); // esquina intacta
    const i = (Math.round(0.9 * 600) - 20) * 800 * info.channels + Math.round(0.22 * 800) * info.channels;
    expect(data[i]).toBeGreaterThan(150); // el objeto rojo está en el hueco 0
  });
  it('envuelve un proveedor sin edición: una sola llamada de generación y mismo id', async () => {
    const jpeg = Buffer.from(await itemOnWhite()).toString('base64');
    const calls: string[] = [];
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      calls.push(String(init.body));
      return new Response(JSON.stringify({ result: { image: jpeg }, success: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const cf = createCloudflareProvider({ accountId: 'a', apiToken: 't', model: '@cf/m', steps: 4, editModel: null, width: 1024, height: 768, fetchImpl });
    expect(cf.capabilities.edit).toBe(false);
    const p = withComposedEdit(cf);
    expect(p.capabilities.edit).toBe(true);
    expect(p.id).toBe('cloudflare');
    const base = new Uint8Array(await solid(640, 480, { r: 90, g: 90, b: 90 }).png().toBuffer());
    const out = await p.editScene({ base: { bytes: base, mime: 'image/png' }, theme: 'house', itemName: 'Sofá', itemDescription: '', itemEmoji: null, previousItems: [] });
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0]!).prompt).toContain('pure white background');
    expect(out.model).toContain('+compose');
    expect(sniffImageMime(out.bytes)).toBe('image/png');
  });

  describe('edición real con plan B', () => {
    const mk = async (status: number, msg: string) => {
      const jpeg = Buffer.from(await itemOnWhite()).toString('base64');
      const urls: string[] = [];
      const fetchImpl = (async (u: string) => {
        urls.push(u);
        if (u.includes('klein')) return new Response(JSON.stringify({ success: false, errors: [{ message: msg }] }), { status, headers: { 'content-type': 'application/json' } });
        return new Response(JSON.stringify({ result: { image: jpeg }, success: true }), { status: 200, headers: { 'content-type': 'application/json' } });
      }) as unknown as typeof fetch;
      const cf = createCloudflareProvider({ accountId: 'a', apiToken: 't', model: '@cf/m', steps: 4, editModel: '@cf/black-forest-labs/flux-2-klein-4b', width: 1024, height: 768, fetchImpl, resizeForReference: async () => new Uint8Array([1]) });
      return { p: withEditFallback(cf), urls };
    };
    const input = async () => ({ base: { bytes: new Uint8Array(await solid(640, 480, { r: 90, g: 90, b: 90 }).png().toBuffer()), mime: 'image/png' }, theme: 'h', itemName: 'Sofá', itemDescription: '', itemEmoji: null, previousItems: [] });
    it('si el modelo de edición rechaza la entrada (400) usa la composición', async () => {
      const { p, urls } = await mk(400, 'bad input');
      const out = await p.editScene(await input());
      expect(out.model).toContain('+compose');
      expect(urls.some((u) => u.includes('klein'))).toBe(true);
    });
    it('la cuota agotada NO activa el plan B', async () => {
      const { p, urls } = await mk(429, 'you have exceeded your daily free allocation of 10000 neurons');
      await expect(p.editScene(await input())).rejects.toMatchObject({ retryable: false });
      expect(urls).toHaveLength(1);
    });
  });
});
