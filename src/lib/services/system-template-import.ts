import type { BundleEntry } from '@/lib/domain/system-template-pack';
import type { AppContext } from './context';
import { getSystemTemplate, listSystemTemplates, saveSystemTemplate, setSystemTemplateStatus, validateSystemTemplateData } from './system-template-service';

type Ctx = Pick<AppContext, 'db'>;

export type ImportAction = 'created' | 'updated' | 'unchanged' | 'error';
export interface ImportResult {
  slug: string;
  action: ImportAction;
  /** Estado final de la plantilla (las nuevas entran SIEMPRE como borrador; solo `publish` las publica). */
  status?: 'draft' | 'published';
  error?: string;
}

/** JSON con claves ordenadas: jsonb no conserva el orden de las claves. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

/**
 * Importa un lote como plantillas del sistema, de forma **idempotente por identificador**: si el slug existe se actualiza su contenido
 * (sin tocar su estado), si no existe se crea como BORRADOR. Con `publish` se publican después (la publicación comprueba las imágenes).
 * Reutiliza `saveSystemTemplate` (validación Zod + `ss_admin_system_template_upsert`): no hay lógica nueva de dinero ni de reglas.
 * Cada plantilla se valida con el esquema real; las reglas extra del catálogo propio (`validatePack`) las aplican `npm run templates:validate` y los tests. Un fallo en una plantilla no impide importar las demás. Con `dryRun` solo valida y dice qué haría.
 */
export async function importSystemTemplates(ctx: Ctx, actor: string, entries: BundleEntry[], opts: { publish?: boolean; dryRun?: boolean } = {}): Promise<ImportResult[]> {
  const existing = new Map((await listSystemTemplates(ctx, { admin: true })).map((t) => [t.slug, t]));
  const out: ImportResult[] = [];
  for (const e of entries) {
    try {
      const template = validateSystemTemplateData(e.plantilla);
      const found = existing.get(e.slug);
      let action: ImportAction = 'created';
      let status: 'draft' | 'published' = 'draft';
      if (found) {
        status = found.status;
        const full = await getSystemTemplate(ctx, found.id, { admin: true });
        action = stable(full.data) === stable(template) && full.title === e.titulo && full.description === e.descripcion ? 'unchanged' : 'updated';
      }
      if (!opts.dryRun) {
        if (action !== 'unchanged') {
          const saved = await saveSystemTemplate(ctx, actor, { id: found?.id, slug: e.slug, title: e.titulo, description: e.descripcion, sort_order: e.orden, data: template });
          status = saved.status;
          if (!found) existing.set(e.slug, saved);
        }
        if (opts.publish && status !== 'published') {
          const id = existing.get(e.slug)!.id;
          await setSystemTemplateStatus(ctx, actor, id, 'published');
          status = 'published';
        }
      }
      out.push({ slug: e.slug, action, status });
    } catch (err) {
      out.push({ slug: e.slug, action: 'error', error: err instanceof Error ? err.message : String(err) });
    }
  }
  return out;
}
