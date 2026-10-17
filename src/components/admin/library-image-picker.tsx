'use client';

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { libraryApi, type CollectionCount, type LibraryImage } from '@/lib/client/library-api';

const field = 'w-full rounded-xl border border-white/15 bg-night-900 px-3 py-2 text-base';

/** Modal para elegir UNA imagen de la biblioteca (portada o casa inicial de una plantilla del sistema). Solo superadmin. */
export function LibraryImagePicker({ open, title, onClose, onPick }: { open: boolean; title: string; onClose: () => void; onPick: (image: LibraryImage) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [images, setImages] = useState<LibraryImage[]>([]);
  const [collections, setCollections] = useState<CollectionCount[]>([]);
  const [collection, setCollection] = useState('');
  const [q, setQ] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    const t = setTimeout(() => {
      libraryApi.images({ q, collection: collection || null, limit: 120 })
        .then((r) => { if (alive) { setImages(r.images); setCollections(r.collections); setError(''); } })
        .catch((e) => alive && setError(e instanceof Error ? e.message : 'No se pudo cargar la biblioteca.'));
    }, q ? 250 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [open, q, collection]);

  return (
    <dialog
      ref={dialog}
      aria-labelledby="library-image-picker-title"
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => e.target === dialog.current && onClose()}
      className="m-auto max-h-[90dvh] w-[min(94vw,48rem)] flex-col overflow-hidden rounded-3xl border border-white/15 bg-night-800 p-0 text-left text-white shadow-2xl backdrop:bg-black/70 backdrop:backdrop-blur-sm open:flex"
    >
      {open ? (
        <>
          <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-6">
            <h2 id="library-image-picker-title" className="font-display text-xl sm:text-2xl">{title}</h2>
            <Button type="button" variant="ghost" size="sm" onClick={onClose} aria-label="Cerrar"><X className="size-5" aria-hidden /></Button>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6" data-testid="library-image-picker">
            <div className="grid gap-2 sm:grid-cols-2">
              <select aria-label="Colección de imágenes" value={collection} onChange={(e) => setCollection(e.target.value)} className={field}>
                <option value="">Todas las colecciones</option>
                {collections.map((c) => <option key={c.name} value={c.name}>{c.name || '(sin colección)'} · {c.count}</option>)}
              </select>
              <input aria-label="Buscar imágenes de la biblioteca" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} className={field} />
            </div>
            {error ? <p role="alert" className="rounded-xl bg-rose/15 px-3 py-2 text-sm text-rose">{error}</p> : null}
            {images.length === 0 && !error ? <p className="text-sm text-white/70">No hay imágenes con ese filtro. Súbelas en Biblioteca → Imágenes.</p> : null}
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {images.map((i) => (
                <li key={i.id}>
                  <button type="button" onClick={() => onPick(i)} data-testid="library-image-choice" className="block w-full overflow-hidden rounded-2xl border border-white/10 bg-night-900 text-left hover:border-gold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-gold/50">
                    {/* eslint-disable-next-line @next/next/no-img-element -- alojada en el CDN del propietario */}
                    <img src={i.url} alt={i.title} loading="lazy" referrerPolicy="no-referrer" className="aspect-[3/2] w-full object-cover" />
                    <span className="block truncate p-2 text-xs font-bold">{i.title || '(sin título)'}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : null}
    </dialog>
  );
}
