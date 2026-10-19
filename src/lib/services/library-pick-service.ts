import { z } from 'zod';
import { DomainError } from '@/lib/domain/errors';
import { isLibraryRole, type LibraryRole } from '@/lib/library/taxonomy';
import { isHostedImage } from '@/lib/storage/hosted';
import type { AppContext } from './context';
import { setInitialFromHosted, setItemImageFromHosted, type ActionResult } from './game-service';
import type { CollectionCount, LibraryPickImage } from './library-service';

type Ctx = Pick<AppContext, 'db' | 'storage' | 'publisher'>;

/**
 * Selector de la biblioteca para ANFITRIONES («Elegir de la biblioteca»). Solo lectura sobre imágenes con el rol pedido y REVISADAS
 * por el superadmin; nunca devuelve rutas internas, huellas ni datos de gestión. Cada rol tiene su uso:
 *  - `start`   → imagen base / foto de inicio de partida (imagen inicial común);
 *  - `product` → foto de un elemento del catálogo.
 */
export interface PickQuery { role: LibraryRole; q?: string; category?: string | null; limit?: number; offset?: number }
export interface PickList { total: number; images: LibraryPickImage[]; categories: CollectionCount[] }

export async function listPickableImages(ctx: Pick<AppContext, 'db'>, query: PickQuery): Promise<PickList> {
  if (!isLibraryRole(query.role)) throw new DomainError('invalid_input');
  return ctx.db.rpc('ss_library_pick_list', {
    role: query.role, q: (query.q ?? '').slice(0, 80), category: query.category ?? null,
    limit: Math.min(Math.max(query.limit ?? 24, 1), 60), offset: Math.max(query.offset ?? 0, 0),
  });
}

export const applySchema = z.discriminatedUnion('target', [
  z.object({ target: z.literal('initial'), image_id: z.string().uuid(), scope_current: z.boolean().default(true), scope_new: z.boolean().default(true) }),
  z.object({ target: z.literal('item'), image_id: z.string().uuid(), item_id: z.string().uuid() }),
]);

/**
 * Aplica una imagen de la biblioteca a una partida SIN copiarla ni pasar por IA: se usa por enlace, igual que las fotos de las plantillas del sistema
 * (`setInitialFromHosted` / `setItemImageFromHosted`, que escriben por las funciones SQL `ss_apply_initial_image` / `ss_set_item_image` y comprueban
 * que el anfitrión es el dueño de la partida y que sigue en la sala de espera cuando toca). La imagen ya se normalizó al formato interno
 * (`normalizeImage`) al entrar en la biblioteca. No toca saldos ni cuotas de IA.
 */
export async function applyLibraryImage(ctx: Ctx, code: string, hostId: string, raw: unknown): Promise<ActionResult> {
  const input = applySchema.safeParse(raw);
  if (!input.success) throw new DomainError('invalid_input');
  const b = input.data;
  const role: LibraryRole = b.target === 'initial' ? 'start' : 'product';
  const image = await ctx.db.rpc<LibraryPickImage>('ss_library_pick_get', { id: b.image_id, role });
  if (!isHostedImage(image.url)) throw new DomainError('invalid_input', 'Esa imagen no está alojada en el repositorio de fotos configurado.');
  if (b.target === 'initial') return setInitialFromHosted(ctx, code, hostId, image.url, { current: b.scope_current, new: b.scope_new });
  return setItemImageFromHosted(ctx, code, hostId, b.item_id, image.url);
}
