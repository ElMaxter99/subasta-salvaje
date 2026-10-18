import { z } from 'zod';
import { assertSameOrigin, handle, json, limit } from '@/lib/api';
import { requireSuperadmin } from '@/lib/auth/host';
import { DomainError } from '@/lib/domain/errors';
import { getContext } from '@/lib/services/context';
import {
  addLibraryItems, backfillLibraryPhashes, deleteLibraryImages, libraryCoverage, listSimilarImages, deleteLibraryItems, libraryUploadsEnabled, listLibraryDuplicates, listLibraryImages, listLibraryItems, updateLibraryImages, updateLibraryItem, updateLibraryItems,
} from '@/lib/services/library-service';

const query = z.object({ q: z.string().max(80).optional(), collection: z.string().max(60).nullish(), limit: z.number().int().min(1).max(500).optional(), offset: z.number().int().min(0).optional() });

const opSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('images.list'), noCredit: z.boolean().optional(), unreviewed: z.boolean().optional(), category: z.string().max(60).nullish(), role: z.enum(['start', 'product', 'none']).nullish() }).extend(query.shape),
  z.object({ op: z.literal('images.similar') }),
  z.object({ op: z.literal('images.backfill_hashes') }),
  z.object({ op: z.literal('coverage') }),
  z.object({ op: z.literal('images.duplicates') }),
  z.object({ op: z.literal('images.update'), ids: z.unknown(), patch: z.unknown() }),
  z.object({ op: z.literal('images.delete'), ids: z.unknown() }),
  z.object({ op: z.literal('items.list') }).extend(query.shape),
  z.object({ op: z.literal('items.add'), items: z.unknown() }),
  z.object({ op: z.literal('items.update'), id: z.unknown(), patch: z.unknown() }),
  z.object({ op: z.literal('items.update_many'), ids: z.unknown(), change: z.unknown() }),
  z.object({ op: z.literal('items.delete'), ids: z.unknown() }),
]);

/** Biblioteca de medios: listar, editar y borrar imágenes y productos del catálogo general. Solo superadmin. */
export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  const admin = await requireSuperadmin();
  limit(req, 'admin-library', admin.id, 300);
  const body = opSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) throw new DomainError('invalid_input');
  const ctx = await getContext();
  const actor = admin.email ?? 'superadmin';
  const b = body.data;
  switch (b.op) {
    case 'images.list': return json({ ...(await listLibraryImages(ctx, b)), uploadsEnabled: libraryUploadsEnabled() });
    case 'images.similar': return json({ pairs: await listSimilarImages(ctx) });
    case 'images.backfill_hashes': return json(await backfillLibraryPhashes(ctx));
    case 'coverage': return json(await libraryCoverage(ctx));
    case 'images.duplicates': return json({ groups: await listLibraryDuplicates(ctx) });
    case 'images.update': return json(await updateLibraryImages(ctx, actor, b));
    case 'images.delete': return json(await deleteLibraryImages(ctx, actor, b.ids));
    case 'items.list': return json(await listLibraryItems(ctx, b));
    case 'items.add': return json(await addLibraryItems(ctx, actor, b.items));
    case 'items.update': return json(await updateLibraryItem(ctx, actor, b.id, b.patch));
    case 'items.update_many': return json(await updateLibraryItems(ctx, actor, b));
    case 'items.delete': return json(await deleteLibraryItems(ctx, actor, b.ids));
  }
});
