export interface StoredImage {
  bytes: Uint8Array;
  mime: string;
}

export interface ImageStorage {
  put(storagePath: string, bytes: Uint8Array, mime: string): Promise<void>;
  get(storagePath: string): Promise<StoredImage>;
  /** URL pública para el navegador. */
  publicUrl(storagePath: string): string;
}

export function extensionForMime(mime: string): string {
  switch (mime) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    case 'image/svg+xml':
      return 'svg';
    default:
      throw new Error(`Tipo de imagen no soportado: ${mime}`);
  }
}

export function mimeForPath(storagePath: string): string {
  const ext = storagePath.split('.').pop()?.toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'svg') return 'image/svg+xml';
  return 'application/octet-stream';
}
