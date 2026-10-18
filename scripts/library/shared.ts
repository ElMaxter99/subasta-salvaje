/**
 * Utilidades compartidas por los scripts de descarga de la biblioteca (Commons, Openverse, museos): estado de la carpeta local
 * (`fuentes.json`) y regeneración de manifest.csv, FUENTES.md e index.html a partir de lo que SIGUE existiendo en disco.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { manifestToCsv, type ManifestRow } from '../../src/lib/library/commons';

export const stateFile = (out: string) => join(out, 'fuentes.json');
export const loadState = (out: string): ManifestRow[] => (existsSync(stateFile(out)) ? (JSON.parse(readFileSync(stateFile(out), 'utf8')) as ManifestRow[]) : []);
export const saveState = (out: string, rows: ManifestRow[]): void => writeFileSync(stateFile(out), JSON.stringify(rows, null, 2));

/** Reescribe manifest.csv, FUENTES.md, index.html y productos.txt a partir de lo que SIGUE existiendo en disco. */
export function writeIndexes(out: string, open: boolean): void {
  const rows = loadState(out).filter((r) => existsSync(join(out, r.coleccion, r.archivo)));
  saveState(out, rows);
  writeFileSync(join(out, 'manifest.csv'), manifestToCsv(rows));
  writeFileSync(join(out, 'FUENTES.md'), `# Fuentes de las imágenes\n\n${rows.map((r) => `- **${r.coleccion}/${r.archivo}**: ${r.autor} · ${r.licencia} · ${r.fuente}`).join('\n')}\n`);
  const cols = [...new Set(rows.map((r) => r.coleccion))];
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const body = cols.map((c) => `<h2>${esc(c)} <small>(${rows.filter((r) => r.coleccion === c).length})</small></h2><div class="g">${rows.filter((r) => r.coleccion === c).map((r) => `<figure><img loading="lazy" src="${encodeURI(`${r.coleccion}/${r.archivo}`)}"><figcaption><b>${esc(r.titulo)}</b><br>${esc(r.autor)} · ${esc(r.licencia)}<br><a href="${esc(r.fuente)}" target="_blank" rel="noreferrer">origen</a><br><small>${esc(r.archivo)}</small></figcaption></figure>`).join('')}</div>`).join('');
  writeFileSync(join(out, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Biblioteca pendiente</title><style>body{font:14px system-ui;background:#111;color:#eee;margin:16px}.g{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px}figure{margin:0;background:#1d1d2a;border-radius:10px;overflow:hidden}img{width:100%;aspect-ratio:1;object-fit:cover;display:block}figcaption{padding:6px;font-size:12px}a{color:#fbbf24}</style><h1>Biblioteca pendiente (${rows.length} imágenes)</h1><p>Borra de las carpetas lo que no sirva y ejecuta <code>npm run library:fetch -- --index-only</code>. Luego sube la carpeta entera en Superadmin → Biblioteca → «Elegir una carpeta».</p>${body}`);
  if (open) {
    const index = join(out, 'index.html');
    const [cmd, args] = process.platform === 'darwin' ? ['open', [index]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', index]] : ['xdg-open', [index]];
    execFile(cmd, args, () => undefined);
  }
  console.log(`\n✔ ${rows.length} imágenes en ${cols.length} colecciones.\n  Revisa: ${join(out, 'index.html')}\n  Luego sube la carpeta «${out}» en Superadmin → Biblioteca → Imágenes → «Elegir una carpeta».`);
}

