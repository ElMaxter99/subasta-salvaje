/**
 * Reduce una foto ANTES de subirla (en el navegador): ahorra datos móviles y evita el límite de cuerpo de las funciones de
 * Vercel (4,5 MB). Es solo una comodidad: el servidor no se fía y vuelve a normalizar (formato interno único).
 * Si algo falla (navegador antiguo, formato raro) devuelve el archivo original.
 */
const MAX_SIDE = 2048;
const SKIP_BELOW_BYTES = 1_000_000;

export async function shrinkForUpload(file: File): Promise<File> {
  try {
    if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') return file;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return file;
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size <= SKIP_BELOW_BYTES) {
      bitmap.close();
      return file;
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.85));
    if (!blob || blob.type !== 'image/webp' || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.webp', { type: 'image/webp' });
  } catch {
    return file;
  }
}
