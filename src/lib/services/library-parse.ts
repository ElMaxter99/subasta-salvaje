import { slugify } from '@/lib/domain/template-assets';

/**
 * Líneas de texto «Nombre; Descripción; Emoji» → productos. Si hay una imagen de la biblioteca cuyo título (sin tildes ni
 * mayúsculas) coincide con el nombre, se enlaza sola. Devuelve también las líneas descartadas.
 */
export function parseItemLines(text: string, images: { id: string; title: string; collection: string }[], collection: string): { items: LibraryItemLine[]; ignored: string[] } {
  const bySlug = new Map<string, string>();
  for (const i of images) if (!collection || i.collection === collection) bySlug.set(slugify(i.title), i.id);
  const items: LibraryItemLine[] = [];
  const ignored: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const [name = '', description = '', emoji = ''] = line.split(/[;\t]/).map((s) => s.trim());
    if (!name || name.length > 80) { ignored.push(line.slice(0, 60)); continue; }
    items.push({ name, description, emoji: emoji || null, collection, image_id: bySlug.get(slugify(name)) ?? null });
  }
  return { items, ignored };
}

export interface LibraryItemLine { name: string; description?: string; emoji?: string | null; image_id?: string | null; collection?: string }
