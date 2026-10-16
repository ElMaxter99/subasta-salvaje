import { getCatalogEntry } from '@/lib/domain/initial-catalog';
import { renderScene } from './demo';

/** SVG de una imagen inicial de la galería. Sin marca «DEMO»: es una ilustración incluida, no una generación. */
export function catalogSceneSvg(id: string): Uint8Array | null {
  const entry = getCatalogEntry(id);
  return entry ? new TextEncoder().encode(renderScene(entry.id, entry.label, false)) : null;
}
