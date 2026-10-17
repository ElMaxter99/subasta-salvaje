import { ProviderError, type ImageData } from './types';

/**
 * Normaliza una imagen de referencia para los proveedores: la rasteriza a PNG (los SVG de pegatinas/galería no los admiten
 * los modelos) y limita el lado mayor. Se hace en el servidor con sharp.
 */
export async function toReferencePng(img: ImageData, maxSide: number): Promise<Uint8Array> {
  try {
    const { default: sharp } = await import('sharp');
    const out = await sharp(Buffer.from(img.bytes), { density: 144 })
      .resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();
    return new Uint8Array(out);
  } catch (e) {
    throw new ProviderError(`No se pudo preparar la imagen de referencia: ${(e as Error).message}`, false, false);
  }
}
