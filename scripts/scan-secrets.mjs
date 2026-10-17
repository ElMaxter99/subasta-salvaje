#!/usr/bin/env node
/**
 * Escáner de secretos. Falla (exit 1) si encuentra credenciales:
 *   1) en los archivos versionados por git (excepto .env.example con valores vacíos),
 *   2) en el historial de git (patrones conocidos),
 *   3) en el bundle del NAVEGADOR (.next/static) tras `npm run build`, incluidos los valores EXACTOS de las
 *      variables secretas definidas en tu entorno / .env.local.
 *   npm run scan:secrets
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const PATTERNS = [
  ['Token de Cloudflare', /cf[ua]t_[A-Za-z0-9_-]{16,}/],
  ['Clave secreta de Supabase', /sb_secret_[A-Za-z0-9_-]{8,}/],
  ['Clave de OpenAI', /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/],
  ['Clave de Resend', /\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{16,}/],
  ['JWT (p. ej. service_role)', /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/],
];
const SECRET_VARS = ['CLOUDFLARE_API_TOKEN', 'OPENAI_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'CRON_SECRET', 'RESEND_API_KEY'];
let problems = 0;
const fail = (msg) => {
  problems++;
  console.error(`✖ ${msg}`);
};

// valores secretos reales (entorno + .env.local), para buscarlos literalmente
const secrets = new Map();
const addEnv = (k, v) => v && v.trim().length >= 8 && SECRET_VARS.includes(k) && secrets.set(v.trim(), k);
for (const k of SECRET_VARS) addEnv(k, process.env[k]);
for (const f of ['.env', '.env.local', '.env.production', '.env.production.local']) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) addEnv(m[1], m[2].replace(/^['"]|['"]$/g, ''));
  }
}

// 1) archivos versionados
const tracked = execFileSync('git', ['ls-files', '-z']).toString().split('\0').filter(Boolean);
for (const f of tracked) {
  if (f === 'package-lock.json' || /\.(png|jpe?g|webp|ico|woff2?)$/.test(f)) continue;
  let text;
  try {
    text = readFileSync(f, 'utf8');
  } catch {
    continue;
  }
  for (const [name, re] of PATTERNS) if (re.test(text)) fail(`${name} en el archivo versionado ${f}`);
  for (const [value, k] of secrets) if (text.includes(value)) fail(`El valor de ${k} aparece en el archivo versionado ${f}`);
}
if (tracked.some((f) => /^\.env(\.|$)/.test(f) && f !== '.env.example')) fail('Hay un archivo .env versionado (solo se permite .env.example)');

// 2) historial de git
const GIT_PATTERNS = [
  ['Token de Cloudflare', 'cf[ua]t_[A-Za-z0-9_-]{16,}'],
  ['Clave secreta de Supabase', 'sb_secret_[A-Za-z0-9_-]{8,}'],
  ['Clave de OpenAI', 'sk-[A-Za-z0-9_-]{20,}'],
  ['JWT (p. ej. service_role)', 'eyJ[A-Za-z0-9_-]{20,}[.][A-Za-z0-9_-]{20,}[.][A-Za-z0-9_-]{20,}'],
];
for (const [name, ere] of GIT_PATTERNS) {
  const out = execFileSync('git', ['log', '--all', '-G', ere, '--oneline', '--', '.', ':!package-lock.json']).toString().trim();
  if (out) fail(`${name} aparece en el historial de git:\n${out}`);
}

// 3) bundle del navegador
const walk = (dir) => (existsSync(dir) ? readdirSync(dir).flatMap((n) => (statSync(path.join(dir, n)).isDirectory() ? walk(path.join(dir, n)) : [path.join(dir, n)])) : []);
const files = walk('.next/static');
if (files.length === 0) console.warn('⚠ No hay .next/static: ejecuta `npm run build` antes para comprobar el bundle del navegador.');
for (const f of files) {
  if (!/\.(js|css|html|json|map)$/.test(f)) continue;
  const text = readFileSync(f, 'utf8');
  for (const [value, k] of secrets) if (text.includes(value)) fail(`El valor de ${k} está en el bundle del navegador: ${f}`);
  for (const [name, re] of PATTERNS.slice(0, 1).concat(PATTERNS.slice(3))) {
    const m = re.exec(text);
    if (m && !/^sb_secret_/.test(m[0])) fail(`${name} en el bundle del navegador: ${f}`);
  }
}

if (problems) {
  console.error(`\n${problems} problema(s). NO despliegues hasta resolverlos y, si un secreto se publicó, ROTA esa credencial.`);
  process.exit(1);
}
console.log(`✔ Sin secretos en ${tracked.length} archivos versionados, el historial de git y ${files.length} archivos del bundle del navegador.`);
