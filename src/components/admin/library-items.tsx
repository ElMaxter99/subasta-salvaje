'use client';

import { useCallback, useEffect, useState } from 'react';
import { Section } from './widgets';
import { Button } from '@/components/ui/button';
import { libraryApi, type CollectionCount, type LibraryImage, type LibraryItem, type LibraryItemInput } from '@/lib/client/library-api';
import { parseItemLines } from '@/lib/services/library-parse';

const input = 'w-full rounded-xl border border-white/15 bg-night-900 px-3 py-2';

/**
 * Catálogo general de productos: se crean en bloque (a partir de imágenes seleccionadas o de texto «Nombre; Descripción; Emoji»)
 * y luego se importan en cualquier partida o plantilla desde el catálogo del asistente.
 */
export function LibraryItems({ selectedImageIds, onClearSelection }: { selectedImageIds: string[]; onClearSelection: () => void }) {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [collections, setCollections] = useState<CollectionCount[]>([]);
  const [q, setQ] = useState('');
  const [collection, setCollection] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [text, setText] = useState('');
  const [targetCollection, setTargetCollection] = useState('');
  const [fromImages, setFromImages] = useState<{ id: string; name: string; emoji: string; description: string; collection: string }[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      libraryApi.items({ q, collection: collection || null, limit: 500 })
        .then((r) => { if (alive) { setItems(r.items); setTotal(r.total); setCollections(r.collections); } })
        .catch((e) => alive && setMsg({ ok: false, text: e instanceof Error ? e.message : 'Error' }));
    }, q ? 250 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [q, collection, version]);

  // Imágenes seleccionadas en la otra pestaña → borrador de productos (nombre = título de la imagen, editable).
  useEffect(() => {
    if (selectedImageIds.length === 0) return;
    let alive = true;
    (async () => {
      const found: LibraryImage[] = [];
      for (let offset = 0; found.length < selectedImageIds.length && offset < 5000; offset += 200) {
        const r = await libraryApi.images({ limit: 200, offset });
        found.push(...r.images.filter((i) => selectedImageIds.includes(i.id)));
        if (offset + 200 >= r.total) break;
      }
      if (alive) setFromImages(found.map((i) => ({ id: i.id, name: i.title, emoji: '', description: '', collection: i.collection })));
    })().catch(() => undefined);
    return () => { alive = false; };
  }, [selectedImageIds]);

  async function run(fn: () => Promise<string>) {
    setBusy(true);
    setMsg(null);
    try { setMsg({ ok: true, text: await fn() }); refresh(); } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'Error' }); } finally { setBusy(false); }
  }

  async function addFromText() {
    await run(async () => {
      const imgs = (await libraryApi.images({ collection: targetCollection || null, limit: 200 })).images;
      const { items: parsed, ignored } = parseItemLines(text, imgs, targetCollection.trim());
      if (parsed.length === 0) throw new Error('Escribe al menos un producto: «Nombre; Descripción; Emoji», uno por línea.');
      const r = await libraryApi.addItems(parsed as LibraryItemInput[]);
      setText('');
      const linked = parsed.filter((p) => p.image_id).length;
      return `${r.added} productos añadidos${r.skipped ? `, ${r.skipped} repetidos omitidos` : ''}${linked ? `, ${linked} con foto enlazada por nombre` : ''}${ignored.length ? `, ${ignored.length} líneas ignoradas` : ''}.`;
    });
  }

  async function addFromImages() {
    await run(async () => {
      const r = await libraryApi.addItems(fromImages.map((f) => ({ name: f.name || 'Sin nombre', description: f.description, emoji: f.emoji || null, image_id: f.id, collection: targetCollection.trim() || f.collection })));
      setFromImages([]);
      onClearSelection();
      return `${r.added} productos creados a partir de las imágenes${r.skipped ? ` (${r.skipped} repetidos omitidos)` : ''}.`;
    });
  }

  const toggle = (id: string) => setChosen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="space-y-5">
      {msg ? <p role="status" className={`rounded-2xl px-4 py-2 text-sm font-semibold ${msg.ok ? 'bg-teal/15 text-teal' : 'bg-rose/20 text-rose'}`}>{msg.text}</p> : null}

      {fromImages.length > 0 ? (
        <Section title={`Crear ${fromImages.length} productos desde las imágenes`} hint="El nombre sale del título de la imagen; edítalo y añade emoji o descripción si quieres.">
          <div className="space-y-2" data-testid="library-from-images">
            <label className="block text-sm font-semibold">Colección de los productos (vacío = la de cada imagen)
              <input list="library-item-collections" aria-label="Colección de los productos" value={targetCollection} onChange={(e) => setTargetCollection(e.target.value)} className={`${input} mt-1`} />
            </label>
            <ul className="max-h-96 space-y-2 overflow-y-auto">
              {fromImages.map((f, idx) => (
                <li key={f.id} className="grid gap-2 rounded-xl bg-night-900 p-2 md:grid-cols-[1fr_5rem_2fr]">
                  <input aria-label={`Nombre del producto ${idx + 1}`} maxLength={80} value={f.name} onChange={(e) => setFromImages((all) => all.map((x) => (x.id === f.id ? { ...x, name: e.target.value } : x)))} className={input} />
                  <input aria-label={`Emoji del producto ${idx + 1}`} maxLength={8} value={f.emoji} onChange={(e) => setFromImages((all) => all.map((x) => (x.id === f.id ? { ...x, emoji: e.target.value } : x)))} className={`${input} text-center`} placeholder="📦" />
                  <input aria-label={`Descripción del producto ${idx + 1}`} maxLength={500} value={f.description} onChange={(e) => setFromImages((all) => all.map((x) => (x.id === f.id ? { ...x, description: e.target.value } : x)))} className={input} placeholder="Descripción (opcional)" />
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <Button variant="primary" loading={busy} onClick={() => void addFromImages()}>Crear productos</Button>
              <Button variant="ghost" onClick={() => { setFromImages([]); onClearSelection(); }}>Cancelar</Button>
            </div>
          </div>
        </Section>
      ) : null}

      <Section title="Añadir productos en bloque" hint={<>Una línea por producto: <code>Nombre; Descripción; Emoji</code> (descripción y emoji opcionales). Si hay una imagen de la biblioteca con el mismo título (en esa colección), se enlaza sola.</>}>
        <div className="space-y-2">
          <label className="block text-sm font-semibold">Colección
            <input list="library-item-collections" aria-label="Colección de los productos nuevos" value={targetCollection} onChange={(e) => setTargetCollection(e.target.value)} placeholder="Halloween, Chocolates…" className={`${input} mt-1`} />
            <datalist id="library-item-collections">{collections.map((c) => <option key={c.name} value={c.name} />)}</datalist>
          </label>
          <textarea aria-label="Lista de productos" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Calabaza gigante; Con una vela dentro; 🎃\nFantasma\nMurciélago;;🦇'} className={`${input} font-mono text-sm`} />
          <Button variant="primary" loading={busy} disabled={!text.trim()} onClick={() => void addFromText()}>Añadir productos</Button>
        </div>
      </Section>

      <Section title={`Productos del catálogo general (${total})`} hint="Al configurar una partida, «Importar de la biblioteca» en el catálogo los copia a esa partida.">
        <div className="mb-3 grid gap-2 md:grid-cols-3">
          <input aria-label="Buscar productos" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} className={input} />
          <select aria-label="Filtrar productos por colección" value={collection} onChange={(e) => setCollection(e.target.value)} className={input}>
            <option value="">Todas las colecciones</option>
            {collections.map((c) => <option key={c.name} value={c.name}>{c.name || '(sin colección)'} · {c.count}</option>)}
          </select>
          <Button variant="danger" disabled={chosen.size === 0 || busy} onClick={() => void run(async () => { const r = await libraryApi.deleteItems([...chosen]); setChosen(new Set()); return `${r.deleted} productos borrados`; })}>Borrar seleccionados ({chosen.size})</Button>
        </div>
        {items.length === 0 ? <p className="text-sm text-white/70">Todavía no hay productos{q || collection ? ' con ese filtro' : ''}.</p> : (
          <ul className="space-y-2" data-testid="library-items">
            {items.map((it) => (
              <li key={it.id} data-testid="library-item" className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-night-900 p-2">
                <input type="checkbox" checked={chosen.has(it.id)} onChange={() => toggle(it.id)} aria-label={`Seleccionar ${it.name}`} className="size-4 accent-[#fbbf24]" />
                {it.photo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- alojada en el CDN del propietario
                  <img src={it.photo_url} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-12 rounded-lg object-cover" />
                ) : <span className="grid size-12 place-items-center rounded-lg bg-night-950 text-xl" aria-hidden>{it.emoji ?? '📦'}</span>}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold">{it.emoji ? `${it.emoji} ` : ''}{it.name}</span>
                  <span className="block truncate text-xs text-white/60">{it.collection || 'sin colección'}{it.description ? ` · ${it.description}` : ''}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
