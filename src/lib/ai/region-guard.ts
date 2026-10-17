import { slotFor } from './compose';

/**
 * Guardia de zona para las ediciones con IA. Los modelos de edición económicos tienden a volver a dibujar la escena y a «perder» el
 * objeto comprado antes (caso real: la barca sustituyó al Pikachu). Como cada compra tiene asignada una zona (`slotFor`, la misma que
 * se le pide al modelo en el prompt), la imagen final se arma así: **fuera de la zona del objeto nuevo se conserva la imagen anterior
 * píxel a píxel** y dentro se toma lo que dibujó el modelo, con un borde suave. Así lo que hubiera en otras zonas no puede desaparecer.
 *
 * Es una red de seguridad honesta, no magia: si el modelo no puso el objeto en su zona (casi no hay cambio dentro), devolvió otra
 * proporción o transformó buena parte de la imagen (una mezcla, no un objeto añadido), NO se toca el resultado. Un objeto más grande que su zona se recorta en el borde.
 */
export interface GuardResult { bytes: Uint8Array; applied: boolean; note: string }

const BOX_HALF_W = 0.32; // media anchura de la zona (fracción del ancho)
const BOX_UP = 0.7; // cuánto sube desde la base del objeto (fracción del alto)
const BOX_DOWN = 0.08;
const MIN_INSIDE_DIFF = 2;
/** Si cambia más de esta fracción de la imagen no es «un objeto añadido» sino una mezcla (p. ej. salsa en un batido): no se toca. */
const MAX_CHANGED_FRACTION = 0.4;
const CHANGED_PIXEL = 40; // diferencia (0-255, en gris) a partir de la cual un píxel cuenta como cambiado // diferencia media (0-255) dentro de la zona para entender que el modelo puso ahí el objeto

export function zoneBox(index: number, w: number, h: number): { left: number; top: number; width: number; height: number } {
  const [x, y] = slotFor(index);
  const left = Math.max(0, Math.round((x - BOX_HALF_W) * w));
  const right = Math.min(w, Math.round((x + BOX_HALF_W) * w));
  const top = Math.max(0, Math.round((y - BOX_UP) * h));
  const bottom = Math.min(h, Math.round((y + BOX_DOWN) * h));
  return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

export async function preserveOutsideZone(base: Uint8Array, candidate: Uint8Array, slotIndex: number): Promise<GuardResult> {
  const { default: sharp } = await import('sharp');
  try {
    const bm = await sharp(Buffer.from(base)).metadata();
    const cm = await sharp(Buffer.from(candidate)).metadata();
    if (!bm.width || !bm.height || !cm.width || !cm.height) return { bytes: candidate, applied: false, note: 'sin dimensiones' };
    const ratio = (bm.width / bm.height) / (cm.width / cm.height);
    if (ratio < 0.95 || ratio > 1.05) return { bytes: candidate, applied: false, note: 'el modelo devolvió otra proporción' };
    const W = bm.width, H = bm.height;
    const box = zoneBox(slotIndex, W, H);

    // ¿Hay cambio dentro de la zona? (comparación en pequeño y en gris)
    const sw = 160, sh = Math.max(1, Math.round((160 * H) / W));
    const small = async (b: Uint8Array) => sharp(Buffer.from(b)).resize(sw, sh, { fit: 'fill' }).greyscale().raw().toBuffer();
    const [a, c] = await Promise.all([small(base), small(candidate)]);
    const sb = zoneBox(slotIndex, sw, sh);
    let inside = 0, n = 0;
    for (let y = sb.top; y < sb.top + sb.height; y++) for (let x = sb.left; x < sb.left + sb.width; x++) { inside += Math.abs(a[y * sw + x]! - c[y * sw + x]!); n++; }
    const insideDiff = n ? inside / n : 0;
    let changed = 0;
    for (let i = 0; i < a.length; i++) if (Math.abs(a[i]! - c[i]!) > CHANGED_PIXEL) changed++;
    if (changed / a.length > MAX_CHANGED_FRACTION) return { bytes: candidate, applied: false, note: 'cambio global (mezcla): sin guardia' };
    if (insideDiff < MIN_INSIDE_DIFF) return { bytes: candidate, applied: false, note: 'el objeto no está en su zona' };

    // Máscara con borde suave: 255 dentro de la zona, 0 fuera.
    const feather = Math.max(4, Math.round(Math.min(W, H) * 0.03));
    const mask = await sharp({ create: { width: W, height: H, channels: 3, background: '#000' } })
      .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${box.width}" height="${box.height}"><rect width="${box.width}" height="${box.height}" fill="#fff"/></svg>`), left: box.left, top: box.top }])
      .blur(feather).greyscale().raw().toBuffer();
    const rgb = await sharp(Buffer.from(candidate)).resize(W, H, { fit: 'fill' }).removeAlpha().raw().toBuffer();
    const rgba = Buffer.alloc(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      rgba[i * 4] = rgb[i * 3]!;
      rgba[i * 4 + 1] = rgb[i * 3 + 1]!;
      rgba[i * 4 + 2] = rgb[i * 3 + 2]!;
      rgba[i * 4 + 3] = mask[i]!; // la máscara hace de transparencia: 0 = imagen anterior, 255 = lo del modelo
    }
    const cand = await sharp(rgba, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
    const out = await sharp(Buffer.from(base)).removeAlpha().composite([{ input: cand }]).png().toBuffer();
    return { bytes: new Uint8Array(out), applied: true, note: 'lo anterior se conserva fuera de la zona del objeto nuevo' };
  } catch {
    return { bytes: candidate, applied: false, note: 'no se pudo aplicar' }; // la guardia nunca bloquea una generación
  }
}
