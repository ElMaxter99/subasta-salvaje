import { slotFor } from './compose';

/**
 * Guardia de zona para las ediciones con IA. Los modelos de edición económicos tienden a volver a dibujar la escena y a «perder» el
 * objeto comprado antes (caso real: la barca sustituyó al Pikachu). Como cada compra tiene asignada una zona (`slotFor`, la misma que
 * se le pide al modelo en el prompt), la imagen final se arma así: **fuera de la zona del objeto nuevo —y dentro de ella, en el núcleo de
 * cada objeto anterior— se conserva la imagen anterior píxel a píxel** y dentro se toma lo que dibujó el modelo, con un borde suave. Así lo que hubiera en otras zonas no puede desaparecer.
 *
 * Es una red de seguridad honesta, no magia: si el modelo no puso el objeto en su zona (casi no hay cambio dentro), devolvió otra
 * proporción o transformó buena parte de la imagen (una mezcla, no un objeto añadido), NO se toca el resultado. Un objeto más grande que su zona se recorta en el borde.
 */
export interface GuardResult { bytes: Uint8Array; applied: boolean; note: string }

const BOX_HALF_W = 0.32; // media anchura de la zona (fracción del ancho)
const BOX_UP = 0.7; // cuánto sube desde la base del objeto (fracción del alto)
const BOX_DOWN = 0.08;
const MIN_INSIDE_DIFF = 2; // diferencia media (0-255) dentro de la zona para entender que el modelo puso ahí el objeto
/** Si cambia más de esta fracción de la imagen no es «un objeto añadido» sino una mezcla (p. ej. salsa en un batido): no se toca. */
const MAX_CHANGED_FRACTION = 0.4;
const CHANGED_PIXEL = 40; // cambio (0-255) del canal RGB que más cambia a partir del cual un píxel cuenta como cambiadoe el modelo puso ahí el objeto

/** Núcleo de un objeto ya comprado: su zona estrecha. La zona del objeto nuevo NUNCA lo pisa (si el modelo lo repinta, se restaura). */
const CORE_HALF_W = 0.14;
const CORE_UP = 0.38;

export function coreBox(index: number, w: number, h: number): { left: number; top: number; width: number; height: number } {
  const [x, y] = slotFor(index);
  const left = Math.max(0, Math.round((x - CORE_HALF_W) * w));
  const right = Math.min(w, Math.round((x + CORE_HALF_W) * w));
  const top = Math.max(0, Math.round((y - CORE_UP) * h));
  const bottom = Math.min(h, Math.round((y + BOX_DOWN) * h));
  return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

/** Zonas de los objetos anteriores (las compras 0..n-1; con más de 8 se reutilizan zonas y la que se va a reutilizar no se protege). */
function previousCores(slotIndex: number, w: number, h: number) {
  const reused = slotIndex % 8;
  const out: ReturnType<typeof coreBox>[] = [];
  for (let k = 0; k < Math.min(slotIndex, 8); k++) if (k !== reused) out.push(coreBox(k, w, h));
  return out;
}

/** Mapa de diferencias en pequeño: para cada píxel, el mayor cambio de un canal RGB (el gris no distingue p. ej. un rojo de un gris). */
async function diffMap(base: Uint8Array, candidate: Uint8Array, sw: number, sh: number): Promise<Uint8Array> {
  const { default: sharp } = await import('sharp');
  const small = async (b: Uint8Array) => sharp(Buffer.from(b)).resize(sw, sh, { fit: 'fill' }).removeAlpha().raw().toBuffer();
  const [a, c] = await Promise.all([small(base), small(candidate)]);
  const out = new Uint8Array(sw * sh);
  for (let i = 0; i < sw * sh; i++) out[i] = Math.max(Math.abs(a[i * 3]! - c[i * 3]!), Math.abs(a[i * 3 + 1]! - c[i * 3 + 1]!), Math.abs(a[i * 3 + 2]! - c[i * 3 + 2]!));
  return out;
}

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
    const d = await diffMap(base, candidate, sw, sh);
    const sb = zoneBox(slotIndex, sw, sh);
    let inside = 0, n = 0;
    for (let y = sb.top; y < sb.top + sb.height; y++) for (let x = sb.left; x < sb.left + sb.width; x++) { inside += d[y * sw + x]!; n++; }
    const insideDiff = n ? inside / n : 0;
    let changed = 0;
    for (let i = 0; i < d.length; i++) if (d[i]! > CHANGED_PIXEL) changed++;
    if (changed / d.length > MAX_CHANGED_FRACTION) return { bytes: candidate, applied: false, note: 'cambio global (mezcla): sin guardia' };
    if (insideDiff < MIN_INSIDE_DIFF) return { bytes: candidate, applied: false, note: 'el objeto no está en su zona' };

    // Máscara con borde suave: 255 dentro de la zona, 0 fuera.
    const feather = Math.max(4, Math.round(Math.min(W, H) * 0.03));
    const rect = (b: { left: number; top: number; width: number; height: number }, fill: string) => ({
      input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${b.width}" height="${b.height}"><rect width="${b.width}" height="${b.height}" fill="${fill}"/></svg>`), left: b.left, top: b.top,
    });
    // Zona del objeto nuevo en blanco, MENOS el núcleo de cada objeto anterior (en negro): ahí manda siempre la imagen anterior.
    const mask = await sharp({ create: { width: W, height: H, channels: 3, background: '#000' } })
      .composite([rect(box, '#fff'), ...previousCores(slotIndex, W, H).map((c) => rect(c, '#000'))])
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


/* ------------------------------------------------------------------------------------------------------------------------
 * Modo «cores» (por defecto): edición CREATIVA. El juego quiere que la IA transforme la imagen (agua para la barca, la persona dentro,
 * una salsa en el batido…), así que NO se limita lo que puede cambiar. Solo se vigila lo ya añadido: si el modelo ha «perdido» el
 * objeto de una compra anterior (su núcleo cambia mucho respecto a la imagen anterior), se restaura ese trozo de la imagen anterior
 * con borde suave. Si el modelo ha rehecho casi todo el cuadro, no se interviene (un parche suelto quedaría peor).
 * ---------------------------------------------------------------------------------------------------------------------- */
const LOST_FRACTION = 0.06; // fracción del núcleo con cambio fuerte a partir de la cual se considera que el objeto se ha perdido (un objeto ocupa ~10-30 % del núcleo)
const MAX_REDRAW_FRACTION = 0.7;

export async function restoreLostCores(base: Uint8Array, candidate: Uint8Array, slotIndex: number): Promise<GuardResult> {
  const { default: sharp } = await import('sharp');
  try {
    if (slotIndex < 1) return { bytes: candidate, applied: false, note: 'sin compras anteriores' };
    const bm = await sharp(Buffer.from(base)).metadata();
    const cm = await sharp(Buffer.from(candidate)).metadata();
    if (!bm.width || !bm.height || !cm.width || !cm.height) return { bytes: candidate, applied: false, note: 'sin dimensiones' };
    const ratio = (bm.width / bm.height) / (cm.width / cm.height);
    if (ratio < 0.95 || ratio > 1.05) return { bytes: candidate, applied: false, note: 'el modelo devolvió otra proporción' };
    const W = bm.width, H = bm.height;
    const sw = 160, sh = Math.max(1, Math.round((160 * H) / W));
    const d = await diffMap(base, candidate, sw, sh);
    let changed = 0;
    for (let i = 0; i < d.length; i++) if (d[i]! > CHANGED_PIXEL) changed++;
    if (changed / d.length > MAX_REDRAW_FRACTION) return { bytes: candidate, applied: false, note: 'el modelo rehízo casi toda la imagen' };
    // Núcleos en coordenadas pequeñas para medir la diferencia
    const smallCores = previousCores(slotIndex, sw, sh);
    const fullCores = previousCores(slotIndex, W, H);
    const lostFull: typeof fullCores = [];
    smallCores.forEach((sb, i) => {
      let strong = 0, n = 0;
      for (let y = sb.top; y < sb.top + sb.height; y++) for (let x = sb.left; x < sb.left + sb.width; x++) { if (d[y * sw + x]! > CHANGED_PIXEL) strong++; n++; }
      if (n && strong / n > LOST_FRACTION) lostFull.push(fullCores[i]!);
    });
    if (lostFull.length === 0) return { bytes: candidate, applied: false, note: 'lo anterior se conserva' };

    const feather = Math.max(4, Math.round(Math.min(W, H) * 0.03));
    const mask = await sharp({ create: { width: W, height: H, channels: 3, background: '#000' } })
      .composite(lostFull.map((b) => ({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${b.width}" height="${b.height}"><rect width="${b.width}" height="${b.height}" fill="#fff"/></svg>`), left: b.left, top: b.top })))
      .blur(feather).greyscale().raw().toBuffer();
    const rgb = await sharp(Buffer.from(base)).resize(W, H, { fit: 'fill' }).removeAlpha().raw().toBuffer();
    const rgba = Buffer.alloc(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      rgba[i * 4] = rgb[i * 3]!; rgba[i * 4 + 1] = rgb[i * 3 + 1]!; rgba[i * 4 + 2] = rgb[i * 3 + 2]!; rgba[i * 4 + 3] = mask[i]!;
    }
    const patch = await sharp(rgba, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
    const out = await sharp(Buffer.from(candidate)).resize(W, H, { fit: 'fill' }).removeAlpha().composite([{ input: patch }]).png().toBuffer();
    return { bytes: new Uint8Array(out), applied: true, note: `se restauró lo anterior que el modelo había perdido (${lostFull.length} ${lostFull.length === 1 ? 'objeto' : 'objetos'})` };
  } catch {
    return { bytes: candidate, applied: false, note: 'no se pudo aplicar' };
  }
}

export type EditGuardMode = 'cores' | 'zone' | 'off';

/** Aplica la guardia elegida (IMAGE_EDIT_GUARD): `cores` (por defecto, creativa), `zone` (estricta) u `off`. */
export async function applyEditGuard(mode: EditGuardMode, base: Uint8Array, candidate: Uint8Array, slotIndex: number): Promise<GuardResult> {
  if (mode === 'off') return { bytes: candidate, applied: false, note: 'guardia desactivada' };
  return mode === 'zone' ? preserveOutsideZone(base, candidate, slotIndex) : restoreLostCores(base, candidate, slotIndex);
}
