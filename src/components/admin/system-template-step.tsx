'use client';

import { useRef, useState } from 'react';
import { ImageOff } from 'lucide-react';
import { slugify, matchTarget, targetLabel, type AssetTarget } from '@/lib/domain/template-assets';
import { commitTemplateImagesRequest, stageTemplateImageRequest, uploadTemplateImageRequest, type StagedTemplateImage } from '@/lib/client/template-upload';
import { LibraryImagePicker } from './library-image-picker';

/** Datos propios de una plantilla del sistema (lo que el asistente de «Nueva partida» no tiene). */
export interface SystemMeta {
  slug: string;
  title: string;
  description: string;
  sortOrder: string;
  portada: string | null;
  creditos: string;
  /** El identificador deja de seguirse al título en cuanto se edita a mano. */
  slugTouched: boolean;
}

export const slugFromTitle = (title: string): string => slugify(title).slice(0, 60);

interface UploadRow { id: number; name: string; state: 'sending' | 'ok' | 'error' | 'unassigned'; message?: string; file?: File }
const field = 'w-full rounded-xl border border-white/15 bg-night-900 px-4 py-3 text-base focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-gold/50 2xl:px-5 2xl:py-4 2xl:text-xl';
const label = 'mb-1 block text-sm font-bold 2xl:text-lg';

/**
 * Paso «Ficha del sistema» del asistente en modo superadmin: título, identificador, tarjeta (descripción, orden, créditos),
 * portada, casa inicial y arrastrar y soltar de imágenes (se suben al repositorio de fotos, nunca a Supabase).
 * El asistente conserva el estado; este componente solo pinta y sube.
 */
export function SystemTemplateStep({
  meta, onMeta, initialImage, onInitialImage, itemTitles, onItemPhoto, uploadsEnabled,
}: {
  meta: SystemMeta;
  onMeta: (patch: Partial<SystemMeta>) => void;
  initialImage: string | null;
  onInitialImage: (url: string | null) => void;
  itemTitles: string[];
  onItemPhoto: (index: number, url: string) => void;
  uploadsEnabled: boolean;
}) {
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [over, setOver] = useState(false);
  const seq = useRef(0);
  const [pick, setPick] = useState<'cover' | 'scene' | null>(null);

  async function handleFiles(files: File[], forced?: AssetTarget) {
    if (!meta.slug) return setUploads((u) => [...u, { id: ++seq.current, name: files[0]?.name ?? 'imagen', state: 'error', message: 'Pon primero el identificador: las imágenes se guardan en su carpeta.' }]);
    const startId = seq.current + 1;
    seq.current += files.length;
    setUploads((u) => [...u, ...files.map((f, i): UploadRow => ({ id: startId + i, name: f.name, state: 'sending' }))]);
    const tpl = { catalogo: itemTitles.map((titulo) => ({ titulo, descripcion: '' })) };
    const apply = (target: AssetTarget, url: string) => {
      if (target.kind === 'cover') onMeta({ portada: url });
      else if (target.kind === 'scene') onInitialImage(url);
      else onItemPhoto(target.index, url);
    };
    // Varias imágenes a la vez = UN solo commit (se preparan una a una y se publican juntas); una sola imagen = su propio commit.
    const batch = files.length > 1 && !forced;
    const staged: { id: number; target: AssetTarget; st: StagedTemplateImage }[] = [];
    for (const [i, file] of files.entries()) {
      const id = startId + i;
      const set = (patch: Partial<UploadRow>) => setUploads((u) => u.map((r) => (r.id === id ? { ...r, ...patch } : r)));
      const target = forced ?? matchTarget(file.name, tpl);
      if (!target) { set({ state: 'unassigned', message: 'No encaja con la portada, la casa ni ningún elemento: asígnala abajo', file }); continue; }
      try {
        if (batch) {
          staged.push({ id, target, st: await stageTemplateImageRequest(meta.slug, target.kind, file) });
          set({ message: 'preparada para el commit…' });
        } else {
          const up = await uploadTemplateImageRequest(meta.slug, target.kind, file);
          apply(target, up.url);
          set({ state: 'ok', message: `${targetLabel(target, tpl)} · ${up.width}×${up.height} · ${Math.round(up.bytes / 1024)} KB` });
        }
      } catch (e) {
        set({ state: 'error', message: e instanceof Error ? e.message : 'No se pudo subir' });
      }
    }
    if (batch && staged.length > 0) {
      try {
        const r = await commitTemplateImagesRequest(staged.map((x) => x.st));
        const byPath = new Map(r.files.map((f) => [f.path, f]));
        for (const x of staged) {
          const f = byPath.get(x.st.path)!;
          apply(x.target, f.url);
          setUploads((u) => u.map((row) => (row.id === x.id ? { ...row, state: 'ok', message: `${targetLabel(x.target, tpl)} · ${x.st.width}×${x.st.height} · ${Math.round(x.st.bytes / 1024)} KB · commit ${r.commit.slice(0, 7)}` } : row)));
        }
      } catch (e) {
        for (const x of staged) setUploads((u) => u.map((row) => (row.id === x.id ? { ...row, state: 'error', message: `No se pudo publicar el lote: ${e instanceof Error ? e.message : 'error'}` } : row)));
      }
    }
  }

  const picker = (kind: 'cover' | 'scene', name: string) => (
    <label className={`inline-flex min-h-11 cursor-pointer items-center rounded-xl border border-white/15 px-3 text-sm font-semibold ${uploadsEnabled ? 'hover:bg-white/10' : 'cursor-not-allowed opacity-50'}`}>
      Subir imagen
      <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label={name} disabled={!uploadsEnabled} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void handleFiles([f], { kind }); }} />
    </label>
  );

  return (
    <div className="space-y-4" data-testid="system-step">
      <section className="space-y-4 rounded-3xl border border-white/10 bg-night-800/70 p-4 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label htmlFor="sys-title" className={label}>Título de la tarjeta</label>
            <input id="sys-title" required maxLength={80} value={meta.title} onChange={(e) => onMeta({ title: e.target.value, ...(meta.slugTouched ? {} : { slug: slugFromTitle(e.target.value) }) })} className={field} />
          </div>
          <div>
            <label htmlFor="sys-order" className={label}>Orden</label>
            <input id="sys-order" inputMode="numeric" value={meta.sortOrder} onChange={(e) => onMeta({ sortOrder: e.target.value.replace(/\D/g, '') })} className={field} />
          </div>
        </div>
        <div>
          <label htmlFor="sys-slug" className={label}>Identificador (carpeta de las fotos)</label>
          <input id="sys-slug" required maxLength={60} value={meta.slug} onChange={(e) => onMeta({ slug: e.target.value.toLowerCase(), slugTouched: true })} placeholder="noche-de-playa" className={`${field} font-mono`} />
        </div>
        <div>
          <label htmlFor="sys-desc" className={label}>Descripción (hasta 300 caracteres)</label>
          <input id="sys-desc" maxLength={300} value={meta.description} onChange={(e) => onMeta({ description: e.target.value })} className={field} />
        </div>
        <div>
          <label htmlFor="sys-credits" className={label}>Créditos de las imágenes (opcional)</label>
          <input id="sys-credits" maxLength={200} value={meta.creditos} onChange={(e) => onMeta({ creditos: e.target.value })} placeholder="Dibujos propios y Wikimedia Commons" className={field} />
        </div>
      </section>

      <section className="space-y-4 rounded-3xl border border-white/10 bg-night-800/70 p-4 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          {([
            ['Portada de la tarjeta', meta.portada, (u: string | null) => onMeta({ portada: u }), 'cover'],
            ['Casa inicial (la reciben los jugadores)', initialImage, onInitialImage, 'scene'],
          ] as const).map(([title, url, set, kind]) => (
            <div key={kind} className="space-y-2 rounded-2xl border border-white/10 bg-night-900 p-3" data-testid={`system-${kind}`}>
              <h3 className="text-sm font-bold uppercase tracking-wide text-white/60">{title}</h3>
              {url ? (
                // eslint-disable-next-line @next/next/no-img-element -- alojada en el CDN del propietario
                <img src={url} alt="" referrerPolicy="no-referrer" className="aspect-[1200/630] w-full rounded-xl object-cover" />
              ) : <div className="grid aspect-[1200/630] w-full place-items-center rounded-xl bg-night-950 text-sm text-white/50">Sin imagen</div>}
              <div className="flex flex-wrap gap-2">
                {picker(kind, `Subir ${kind === 'cover' ? 'portada' : 'casa inicial'}`)}
                <button type="button" onClick={() => setPick(kind)} aria-label={`Elegir ${kind === 'cover' ? 'portada' : 'casa inicial'} de la biblioteca`} className="inline-flex min-h-11 items-center rounded-xl border border-white/15 px-3 text-sm font-semibold hover:bg-white/10">De la biblioteca</button>
                {url ? <button type="button" onClick={() => set(null)} className="inline-flex min-h-11 items-center gap-1 rounded-xl px-3 text-sm text-white/70 hover:bg-white/10"><ImageOff className="size-4" aria-hidden /> Quitar</button> : null}
              </div>
            </div>
          ))}
        </div>

        <div
          data-testid="template-dropzone"
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); if (uploadsEnabled) void handleFiles(Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'))); }}
          className={`rounded-2xl border-2 border-dashed p-4 text-center text-sm ${over ? 'border-gold bg-gold/10' : 'border-white/20 bg-night-900'}`}
        >
          {uploadsEnabled ? (
            <>
              <p className="font-bold">Arrastra aquí varias imágenes (o <label className="cursor-pointer underline">elígelas<input type="file" multiple accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label="Elegir imágenes" onChange={(e) => { void handleFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} /></label>)</p>
              <p className="mt-1 text-xs text-white/60">Se reducen al formato interno y se suben a tu repositorio de fotos (no a Supabase). Se asignan por el nombre del archivo: <code>portada.jpg</code>, <code>casa.jpg</code> o el título del elemento (<code>sombrilla-roja.jpg</code>). Sube solo imágenes que puedas usar y anota su origen en FUENTES.md del repositorio de fotos.</p>
            </>
          ) : (
            <p className="text-white/70" data-testid="uploads-disabled">La subida de imágenes no está configurada: define <code>GITHUB_ASSETS_REPO</code> y <code>GITHUB_ASSETS_TOKEN</code> en Vercel (ver docs/PLANTILLAS-SISTEMA.md). Mientras tanto puedes pegar enlaces https.</p>
          )}
        </div>

        {uploads.length > 0 ? (
          <ul className="space-y-1" aria-label="Imágenes subidas" data-testid="upload-list">
            {uploads.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-night-900 px-3 py-1.5 text-sm">
                <span className={u.state === 'ok' ? 'text-teal' : u.state === 'error' ? 'text-rose' : 'text-gold-soft'} aria-hidden>{u.state === 'ok' ? '✔' : u.state === 'error' ? '✖' : u.state === 'sending' ? '…' : '?'}</span>
                <span className="font-semibold">{u.name}</span>
                <span className="text-xs text-white/65">{u.state === 'sending' ? 'subiendo…' : u.message}</span>
                {u.state === 'unassigned' && u.file ? (
                  <select aria-label={`Asignar ${u.name}`} defaultValue="" className="rounded-lg bg-night-950 px-2 py-1 text-xs" onChange={(e) => {
                    const v = e.target.value;
                    if (!v) return;
                    const file = u.file!;
                    setUploads((all) => all.filter((x) => x.id !== u.id));
                    void handleFiles([file], v === 'cover' ? { kind: 'cover' } : v === 'scene' ? { kind: 'scene' } : { kind: 'item', index: Number(v.slice(5)) });
                  }}>
                    <option value="">Asignar a…</option>
                    <option value="cover">Portada</option>
                    <option value="scene">Casa inicial</option>
                    {itemTitles.map((t, idx) => <option key={idx} value={`item-${idx}`}>Elemento · {t}</option>)}
                  </select>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </section>
      <LibraryImagePicker
        open={pick !== null}
        title={pick === 'cover' ? 'Elegir la portada' : 'Elegir la casa inicial'}
        onClose={() => setPick(null)}
        onPick={(image) => { if (pick === 'cover') onMeta({ portada: image.url }); else onInitialImage(image.url); setPick(null); }}
      />
    </div>
  );
}
