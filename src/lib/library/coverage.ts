import { LIBRARY_CATEGORIES, norm } from './taxonomy';

/** Respuesta cruda de `ss_admin_library_coverage`. */
export interface CoverageRaw {
  total: number; published: number; no_role: number; no_category: number; no_credit: number; no_phash: number;
  categories: { name: string; total: number; start: number; product: number; published: number; pub_start: number; pub_product: number }[];
}

export interface CoverageRow {
  name: string;
  /** ¿Es una categoría con objetivo (LIBRARY_CATEGORIES)? Las demás son categorías propias del superadmin. */
  planned: boolean;
  total: number;
  published: number;
  /** Imágenes publicadas (revisadas) con ese rol: las que de verdad ve un anfitrión. */
  start: number; product: number;
  /** Total con ese rol, publicadas o no. */
  all_start: number; all_product: number;
  target_start: number; target_product: number;
  /** Lo que falta hasta el objetivo (0 si ya se alcanzó). */
  missing_start: number; missing_product: number;
}

export interface CoverageReport {
  totals: Pick<CoverageRaw, 'total' | 'published' | 'no_role' | 'no_category' | 'no_credit' | 'no_phash'>;
  rows: CoverageRow[];
  target: { start: number; product: number };
  /** Publicadas con cada rol (suma de filas) frente al objetivo global. */
  have: { start: number; product: number };
  missing: { start: number; product: number };
}

/** Une los recuentos de la base con los objetivos: todas las categorías planificadas salen aunque estén vacías (los huecos). */
export function buildCoverage(raw: CoverageRaw): CoverageReport {
  const found = new Map(raw.categories.map((c) => [norm(c.name), c]));
  const rows: CoverageRow[] = [];
  const row = (name: string, planned: boolean, tStart: number, tProduct: number): CoverageRow => {
    const c = found.get(norm(name));
    found.delete(norm(name));
    const start = c?.pub_start ?? 0, product = c?.pub_product ?? 0;
    return {
      name: c?.name ?? name, planned, total: c?.total ?? 0, published: c?.published ?? 0, start, product,
      all_start: c?.start ?? 0, all_product: c?.product ?? 0, target_start: tStart, target_product: tProduct,
      missing_start: Math.max(tStart - start, 0), missing_product: Math.max(tProduct - product, 0),
    };
  };
  for (const t of LIBRARY_CATEGORIES) rows.push(row(t.name, true, t.start, t.product));
  for (const c of [...found.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'))) rows.push(row(c.name, false, 0, 0));
  const sum = (f: (r: CoverageRow) => number) => rows.reduce((a, r) => a + f(r), 0);
  const { total, published, no_role, no_category, no_credit, no_phash } = raw;
  return {
    totals: { total, published, no_role, no_category, no_credit, no_phash },
    rows,
    target: { start: sum((r) => r.target_start), product: sum((r) => r.target_product) },
    have: { start: sum((r) => r.start), product: sum((r) => r.product) },
    missing: { start: sum((r) => r.missing_start), product: sum((r) => r.missing_product) },
  };
}
