'use client';

import { ArrowDown, ArrowUp, ImageOff, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TEMPLATE_LIMITS } from '@/lib/domain/template';
import type { LoadedCatalog } from './template-import';

type Item = LoadedCatalog[number];
const input = 'w-full rounded-lg border border-white/15 bg-night-950 px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-gold/50 2xl:text-xl';

/** Error del catálogo (o null): mismas reglas que el servidor (título 1–80, descripción ≤ 500, emoji ≤ 8, foto https ≤ 500, 1–100 elementos). */
export function validateCatalog(items: LoadedCatalog, opts: { allowLocal?: boolean } = {}): string | null {
  if (items.length < 1) return 'El catálogo necesita al menos un elemento.';
  if (items.length > TEMPLATE_LIMITS.items) return `El catálogo admite como máximo ${TEMPLATE_LIMITS.items} elementos.`;
  for (const [i, it] of items.entries()) {
    const n = i + 1;
    if (!it.name.trim()) return `Elemento ${n} del catálogo: falta el título.`;
    if (it.name.trim().length > 80) return `Elemento ${n} del catálogo: el título supera los 80 caracteres.`;
    if (it.description.length > 500) return `Elemento ${n} del catálogo: la descripción supera los 500 caracteres.`;
    if ((it.emoji ?? '').length > 8) return `Elemento ${n} del catálogo: el emoji es demasiado largo.`;
    if (it.photoUrl && !(opts.allowLocal && it.photoUrl.startsWith('blob:')) && (!/^https:\/\//i.test(it.photoUrl.trim()) || it.photoUrl.length > 500)) return `Elemento ${n} («${it.name.trim()}»): la foto no es válida: súbela o elígela de la biblioteca.`;
  }
  return null;
}

/** Editor del catálogo dentro del asistente: cambiar, añadir, borrar y reordenar elementos (título, descripción, emoji y foto por URL). */
/** Solo superadmin: `onUploadPhoto` sube la foto al repositorio de fotos y `onPickPhoto` la elige de la biblioteca (nunca se escribe una URL a mano). */
export function CatalogEditor({ items, onChange, onClose, onUploadPhoto, onPickPhoto }: { items: LoadedCatalog; onChange: (items: LoadedCatalog) => void; onClose: () => void; onUploadPhoto?: (index: number, file: File) => void; onPickPhoto?: (index: number) => void }) {
  const set = (i: number, patch: Partial<Item>) => onChange(items.map((it, k) => (k === i ? { ...it, ...patch } : it)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };
  const err = validateCatalog(items, { allowLocal: Boolean(onUploadPhoto) });
  return (
    <section className="space-y-3 rounded-2xl border border-gold/40 bg-night-900 p-4 md:col-span-2" aria-label="Editar el catálogo" data-testid="catalog-editor">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-xl 2xl:text-3xl">Catálogo ({items.length})</h3>
        <Button type="button" size="sm" variant="secondary" onClick={onClose} disabled={Boolean(err)}>Listo</Button>
      </div>
      <p className="text-sm text-white/65">Cada elemento se subasta en una ronda, en este orden. La foto se usa de referencia cuando alguien gana el elemento.</p>
      <ol className="space-y-3">
        {items.map((it, i) => (
          <li key={i} className="space-y-2 rounded-xl border border-white/10 bg-night-800/70 p-3" data-testid={`catalog-row-${i + 1}`}>
            <div className="flex items-center gap-2">
              <span className="w-6 shrink-0 text-center text-sm font-bold text-white/50">{i + 1}</span>
              <input aria-label={`Emoji del elemento ${i + 1}`} className={`${input} !w-16 text-center`} maxLength={8} value={it.emoji ?? ''} onChange={(e) => set(i, { emoji: e.target.value || null })} placeholder="📦" />
              <input aria-label={`Título del elemento ${i + 1}`} className={input} maxLength={80} value={it.name} onChange={(e) => set(i, { name: e.target.value })} placeholder="Título" />
              <Button type="button" size="sm" variant="ghost" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Subir el elemento ${i + 1}`}><ArrowUp className="size-4" aria-hidden /></Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => move(i, 1)} disabled={i === items.length - 1} aria-label={`Bajar el elemento ${i + 1}`}><ArrowDown className="size-4" aria-hidden /></Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => onChange(items.filter((_, k) => k !== i))} disabled={items.length <= 1} aria-label={`Quitar el elemento ${i + 1}`}><Trash2 className="size-4" aria-hidden /></Button>
            </div>
            <input aria-label={`Descripción del elemento ${i + 1}`} className={input} maxLength={500} value={it.description} onChange={(e) => set(i, { description: e.target.value })} placeholder="Descripción (opcional)" />
            {it.photoFile ? (
              <p className="flex items-center gap-2 text-sm text-teal">
                🖼️ Foto incluida en el ZIP ({it.photoFile.name.split('/').pop()})
                <Button type="button" size="sm" variant="ghost" onClick={() => set(i, { photoFile: null, photoPath: null })} aria-label={`Quitar la foto del elemento ${i + 1}`}><ImageOff className="size-4" aria-hidden /> Quitar</Button>
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                {it.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- alojada en el CDN del propietario
                  <img src={it.photoUrl} alt={`Foto del elemento ${i + 1}`} loading="lazy" referrerPolicy="no-referrer" className="size-12 rounded-lg object-cover" />
                ) : <span className="text-sm text-white/60">Sin foto</span>}
                {onUploadPhoto ? (
                  <label className="inline-flex min-h-11 shrink-0 cursor-pointer items-center rounded-xl border border-white/15 px-3 text-sm font-semibold hover:bg-white/10">
                    Subir foto
                    <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label={`Subir la foto del elemento ${i + 1}`} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onUploadPhoto(i, f); }} />
                  </label>
                ) : null}
                {onPickPhoto ? <Button type="button" size="sm" variant="secondary" onClick={() => onPickPhoto(i)} aria-label={`Elegir la foto del elemento ${i + 1} de la biblioteca`}>De la biblioteca</Button> : null}
                {it.photoUrl ? <Button type="button" size="sm" variant="ghost" onClick={() => set(i, { photoUrl: null })} aria-label={`Quitar la foto del elemento ${i + 1}`}><ImageOff className="size-4" aria-hidden /> Quitar</Button> : null}
              </div>
            )}
            {onUploadPhoto ? (
              <input aria-label={`Crédito de la foto del elemento ${i + 1}`} className={input} maxLength={120} value={it.credito ?? ''} onChange={(e) => set(i, { credito: e.target.value || null })} placeholder="Autoría de la foto (opcional)" />
            ) : null}
          </li>
        ))}
      </ol>
      {err ? <p role="alert" className="text-sm font-semibold text-rose" data-testid="catalog-error">{err}</p> : null}
      <Button type="button" variant="secondary" size="lg" onClick={() => onChange([...items, { name: '', description: '', emoji: null, photoUrl: null, photoPath: null, photoFile: null }])} disabled={items.length >= TEMPLATE_LIMITS.items}>
        <Plus className="size-5" aria-hidden /> Añadir elemento
      </Button>
    </section>
  );
}
