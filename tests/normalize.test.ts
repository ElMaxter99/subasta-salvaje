import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { IMAGE_SPECS, normalizeImage, NormalizeError } from '@/lib/images/normalize';

/** Imagen "tipo foto": degradado suave con algo de ruido (comprimible). */
async function photoLike(w: number, h: number, format: 'jpeg' | 'png' = 'jpeg', extra: Record<string, unknown> = {}) {
  const raw = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3;
    raw[i] = (x * 255) / w; raw[i + 1] = (y * 255) / h; raw[i + 2] = 128 + ((x * 7 + y * 13) % 17);
  }
  const img = sharp(raw, { raw: { width: w, height: h, channels: 3 } });
  return new Uint8Array(await (format === 'jpeg' ? img.jpeg({ quality: 95 }) : img.png()).withMetadata(extra).toBuffer());
}

describe('imagen interna (normalizeImage)', () => {
  it('reduce una foto grande al tamaño y peso de su tipo y la pasa a WebP', async () => {
    const big = await photoLike(4000, 3000);
    expect(big.length).toBeGreaterThan(IMAGE_SPECS.scene.targetBytes);
    for (const kind of ['scene', 'item', 'cover'] as const) {
      const out = await normalizeImage(big, kind);
      const spec = IMAGE_SPECS[kind];
      expect(out.mime).toBe('image/webp');
      expect(out.width).toBeLessThanOrEqual(spec.width);
      expect(out.height).toBeLessThanOrEqual(spec.height);
      expect(out.bytes.length).toBeLessThanOrEqual(spec.targetBytes);
      expect((await sharp(Buffer.from(out.bytes)).metadata()).format).toBe('webp');
    }
  });

  it('mantiene la proporción y no amplía imágenes pequeñas', async () => {
    const small = await photoLike(300, 200, 'png');
    const out = await normalizeImage(small, 'scene');
    expect([out.width, out.height]).toEqual([300, 200]);
    const wide = await normalizeImage(await photoLike(3000, 1000), 'item');
    expect(wide.width).toBe(768);
    expect(wide.height).toBe(256);
  });

  it('elimina los metadatos (EXIF/GPS) y aplica la orientación', async () => {
    const withExif = new Uint8Array(await sharp(Buffer.from(await photoLike(400, 200))).withMetadata({ orientation: 6, exif: { IFD0: { Copyright: 'secreto', Artist: 'Persona' } } }).jpeg().toBuffer());
    expect((await sharp(Buffer.from(withExif)).metadata()).exif).toBeDefined();
    const out = await normalizeImage(withExif, 'scene');
    const meta = await sharp(Buffer.from(out.bytes)).metadata();
    expect(meta.exif).toBeUndefined();
    expect(Buffer.from(out.bytes).includes(Buffer.from('secreto'))).toBe(false);
    expect([out.width, out.height]).toEqual([200, 400]); // orientación 6 = girada 90°: ahora es vertical
  });

  it('conserva la transparencia', async () => {
    const png = new Uint8Array(await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 } } }).png().toBuffer());
    const meta = await sharp(Buffer.from((await normalizeImage(png, 'item')).bytes)).metadata();
    expect(meta.hasAlpha).toBe(true);
  });

  it('rechaza SVG, GIF y datos que no son imagen', async () => {
    await expect(normalizeImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'), 'item')).rejects.toBeInstanceOf(NormalizeError);
    const gif = new Uint8Array(await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).gif().toBuffer());
    await expect(normalizeImage(gif, 'item')).rejects.toThrow(/Formato de imagen no permitido/);
    await expect(normalizeImage(new Uint8Array([1, 2, 3, 4]), 'item')).rejects.toBeInstanceOf(NormalizeError);
  });

  it('rechaza imágenes con demasiados píxeles (bomba de descompresión)', async () => {
    const bomb = new Uint8Array(await sharp({ create: { width: 8000, height: 6000, channels: 3, background: '#123456' } }).png({ compressionLevel: 9 }).toBuffer());
    expect(bomb.length).toBeLessThan(2_000_000); // pesa poco, pero tiene 48 megapíxeles
    await expect(normalizeImage(bomb, 'scene')).rejects.toBeInstanceOf(NormalizeError);
  });

  it('el ruido puro nunca supera el doble del peso objetivo: se acepta si cabe y se rechaza si no', async () => {
    const noise = new Uint8Array(await sharp(randomBytes(1600 * 1100 * 3), { raw: { width: 1600, height: 1100, channels: 3 } }).png().toBuffer());
    const scene = await normalizeImage(noise, 'scene').catch((e) => e);
    if (scene instanceof NormalizeError) expect(scene.message).toMatch(/demasiado compleja/);
    else expect(scene.bytes.length).toBeLessThanOrEqual(IMAGE_SPECS.scene.targetBytes * 2);
    const item = await normalizeImage(noise, 'item').catch((e) => e);
    if (item instanceof NormalizeError) expect(item.message).toMatch(/demasiado compleja/);
    else expect(item.bytes.length).toBeLessThanOrEqual(IMAGE_SPECS.item.targetBytes * 2);
  });
});
