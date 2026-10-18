import type { Proposal } from '@/lib/services/library-match-service';

/** Informe de casamiento: texto de consola, CSV por elemento y lista de huecos agregada (etiqueta → nº de elementos), sin dependencias de servidor. */
export interface MatchReport {
  generated: string;
  library: number;
  templates: { slug: string; title: string; total: number; matched: number; high: number; pct: number; skipped?: string }[];
  rows: { slug: string; index: number; title: string; tags: string; image_id: string; image_title: string; url: string; score: number; confidence: string; reasons: string }[];
  /** Palabras (etiquetas del lote) de elementos sin foto candidata, de más a menos frecuentes: alimenta docs/PLAN-RELLENAR-BIBLIOTECA.md. */
  gaps: { tag: string; items: number; examples: string[] }[];
}

export function buildMatchReport(proposals: Proposal[], skipped: { slug: string; title: string; reason: string }[] = [], now = new Date()): MatchReport {
  const gapMap = new Map<string, { items: number; examples: string[] }>();
  const rows: MatchReport['rows'] = [];
  const templates: MatchReport['templates'] = proposals.map((p) => {
    for (const it of p.items) {
      if (it.hasPhoto) continue;
      const b = it.best;
      rows.push({
        slug: p.template.slug, index: it.index + 1, title: it.item.title, tags: (it.item.tags ?? []).join(' | '),
        image_id: b?.image.id ?? '', image_title: b?.image.title ?? '', url: b?.image.url ?? '', score: b?.score ?? 0, confidence: b?.confidence ?? 'sin candidata', reasons: b?.reasons.join('; ') ?? '',
      });
    }
    for (const g of p.coverage.gaps) {
      for (const tag of g.missing.length ? g.missing : [g.title.toLowerCase()]) {
        const e = gapMap.get(tag) ?? { items: 0, examples: [] };
        e.items++;
        if (e.examples.length < 3) e.examples.push(`${p.template.slug}: ${g.title}`);
        gapMap.set(tag, e);
      }
    }
    const c = p.coverage;
    return { slug: p.template.slug, title: p.template.title, total: c.total, matched: c.matched, high: c.high, pct: c.pct };
  });
  for (const s of skipped) templates.push({ slug: s.slug, title: s.title, total: 0, matched: 0, high: 0, pct: 0, skipped: s.reason });
  const gaps = [...gapMap.entries()].map(([tag, v]) => ({ tag, ...v })).sort((a, b) => b.items - a.items || a.tag.localeCompare(b.tag));
  return { generated: now.toISOString(), library: proposals[0]?.library ?? 0, templates, rows, gaps };
}

const csvCell = (v: unknown) => {
  const s = String(v ?? '');
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (head: string[], rows: unknown[][]) => [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';

export const rowsCsv = (r: MatchReport) => toCsv(['plantilla', 'n', 'elemento', 'etiquetas', 'foto_id', 'foto_titulo', 'url', 'puntuacion', 'confianza', 'motivos'], r.rows.map((x) => [x.slug, x.index, x.title, x.tags, x.image_id, x.image_title, x.url, x.score, x.confidence, x.reasons]));
export const gapsCsv = (r: MatchReport) => toCsv(['etiqueta', 'elementos_sin_foto', 'ejemplos'], r.gaps.map((g) => [g.tag, g.items, g.examples.join(' / ')]));

export function consoleSummary(r: MatchReport): string {
  const lines = [`Fotos candidatas en la biblioteca (producto + revisadas): ${r.library}`, ''];
  for (const t of r.templates) lines.push(t.skipped ? `  - ${t.slug.padEnd(32)} omitida: ${t.skipped}` : `  ${t.slug.padEnd(34)} ${String(t.matched).padStart(2)}/${String(t.total).padEnd(2)} con foto (${t.pct.toFixed(1).padStart(5)} %) · confianza alta ${t.high}`);
  const tot = r.templates.reduce((a, t) => ({ n: a.n + t.total, m: a.m + t.matched }), { n: 0, m: 0 });
  lines.push('', `TOTAL: ${tot.m}/${tot.n} elementos con foto candidata (${tot.n ? ((tot.m / tot.n) * 100).toFixed(1) : '0.0'} %)`);
  if (r.gaps.length) lines.push('', `Huecos (palabras de elementos sin foto), las ${Math.min(15, r.gaps.length)} más pedidas:`, ...r.gaps.slice(0, 15).map((g) => `  ${String(g.items).padStart(3)} × ${g.tag}`));
  return lines.join('\n');
}
