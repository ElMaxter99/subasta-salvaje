import { ProviderError, type ImageData } from './types';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
export const RASTER_MIMES = ['image/png', 'image/jpeg', 'image/webp'] as const;

/** Detecta el tipo real a partir de los primeros bytes (no se fía del Content-Type). */
export function sniffImageMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  )
    return 'image/webp';
  return null;
}

export class ImageValidationError extends Error {}

/** Valida tamaño y tipo. SVG sólo se admite cuando lo produce el proveedor de muestra del modo demo. */
export function validateImage(bytes: Uint8Array, opts: { allowSvg?: boolean; maxBytes?: number } = {}): string {
  const max = opts.maxBytes ?? MAX_IMAGE_BYTES;
  if (bytes.length === 0) throw new ImageValidationError('La imagen está vacía');
  if (bytes.length > max) throw new ImageValidationError(`La imagen supera el máximo de ${Math.round(max / 1024 / 1024)} MB`);
  const sniffed = sniffImageMime(bytes);
  if (sniffed) return sniffed;
  if (opts.allowSvg) {
    const head = new TextDecoder().decode(bytes.slice(0, 256)).trimStart();
    if (head.startsWith('<svg') || head.startsWith('<?xml')) return 'image/svg+xml';
  }
  throw new ImageValidationError('Formato de imagen no permitido (solo PNG, JPEG o WebP)');
}

/** Valida la salida de un proveedor y la convierte en ProviderError no reintentable si es inválida. */
export function validateProviderOutput(img: ImageData, allowSvg: boolean): string {
  try {
    return validateImage(img.bytes, { allowSvg });
  } catch (e) {
    throw new ProviderError(`Imagen devuelta no válida: ${(e as Error).message}`, true);
  }
}
