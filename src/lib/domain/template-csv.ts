import { isLocalPhotoPath, TEMPLATE_LIMITS, type TemplateFormValues } from './template';

/**
 * Catálogo en CSV (se abre y edita en Excel, Google Sheets o LibreOffice). Primera fila = cabecera con las columnas
 * `titulo` (obligatoria), `descripcion`, `emoji` y `foto` (URL https; en un ZIP también una ruta fotos/archivo.jpg).
 * Admite `,` `;` o tabulador como separador (Excel en español usa `;`), comillas dobles y saltos de línea dentro de comillas.
 */
const ALIASES: Record<string, 'titulo' | 'descripcion' | 'emoji' | 'foto'> = {
  titulo: 'titulo', título: 'titulo', nombre: 'titulo', elemento: 'titulo', name: 'titulo', title: 'titulo',
  descripcion: 'descripcion', descripción: 'descripcion', description: 'descripcion',
  emoji: 'emoji', icono: 'emoji',
  foto: 'foto', imagen: 'foto', url: 'foto', photo: 'foto', image: 'foto',
};

/** Divide el texto en filas de celdas respetando comillas. */
function rows(text: string, sep: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else q = false;
      } else cell += c;
    } else if (c === '"' && cell === '') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); out.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length > 0) { row.push(cell); out.push(row); }
  return out.filter((r) => r.some((x) => x.trim() !== ''));
}

const clean = (s: string) => s.normalize('NFKC').replace(/\s+/g, ' ').replace(/[\p{Cc}\p{Cf}]/gu, '').trim();

export type CsvParse = { ok: true; items: NonNullable<TemplateFormValues['items']>; warnings: string[] } | { ok: false; errors: string[] };

export function parseCatalogCsv(raw: string, opts: { zip?: boolean } = {}): CsvParse {
  if (raw.length > TEMPLATE_LIMITS.fileBytes) return { ok: false, errors: [`El archivo es demasiado grande (máximo ${TEMPLATE_LIMITS.fileBytes / 1024} KB).`] };
  const text = raw.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const sep = [';', '\t', ','].map((s) => [s, firstLine.split(s).length] as const).sort((a, b) => b[1] - a[1])[0]![0];
  const table = rows(text, sep);
  if (table.length < 2) return { ok: false, errors: ['El CSV necesita una fila de cabecera (titulo, descripcion, emoji, foto) y al menos un elemento.'] };
  const header = table[0]!.map((h) => ALIASES[h.trim().toLowerCase()] ?? null);
  if (!header.includes('titulo')) return { ok: false, errors: ['Falta la columna «titulo» en la cabecera (acepta también nombre o elemento).'] };
  const col = (k: string) => header.indexOf(k as never);
  const data = table.slice(1);
  if (data.length > TEMPLATE_LIMITS.items) return { ok: false, errors: [`Hay ${data.length} elementos y el máximo es ${TEMPLATE_LIMITS.items}.`] };
  const errors: string[] = [];
  const warnings: string[] = [];
  const items: NonNullable<TemplateFormValues['items']> = [];
  data.forEach((r, i) => {
    const get = (k: string) => (col(k) >= 0 ? (r[col(k)] ?? '') : '');
    const name = clean(get('titulo'));
    const n = i + 2; // número de fila en la hoja de cálculo
    if (!name) return void errors.push(`Fila ${n}: falta el título.`);
    if (name.length > 80) return void errors.push(`Fila ${n}: el título supera los 80 caracteres.`);
    const description = clean(get('descripcion'));
    if (description.length > 500) return void errors.push(`Fila ${n}: la descripción supera los 500 caracteres.`);
    const emoji = get('emoji').trim() || null;
    if (emoji && emoji.length > 8) return void errors.push(`Fila ${n}: el emoji es demasiado largo.`);
    const foto = get('foto').trim();
    let photoUrl: string | null = null;
    let photoPath: string | null = null;
    if (foto) {
      if (/^https:\/\//i.test(foto) && foto.length <= 500) photoUrl = foto;
      else if (opts.zip && isLocalPhotoPath(foto)) photoPath = foto.replace(/\\/g, '/');
      else warnings.push(`Fila ${n} («${name}»): la foto debe ser una URL https://${opts.zip ? ' o una ruta dentro del ZIP' : ''}; se ignorará.`);
    }
    items.push({ name, description, emoji, photoUrl, photoPath });
  });
  if (errors.length > 0) return { ok: false, errors: errors.slice(0, 12) };
  const titles = items.map((i) => i.name.toLowerCase());
  if (new Set(titles).size !== titles.length) warnings.push('Hay elementos con el mismo título.');
  return { ok: true, items, warnings };
}

/** Catálogo → CSV con `;` (lo abre bien Excel en español) y BOM. */
export function catalogToCsv(items: { name: string; description: string; emoji: string | null }[]): string {
  const q = (s: string) => (/[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return '﻿' + ['titulo;descripcion;emoji;foto', ...items.map((i) => [q(i.name), q(i.description), q(i.emoji ?? ''), ''].join(';'))].join('\r\n') + '\r\n';
}
