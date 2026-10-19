/**
 * Imagen INTERNA única. Toda imagen que se guarda en el sistema (subidas, fotos importadas por URL o ZIP, salidas de la IA,
 * fotos de plantillas) pasa por `normalizeImage`: tamaño máximo por tipo, formato WebP, sin metadatos y con peso acotado.
 * Autónomo a propósito (sin importaciones locales): lo usa también el script `npm run assets:normalize`.
 *
 * Reglas: el tipo se decide por el CONTENIDO (sharp), solo PNG/JPEG/WebP (nada de SVG ni GIF/animaciones), límite de píxeles
 * de entrada contra bombas de descompresión, orientación aplicada y EXIF/GPS eliminados.
 */
export type ImageKind = 'scene' | 'item' | 'cover';

export interface ImageSpec {
  /** Caja máxima (se reduce manteniendo proporción; nunca se amplía). */
  width: number;
  height: number;
  /** Peso objetivo en bytes. */
  targetBytes: number;
}

export const IMAGE_SPECS: Record<ImageKind, ImageSpec> = {
  scene: { width: 1536, height: 1024, targetBytes: 300_000 }, // imagen base / escena (3:2)
  item: { width: 768, height: 768, targetBytes: 150_000 }, // foto de un elemento del catálogo
  cover: { width: 1200, height: 630, targetBytes: 150_000 }, // portada de plantilla
};

export const MAX_INPUT_PIXELS = 40_000_000;
const QUALITIES = [80, 72, 64, 56, 48, 40];
const SCALES = [1, 0.85, 0.7];
/** Si ni con la calidad y la escala más bajas cabe en este múltiplo del objetivo, se rechaza. */
const HARD_FACTOR = 2;

export class NormalizeError extends Error {}

export interface NormalizedImage {
  bytes: Uint8Array;
  mime: 'image/webp';
  width: number;
  height: number;
  quality: number;
}

export async function normalizeImage(input: Uint8Array, kind: ImageKind): Promise<NormalizedImage> {
  const spec = IMAGE_SPECS[kind];
  const { default: sharp } = await import('sharp');
  const src = Buffer.from(input);
  let meta;
  try {
    meta = await sharp(src, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  } catch (e) {
    throw new NormalizeError(`No se pudo leer la imagen: ${(e as Error).message}`);
  }
  if (!meta.format || !['jpeg', 'png', 'webp'].includes(meta.format)) throw new NormalizeError('Formato de imagen no permitido (solo PNG, JPEG o WebP)');
  if ((meta.pages ?? 1) > 1) throw new NormalizeError('No se admiten imágenes animadas');
  let best: { buf: Buffer; width: number; height: number; quality: number } | null = null;
  for (const scale of SCALES) {
    for (const quality of QUALITIES) {
      // Sin .withMetadata(): se eliminan EXIF/GPS/ICC. .rotate() aplica la orientación antes de descartarla.
      const { data, info } = await sharp(src, { limitInputPixels: MAX_INPUT_PIXELS })
        .rotate()
        .resize({ width: Math.round(spec.width * scale), height: Math.round(spec.height * scale), fit: 'inside', withoutEnlargement: true })
        .webp({ quality, effort: 4 })
        .toBuffer({ resolveWithObject: true });
      best = { buf: data, width: info.width, height: info.height, quality };
      if (data.length <= spec.targetBytes) return { bytes: new Uint8Array(data), mime: 'image/webp', width: info.width, height: info.height, quality };
    }
  }
  if (best && best.buf.length <= spec.targetBytes * HARD_FACTOR) return { bytes: new Uint8Array(best.buf), mime: 'image/webp', width: best.width, height: best.height, quality: best.quality };
  throw new NormalizeError('La imagen es demasiado compleja para reducirla al peso permitido. Prueba con otra o con menos detalle.');
}
