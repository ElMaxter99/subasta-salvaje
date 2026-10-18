/**
 * Lee y escribe el catálogo de plantillas del sistema de `docs/plantillas-sistema/`.
 * Fuente editable: `fuente/<slug>.txt` (cabecera `# clave: valor`, línea `---`, y un elemento por línea: `emoji | Título | descripción | etiquetas`).
 * Generado (no editar a mano): `<slug>.json` (formato de plantilla), `lote.json` e `indice.json`.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { BUNDLE_FORMAT, VARIANT_AGES, VARIANT_DURATIONS, VARIANT_PLAYERS, type BundleEntry, type Variant } from '@/lib/domain/system-template-pack';
import { TEMPLATE_FORMAT } from '@/lib/domain/template';

export const PACK_DIR = path.join(process.cwd(), 'docs', 'plantillas-sistema');
export const SOURCE_DIR = path.join(PACK_DIR, 'fuente');
/** Variantes (edad, duración, jugadores) de las plantillas base: `fuente/variantes/<slug>.txt`, con las cabeceras extra `# base`, `# edad`, `# duracion`, `# jugadores`. */
export const VARIANT_DIR = path.join(SOURCE_DIR, 'variantes');

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
  const pick = <T extends string>(k: string, allowed: readonly T[]): T | undefined => {
    const v = meta[k];
    if (v === undefined) return undefined;
    if (!(allowed as readonly string[]).includes(v)) throw new Error(`${slug}: «${k}» debe ser uno de ${allowed.join(', ')} (es «${v}»)`);
    return v as T;
  };
  const variante: Variant | undefined = meta.edad || meta.duracion || meta.jugadores || meta.base
    ? { ...(meta.base ? { base: meta.base } : {}), ...(meta.edad ? { edad: pick('edad', VARIANT_AGES) } : {}), ...(meta.duracion ? { duracion: pick('duracion', VARIANT_DURATIONS) } : {}), ...(meta.jugadores ? { jugadores: pick('jugadores', VARIANT_PLAYERS) } : {}) }
    : undefined;
  const num = (k: string, d: number) => (meta[k] ? Number(meta[k]!.replace(',', '.')) : d);
  return {
    slug,
    titulo: meta.nombre ?? slug,
    descripcion: meta.descripcion ?? '',
    orden: 200 + index * 10,
    tono: meta.tono,
    etiquetas: tags,
    ...(variante ? { variante } : {}),
    plantilla: {
      formato: TEMPLATE_FORMAT,
      nombre: meta.nombre ?? slug,
      tematica: meta.tematica ?? 'Otra',
      reglas: { presupuesto: num('presupuesto', 20), puja_minima: num('puja_minima', 1), rondas_maximas: Math.min(num('rondas', 10), items.length), pujas_enteras: true, clasificacion: meta.clasificacion ?? 'elementos', modo_juego: 'movil', modo_imagenes: 'pegatinas' },
      catalogo: items.map((i) => ({ titulo: i.titulo, descripcion: i.descripcion, emoji: i.emoji, foto: null })),
    },
  };
}

/** Primero las plantillas base (orden histórico, sin cambios) y a continuación las variantes, también por orden alfabético. */
export function loadSources(): BundleEntry[] {
  const list = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.txt')).sort().map((f) => path.join(dir, f)) : []);
  return [...list(SOURCE_DIR), ...list(VARIANT_DIR)].map((f, i) => parseSource(path.basename(f).replace(/\.txt$/, ''), readFileSync(f, 'utf8'), i));
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
