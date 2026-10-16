import { DomainError } from '@/lib/domain/errors';
import { parseTemplate, TEMPLATE_LIMITS, type Template } from '@/lib/domain/template';
import type { AppContext } from './context';

type Ctx = Pick<AppContext, 'db'>;

export interface SavedTemplateSummary {
  id: string;
  name: string;
  updated_at: string;
  items: number;
  players: number;
}

export async function listTemplates(ctx: Ctx, hostId: string): Promise<SavedTemplateSummary[]> {
  return ctx.db.rpc<SavedTemplateSummary[]>('ss_template_list', { host_id: hostId });
}

/** Guarda (o sustituye, si el nombre ya existe) una plantilla. Se revalida entera: el cliente no es de fiar. */
export async function saveTemplate(ctx: Ctx, hostId: string, name: unknown, template: unknown): Promise<{ id: string; name: string; replaced: boolean }> {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 80) throw new DomainError('invalid_input', 'Ponle un nombre a la plantilla (hasta 80 caracteres).');
  const text = JSON.stringify(template ?? null);
  if (text.length > TEMPLATE_LIMITS.fileBytes) throw new DomainError('template_too_large');
  const parsed = parseTemplate(text);
  if (!parsed.ok) throw new DomainError('invalid_input', `Plantilla no válida: ${parsed.errors[0]}`);
  return ctx.db.rpc('ss_template_save', { host_id: hostId, name: name.trim(), data: parsed.template });
}

export async function getTemplate(ctx: Ctx, hostId: string, id: string): Promise<{ id: string; name: string; data: Template }> {
  return ctx.db.rpc('ss_template_get', { host_id: hostId, id });
}

export async function deleteTemplate(ctx: Ctx, hostId: string, id: string): Promise<void> {
  await ctx.db.rpc('ss_template_delete', { host_id: hostId, id });
}
