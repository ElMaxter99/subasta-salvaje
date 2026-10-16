import { THEME_PRESETS } from './themes';

/** Galería de imágenes iniciales incluidas en la app (ilustraciones locales, NO generadas por IA). */
export interface InitialCatalogEntry {
  id: string;
  label: string;
  emoji: string;
}

export const INITIAL_CATALOG: InitialCatalogEntry[] = THEME_PRESETS.map((t) => ({ id: t.id, label: `${t.label} vacía`, emoji: t.emoji }));

export function getCatalogEntry(id: string): InitialCatalogEntry | undefined {
  return INITIAL_CATALOG.find((e) => e.id === id);
}
