/**
 * `npm run templates:match`: casa los elementos de las plantillas del sistema con las fotos de la biblioteca (por título y etiquetas).
 *
 *   npm run templates:match                        # ENSAYO (por defecto): lee y propone; no escribe en ninguna base
 *   npm run templates:match -- --apply             # guarda las fotos de CONFIANZA ALTA en las plantillas del sistema que ya estén importadas, siempre en BORRADOR
 *   npm run templates:match -- --apply --min=media # aplica también las de confianza media (alta | media | baja)
 *   npm run templates:match -- --only=antiguo-egipto,noche-de-cine --file=ruta/lote.json --out=informe --threshold=0.45
 *
 * Lee la biblioteca de la base que use la app (Supabase si hay credenciales; si no, modo demo .demo-data) SOLO en lectura (fotos de rol `product`
 * revisadas). Informe: consola + `<out>/casamiento.json`, `casamiento.csv` y `huecos.csv` (por defecto `.match-report/`). Con --apply las plantillas se
 * actualizan por `saveSystemTemplate` (enlaces a la biblioteca, sin copiar ni subir imágenes); nunca publica ni pisa fotos existentes. Sin IA ni red.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseBundle } from '@/lib/domain/system-template-pack';
import { MATCH_DEFAULTS, normText, type Confidence } from '@/lib/library/match';
import { buildMatchReport, consoleSummary, gapsCsv, rowsCsv } from '@/lib/library/match-report';
import { getContext } from '@/lib/services/context';
import { applyMatchPicks, loadMatchableImages, proposeForCatalog, proposeForTemplate, type Proposal } from '@/lib/services/library-match-service';
import { listSystemTemplates } from '@/lib/services/system-template-service';
import { loadBundleFile } from './pack';

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const RANK: Record<Confidence, number> = { baja: 0, media: 1, alta: 2 };

async function main() {
  const apply = flag('apply');
  const min = (opt('min') ?? 'alta') as Confidence;
  if (!(min in RANK)) throw new Error('--min debe ser alta, media o baja.');
  const threshold = opt('threshold') ? Number(opt('threshold')) : MATCH_DEFAULTS.minScore;
  if (!(threshold > 0 && threshold <= 1)) throw new Error('--threshold debe estar entre 0 y 1.');
  const file = opt('file');
  let entries = file ? (() => { const r = parseBundle(readFileSync(file, 'utf8')); if (!r.ok) throw new Error(r.error); return r.bundle.plantillas; })() : loadBundleFile().plantillas;
  const only = opt('only')?.split(',').map((s) => s.trim()).filter(Boolean);
  if (only) entries = entries.filter((e) => only.includes(e.slug));

  const ctx = await getContext();
  console.log(`Base: ${ctx.mode === 'supabase' ? 'SUPABASE (lectura)' : 'modo demo local (.demo-data, lectura)'} · ${entries.length} plantillas del lote · ${apply ? `APLICAR (confianza ≥ ${min}, solo borradores)` : 'ENSAYO (no se escribe nada)'}`);
  const images = await loadMatchableImages(ctx);
  const opts = { minScore: threshold, images };
  const stored = apply ? new Map((await listSystemTemplates(ctx, { admin: true })).map((t) => [t.slug, t])) : null;

  const proposals: Proposal[] = [];
  const skipped: { slug: string; title: string; reason: string }[] = [];
  for (const e of entries) {
    if (!apply) {
      const cat = (e.plantilla as { catalogo?: never; tematica?: string }) as { catalogo: Parameters<typeof proposeForCatalog>[2]; tematica?: string };
      proposals.push(proposeForCatalog({ slug: e.slug, title: e.titulo }, cat.tematica ?? null, cat.catalogo, e.etiquetas, images, opts));
      continue;
    }
    const s = stored!.get(e.slug);
    if (!s) { skipped.push({ slug: e.slug, title: e.titulo, reason: 'no está importada (npm run templates:import -- --apply)' }); continue; }
    if (s.status !== 'draft') { skipped.push({ slug: e.slug, title: e.titulo, reason: 'está publicada: no se toca (retírala a borrador)' }); continue; }
    const tags = new Map<string, string[]>();
    const cat = (e.plantilla as { catalogo: { titulo: string }[] }).catalogo;
    cat.forEach((it, i) => { if (e.etiquetas?.[i]) tags.set(normText(it.titulo), e.etiquetas[i]!); });
    const p = await proposeForTemplate(ctx, s.id, { ...opts, tags });
    proposals.push(p);
    const picks = p.items.filter((i) => i.best && !i.hasPhoto && RANK[i.best.confidence] >= RANK[min]).map((i) => ({ index: i.index, image_id: i.best!.image.id }));
    if (picks.length) {
      const r = await applyMatchPicks(ctx, 'script-casamiento', { id: s.id, picks });
      console.log(`  ✓ ${e.slug}: ${r.applied.length} fotos aplicadas${r.skipped.length ? `, ${r.skipped.length} omitidas` : ''}`);
    }
  }

  const report = buildMatchReport(proposals, skipped);
  console.log(`\n${consoleSummary(report)}`);
  const out = path.resolve(opt('out') ?? '.match-report');
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, 'casamiento.json'), JSON.stringify(report, null, 2) + '\n');
  writeFileSync(path.join(out, 'casamiento.csv'), rowsCsv(report));
  writeFileSync(path.join(out, 'huecos.csv'), gapsCsv(report));
  console.log(`\nInforme escrito en ${out} (casamiento.json, casamiento.csv, huecos.csv)`);
  if (!apply) console.log('Era un ensayo. Para guardar las de confianza alta en las plantillas ya importadas (en borrador): npm run templates:match -- --apply');
  if (images.length === 0) console.log('Aviso: la biblioteca no tiene fotos de producto revisadas; el informe sirve de lista de huecos.');
  process.exit(0);
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
