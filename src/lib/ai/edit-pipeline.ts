import { imageEditGuard } from '@/lib/config/env';
import { normalizeImage, type ImageKind } from '@/lib/images/normalize';
import { validateProviderOutput } from './image-validation';
import { applyEditGuard } from './region-guard';
import { ProviderError, type EditSceneInput, type GeneratedImage, type ImageGenerationProvider } from './types';

/**
 * Tubería de edición COMPARTIDA por las compras reales (`jobs-service`) y el comparador de modelos del superadmin
 * (`compare-service`): así lo que se compara es exactamente lo que ocurriría en una partida.
 */

/**
 * Edita con el proveedor (prompt de `buildEditPrompt` dentro de cada adaptador) y aplica la guardia de zona (IMAGE_EDIT_GUARD) cuando
 * hay compras anteriores: red de seguridad que restaura un objeto añadido antes si el modelo lo «pierde». La composición (collage) ya
 * lo conserva por construcción y los SVG de la galería no se tocan.
 */
export async function editWithGuard(provider: ImageGenerationProvider, input: EditSceneInput): Promise<GeneratedImage> {
  const edited = await provider.editScene(input);
  if (input.previousItems.length > 0 && !edited.model.endsWith('+compose') && input.base.mime !== 'image/svg+xml') {
    const g = await applyEditGuard(imageEditGuard(), input.base.bytes, edited.bytes, input.previousItems.length);
    if (g.applied) return { ...edited, bytes: g.bytes, mime: 'image/png', prompt: `${edited.prompt} [guardia de zona: ${g.note}]` };
  }
  return edited;
}

/**
 * Valida la salida del proveedor y la pasa al formato interno único (WebP, tamaño y peso fijos), como antes de guardar una imagen.
 * Los SVG de pegatinas (solo el proveedor `demo`) se dejan como están.
 */
export async function finalizeProviderImage(image: GeneratedImage, kind: ImageKind, isDemo: boolean): Promise<{ image: GeneratedImage; mime: string }> {
  let mime = validateProviderOutput(image, isDemo);
  if (mime === 'image/svg+xml') return { image, mime };
  try {
    const n = await normalizeImage(image.bytes, kind);
    mime = n.mime;
    return { image: { ...image, bytes: n.bytes, mime: n.mime }, mime };
  } catch (e) {
    throw new ProviderError(`Imagen devuelta no válida: ${(e as Error).message}`, true);
  }
}
