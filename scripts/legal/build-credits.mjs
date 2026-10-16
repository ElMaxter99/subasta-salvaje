// Genera src/lib/legal/credits.generated.json con las dependencias DIRECTAS de package.json
// (nombre, versión instalada, licencia SPDX, web). Uso: node scripts/legal/build-credits.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const pkg = readJson(path.join(root, 'package.json'));

function licenseOf(meta) {
  const l = meta.license ?? meta.licenses;
  if (typeof l === 'string') return l;
  if (l && typeof l === 'object' && !Array.isArray(l)) return l.type ?? '';
  if (Array.isArray(l)) return l.map((x) => (typeof x === 'string' ? x : x.type)).filter(Boolean).join(' OR ');
  return '';
}
function repoOf(meta) {
  const r = typeof meta.repository === 'string' ? meta.repository : meta.repository?.url ?? '';
  return r.replace(/^git\+/, '').replace(/\.git$/, '').replace(/^git:\/\//, 'https://').replace(/^github:/, 'https://github.com/');
}

function collect(group) {
  return Object.keys(pkg[group] ?? {}).sort().map((name) => {
    const file = path.join(root, 'node_modules', ...name.split('/'), 'package.json');
    let meta;
    try { meta = readJson(file); } catch { throw new Error(`No está instalado ${name}: ejecuta «npm install» antes de generar los créditos.`); }
    const license = licenseOf(meta);
    if (!license) throw new Error(`${name} no declara licencia en su package.json: revísalo a mano.`);
    return { name, version: meta.version, license, homepage: meta.homepage || repoOf(meta) || `https://www.npmjs.com/package/${name}` };
  });
}

const out = { generatedFrom: 'package.json', dependencies: collect('dependencies'), devDependencies: collect('devDependencies') };
const dest = path.join(root, 'src', 'lib', 'legal', 'credits.generated.json');
mkdirSync(path.dirname(dest), { recursive: true });
writeFileSync(dest, JSON.stringify(out, null, 2) + '\n');
console.log(`credits: ${out.dependencies.length} de ejecución + ${out.devDependencies.length} de desarrollo -> ${path.relative(root, dest)}`);
