'use client';

import { useCallback, useEffect, useState } from 'react';
import { Section } from './widgets';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { libraryApi, type CollectionCount, type DuplicateGroup, type LibraryImage } from '@/lib/client/library-api';
import { LibraryUpload } from './library-upload';
import { LibraryImageDialog } from './library-image-dialog';
import { CreateProductsDialog } from './library-create-products-dialog';
import { LibraryCoverage, LibrarySimilar } from './library-coverage';
import { RoleBadges } from './library-role-fields';
import { LIBRARY_CATEGORIES, LIBRARY_ROLES, type LibraryRole } from '@/lib/library/taxonomy';

const input = 'w-full rounded-xl border border-white/15 bg-night-900 px-3 py-2';
const PAGE = 60;

/** Imágenes de la biblioteca del superadmin: subida masiva y galería (solo fotos). Los productos del catálogo viven en /admin/catalogo. */
export function LibraryPanel({ uploadsEnabled }: { uploadsEnabled: boolean }) {
  const [images, setImages] = useState<LibraryImage[]>([]);
  const [total, setTotal] = useState(0);
  const [collections, setCollections] = useState<CollectionCount[]>([]);
  const [q, setQ] = useState('');
  const [collection, setCollection] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [bulkCollection, setBulkCollection] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const [viewing, setViewing] = useState<LibraryImage | null>(null);
  const [creating, setCreating] = useState<LibraryImage[]>([]);
  const [noCredit, setNoCredit] = useState(false);
  const [unreviewed, setUnreviewed] = useState(false);
  const [counts, setCounts] = useState({ no_credit: 0, unreviewed: 0, start: 0, product: 0, none: 0 });
  const [categories, setCategories] = useState<CollectionCount[]>([]);
  const [category, setCategory] = useState('');
  const [role, setRole] = useState<'' | LibraryRole | 'none'>('');
  const [bulkRole, setBulkRole] = useState<LibraryRole>('start');
  const [bulkTag, setBulkTag] = useState('');
  const [bulkCategory, setBulkCategory] = useState('');
  const [dups, setDups] = useState<DuplicateGroup[]>([]);
  const [dupDelete, setDupDelete] = useState<LibraryImage | null>(null);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      libraryApi.images({ q, collection: collection || null, category: category || null, role: role || null, limit: PAGE, offset: 0, noCredit, unreviewed })
        .then((r) => { if (alive) { setImages(r.images); setTotal(r.total); setCollections(r.collections); setCategories(r.categories); setCounts(r.counts); } })
        .catch((e) => alive && setMsg({ ok: false, text: e instanceof Error ? e.message : 'Error' }));
    }, q ? 250 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [q, collection, category, role, noCredit, unreviewed, version]);

  useEffect(() => {
    let alive = true;
    libraryApi.duplicates().then((r) => alive && setDups(r.groups)).catch(() => undefined);
    return () => { alive = false; };
  }, [version]);

  async function more() {
    const r = await libraryApi.images({ q, collection: collection || null, category: category || null, role: role || null, limit: PAGE, offset: images.length, noCredit, unreviewed });
    setImages((cur) => [...cur, ...r.images.filter((i) => !cur.some((c) => c.id === i.id))]);
  }

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const ids = [...selected];

  async function act(fn: () => Promise<string>) {
    setBusy(true);
    setMsg(null);
    try { setMsg({ ok: true, text: await fn() }); refresh(); } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'Error' }); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-5">
      {msg ? <p role="status" className={`rounded-2xl px-4 py-2 text-sm font-semibold ${msg.ok ? 'bg-teal/15 text-teal' : 'bg-rose/20 text-rose'}`}>{msg.text}</p> : null}

      <>
          <Section title="Cobertura y calidad" hint="Cuántas imágenes publicadas hay por rol y categoría frente al objetivo, y qué falta por revisar. Solo las revisadas aparecen en «Elegir de la biblioteca» de las partidas.">
            <LibraryCoverage version={version} onFilter={(f) => { setCategory(f.category); setRole(f.role); setCollection(''); setQ(''); }} />
          </Section>

          <Section title="Subida masiva" hint={<>Imágenes generales (paisajes, objetos divertidos…) que se reutilizan en cualquier partida o plantilla: se guardan <b>una sola vez</b> en tu repositorio público de fotos y aquí solo queda el enlace.</>}>
            <LibraryUpload enabled={uploadsEnabled} collections={collections.map((c) => c.name).filter(Boolean)} onDone={refresh} />
          </Section>

          <Section title="Imágenes" hint="Pulsa una imagen para inspeccionarla y crear o asociar un producto del catálogo. Marca varias para moverlas de colección, borrarlas o crear productos.">
            <div className="mb-3 grid gap-2 md:grid-cols-4">
              <input aria-label="Buscar imágenes" placeholder="Buscar por título, etiqueta, categoría o colección…" value={q} onChange={(e) => setQ(e.target.value)} className={input} />
              <select aria-label="Filtrar por rol" value={role} onChange={(e) => setRole(e.target.value as typeof role)} className={input}>
                <option value="">Todos los roles</option>
                {LIBRARY_ROLES.map((r) => <option key={r.id} value={r.id}>{r.label} · {counts[r.id]}</option>)}
                <option value="none">Sin rol · {counts.none}</option>
              </select>
              <select aria-label="Filtrar por categoría" value={category} onChange={(e) => setCategory(e.target.value)} className={input}>
                <option value="">Todas las categorías</option>
                {categories.map((c) => <option key={c.name} value={c.name}>{c.name} · {c.count}</option>)}
              </select>
              <select aria-label="Filtrar por colección" value={collection} onChange={(e) => setCollection(e.target.value)} className={input}>
                <option value="">Todas las colecciones</option>
                {collections.map((c) => <option key={c.name} value={c.name}>{c.name || '(sin colección)'} · {c.count}</option>)}
              </select>
              <div className="flex flex-wrap gap-2 md:col-span-4">
                <Button variant="ghost" onClick={() => setSelected(new Set(images.map((i) => i.id)))} disabled={images.length === 0}>Seleccionar todo lo visible</Button>
                <Button variant="ghost" onClick={() => setSelected(new Set())} disabled={selected.size === 0}>Quitar selección</Button>
                {collection ? (
                  <Button variant="secondary" disabled={busy || images.length === 0} data-testid="library-collection-to-items" onClick={() => void act(async () => {
                    const all = await libraryApi.images({ collection, limit: 500, offset: 0 });
                    if (all.images.length === 0) throw new Error('Esa colección no tiene imágenes.');
                    setCreating(all.images);
                    return `${all.images.length} imágenes de «${collection}» listas para crear productos`;
                  })}>Productos de toda la colección</Button>
                ) : null}
              </div>
            </div>

            <div className="mb-3 flex flex-wrap items-center gap-2" role="group" aria-label="Filtros de moderación">
              <Button size="sm" variant={noCredit ? 'primary' : 'secondary'} aria-pressed={noCredit} onClick={() => setNoCredit(!noCredit)} data-testid="filter-no-credit">Sin crédito ({counts.no_credit})</Button>
              <Button size="sm" variant={unreviewed ? 'primary' : 'secondary'} aria-pressed={unreviewed} onClick={() => setUnreviewed(!unreviewed)} data-testid="filter-unreviewed">Sin revisar ({counts.unreviewed})</Button>
            </div>

            {selected.size > 0 ? (
              <div className="sticky top-2 z-10 mb-3 flex flex-wrap items-end gap-2 rounded-2xl border border-gold/40 bg-night-900/95 p-3 backdrop-blur" data-testid="library-bulk">
                <span className="font-bold">{selected.size} seleccionadas</span>
                <label className="text-xs font-semibold">Mover a colección
                  <input list="library-collections-bulk" aria-label="Nueva colección" value={bulkCollection} onChange={(e) => setBulkCollection(e.target.value)} className={`${input} mt-1 w-48`} />
                  <datalist id="library-collections-bulk">{collections.map((c) => <option key={c.name} value={c.name} />)}</datalist>
                </label>
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => void act(async () => { const r = await libraryApi.updateImages(ids, { collection: bulkCollection }); setSelected(new Set()); return `${r.updated} imágenes movidas a «${bulkCollection || 'sin colección'}»`; })}>Mover</Button>
                <label className="text-xs font-semibold">Rol
                  <select aria-label="Rol para la selección" value={bulkRole} onChange={(e) => setBulkRole(e.target.value as LibraryRole)} className={`${input} mt-1 w-44`}>
                    {LIBRARY_ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                  </select>
                </label>
                <Button size="sm" variant="secondary" disabled={busy} data-testid="library-role-add" onClick={() => void act(async () => { const r = await libraryApi.updateImages(ids, { roles_add: [bulkRole] }); return `Rol añadido a ${r.updated} imágenes`; })}>Añadir rol</Button>
                <Button size="sm" variant="secondary" disabled={busy} data-testid="library-role-remove" onClick={() => void act(async () => { const r = await libraryApi.updateImages(ids, { roles_remove: [bulkRole] }); return `Rol quitado de ${r.updated} imágenes`; })}>Quitar rol</Button>
                <label className="text-xs font-semibold">Categoría
                  <input list="library-categories-bulk" aria-label="Categoría para la selección" value={bulkCategory} onChange={(e) => setBulkCategory(e.target.value)} className={`${input} mt-1 w-44`} />
                  <datalist id="library-categories-bulk">{[...new Set([...LIBRARY_CATEGORIES.map((c) => c.name), ...categories.map((c) => c.name)])].map((n) => <option key={n} value={n} />)}</datalist>
                </label>
                <Button size="sm" variant="secondary" disabled={busy || !bulkCategory.trim()} data-testid="library-category-set" onClick={() => void act(async () => { const r = await libraryApi.updateImages(ids, { category: bulkCategory }); return `${r.updated} imágenes en la categoría «${bulkCategory}»`; })}>Fijar categoría</Button>
                <label className="text-xs font-semibold">Etiqueta
                  <input aria-label="Etiqueta para la selección" value={bulkTag} onChange={(e) => setBulkTag(e.target.value)} placeholder="terror" className={`${input} mt-1 w-36`} />
                </label>
                <Button size="sm" variant="secondary" disabled={busy || !bulkTag.trim()} data-testid="library-tag-add" onClick={() => void act(async () => { const r = await libraryApi.updateImages(ids, { tags_add: [bulkTag] }); return `Etiqueta «${bulkTag}» añadida a ${r.updated} imágenes`; })}>Añadir etiqueta</Button>
                <Button size="sm" variant="secondary" disabled={busy || !bulkTag.trim()} onClick={() => void act(async () => { const r = await libraryApi.updateImages(ids, { tags_remove: [bulkTag] }); return `Etiqueta «${bulkTag}» quitada de ${r.updated} imágenes`; })}>Quitar etiqueta</Button>
                <Button size="sm" variant="secondary" disabled={busy} data-testid="library-mark-reviewed" onClick={() => void act(async () => { const r = await libraryApi.updateImages(ids, { reviewed: true }); setSelected(new Set()); return `${r.updated} imágenes marcadas como revisadas`; })}>Marcar como revisadas</Button>
                <Button size="sm" variant="primary" disabled={busy} onClick={() => setCreating(images.filter((i) => selected.has(i.id)))} data-testid="library-to-items">Crear productos…</Button>
                <Button size="sm" variant="danger" disabled={busy} onClick={() => setConfirmDelete(true)}>Borrar</Button>
              </div>
            ) : null}

            {images.length === 0 ? <p className="text-sm text-white/70">Todavía no hay imágenes{q || collection ? ' con ese filtro' : ''}.</p> : (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6" data-testid="library-grid">
                {images.map((i) => (
                  <li key={i.id} data-testid="library-image" className={`overflow-hidden rounded-2xl border bg-night-900 ${selected.has(i.id) ? 'border-gold' : 'border-white/10'}`}>
                    <button type="button" onClick={() => setViewing(i)} aria-label={`Ver ${i.title || 'imagen'}`} className="block w-full focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-gold/50">
                      {/* eslint-disable-next-line @next/next/no-img-element -- alojada en el CDN del propietario */}
                      <img src={i.url} alt={i.title} loading="lazy" referrerPolicy="no-referrer" className="aspect-square w-full object-cover" />
                    </button>
                    <label className="flex cursor-pointer items-start gap-2 p-2 text-xs">
                      <input type="checkbox" checked={selected.has(i.id)} onChange={() => toggle(i.id)} aria-label={`Seleccionar ${i.title}`} className="mt-0.5 size-4 accent-[#fbbf24]" />
                      <span className="min-w-0">
                        <span className="block truncate font-bold">{i.title || '(sin título)'}</span>
                        <span className="block truncate text-white/60">{i.category || i.collection || 'sin categoría'}</span>
                        <span className="flex flex-wrap gap-1"><RoleBadges roles={i.roles} /></span>
                        {!i.credit.trim() || !i.reviewed ? <span className="block truncate text-gold-soft">{[!i.credit.trim() ? 'sin crédito' : '', !i.reviewed ? 'sin revisar' : ''].filter(Boolean).join(' · ')}</span> : null}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            {images.length < total ? <div className="mt-3 text-center"><Button variant="secondary" onClick={() => void more()}>Cargar más ({images.length}/{total})</Button></div> : null}
          </Section>

          <LibrarySimilar version={version} busy={busy} onChanged={refresh} onDelete={setDupDelete} />

          <Section title={`Posibles duplicados (${dups.length})`} hint="Imágenes con el mismo título dentro de la misma colección. Solo se compara el título, no el contenido: revisa antes de borrar. Se quita el registro (el archivo sigue en GitHub) y los productos que lo usaban se quedan sin foto.">
            {dups.length === 0 ? <p className="text-sm text-white/70">No hay títulos repetidos dentro de una misma colección.</p> : (
              <ul className="space-y-3" data-testid="library-duplicates">
                {dups.map((g) => (
                  <li key={`${g.collection}|${g.title}`} className="rounded-2xl border border-white/10 bg-night-900 p-3" data-testid="library-duplicate-group">
                    <p className="mb-2 text-sm font-bold">«{g.title}» <span className="font-normal text-white/60">· {g.collection || 'sin colección'} · {g.images.length} imágenes</span></p>
                    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      {g.images.map((i, n) => (
                        <li key={i.id} className="overflow-hidden rounded-xl border border-white/10">
                          {/* eslint-disable-next-line @next/next/no-img-element -- alojada en el CDN del propietario */}
                          <img src={i.url} alt={i.title} loading="lazy" referrerPolicy="no-referrer" className="aspect-square w-full object-cover" />
                          <div className="flex items-center justify-between gap-1 p-2 text-xs">
                            <span className="text-white/60">{n === 0 ? 'La más antigua' : 'Posible repetida'}</span>
                            <Button size="sm" variant="danger" disabled={busy} aria-label={`Borrar el registro duplicado ${i.title} ${n + 1}`} onClick={() => setDupDelete(i)}>Borrar</Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </Section>
      </>

      <ConfirmDialog
        open={!!dupDelete}
        title="Borrar registro duplicado"
        confirmLabel="Borrar"
        variant="danger"
        loading={busy}
        onCancel={() => setDupDelete(null)}
        onConfirm={async () => { const d = dupDelete; if (d) await act(async () => { const r = await libraryApi.deleteImages([d.id]); return `${r.deleted} registro quitado de la biblioteca`; }); setDupDelete(null); }}
      >
        <p>Se quitará el registro de <b>{dupDelete?.title}</b>. <b>El archivo permanece en el repositorio de fotos</b> y los productos que usaban esta imagen se quedan sin foto.</p>
      </ConfirmDialog>

      <LibraryImageDialog
        image={viewing}
        collections={collections.map((c) => c.name).filter(Boolean)}
        onClose={() => setViewing(null)}
        onChanged={(text) => { setMsg({ ok: true, text }); setViewing(null); refresh(); }}
        onCreateProduct={(img) => { setViewing(null); setCreating([img]); }}
        onDelete={(img) => { setViewing(null); setSelected(new Set([img.id])); setConfirmDelete(true); }}
      />
      <CreateProductsDialog
        images={creating}
        collections={collections.map((c) => c.name).filter(Boolean)}
        onClose={() => setCreating([])}
        onDone={(text) => { setMsg({ ok: true, text }); setCreating([]); setSelected(new Set()); }}
      />

      <ConfirmDialog
        open={confirmDelete}
        title="Borrar imágenes de la biblioteca"
        confirmLabel="Borrar"
        variant="danger"
        loading={busy}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => { await act(async () => { const r = await libraryApi.deleteImages(ids); setSelected(new Set()); return `${r.deleted} imágenes quitadas de la biblioteca`; }); setConfirmDelete(false); }}
      >
        <p>Se quitarán {selected.size} imágenes de la biblioteca. <b>El archivo permanece en el repositorio de fotos</b> (no se borra de GitHub) y las partidas ya creadas no cambian. Los productos que las usaban se quedan sin foto.</p>
      </ConfirmDialog>
    </div>
  );
}
