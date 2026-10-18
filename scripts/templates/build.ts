/** `npm run templates:build`: regenera los JSON de docs/plantillas-sistema/ y la tabla de docs/PLANTILLAS-SISTEMA-CATALOGO.md desde fuente/*.txt. */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { validatePack } from '@/lib/domain/system-template-pack';
import { loadSources, writeGenerated } from './pack';

const entries = loadSources();
const report = validatePack(entries);
if (report.errors.length) {
  console.error(report.errors.map((e) => `  ✗ ${e}`).join('\n'));
  console.error(`\n${report.errors.length} error(es): no se genera nada.`);
  process.exit(1);
}
writeGenerated(entries);

const rows = entries.map((e) => {
  const t = e.plantilla as { nombre: string; reglas: { presupuesto: number; rondas_maximas: number }; catalogo: unknown[] };
  const v = e.variante;
  const variante = v ? [v.edad && `edad: ${v.edad}`, v.duracion && `duración: ${v.duracion}`, v.jugadores && `jugadores: ${v.jugadores}`].filter(Boolean).join(' · ') : '';
  return `| \`${e.slug}\` | ${t.nombre} | ${e.tono ?? ''} | ${t.catalogo.length} | ${t.reglas.presupuesto} | ${t.reglas.rondas_maximas} | ${v ? `\`${v.base ?? ''}\`` : ''} | ${variante} |`;
});
const table = ['<!-- inicio-tabla (generada por npm run templates:build) -->', '| Slug | Título | Tono | Elementos | Presupuesto (Ohros) | Rondas | Base | Variante |', '|---|---|---|---|---|---|---|---|', ...rows, '<!-- fin-tabla -->'].join('\n');
const doc = path.join(process.cwd(), 'docs', 'PLANTILLAS-SISTEMA-CATALOGO.md');
let md = readFileSync(doc, 'utf8');
md = md.replace(/<!-- inicio-tabla[\s\S]*?<!-- fin-tabla -->/, table);
writeFileSync(doc, md);
console.log(`Generadas ${entries.length} plantillas (${entries.reduce((n, e) => n + (e.plantilla as { catalogo: unknown[] }).catalogo.length, 0)} elementos). Avisos: ${report.warnings.length}.`);
