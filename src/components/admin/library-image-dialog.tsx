'use client';

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { libraryApi, type LibraryImage, type LibraryItem } from '@/lib/client/library-api';
import { LIBRARY_CATEGORIES, type LibraryRole } from '@/lib/library/taxonomy';
import { RoleChecks } from './library-role-fields';

const field = 'w-full rounded-xl border border-white/15 bg-night-900 px-3 py-2 text-base';

/**
 * Ventana para inspeccionar una imagen de la biblioteca (grande, con sus datos) y actuar sobre ella:
 * editar título/colección/etiquetas/crédito, crear un producto del catálogo con ella, asociarla a un producto que ya existe o borrarla.
 */
export function LibraryImageDialog({ image, collections, onClose, onChanged, onCreateProduct, onDelete }: {
  image: LibraryImage | null;
  collections: string[];
  onClose: () => void;
  onChanged: (message: string) => void;
  onCreateProduct: (image: LibraryImage) => void;
  onDelete: (image: LibraryImage) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<'view' | 'associate'>('view');
  const [title, setTitle] = useState('');
  const [collection, setCollection] = useState('');
  const [tags, setTags] = useState('');
  const [roles, setRoles] = useState<LibraryRole[]>([]);
  const [category, setCategory] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [credit, setCredit] = useState('');
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [q, setQ] = useState('');
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const open = image !== null;

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (image && !d.open) {
      setMode('view');
      setTitle(image.title);
      setCollection(image.collection);
      setTags(image.tags.join(', '));
      setRoles(image.roles);
      setCategory(image.category);
      setReviewed(image.reviewed);
      setCredit(image.credit);
      setNatural(null);
      setQ('');
      setError('');
      d.showModal();
    }
    if (!image && d.open) d.close();
  }, [image]);

  useEffect(() => {
    if (!open || mode !== 'associate') return;
    let alive = true;
    const t = setTimeout(() => {
      libraryApi.items({ q, limit: 60 })
        .then((r) => { if (alive) { setItems(r.items); setError(''); } })
        .catch((e) => alive && setError(e instanceof Error ? e.message : 'No se pudo cargar el catálogo.'));
    }, q ? 250 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [open, mode, q]);

  async function guard(fn: () => Promise<string>) {
    setBusy(true);
    setError('');
    try { onChanged(await fn()); } catch (e) { setError(e instanceof Error ? e.message : 'Error'); } finally { setBusy(false); }
  }

  const dims = natural ?? (image?.width && image.height ? { w: image.width, h: image.height } : null);

  return (
    <dialog
      ref={dialog}
      aria-labelledby="library-image-title"
      onCancel={(e) => { e.preventDefault(); if (!busy) onClose(); }}
      onClick={(e) => e.target === dialog.current && !busy && onClose()}
      className="m-auto max-h-[92dvh] w-[min(96vw,64rem)] flex-col overflow-hidden rounded-3xl border border-white/15 bg-night-800 p-0 text-left text-white shadow-2xl backdrop:bg-black/70 backdrop:backdrop-blur-sm open:flex"
    >
      {image ? (
        <>
          <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-6">
            <h2 id="library-image-title" className="min-w-0 truncate font-display text-xl sm:text-2xl">{image.title || '(sin título)'}</h2>
            <Button type="button" variant="ghost" size="sm" onClick={onClose} aria-label="Cerrar"><X className="size-5" aria-hidden /></Button>
          </div>
          <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto overscroll-contain p-4 sm:px-6 lg:grid-cols-[1.4fr_1fr]" data-testid="library-image-dialog">
            <div className="space-y-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- alojada en el CDN del propietario */}
              <img src={image.url} alt={image.title} referrerPolicy="no-referrer" onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} className="max-h-[60dvh] w-full rounded-2xl bg-night-950 object-contain" />
              <p className="text-xs text-white/60">
                {dims ? `${dims.w}×${dims.h} px` : ''}{image.bytes ? ` · ${Math.round(image.bytes / 1024)} KB` : ''} · subida el {new Date(image.created_at).toLocaleDateString('es-ES')}
              </p>
              <a href={image.url} target="_blank" rel="noreferrer" className="inline-block text-sm underline">Abrir la imagen en una pestaña nueva</a>
            </div>

            {mode === 'view' ? (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" onClick={() => onCreateProduct(image)} data-testid="library-create-product">Crear producto del catálogo</Button>
                  <Button variant="secondary" onClick={() => setMode('associate')} data-testid="library-associate">Asociar a un producto</Button>
                </div>
                {!image.credit.trim() ? (
                  <p role="status" className="rounded-xl bg-gold/10 px-3 py-2 text-sm font-semibold text-gold-soft" data-testid="no-credit-warning">Esta imagen no tiene crédito ni origen. Anota abajo el autor o la fuente (ayuda a retirarla si un titular lo pide).</p>
                ) : null}
                <form
                  className="space-y-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void guard(async () => {
                      await libraryApi.updateImages([image.id], { title, collection, category, roles, reviewed, tags: tags.split(',').map((t) => t.trim()).filter(Boolean), credit });
                      return `«${title || 'Imagen'}» actualizada`;
                    });
                  }}
                >
                  <label className="block text-sm font-semibold">Título
                    <input aria-label="Título de la imagen" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} className={`${field} mt-1`} />
                  </label>
                  <label className="block text-sm font-semibold">Colección
                    <input list="library-image-collections" aria-label="Colección de la imagen" maxLength={60} value={collection} onChange={(e) => setCollection(e.target.value)} className={`${field} mt-1`} />
                    <datalist id="library-image-collections">{collections.map((c) => <option key={c} value={c} />)}</datalist>
                  </label>
                  <RoleChecks value={roles} onChange={setRoles} />
                  <label className="block text-sm font-semibold">Categoría / temática
                    <input list="library-image-categories" aria-label="Categoría de la imagen" maxLength={60} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Halloween, Paisajes…" className={`${field} mt-1`} />
                    <datalist id="library-image-categories">{LIBRARY_CATEGORIES.map((c) => <option key={c.name} value={c.name} />)}</datalist>
                  </label>
                  <label className="block text-sm font-semibold">Etiquetas (separadas por comas)
                    <input aria-label="Etiquetas de la imagen" value={tags} onChange={(e) => setTags(e.target.value)} className={`${field} mt-1`} />
                  </label>
                  <label className="block text-sm font-semibold">Crédito / origen
                    <input aria-label="Crédito de la imagen" maxLength={120} value={credit} onChange={(e) => setCredit(e.target.value)} className={`${field} mt-1`} />
                  </label>
                  <label className="flex min-h-9 cursor-pointer items-center gap-2 text-sm font-semibold" title="Solo las revisadas se ofrecen a los anfitriones en «Elegir de la biblioteca»">
                    <input type="checkbox" className="size-4 accent-[#fbbf24]" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} aria-label="Revisada y publicada en el selector" />
                    Revisada: se ofrece a los anfitriones
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <Button type="submit" variant="secondary" loading={busy}>Guardar cambios</Button>
                    <Button type="button" variant="danger" disabled={busy} onClick={() => onDelete(image)}>Borrar</Button>
                  </div>
                </form>
              </div>
            ) : (
              <div className="space-y-3" data-testid="library-associate-panel">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-bold">Asociar a un producto del catálogo</h3>
                  <Button size="sm" variant="ghost" onClick={() => setMode('view')}>Volver</Button>
                </div>
                <p className="text-xs text-white/65">La imagen pasa a ser la foto del producto elegido (sustituye a la que tuviera).</p>
                <input aria-label="Buscar productos del catálogo" placeholder="Buscar producto…" value={q} onChange={(e) => setQ(e.target.value)} className={field} />
                {items.length === 0 ? <p className="text-sm text-white/70">No hay productos{q ? ' con ese nombre' : ''}. Créalo con «Crear producto del catálogo».</p> : (
                  <ul className="max-h-[45dvh] space-y-2 overflow-y-auto">
                    {items.map((it) => (
                      <li key={it.id} data-testid="library-associate-item" className="flex items-center gap-2 rounded-xl border border-white/10 bg-night-900 p-2">
                        {it.photo_url ? (
                          // eslint-disable-next-line @next/next/no-img-element -- alojada en el CDN del propietario
                          <img src={it.photo_url} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-10 rounded-lg object-cover" />
                        ) : <span className="grid size-10 place-items-center rounded-lg bg-night-950" aria-hidden>{it.emoji ?? '📦'}</span>}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-bold">{it.name}</span>
                          <span className="block truncate text-xs text-white/60">{it.collection || 'sin colección'}{it.image_id === image.id ? ' · ya usa esta imagen' : ''}</span>
                        </span>
                        <Button size="sm" variant="secondary" disabled={busy || it.image_id === image.id} aria-label={`Asociar a ${it.name}`} onClick={() => void guard(async () => { await libraryApi.updateItem(it.id, { image_id: image.id }); return `Imagen asociada a «${it.name}»`; })}>Asociar</Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
          {error ? <p role="alert" className="mx-4 mb-3 rounded-xl bg-rose/15 px-3 py-2 text-sm text-rose sm:mx-6">{error}</p> : null}
        </>
      ) : null}
    </dialog>
  );
}
