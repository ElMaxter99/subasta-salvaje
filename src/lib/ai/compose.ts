import { ProviderError, type EditSceneInput, type GeneratedImage, type ImageGenerationProvider } from './types';

/**
 * «Edición» gratuita por composición. Los modelos económicos de generación (p. ej. flux-1-schnell de Cloudflare,
 * dentro de su cuota gratuita) no aceptan imagen de referencia. En lugar de fallar, este envoltorio:
 *  1. genera con IA SÓLO el objeto nuevo (una llamada, igual que cualquier otra generación; cuenta en la cuota),
 *  2. recorta su fondo liso y
 *  3. lo pega con sombra sobre la imagen actual, en un hueco libre.
 * La escena anterior se conserva píxel a píxel (por construcción), pero NO es una edición real: el objeto no se
 * integra con la luz ni la perspectiva de la casa. Es un collage honesto, sin coste extra ni proveedor de pago.
 */

/** Posiciones (centro-horizontal, base-vertical) normalizadas, en orden de uso. */
export const COMPOSE_SLOTS: readonly (readonly [number, number])[] = [
  [0.22, 0.9], [0.5, 0.94], [0.78, 0.9], [0.36, 0.78], [0.64, 0.78], [0.14, 0.74], [0.86, 0.74], [0.5, 0.68],
];

export function slotFor(index: number): readonly [number, number] {
  return COMPOSE_SLOTS[((index % COMPOSE_SLOTS.length) + COMPOSE_SLOTS.length) % COMPOSE_SLOTS.length]!;
}

/** Recorta el fondo liso: inunda desde el borde los píxeles parecidos al color medio del marco. Devuelve PNG con alfa. */
export async function cutOutBackground(bytes: Uint8Array, tolerance = 70): Promise<Uint8Array> {
  const { default: sharp } = await import('sharp');
  const { data, info } = await sharp(Buffer.from(bytes)).resize({ width: 512, height: 512, fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const at = (x: number, y: number) => (y * w + x) * 4;
  let r = 0, g = 0, b = 0, n = 0;
  const sample = (x: number, y: number) => {
    const i = at(x, y);
    r += data[i]!; g += data[i + 1]!; b += data[i + 2]!; n++;
  };
  for (let x = 0; x < w; x++) { sample(x, 0); sample(x, h - 1); }
  for (let y = 1; y < h - 1; y++) { sample(0, y); sample(w - 1, y); }
  r /= n; g /= n; b /= n;
  const close = (i: number) => Math.hypot(data[i]! - r, data[i + 1]! - g, data[i + 2]! - b) < tolerance;
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h || seen[y * w + x]) return;
    if (!close(at(x, y))) return;
    seen[y * w + x] = 1;
    stack.push(x, y);
  };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (stack.length) {
    const y = stack.pop()!, x = stack.pop()!;
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }
  const removed = seen.reduce((s, v) => s + v, 0);
  // Si casi todo es fondo (o no hay fondo liso) el recorte no es fiable.
  if (removed < w * h * 0.05 || removed > w * h * 0.95) throw new ProviderError('No se pudo separar el objeto de su fondo', true);
  for (let p = 0; p < w * h; p++) if (seen[p]) data[p * 4 + 3] = 0;
  // Suaviza el borde del alfa (1 px) para evitar dientes de sierra.
  const alpha = await sharp(data, { raw: { width: w, height: h, channels: 4 } }).extractChannel(3).blur(1).raw().toBuffer();
  for (let p = 0; p < w * h; p++) data[p * 4 + 3] = alpha[p]!;
  const out = await sharp(data, { raw: { width: w, height: h, channels: 4 } }).trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 1 }).png().toBuffer();
  return new Uint8Array(out);
}

/**
 * Recuadro redondeado con borde blanco para una foto que no tiene fondo liso recortable (p. ej. una foto subida por el
 * anfitrión o una imagen de catálogo con degradado). Se pega como «foto en la casa» en lugar de recortar el objeto.
 */
export async function frameImage(bytes: Uint8Array, maxSide = 420): Promise<Uint8Array> {
  const { default: sharp } = await import('sharp');
  const resized = await sharp(Buffer.from(bytes), { density: 144 }).resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: false }).png().toBuffer();
  const meta = await sharp(resized).metadata();
  const w = meta.width ?? maxSide, h = meta.height ?? maxSide;
  const r = Math.round(Math.min(w, h) * 0.12);
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${r}" fill="#fff"/></svg>`);
  const border = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect x="3" y="3" width="${w - 6}" height="${h - 6}" rx="${r}" fill="none" stroke="#fff" stroke-width="6"/></svg>`);
  const out = await sharp(resized).ensureAlpha().composite([{ input: mask, blend: 'dest-in' }, { input: border }]).png().toBuffer();
  return new Uint8Array(out);
}

/** Pega `cutout` (PNG con alfa) sobre `base` en la posición `slot`, con sombra de contacto. Devuelve PNG. */
export async function compositeOnto(base: Uint8Array, cutout: Uint8Array, slot: readonly [number, number]): Promise<Uint8Array> {
  const { default: sharp } = await import('sharp');
  const baseImg = sharp(Buffer.from(base));
  const meta = await baseImg.metadata();
  const W = meta.width ?? 1024, H = meta.height ?? 768;
  const maxW = Math.round(W * 0.26), maxH = Math.round(H * 0.4);
  const item = await sharp(Buffer.from(cutout)).resize({ width: maxW, height: maxH, fit: 'inside' }).png().toBuffer();
  const im = await sharp(item).metadata();
  const iw = im.width ?? maxW, ih = im.height ?? maxH;
  const left = Math.max(0, Math.min(W - iw, Math.round(slot[0] * W - iw / 2)));
  const top = Math.max(0, Math.min(H - ih, Math.round(slot[1] * H - ih)));
  const shadowW = Math.round(iw * 1.1), shadowH = Math.max(10, Math.round(ih * 0.14));
  const shadow = await sharp(
    Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${shadowW}" height="${shadowH}"><ellipse cx="${shadowW / 2}" cy="${shadowH / 2}" rx="${shadowW / 2 - 2}" ry="${shadowH / 2 - 2}" fill="rgba(0,0,0,0.38)"/></svg>`),
  ).blur(4).png().toBuffer();
  const out = await baseImg
    .ensureAlpha()
    .composite([
      { input: shadow, left: Math.max(0, Math.min(W - shadowW, left + Math.round((iw - shadowW) / 2))), top: Math.max(0, Math.min(H - shadowH, top + ih - Math.round(shadowH / 2))) },
      { input: item, left, top },
    ])
    .png()
    .toBuffer();
  return new Uint8Array(out);
}

/** Si el proveedor no edita, añade una edición por composición. Mismo `id` y misma cuota: no cambia de proveedor. */
export function withComposedEdit(inner: ImageGenerationProvider): ImageGenerationProvider {
  if (inner.capabilities.edit) return inner;
  return {
    ...inner,
    capabilities: { edit: true },
    generateInitialScene: (i) => inner.generateInitialScene(i),
    generateItemImage: (i) => inner.generateItemImage(i),
    async editScene(input: EditSceneInput): Promise<GeneratedImage> {
      // Con foto del elemento (subida o generada para el catálogo) se usa ESA foto: no hace falta generar nada.
      const item = input.itemImage
        ? { bytes: input.itemImage.bytes, prompt: 'foto del elemento del catálogo', model: 'reference' }
        : await inner.generateItemImage({
            theme: input.theme,
            itemName: input.itemName,
            itemDescription: input.itemDescription,
            itemEmoji: input.itemEmoji,
            isolated: true,
          });
      let cut: Uint8Array;
      let merged: Uint8Array;
      try {
        cut = input.itemImage
          ? await cutOutBackground(item.bytes).catch(() => frameImage(item.bytes)) // sin fondo liso: se pega la foto enmarcada
          : await cutOutBackground(item.bytes);
        merged = await compositeOnto(input.base.bytes, cut, slotFor(input.previousItems.length));
      } catch (e) {
        if (e instanceof ProviderError) throw e;
        throw new ProviderError(`No se pudo componer el objeto sobre la escena: ${(e as Error).message}`, false);
      }
      return { bytes: merged, mime: 'image/png', prompt: `[composición] ${item.prompt}`, model: `${item.model}+compose` };
    },
  };
}

/** Rechazos de entrada del modelo de edición (400/404/422): no consumen cuota de Cloudflare y justifican el plan B. */
const INPUT_REJECTED = /Cloudflare (400|404|422)\b/;

/**
 * Edición REAL con imagen de referencia (modelo de edición del proveedor). Si el modelo rechaza la petición por
 * entrada no válida o no existente, se usa la composición como plan B (una generación más del MISMO proveedor).
 * Errores de red, cuota, credenciales o moderación NO activan el plan B: se propagan y se conserva la imagen anterior.
 */
export function withEditFallback(inner: ImageGenerationProvider): ImageGenerationProvider {
  if (!inner.capabilities.edit) return withComposedEdit(inner);
  const composed = withComposedEdit({ ...inner, capabilities: { edit: false } });
  return {
    ...inner,
    async editScene(input: EditSceneInput): Promise<GeneratedImage> {
      try {
        return await inner.editScene(input);
      } catch (e) {
        if (e instanceof ProviderError && !e.retryable && INPUT_REJECTED.test(e.message)) return composed.editScene(input);
        throw e;
      }
    },
  };
}
