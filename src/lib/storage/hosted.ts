import { githubAssetsConfig } from '@/lib/config/env';

/**
 * Imágenes ya ALOJADAS en nuestro repositorio público de fotos (GitHub + jsDelivr): se usan por enlace, sin descargarlas ni copiarlas
 * al almacenamiento de la partida. Una referencia de imagen (`storage_path` / `image_path`) que empieza por `https://` es de este tipo.
 * Solo se admiten enlaces de NUESTRO repositorio (`GITHUB_ASSETS_REPO`); cualquier otro servidor se sigue descargando y normalizando.
 */
export const isExternalRef = (ref: string | null | undefined): ref is string => typeof ref === 'string' && /^https:\/\//i.test(ref);

/** Ruta dentro del repositorio de fotos a partir de un enlace de jsDelivr de ESE repositorio (o null si el enlace es de otro sitio). */
export function hostedRepoPath(url: string | null | undefined): string | null {
  const cfg = githubAssetsConfig();
  if (!url || !cfg) return null;
  const m = new RegExp(`^https://cdn\\.jsdelivr\\.net/gh/${cfg.repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}@[^/?#]+/([^?#]+)$`).exec(url);
  return m ? m[1]! : null;
}

/** ¿Es un enlace de imagen de nuestro repositorio alojado y con un formato de imagen conocido? */
export function isHostedImage(url: string | null | undefined): url is string {
  const p = hostedRepoPath(url);
  return Boolean(p && /\.(webp|png|jpe?g)$/i.test(p));
}

export function mimeFromExtension(url: string): string {
  return /\.png(\?|$)/i.test(url) ? 'image/png' : /\.jpe?g(\?|$)/i.test(url) ? 'image/jpeg' : 'image/webp';
}
