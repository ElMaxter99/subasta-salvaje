'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { listPickableImagesRequest, type LibraryPickImage } from '@/lib/client/library-pick-api';
import type { CollectionCount } from '@/lib/services/library-service';
import type { LibraryRole } from '@/lib/library/taxonomy';

const field = 'w-full rounded-xl border border-white/15 bg-night-900 px-3 py-2 text-base';
const PAGE = 24;

/**
 * «Elegir de la biblioteca» (anfitrión): diálogo con buscador y filtro de categoría que lista SOLO las imágenes del rol pedido
 * (`start` = foto de inicio de partida, `product` = producto de catálogo) que el superadmin ya ha revisado. Es de solo lectura:
 * al elegir una se llama a `onPick` y quien lo usa decide cómo aplicarla (nunca es IA ni toca saldos).
 */
export function HostLibraryPicker({ open, role, title, onClose, onPick, initialQuery = '' }: {
  open: boolean; role: LibraryRole; title: string; onClose: () => void; onPick: (image: LibraryPickImage) => void; initialQuery?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [images, setImages] = useState<LibraryPickImage[]>([]);
  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState<CollectionCount[]>([]);
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');
  const [state, setState] = useState<'loading' | 'idle' | 'error'>('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) { setQ(initialQuery); setCategory(''); d.showModal(); }
    if (!open && d.open) d.close();
  }, [open, initialQuery]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    const t = setTimeout(() => {
      setState('loading');
      listPickableImagesRequest({ role, q, category: category || null, limit: PAGE })
        .then((r) => { if (alive) { setImages(r.images); setTotal(r.total); setCategories(r.categories); setState('idle'); setError(''); } })
        .catch((e) => { if (alive) { setError(e instanceof Error ? e.message : 'No se pudo cargar la biblioteca.'); setState('error'); } });
    }, q ? 250 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [open, role, q, category]);

  const more = useCallback(async () => {
    try {
      const r = await listPickableImagesRequest({ role, q, category: category || null, limit: PAGE, offset: images.length });
      setImages((cur) => [...cur, ...r.images.filter((i) => !cur.some((c) => c.id === i.id))]);
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo cargar más.'); }
  }, [role, q, category, images.length]);

  return (
    <dialog
      ref={dialog}
      aria-labelledby="host-library-picker-title"
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => e.target === dialog.current && onClose()}
      className="m-auto max-h-[90dvh] w-[min(96vw,52rem)] flex-col overflow-hidden rounded-3xl border border-white/15 bg-night-800 p-0 text-left text-white shadow-2xl backdrop:bg-black/70 backdrop:backdrop-blur-sm open:flex"
    >
      {open ? (
        <>
          <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-6">
            <h2 id="host-library-picker-title" className="font-display text-xl sm:text-2xl">{title}</h2>
            <Button type="button" variant="ghost" size="sm" onClick={onClose} aria-label="Cerrar"><X className="size-5" aria-hidden /></Button>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6" data-testid="host-library-picker">
            <div className="grid gap-2 sm:grid-cols-2">
              <input aria-label="Buscar en la biblioteca" placeholder="Buscar por nombre, tema o etiqueta…" value={q} onChange={(e) => setQ(e.target.value)} className={field} />
              <select aria-label="Categoría de la biblioteca" value={category} onChange={(e) => setCategory(e.target.value)} className={field}>
                <option value="">Todas las categorías</option>
                {categories.map((c) => <option key={c.name} value={c.name}>{c.name} · {c.count}</option>)}
              </select>
            </div>
            {error ? <p role="alert" className="rounded-xl bg-rose/15 px-3 py-2 text-sm text-rose">{error}</p> : null}
            {state === 'loading' && images.length === 0 ? <p className="text-sm text-white/70" role="status">Cargando…</p> : null}
            {state === 'idle' && images.length === 0 && !error ? (
              <p className="text-sm text-white/70" data-testid="host-library-empty">
                No hay imágenes {q || category ? 'con ese filtro' : 'disponibles'}. Solo se muestran las que el administrador ha revisado y marcado como «{role === 'start' ? 'foto de inicio de partida' : 'producto de catálogo'}».
              </p>
            ) : null}
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {images.map((i) => (
                <li key={i.id}>
                  <button type="button" onClick={() => onPick(i)} data-testid="host-library-choice" aria-label={`Elegir ${i.title || 'imagen'}`} className="block w-full overflow-hidden rounded-2xl border border-white/10 bg-night-900 text-left hover:border-gold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-gold/50">
                    {/* eslint-disable-next-line @next/next/no-img-element -- alojada en el CDN del propietario */}
                    <img src={i.url} alt="" loading="lazy" referrerPolicy="no-referrer" className="aspect-[3/2] w-full object-cover" />
                    <span className="block truncate px-2 pt-1.5 text-sm font-bold">{i.title || '(sin título)'}</span>
                    <span className="block truncate px-2 pb-1.5 text-xs text-white/60">{i.category || i.collection || ' '}</span>
                  </button>
                </li>
              ))}
            </ul>
            {images.length < total ? <div className="text-center"><Button variant="secondary" onClick={() => void more()}>Cargar más ({images.length}/{total})</Button></div> : null}
            <p className="text-xs text-white/50">Son fotos de la biblioteca del administrador (no generadas por IA). Se usan por enlace, sin copiarlas. Su crédito consta en la biblioteca.</p>
          </div>
        </>
      ) : null}
    </dialog>
  );
}
