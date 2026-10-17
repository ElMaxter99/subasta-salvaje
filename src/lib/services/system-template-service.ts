import { z } from 'zod';
import { IMAGE_SPECS, type ImageKind } from '@/lib/images/normalize';
import { assetCdnHosts, urlAllowedByCdn } from '@/lib/config/env';
import { DomainError } from '@/lib/domain/errors';
import { parseTemplate, TEMPLATE_LIMITS, type Template } from '@/lib/domain/template';
import { fetchImageBytes, SafeFetchError, type FetchImageOptions } from '@/lib/security/safe-fetch';
import type { AppContext } from './context';

type Ctx = Pick<AppContext, 'db'>;

export interface SystemTemplateSummary {
  id: string;
  slug: string;
  title: string;
  description: string;
  cover_url: string | null;
  status: 'draft' | 'published';
  sort_order: number;
  updated_at: string;
  published_at: string | null;
  items: number;
  players: number;
  has_initial_image: boolean;
}
export type SystemTemplate = SystemTemplateSummary & { data: Template };

const saveSchema = z.object({
  id: z.string().uuid().optional(),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'El identificador solo admite minúsculas, números y guiones').min(2).max(60),
  title: z.string().trim().min(1, 'Falta el título').max(80),
  description: z.string().trim().max(300).default(''),
  sort_order: z.number().int().min(0).max(100000).optional(),
  data: z.unknown(),
});

/** Todas las URL de fotos que lleva una plantilla (portada, casa inicial y fotos de elementos), con su tipo de imagen. */
export function templateImageUrls(t: Template): { label: string; url: string; kind: ImageKind }[] {
  const out: { label: string; url: string; kind: ImageKind }[] = [];
  if (t.portada) out.push({ label: 'Portada', url: t.portada, kind: 'cover' });
  if (t.casa_inicial) out.push({ label: 'Casa inicial', url: t.casa_inicial, kind: 'scene' });
  (t.catalogo ?? []).forEach((it, i) => {
    if (it.foto) out.push({ label: `Elemento ${i + 1} · ${it.titulo}`, url: it.foto, kind: 'item' });
  });
  return out;
}

/** Valida el contenido con las mismas reglas que cualquier plantilla + la lista blanca de servidores de fotos. */
export function validateSystemTemplateData(data: unknown, hosts: string[] = assetCdnHosts()): Template {
  const text = JSON.stringify(data ?? null);
  if (text.length > TEMPLATE_LIMITS.fileBytes) throw new DomainError('template_too_large');
  const parsed = parseTemplate(text);
  if (!parsed.ok) throw new DomainError('invalid_input', `Plantilla no válida: ${parsed.errors[0]}`);
  for (const img of templateImageUrls(parsed.template)) {
    if (!/^https:\/\//i.test(img.url)) throw new DomainError('invalid_input', `${img.label}: la foto debe ser una URL https:// (en plantillas del sistema no se admiten rutas de ZIP).`);
    if (!urlAllowedByCdn(img.url, hosts)) throw new DomainError('invalid_input', `${img.label}: el servidor de la foto no está en ASSET_CDN_HOSTS.`);
  }
  return parsed.template;
}

export async function listSystemTemplates(ctx: Ctx, opts: { admin?: boolean } = {}): Promise<SystemTemplateSummary[]> {
  return ctx.db.rpc<SystemTemplateSummary[]>('ss_system_template_list', { admin: Boolean(opts.admin) });
}

export async function getSystemTemplate(ctx: Ctx, idOrSlug: string, opts: { admin?: boolean } = {}): Promise<SystemTemplate> {
  const isId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
  return ctx.db.rpc<SystemTemplate>('ss_system_template_get', { ...(isId ? { id: idOrSlug } : { slug: idOrSlug }), admin: Boolean(opts.admin) });
}

/** Crea o actualiza (borrador). Revalida todo: el cliente no es de fiar. La portada vive en `data.portada`. */
export async function saveSystemTemplate(ctx: Ctx, actor: string, raw: unknown): Promise<SystemTemplateSummary> {
  const parsed = saveSchema.safeParse(raw);
  if (!parsed.success) throw new DomainError('invalid_input', parsed.error.issues[0]?.message ?? 'Datos no válidos');
  const template = validateSystemTemplateData(parsed.data.data);
  return ctx.db.rpc<SystemTemplateSummary>('ss_admin_system_template_upsert', {
    id: parsed.data.id,
    slug: parsed.data.slug,
    title: parsed.data.title,
    description: parsed.data.description,
    cover_url: template.portada ?? null,
    sort_order: parsed.data.sort_order,
    data: template,
    actor,
  });
}

export interface ImageCheck {
  label: string;
  url: string;
  ok: boolean;
  /** Dentro del formato interno (WebP y dentro de tamaño/peso): si no, se normaliza al copiarla, pero conviene preparar la foto. */
  internal: boolean;
  format?: string;
  width?: number;
  height?: number;
  bytes?: number;
  note?: string;
}

const FAIL: Record<SafeFetchError['reason'], string> = {
  url: 'URL no válida', blocked: 'dirección no permitida', status: 'el servidor no entregó la imagen', size: 'supera el máximo de 7 MB',
  type: 'no es una imagen PNG/JPEG/WebP', timeout: 'tardó demasiado', network: 'no se pudo descargar',
};

/** Descarga cada foto (con las defensas SSRF de safe-fetch) y la compara con el formato interno. No guarda nada. */
export async function checkTemplateImages(template: Template, opts: FetchImageOptions & { budgetMs?: number; hosts?: string[] } = {}): Promise<ImageCheck[]> {
  const items = templateImageUrls(template);
  const hosts = opts.hosts ?? assetCdnHosts();
  const deadline = Date.now() + (opts.budgetMs ?? 45_000);
  const results: ImageCheck[] = new Array(items.length);
  let next = 0;
  async function worker() {
    for (let i = next++; i < items.length; i = next++) {
      const it = items[i]!;
      const base = { label: it.label, url: it.url, ok: false, internal: false };
      if (!urlAllowedByCdn(it.url, hosts)) {
        results[i] = { ...base, note: 'el servidor no está en ASSET_CDN_HOSTS' };
        continue;
      }
      if (Date.now() > deadline) {
        results[i] = { ...base, note: 'se agotó el tiempo' };
        continue;
      }
      try {
        const bytes = await fetchImageBytes(it.url, opts);
        const { default: sharp } = await import('sharp');
        const meta = await sharp(Buffer.from(bytes), { limitInputPixels: 40_000_000 }).metadata();
        const spec = IMAGE_SPECS[it.kind];
        const internal = meta.format === 'webp' && (meta.width ?? 0) <= spec.width && (meta.height ?? 0) <= spec.height && bytes.length <= spec.targetBytes;
        results[i] = { ...base, ok: true, internal, format: meta.format, width: meta.width, height: meta.height, bytes: bytes.length, note: internal ? undefined : 'se reducirá al copiarla; mejor prepárala con npm run assets:normalize' };
      } catch (e) {
        results[i] = { ...base, note: e instanceof SafeFetchError ? FAIL[e.reason] : 'no se pudo leer la imagen' };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, items.length) }, worker));
  return results;
}

/** Publica (solo si todas las imágenes se pueden descargar y leer) o retira una plantilla. */
export async function setSystemTemplateStatus(ctx: Ctx, actor: string, id: string, status: 'draft' | 'published', opts: FetchImageOptions & { budgetMs?: number } = {}): Promise<{ template: SystemTemplateSummary; checks: ImageCheck[] }> {
  let checks: ImageCheck[] = [];
  if (status === 'published') {
    const current = await getSystemTemplate(ctx, id, { admin: true });
    const template = validateSystemTemplateData(current.data);
    checks = await checkTemplateImages(template, opts);
    if (checks.some((c) => !c.ok)) throw new DomainError('template_images_failed', `No se puede publicar: ${checks.filter((c) => !c.ok).map((c) => `${c.label} (${c.note})`).slice(0, 3).join('; ')}.`);
  }
  const template = await ctx.db.rpc<SystemTemplateSummary>('ss_admin_system_template_set_status', { id, status, actor });
  return { template, checks };
}

export async function deleteSystemTemplate(ctx: Ctx, actor: string, id: string): Promise<void> {
  await ctx.db.rpc('ss_admin_system_template_delete', { id, actor });
}
