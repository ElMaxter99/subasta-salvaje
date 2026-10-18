/** `npm run templates:validate`: valida TODOS los JSON de docs/plantillas-sistema/ contra el esquema real y las reglas del catálogo. Sale con código 1 si hay errores. */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { validatePack, type BundleEntry } from '@/lib/domain/system-template-pack';
import { loadBundleFile, loadSources, PACK_DIR } from './pack';

const problems: string[] = [];
const bundle = loadBundleFile();
// 1) cada <slug>.json suelto es exactamente la plantilla del lote; 2) el lote coincide con la fuente (nada desactualizado)
for (const e of bundle.plantillas) {
  const f = path.join(PACK_DIR, `${e.slug}.json`);
  if (!existsSync(f)) problems.push(`falta ${e.slug}.json`);
  else if (JSON.stringify(JSON.parse(readFileSync(f, 'utf8'))) !== JSON.stringify(e.plantilla)) problems.push(`${e.slug}.json no coincide con lote.json (ejecuta npm run templates:build)`);
}
const known = new Set(bundle.plantillas.map((e) => `${e.slug}.json`));
for (const f of readdirSync(PACK_DIR)) if (f.endsWith('.json') && !['lote.json', 'indice.json'].includes(f) && !known.has(f)) problems.push(`${f} no está en lote.json`);
const fresh = loadSources();
if (JSON.stringify(fresh) !== JSON.stringify(bundle.plantillas)) problems.push('lote.json no está al día con fuente/*.txt (ejecuta npm run templates:build)');

const report = validatePack(bundle.plantillas as BundleEntry[]);
problems.push(...report.errors);
for (const w of report.warnings) console.warn(`  ! ${w}`);
if (problems.length) {
  console.error(problems.map((p) => `  ✗ ${p}`).join('\n'));
  console.error(`\n${problems.length} problema(s).`);
  process.exit(1);
}
console.log(`OK: ${bundle.plantillas.length} plantillas válidas (${report.warnings.length} avisos).`);
