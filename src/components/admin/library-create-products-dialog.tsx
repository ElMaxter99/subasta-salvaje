'use client';

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { libraryApi, type LibraryImage } from '@/lib/client/library-api';

const field = 'w-full rounded-xl border border-white/15 bg-night-900 px-3 py-2 text-base';
interface Row { id: string; url: string; name: string; emoji: string; description: string }

/** Modal para crear productos del catálogo general a partir de una o varias imágenes (el nombre sale del título, editable). */
export function CreateProductsDialog({ images, collections, onClose, onDone }: { images: LibraryImage[]; collections: string[]; onClose: () => void; onDone: (message: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [collection, setCollection] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const open = images.length > 0;

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      setRows(images.map((i) => ({ id: i.id, url: i.url, name: i.title, emoji: '', description: '' })));
      setCollection('');
      setError('');
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open, images]);

  async function create() {
    setBusy(true);
    setError('');
    try {
      const byId = new Map(images.map((i) => [i.id, i]));
      const r = await libraryApi.addItems(rows.map((f) => ({ name: f.name.trim() || 'Sin nombre', description: f.description, emoji: f.emoji || null, image_id: f.id, collection: collection.trim() || byId.get(f.id)?.collection || '' })));
      onDone(`${r.added} producto${r.added === 1 ? '' : 's'} creado${r.added === 1 ? '' : 's'}${r.skipped ? ` (${r.skipped} repetido${r.skipped === 1 ? '' : 's'} omitido${r.skipped === 1 ? '' : 's'})` : ''}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron crear los productos.');
    } finally {
      setBusy(false);
    }
  }

  const setRow = (id: string, patch: Partial<Row>) => setRows((all) => all.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  return (
    <dialog
      ref={dialog}
      aria-labelledby="create-products-title"
      onCancel={(e) => { e.preventDefault(); if (!busy) onClose(); }}
      onClick={(e) => e.target === dialog.current && !busy && onClose()}
      className="m-auto max-h-[90dvh] w-[min(94vw,44rem)] flex-col overflow-hidden rounded-3xl border border-white/15 bg-night-800 p-0 text-left text-white shadow-2xl backdrop:bg-black/70 backdrop:backdrop-blur-sm open:flex"
    >
      {open ? (
        <>
          <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-6">
            <h2 id="create-products-title" className="font-display text-xl sm:text-2xl">{rows.length === 1 ? 'Crear producto del catálogo' : `Crear ${rows.length} productos del catálogo`}</h2>
            <Button type="button" variant="ghost" size="sm" onClick={onClose} aria-label="Cerrar"><X className="size-5" aria-hidden /></Button>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6" data-testid="library-from-images">
            <label className="block text-sm font-semibold">Colección de los productos (vacío = la de cada imagen)
              <input list="create-products-collections" aria-label="Colección de los productos" value={collection} onChange={(e) => setCollection(e.target.value)} className={`${field} mt-1`} />
              <datalist id="create-products-collections">{collections.map((c) => <option key={c} value={c} />)}</datalist>
            </label>
            <ul className="space-y-2">
              {rows.map((f, idx) => (
                <li key={f.id} className="grid gap-2 rounded-xl bg-night-900 p-2 sm:grid-cols-[4rem_1fr_5rem]">
                  {/* eslint-disable-next-line @next/next/no-img-element -- alojada en el CDN del propietario */}
                  <img src={f.url} alt="" referrerPolicy="no-referrer" className="size-16 rounded-lg object-cover" />
                  <div className="space-y-2">
                    <input aria-label={`Nombre del producto ${idx + 1}`} maxLength={80} value={f.name} onChange={(e) => setRow(f.id, { name: e.target.value })} className={field} />
                    <input aria-label={`Descripción del producto ${idx + 1}`} maxLength={500} value={f.description} onChange={(e) => setRow(f.id, { description: e.target.value })} className={field} placeholder="Descripción (opcional)" />
                  </div>
                  <input aria-label={`Emoji del producto ${idx + 1}`} maxLength={8} value={f.emoji} onChange={(e) => setRow(f.id, { emoji: e.target.value })} className={`${field} text-center sm:self-start`} placeholder="📦" />
                </li>
              ))}
            </ul>
            {error ? <p role="alert" className="rounded-xl bg-rose/15 px-3 py-2 text-sm text-rose">{error}</p> : null}
          </div>
          <div className="flex flex-wrap justify-end gap-2 border-t border-white/10 px-4 py-3 sm:px-6">
            <Button variant="ghost" onClick={onClose} disabled={busy}>Cancelar</Button>
            <Button variant="primary" loading={busy} onClick={() => void create()}>Crear productos</Button>
          </div>
        </>
      ) : null}
    </dialog>
  );
}
