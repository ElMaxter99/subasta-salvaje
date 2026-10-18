/**
 * `npm run templates:import`: importa el catálogo de docs/plantillas-sistema/lote.json como plantillas del sistema.
 *
 *   npm run templates:import                      # ENSAYO: valida e importa en una base PGlite en memoria; no toca nada real
 *   npm run templates:import -- --apply           # escribe en la base que use la app (Supabase si hay credenciales; si no, .demo-data)
 *   npm run templates:import -- --apply --publish # además las publica (por defecto quedan en BORRADOR; publica a mano el superadmin)
 *   npm run templates:import -- --only=cena-de-empresa,noche-de-cine --file=ruta/otro-lote.json
 *
 * Idempotente por identificador (slug): repetirlo actualiza lo cambiado y no duplica. Nunca borra. No sube imágenes ni llama a ningún
 * servicio externo (las plantillas van solo con emojis). Con --apply sobre Supabase usa SUPABASE_SERVICE_ROLE_KEY de .env.local.
 */
import { readFileSync } from 'node:fs';
import { createPgliteDb } from '@/lib/db/pglite';
import type { Db } from '@/lib/db/types';
import { getRuntimeMode } from '@/lib/config/env';
import { parseBundle, validatePack } from '@/lib/domain/system-template-pack';
import { getContext } from '@/lib/services/context';
import { importSystemTemplates } from '@/lib/services/system-template-import';
import { loadBundleFile } from './pack';

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);

async function main() {
  const apply = flag('apply');
  const publish = flag('publish');
  if (publish && !apply) throw new Error('--publish solo tiene sentido con --apply.');
  const file = opt('file');
  let entries = file ? (() => { const r = parseBundle(readFileSync(file, 'utf8')); if (!r.ok) throw new Error(r.error); return r.bundle.plantillas; })() : loadBundleFile().plantillas;
  const only = opt('only')?.split(',').map((s) => s.trim()).filter(Boolean);
  if (only) {
    const missing = only.filter((s) => !entries.some((e) => e.slug === s));
    if (missing.length) throw new Error(`No existen en el lote: ${missing.join(', ')}`);
    entries = entries.filter((e) => only.includes(e.slug));
  }
  if (!file) {
    const rep = validatePack(entries);
    if (rep.errors.length) throw new Error(`El catálogo no valida (ejecuta npm run templates:validate):\n${rep.errors.slice(0, 5).join('\n')}`);
  }

  let ctx: { db: Db };
  let pglite: Awaited<ReturnType<typeof createPgliteDb>> | null = null;
  let where: string;
  if (apply) {
    const c = await getContext();
    ctx = c;
    where = c.mode === 'supabase' ? 'SUPABASE (base configurada)' : 'modo demo local (.demo-data)';
  } else {
    pglite = await createPgliteDb();
    ctx = { db: pglite };
    where = 'ENSAYO en memoria (no se escribe nada real)';
  }
  console.log(`Destino: ${where}${apply ? ` · modo ${getRuntimeMode()}` : ''} · ${entries.length} plantillas · ${publish ? 'con publicación' : 'en borrador'}`);
  const results = await importSystemTemplates(ctx, 'script-importador', entries, { publish });
  for (const r of results) console.log(`  ${r.action === 'error' ? '✗' : '✓'} ${r.slug.padEnd(32)} ${r.action}${r.status ? ` (${r.status === 'published' ? 'publicada' : 'borrador'})` : ''}${r.error ? ` — ${r.error}` : ''}`);
  const c = (a: string) => results.filter((r) => r.action === a).length;
  console.log(`\nCreadas ${c('created')} · actualizadas ${c('updated')} · sin cambios ${c('unchanged')} · errores ${c('error')}`);
  if (!apply) console.log('Era un ensayo. Para importar de verdad: npm run templates:import -- --apply');
  if (c('error')) process.exit(1);
  await pglite?.close();
  process.exit(0);
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
