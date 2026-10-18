/**
 * Lee y escribe el catálogo de plantillas del sistema de `docs/plantillas-sistema/`.
 * Fuente editable: `fuente/<slug>.txt` (cabecera `# clave: valor`, línea `---`, y un elemento por línea: `emoji | Título | descripción | etiquetas`).
 * Generado (no editar a mano): `<slug>.json` (formato de plantilla), `lote.json` e `indice.json`.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { BUNDLE_FORMAT, type BundleEntry } from '@/lib/domain/system-template-pack';
import { TEMPLATE_FORMAT } from '@/lib/domain/template';

export const PACK_DIR = path.join(process.cwd(), 'docs', 'plantillas-sistema');
export const SOURCE_DIR = path.join(PACK_DIR, 'fuente');

export function parseSource(slug: string, text: string, index: number): BundleEntry {
  const [head = '', body = ''] = text.split(/^---\s*$/m);
  const meta: Record<string, string> = {};
  for (const line of head.split('\n')) {
    const m = /^#\s*([a-z_]+):\s*(.*)$/.exec(line.trim());
    if (m) meta[m[1]!] = m[2]!.trim();
  }
  const items: { titulo: string; descripcion: string; emoji: string }[] = [];
  const tags: string[][] = [];
  body.split('\n').map((l) => l.trim()).filter(Boolean).forEach((line, n) => {
    const parts = line.split('|').map((p) => p.trim());
    if (parts.length !== 4) throw new Error(`${slug}: la línea ${n + 1} no tiene 4 campos separados por «|»: ${line}`);
    items.push({ emoji: parts[0]!, titulo: parts[1]!, descripcion: parts[2]! });
    tags.push(parts[3]!.split(',').map((t) => t.trim()).filter(Boolean));
  });
  const num = (k: string, d: number) => (meta[k] ? Number(meta[k]!.replace(',', '.')) : d);
  return {
    slug,
    titulo: meta.nombre ?? slug,
    descripcion: meta.descripcion ?? '',
    orden: 200 + index * 10,
    tono: meta.tono,
    etiquetas: tags,
    plantilla: {
      formato: TEMPLATE_FORMAT,
      nombre: meta.nombre ?? slug,
      tematica: meta.tematica ?? 'Otra',
      reglas: { presupuesto: num('presupuesto', 20), puja_minima: num('puja_minima', 1), rondas_maximas: Math.min(num('rondas', 10), items.length), pujas_enteras: true, clasificacion: meta.clasificacion ?? 'elementos', modo_juego: 'movil', modo_imagenes: 'pegatinas' },
      catalogo: items.map((i) => ({ titulo: i.titulo, descripcion: i.descripcion, emoji: i.emoji, foto: null })),
    },
  };
}

export function loadSources(): BundleEntry[] {
  return readdirSync(SOURCE_DIR).filter((f) => f.endsWith('.txt')).sort().map((f, i) => parseSource(f.replace(/\.txt$/, ''), readFileSync(path.join(SOURCE_DIR, f), 'utf8'), i));
}

/** Lee el lote generado (`lote.json`) tal como se commitea. */
export function loadBundleFile(): { formato: string; plantillas: BundleEntry[] } {
  return JSON.parse(readFileSync(path.join(PACK_DIR, 'lote.json'), 'utf8'));
}

export function writeGenerated(entries: BundleEntry[]): void {
  for (const e of entries) writeFileSync(path.join(PACK_DIR, `${e.slug}.json`), JSON.stringify(e.plantilla, null, 2) + '\n');
  writeFileSync(path.join(PACK_DIR, 'lote.json'), JSON.stringify({ formato: BUNDLE_FORMAT, plantillas: entries }, null, 1) + '\n');
  const idx = entries.map((e) => ({ slug: e.slug, titulo: e.titulo, tono: e.tono, orden: e.orden, elementos: ((e.plantilla as { catalogo: unknown[] }).catalogo).length, archivo: `${e.slug}.json` }));
  writeFileSync(path.join(PACK_DIR, 'indice.json'), JSON.stringify({ formato: 'subasta-salvaje/indice-plantillas@1', plantillas: idx }, null, 2) + '\n');
}

export const hasSources = () => existsSync(SOURCE_DIR);
