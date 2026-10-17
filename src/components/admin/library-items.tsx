'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ImageOff, Images, ListPlus, Pencil, Plus, Sparkles, Trash2, Upload, X } from 'lucide-react';
import { Section } from './widgets';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  commitLibraryRequest, generateItemImageRequest, libraryApi, stageLibraryImageRequest, type CollectionCount, type LibraryImage, type LibraryItem, type LibraryItemInput,
} from '@/lib/client/library-api';
import { parseItemLines } from '@/lib/services/library-parse';
import { EmojiInput } from '@/components/ui/emoji-input';
import { LibraryImagePicker } from './library-image-picker';

const input = 'w-full rounded-xl border border-white/15 bg-night-900 px-3 py-2';
const PAGE_SIZES = [12, 24, 48];
const PHOTO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

interface Draft { name: string; description: string; emoji: string; collection: string }

/** Ventana modal sencilla (<dialog>): se cierra con Escape, con la ✕ o pulsando fuera. */
function Modal({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-auto max-h-[92dvh] w-[min(94vw,36rem)] flex-col overflow-hidden rounded-3xl border border-white/15 bg-night-800 p-0 text-left text-white shadow-2xl backdrop:bg-black/70 backdrop:backdrop-blur-sm open:flex"
    >
      {open ? (
        <>
          <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-6">
            <h2 className="font-display text-xl sm:text-2xl">{title}</h2>
            <Button type="button" variant="ghost" size="sm" onClick={onClose} aria-label="Cerrar"><X className="size-5" aria-hidden /></Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">{children}</div>
        </>
      ) : null}
    </dialog>
  );
}

function ItemForm({ initial, collections, submitLabel, busy, onSubmit, onCancel }: { initial?: LibraryItem; collections: string[]; submitLabel: string; busy: boolean; onSubmit: (d: Draft) => Promise<boolean>; onCancel?: () => void }) {
  const [d, setD] = useState<Draft>({ name: initial?.name ?? '', description: initial?.description ?? '', emoji: initial?.emoji ?? '', collection: initial?.collection ?? '' });
  const id = initial?.id ?? 'new';
  const listId = `item-collections-${id}`;
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await onSubmit({ ...d, name: d.name.trim(), description: d.description.trim(), emoji: d.emoji.trim(), collection: d.collection.trim() });
        if (ok && !initial) setD({ name: '', description: '', emoji: '', collection: d.collection });
      }}
    >
      <div className="grid grid-cols-[6.5rem_1fr] gap-2">
        <label className="text-sm font-semibold">Emoji
          <EmojiInput ariaLabel="Emoji del producto" className={`${input} mt-1 text-center text-2xl`} value={d.emoji} onChange={(emoji) => setD({ ...d, emoji })} />
        </label>
        <label className="text-sm font-semibold">Nombre
          <input aria-label="Nombre del producto" className={`${input} mt-1`} value={d.name} maxLength={80} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="Nombre del producto" />
        </label>
      </div>
      <label className="block text-sm font-semibold">Colección
        <input list={listId} aria-label="Colección del producto" className={`${input} mt-1`} value={d.collection} maxLength={60} onChange={(e) => setD({ ...d, collection: e.target.value })} placeholder="Halloween, Chocolates…" />
        <datalist id={listId}>{collections.map((c) => <option key={c} value={c} />)}</datalist>
      </label>
      <label className="block text-sm font-semibold">Descripción
        <textarea aria-label="Descripción del producto" className={`${input} mt-1 min-h-20`} value={d.description} maxLength={500} onChange={(e) => setD({ ...d, description: e.target.value })} placeholder="Qué es y cómo se ve (se usa para generar la imagen)" />
      </label>
      <div className="flex gap-2">
        <Button type="submit" variant={initial ? 'success' : 'primary'} disabled={!d.name.trim() || busy} loading={busy}>
          {!initial ? <Plus className="size-5" aria-hidden /> : null} {submitLabel}
        </Button>
        {onCancel ? <Button type="button" variant="ghost" onClick={onCancel}>Cancelar</Button> : null}
      </div>
    </form>
  );
}

/**
 * Catálogo general de productos del superadmin, con la misma presentación que el catálogo del anfitrión: buscador, filtro por colección,
 * lista con foto y, en cada producto, generar imagen con IA, subir o elegir de la biblioteca su foto, quitarla, editarlo y eliminarlo.
 * Los productos se importan después en cualquier partida o plantilla desde el asistente.
 */
export function LibraryItems({ aiConfigured = false, uploadsEnabled = true }: { aiConfigured?: boolean; uploadsEnabled?: boolean }) {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [collections, setCollections] = useState<CollectionCount[]>([]);
  const [q, setQ] = useState('');
  const [collection, setCollection] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [text, setText] = useState('');
  const [targetCollection, setTargetCollection] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState<'one' | 'many' | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]!);
  const [removing, setRemoving] = useState<LibraryItem | null>(null);
  const [picking, setPicking] = useState<LibraryItem | null>(null);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const files = useRef<Record<string, HTMLInputElement | null>>({});
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const names = collections.map((c) => c.name).filter(Boolean);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      libraryApi.items({ q, collection: collection || null, limit: pageSize, offset: page * pageSize })
        .then((r) => {
          if (!alive) return;
          // Si tras borrar la página actual queda fuera de rango, se vuelve a la última.
          if (r.items.length === 0 && r.total > 0 && page > 0) { setPage(Math.ceil(r.total / pageSize) - 1); return; }
          setItems(r.items); setTotal(r.total); setCollections(r.collections);
        })
        .catch((e) => alive && setMsg({ ok: false, text: e instanceof Error ? e.message : 'Error' }));
    }, q ? 250 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [q, collection, version, page, pageSize]);

  const pages = Math.max(1, Math.ceil(total / pageSize));
  async function run(key: string, fn: () => Promise<string>): Promise<boolean> {
    setBusy(key);
    setMsg(null);
    try { setMsg({ ok: true, text: await fn() }); refresh(); return true; } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'Error' }); return false; } finally { setBusy(null); }
  }

  const toPayload = (d: Draft): LibraryItemInput => ({ name: d.name, description: d.description, emoji: d.emoji || null, collection: d.collection });

  async function uploadPhoto(it: LibraryItem, file: File) {
    if (!PHOTO_TYPES.includes(file.type)) return setMsg({ ok: false, text: 'Formato no válido. Usa PNG, JPEG o WebP.' });
    await run(`photo-${it.id}`, async () => {
      const r = await stageLibraryImageRequest(file, { collection: it.collection, tags: '', credit: '', kind: 'item' });
      const image: LibraryImage = r.existed ? r.image : (await commitLibraryRequest([r.staged])).images[0]!;
      await libraryApi.updateItem(it.id, { image_id: image.id });
      return `Foto de «${it.name}» guardada`;
    });
  }

  async function addFromText(): Promise<boolean> {
    return run('bulk', async () => {
      const imgs = (await libraryApi.images({ collection: targetCollection || null, limit: 200 })).images;
      const { items: parsed, ignored } = parseItemLines(text, imgs, targetCollection.trim());
      if (parsed.length === 0) throw new Error('Escribe al menos un producto: «Nombre; Descripción; Emoji», uno por línea.');
      const r = await libraryApi.addItems(parsed as LibraryItemInput[]);
      setText('');
      const linked = parsed.filter((p) => p.image_id).length;
      return `${r.added} productos añadidos${r.skipped ? `, ${r.skipped} repetidos omitidos` : ''}${linked ? `, ${linked} con foto enlazada por nombre` : ''}${ignored.length ? `, ${ignored.length} líneas ignoradas` : ''}.`;
    });
  }

  return (
    <div className="space-y-5">
      {msg ? <p role="status" className={`rounded-2xl px-4 py-2 text-sm font-semibold ${msg.ok ? 'bg-teal/15 text-teal' : 'bg-rose/20 text-rose'}`}>{msg.text}</p> : null}
      <p className="rounded-2xl border border-white/10 bg-night-800/70 px-4 py-3 text-sm text-white/75">
        📷 Cada producto puede tener su <b>foto</b> (la subes, la eliges de Imágenes o la genera la IA). Al importarlo en una partida, la IA mezcla esa foto con la casa del jugador. {aiConfigured ? 'La generación con IA usa la cadena de proveedores gratuitos y cuenta en el tope diario.' : 'La IA no está configurada en el servidor: «Generar imagen» está desactivada.'}
      </p>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl">Productos del catálogo general <span className="text-white/60">({total})</span></h2>
          <p className="text-sm text-white/65">Se importan en cualquier partida o plantilla desde «Importar de la biblioteca» (las fotos se usan por enlace, sin copiarlas).</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" size="lg" onClick={() => setAdding('one')} data-testid="catalog-add-one"><Plus className="size-5" aria-hidden /> Añadir producto</Button>
          <Button variant="secondary" size="lg" onClick={() => setAdding('many')} data-testid="catalog-add-many"><ListPlus className="size-5" aria-hidden /> Añadir varios (texto)</Button>
        </div>
      </div>

      <Section title="Productos" hint="Busca por nombre, descripción o colección y filtra por colección.">
        <div className="mb-3 grid gap-2 md:grid-cols-[1fr_1fr_auto]">
          <input aria-label="Buscar productos" placeholder="Buscar por nombre, descripción o colección…" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} className={input} />
          <select aria-label="Filtrar productos por colección" value={collection} onChange={(e) => { setCollection(e.target.value); setPage(0); }} className={input}>
            <option value="">Todas las colecciones</option>
            {collections.map((c) => <option key={c.name} value={c.name}>{c.name || '(sin colección)'} · {c.count}</option>)}
          </select>
          <select aria-label="Productos por página" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }} className={input}>
            {PAGE_SIZES.map((n) => <option key={n} value={n}>{n} por página</option>)}
          </select>
        </div>
        {items.length === 0 ? <p className="text-sm text-white/70">Todavía no hay productos{q || collection ? ' con ese filtro' : ''}.</p> : (
          <ul className="space-y-3" data-testid="library-items">
            {items.map((it) => (
              <li key={it.id} data-testid="library-item" className="rounded-3xl border border-white/10 bg-night-800/80 p-4">
                <div className="flex items-start gap-3">
                  {it.photo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- alojada en el CDN del propietario
                    <img src={it.photo_url} alt={it.name} loading="lazy" referrerPolicy="no-referrer" className="size-16 shrink-0 rounded-xl object-cover" />
                  ) : <span className="flex size-16 shrink-0 items-center justify-center rounded-xl bg-night-950 text-4xl" aria-hidden>{it.emoji ?? '🎁'}</span>}
                  <div className="min-w-0 flex-1">
                    <h3 className="font-bold">{it.emoji ? `${it.emoji} ` : ''}{it.name}</h3>
                    <p className="line-clamp-2 text-sm text-white/65">{it.description || 'Sin descripción'}</p>
                    <p className="mt-1 text-xs text-white/55">{it.collection || 'sin colección'}{it.photo_credit ? ` · ${it.photo_credit}` : ''}</p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="md" variant="secondary" disabled={!aiConfigured || !uploadsEnabled || busy !== null} loading={busy === `gen-${it.id}`} title={aiConfigured ? undefined : 'Requiere un proveedor de IA configurado'} aria-label={`Generar imagen de ${it.name}`}
                    onClick={() => void run(`gen-${it.id}`, async () => { const r = await generateItemImageRequest(it); return `Imagen de «${it.name}» generada con ${r.provider}${r.model ? ` (${r.model})` : ''}`; })}>
                    <Sparkles className="size-4" aria-hidden /> {busy === `gen-${it.id}` ? 'Generando…' : 'Generar imagen'}
                  </Button>
                  <input ref={(el) => { files.current[it.id] = el; }} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" tabIndex={-1} aria-label={`Archivo de foto de ${it.name}`}
                    onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void uploadPhoto(it, f); }} />
                  <Button size="md" variant="secondary" disabled={!uploadsEnabled || busy !== null} loading={busy === `photo-${it.id}`} aria-label={`Subir foto de ${it.name}`} onClick={() => files.current[it.id]?.click()}>
                    <Upload className="size-4" aria-hidden /> {it.photo_url ? 'Cambiar foto' : 'Subir foto'}
                  </Button>
                  <Button size="md" variant="secondary" disabled={busy !== null} aria-label={`Elegir foto de ${it.name} de la biblioteca`} onClick={() => setPicking(it)}>
                    <Images className="size-4" aria-hidden /> De la biblioteca
                  </Button>
                  {it.photo_url ? (
                    <Button size="md" variant="ghost" disabled={busy !== null} loading={busy === `clear-${it.id}`} aria-label={`Quitar foto de ${it.name}`} onClick={() => void run(`clear-${it.id}`, async () => { await libraryApi.updateItem(it.id, { image_id: null }); return 'Foto quitada'; })}>
                      <ImageOff className="size-4" aria-hidden /> Quitar foto
                    </Button>
                  ) : null}
                  <Button size="md" variant="ghost" disabled={busy !== null} aria-label={`Editar ${it.name}`} onClick={() => setEditing(editing === it.id ? null : it.id)}>
                    <Pencil className="size-4" aria-hidden /> Editar
                  </Button>
                  <Button size="md" variant="ghost" className="text-rose" disabled={busy !== null} aria-label={`Eliminar ${it.name}`} onClick={() => setRemoving(it)}>
                    <Trash2 className="size-4" aria-hidden /> Eliminar
                  </Button>
                </div>
                {editing === it.id ? (
                  <div className="mt-3 rounded-2xl bg-night-900 p-3">
                    <ItemForm
                      initial={it}
                      collections={names}
                      submitLabel="Guardar cambios"
                      busy={busy === `edit-${it.id}`}
                      onCancel={() => setEditing(null)}
                      onSubmit={async (d) => {
                        const ok = await run(`edit-${it.id}`, async () => { await libraryApi.updateItem(it.id, { name: d.name, description: d.description, emoji: d.emoji || null, collection: d.collection }); return 'Producto actualizado'; });
                        if (ok) setEditing(null);
                        return ok;
                      }}
                    />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {total > 0 ? (
          <nav aria-label="Paginación del catálogo" className="mt-4 flex flex-wrap items-center justify-center gap-3" data-testid="catalog-pagination">
            <Button variant="secondary" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Página anterior"><ChevronLeft className="size-4" aria-hidden /> Anterior</Button>
            <span className="text-sm font-semibold" aria-live="polite">Página {Math.min(page + 1, pages)} de {pages} · {total} productos</span>
            <Button variant="secondary" size="sm" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)} aria-label="Página siguiente">Siguiente <ChevronRight className="size-4" aria-hidden /></Button>
          </nav>
        ) : null}
      </Section>

      <Modal open={adding === 'one'} title="Añadir producto" onClose={() => setAdding(null)}>
        <p className="mb-3 text-sm text-white/70">Crea un producto nuevo; después le pones foto (subirla, elegirla de Imágenes o generarla con IA).</p>
        <ItemForm
          collections={names}
          submitLabel="Añadir al catálogo"
          busy={busy === 'add'}
          onCancel={() => setAdding(null)}
          onSubmit={async (d) => {
            const ok = await run('add', async () => { const r = await libraryApi.addItems([toPayload(d)]); return r.added ? `«${d.name}» añadido` : `«${d.name}» ya existe en esa colección`; });
            if (ok) { setAdding(null); setPage(0); }
            return ok;
          }}
        />
      </Modal>

      <Modal open={adding === 'many'} title="Añadir varios productos" onClose={() => setAdding(null)}>
        <div className="space-y-2">
          <p className="text-sm text-white/70">Una línea por producto: <code>Nombre; Descripción; Emoji</code> (descripción y emoji opcionales). Si hay una imagen de la biblioteca con el mismo título (en esa colección), se enlaza sola.</p>
          <label className="block text-sm font-semibold">Colección
            <input list="library-item-collections" aria-label="Colección de los productos nuevos" value={targetCollection} onChange={(e) => setTargetCollection(e.target.value)} placeholder="Halloween, Chocolates…" className={`${input} mt-1`} />
            <datalist id="library-item-collections">{names.map((c) => <option key={c} value={c} />)}</datalist>
          </label>
          <textarea aria-label="Lista de productos" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Calabaza gigante; Con una vela dentro; 🎃\nFantasma\nMurciélago;;🦇'} className={`${input} font-mono text-sm`} />
          <Button variant="primary" loading={busy === 'bulk'} disabled={!text.trim() || busy !== null} onClick={() => void addFromText().then((ok) => { if (ok) setAdding(null); })}>Añadir productos</Button>
        </div>
      </Modal>

      <LibraryImagePicker
        open={picking !== null}
        title={picking ? `Foto de «${picking.name}»` : 'Elegir foto'}
        onClose={() => setPicking(null)}
        onPick={(image) => { const it = picking; setPicking(null); if (it) void run(`pick-${it.id}`, async () => { await libraryApi.updateItem(it.id, { image_id: image.id }); return `Foto de «${it.name}» actualizada`; }); }}
      />

      <ConfirmDialog
        open={!!removing}
        title="Eliminar producto"
        confirmLabel="Sí, eliminar"
        variant="danger"
        loading={busy === 'remove'}
        onCancel={() => setRemoving(null)}
        onConfirm={async () => { if (removing) await run('remove', async () => { await libraryApi.deleteItems([removing.id]); return `«${removing.name}» eliminado`; }); setRemoving(null); }}
      >
        <p>Se eliminará <b>{removing?.name}</b> del catálogo general. Las partidas que ya lo importaron no cambian. La imagen sigue en Imágenes.</p>
      </ConfirmDialog>
    </div>
  );
}
