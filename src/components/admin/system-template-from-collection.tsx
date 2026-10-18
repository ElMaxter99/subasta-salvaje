'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Images } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { adminPost } from '@/lib/client/admin-api';
import { libraryApi, type CollectionCount, type LibraryImage, type LibraryItem } from '@/lib/client/library-api';
import type { SystemTemplateSummary } from '@/lib/services/system-template-service';
import { LibraryImagePicker } from './library-image-picker';

const field = 'w-full rounded-xl border border-white/15 bg-night-900 px-3 py-2 text-base';

/**
 * «Crear desde una colección de la biblioteca»: crea un BORRADOR de plantilla del sistema con los productos de una colección
 * (fotos por enlace, sin copiar nada), la portada de un producto y una casa inicial elegida de la biblioteca (objeto o escena).
 * Después abre el editor de plantillas para ajustarla.
 */
export function SystemTemplateFromCollection({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [collections, setCollections] = useState<CollectionCount[]>([]);
  const [collection, setCollection] = useState('');
  const [withPhoto, setWithPhoto] = useState<LibraryItem[]>([]);
  const [cover, setCover] = useState('');
  const [house, setHouse] = useState<LibraryImage | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    let alive = true;
    libraryApi.items({ limit: 1 }).then((r) => alive && setCollections(r.collections.filter((c) => c.name))).catch((e) => alive && setError(e instanceof Error ? e.message : 'No se pudieron cargar las colecciones.'));
    return () => { alive = false; };
  }, [open]);

  function chooseCollection(name: string) {
    setCollection(name);
    setError('');
    setWithPhoto([]);
    setCover('');
    if (!name) return;
    libraryApi.items({ collection: name, limit: 100 }).then((r) => {
      const list = r.items.filter((i) => i.photo_url);
      setWithPhoto(list);
      setCover(list[0]?.id ?? '');
    }).catch((e) => setError(e instanceof Error ? e.message : 'No se pudo leer la colección.'));
  }

  async function create() {
    setBusy(true);
    setError('');
    try {
      const r = await adminPost<{ template: SystemTemplateSummary; truncated: boolean }>('system-templates', { op: 'from_collection', collection, house_image_id: house?.id ?? null, cover_item_id: cover || null });
      onClose();
      router.push(`/admin/plantillas/editor?id=${r.template.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear la plantilla.');
    } finally {
      setBusy(false);
    }
  }

  const ready = collection !== '' && !busy; // la casa inicial es opcional: se puede poner luego en el editor
  return (
    <>
      <ConfirmDialog
        open={open && !picking}
        title="Crear desde una colección"
        confirmLabel="Crear borrador"
        loading={busy}
        onCancel={onClose}
        onConfirm={() => { if (ready) void create(); else setError('Elige una colección.'); }}
      >
        <div className="space-y-3 text-sm" data-testid="from-collection-form">
          <p>Se crea un <b>borrador</b> con los productos de la colección (hasta 100). Las fotos se usan <b>por enlace, sin copiarlas</b>; después lo ajustas en el editor.</p>
          <label className="block font-semibold">Colección de productos
            <select aria-label="Colección de productos" className={`${field} mt-1`} value={collection} onChange={(e) => chooseCollection(e.target.value)}>
              <option value="">Elige una colección…</option>
              {collections.map((c) => <option key={c.name} value={c.name}>{c.name} · {c.count}</option>)}
            </select>
          </label>
          <label className="block font-semibold">Portada (foto de un producto)
            <select aria-label="Producto de la portada" className={`${field} mt-1`} value={cover} onChange={(e) => setCover(e.target.value)} disabled={withPhoto.length === 0}>
              {withPhoto.length === 0 ? <option value="">{collection ? 'Ningún producto tiene foto: sin portada' : '—'}</option> : withPhoto.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </label>
          <div>
            <p className="font-semibold">Casa inicial</p>
            <div className="mt-1 flex items-center gap-3">
              {house ? (
                // eslint-disable-next-line @next/next/no-img-element -- alojada en el CDN del propietario
                <img src={house.url} alt={house.title} referrerPolicy="no-referrer" className="h-16 w-24 rounded-xl object-cover" data-testid="from-collection-house" />
              ) : <span className="text-white/60">Sin elegir (se puede poner luego en el editor)</span>}
              <Button type="button" size="md" variant="secondary" onClick={() => setPicking(true)}><Images className="size-4" aria-hidden /> {house ? 'Cambiar' : 'De la biblioteca'}</Button>
            </div>
          </div>
          {error ? <p role="alert" className="rounded-xl bg-rose/15 px-3 py-2 text-rose">{error}</p> : null}
        </div>
      </ConfirmDialog>
      <LibraryImagePicker open={open && picking} title="Casa inicial de la plantilla" onClose={() => setPicking(false)} onPick={(img) => { setHouse(img); setPicking(false); setError(''); }} />
    </>
  );
}
