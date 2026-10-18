/**
 * Paso común de las descargas de la biblioteca desde fuentes abiertas (Openverse, museos): una imagen descargada se NORMALIZA al formato
 * interno único (WebP, tamaño y peso fijos, sin metadatos; `normalizeImage`) y se compara con las ya reunidas mediante la huella
 * perceptual (`perceptualHash`/`hammingHex`) para no meter dos veces casi la misma foto. Sin red: recibe los bytes ya descargados.
 */
import { normalizeImage, NormalizeError, type ImageKind } from '../images/normalize';
import { hammingHex, NEAR_DUPLICATE_DISTANCE } from './taxonomy';
import { perceptualHash } from './phash';

export type IngestResult =
  | { ok: true; bytes: Uint8Array; hash: string; width: number; height: number }
  | { ok: false; reason: 'invalid' | 'too_small' | 'duplicate'; detail: string };

/**
 * @param known huellas ya existentes (nombre de archivo → huella); si una está a ≤ `maxDistance` bits, se rechaza como duplicada.
 * @param minWidth anchura mínima del ORIGINAL tras decodificar (los museos no la declaran en la API, se comprueba aquí).
 */
export async function ingestImage(
  bytes: Uint8Array,
  kind: ImageKind,
  known: Record<string, string>,
  opts: { minWidth?: number; maxDistance?: number } = {},
): Promise<IngestResult> {
  try {
    const { default: sharp } = await import('sharp');
    const meta = await sharp(Buffer.from(bytes), { failOn: 'none' }).metadata();
    if ((meta.width ?? 0) < (opts.minWidth ?? 0)) return { ok: false, reason: 'too_small', detail: `${meta.width ?? '?'} px de ancho (mínimo ${opts.minWidth})` };
    const norm = await normalizeImage(bytes, kind);
    const hash = await perceptualHash(norm.bytes);
    const max = opts.maxDistance ?? NEAR_DUPLICATE_DISTANCE;
    for (const [file, h] of Object.entries(known)) {
      if (hammingHex(hash, h) <= max) return { ok: false, reason: 'duplicate', detail: `parecida a ${file}` };
    }
    return { ok: true, bytes: norm.bytes, hash, width: norm.width, height: norm.height };
  } catch (e) {
    if (e instanceof NormalizeError || e instanceof Error) return { ok: false, reason: 'invalid', detail: e.message };
    throw e;
  }
}
