import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Tipografías de la marca para las imágenes generadas con satori (`next/og`): podio y Open Graph.
 * Satori no lee woff2 ni fuentes variables, así que se empaquetan instancias estáticas TTF (subconjunto latino, SIL OFL 1.1)
 * en `src/assets/fonts/`. Ver docs/FUENTE-PODIO.md. Si alguna no se puede leer, `loadBrandFonts()` devuelve null y quien
 * dibuja vuelve a la fuente por defecto de `next/og` (Geist) simulando la negrita con contorno.
 */
export const FONT_DIR = path.join(process.cwd(), 'src', 'assets', 'fonts');
export const TITLE_FAMILY = 'Baloo 2';
export const BODY_FAMILY = 'Nunito';

export const BRAND_FONT_FILES = [
  { name: TITLE_FAMILY, file: 'Baloo2-Bold.ttf', weight: 700 },
  { name: TITLE_FAMILY, file: 'Baloo2-ExtraBold.ttf', weight: 800 },
  { name: BODY_FAMILY, file: 'Nunito-Regular.ttf', weight: 400 },
  { name: BODY_FAMILY, file: 'Nunito-Bold.ttf', weight: 700 },
] as const;

export interface SatoriFont {
  name: string;
  data: Buffer;
  weight: 400 | 700 | 800;
  style: 'normal';
}

let cache: Promise<SatoriFont[] | null> | null = null;

/** Lee las cuatro fuentes una sola vez (caché en memoria). Cualquier fallo → null (y se reintenta en la siguiente llamada). */
export function loadBrandFonts(): Promise<SatoriFont[] | null> {
  if (!cache) {
    cache = Promise.all(BRAND_FONT_FILES.map(async (f) => ({ name: f.name, data: await readFile(path.join(FONT_DIR, f.file)), weight: f.weight as 400 | 700 | 800, style: 'normal' as const }))).catch(() => {
      cache = null;
      return null;
    });
  }
  return cache;
}
