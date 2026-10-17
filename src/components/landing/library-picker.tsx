'use client';

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { listLibraryItemsRequest, type CollectionCount, type LibraryItem } from '@/lib/client/library-api';
import type { LoadedCatalog } from './template-import';

type CatalogItem = LoadedCatalog[number];

const field = 'w-full rounded-xl border border-white/15 bg-night-900 px-3 py-2 text-base';

/** Convierte un producto de la biblioteca en un elemento del catálogo de la partida (la foto es un enlace https que se copia al crear la partida). */
export function libraryToCatalogItem(it: LibraryItem): CatalogItem {
  return { name: it.name, description: it.description, emoji: it.emoji, photoUrl: it.photo_url, photoPath: null, photoFile: null, credito: it.photo_credit || it.credit || null };
}

/**
 * Selector del catálogo general (modal flotante): se elige una colección o se busca, se marcan productos y se añaden al catálogo
 * de la partida. Funciona igual en móvil y escritorio.
 */
export function LibraryPicker({ open, onClose, onPick, taken }: { open: boolean; onClose: () => void; onPick: (items: CatalogItem[]) => void; taken: Set<string> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [collections, setCollections] = useState<CollectionCount[]>([]);
  const [collection, setCollection] = useState('');
  const [q, setQ] = useState('');
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
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
      setState('loading');
      listLibraryItemsRequest({ q, collection: collection || null, limit: 500 })
        .then((r) => { if (alive) { setItems(r.items); setCollections(r.collections); setState('idle'); } })
        .catch((e) => { if (alive) { setError(e instanceof Error ? e.message : 'No se pudo cargar la biblioteca.'); setState('error'); } });
    }, q ? 250 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [open, q, collection]);

  const selectable = items.filter((i) => !taken.has(i.name.trim().toLowerCase()));
  const toggle = (id: string) => setChosen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const close = () => { setChosen(new Set()); onClose(); };

  return (
    <dialog
      ref={dialog}
      aria-labelledby="library-picker-title"
      onCancel={(e) => { e.preventDefault(); close(); }}
      onClick={(e) => e.target === dialog.current && close()}
      className="m-auto max-h-[90dvh] w-[min(94vw,44rem)] flex-col overflow-hidden rounded-3xl border border-white/15 bg-night-800 p-0 text-left text-white shadow-2xl backdrop:bg-black/70 backdrop:backdrop-blur-sm open:flex 2xl:w-[min(90vw,64rem)]"
    >
      {open ? (
        <>
          <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-6">
            <h2 id="library-picker-title" className="font-display text-xl sm:text-2xl 2xl:text-3xl">Importar de la biblioteca</h2>
            <Button type="button" variant="ghost" size="sm" onClick={close} aria-label="Cerrar"><X className="size-5" aria-hidden /></Button>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6" data-testid="library-picker">
            <div className="grid gap-2 sm:grid-cols-2">
              <select aria-label="Colección" value={collection} onChange={(e) => setCollection(e.target.value)} className={field}>
                <option value="">Todas las colecciones</option>
                {collections.map((c) => <option key={c.name} value={c.name}>{c.name || '(sin colección)'} · {c.count}</option>)}
              </select>
              <input aria-label="Buscar en la biblioteca" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} className={field} />
            </div>
            {state === 'error' ? <p role="alert" className="rounded-xl bg-rose/15 px-3 py-2 text-sm text-rose">{error}</p> : null}
            {state !== 'error' && items.length === 0 ? <p className="text-sm text-white/70">{state === 'loading' ? 'Cargando…' : 'No hay productos en la biblioteca con ese filtro. El superadmin los crea en Biblioteca → Productos.'}</p> : null}
            {selectable.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => setChosen(new Set(selectable.map((i) => i.id)))}>Marcar todos ({selectable.length})</Button>
                <Button size="sm" variant="ghost" onClick={() => setChosen(new Set())} disabled={chosen.size === 0}>Quitar marcas</Button>
              </div>
            ) : null}
            <ul className="space-y-2">
              {items.map((it) => {
                const already = taken.has(it.name.trim().toLowerCase());
                return (
                  <li key={it.id} data-testid="library-pick-item">
                    <label className={`flex items-center gap-3 rounded-2xl border border-white/10 bg-night-900 p-2 ${already ? 'opacity-50' : 'cursor-pointer'}`}>
                      <input type="checkbox" disabled={already} checked={chosen.has(it.id)} onChange={() => toggle(it.id)} aria-label={`Elegir ${it.name}`} className="size-5 accent-[#fbbf24]" />
                      {it.photo_url ? (
                        // eslint-disable-next-line @next/next/no-img-element -- alojada en el CDN del propietario
                        <img src={it.photo_url} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-12 rounded-lg object-cover" />
                      ) : <span className="grid size-12 place-items-center rounded-lg bg-night-950 text-xl" aria-hidden>{it.emoji ?? '📦'}</span>}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-bold">{it.emoji ? `${it.emoji} ` : ''}{it.name}</span>
                        <span className="block truncate text-xs text-white/60">{already ? 'Ya está en el catálogo' : (it.collection || 'sin colección')}{!already && it.description ? ` · ${it.description}` : ''}</span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="flex flex-col-reverse gap-2 border-t border-white/10 px-4 py-3 sm:flex-row sm:justify-end sm:px-6">
            <Button type="button" variant="ghost" size="lg" onClick={close}>Cancelar</Button>
            <Button type="button" variant="primary" size="lg" disabled={chosen.size === 0} onClick={() => { onPick(items.filter((i) => chosen.has(i.id)).map(libraryToCatalogItem)); setChosen(new Set()); }} data-testid="library-pick-add">
              Añadir {chosen.size > 0 ? `${chosen.size} ` : ''}al catálogo
            </Button>
          </div>
        </>
      ) : null}
    </dialog>
  );
}
