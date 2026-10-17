'use client';

import { useEffect, useRef, useState } from 'react';
import { FolderUp, ImagePlus, Square, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/client/api';
import { creditOf, parseManifestCsv, type ManifestRow } from '@/lib/library/commons';
import { commitLibraryRequest, stageLibraryImageRequest, type StagedImage, type UploadMeta } from '@/lib/client/library-api';

interface Row { id: number; file: File; url: string; /** Datos propios de esta foto (vienen del manifest.csv de una carpeta preparada con npm run library:fetch). */ over?: Partial<UploadMeta>; state: 'wait' | 'sending' | 'ready' | 'ok' | 'dup' | 'error'; message?: string; staged?: StagedImage }

const input = 'w-full rounded-xl border border-white/15 bg-night-900 px-3 py-2';
const IMAGE = /\.(jpe?g|png|webp)$/i;
const COMMIT_CHUNK = 500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Las imágenes elegidas NO se suben al momento: quedan en una cuadrícula de miniaturas para revisarlas y quitar las que sobren (✕);
 * la subida empieza al pulsar «Subir». Subida masiva en dos fases: (1) cada foto se envía de UNA en una y se deja preparada en GitHub (sin commit; las ya registradas
 * se detectan por su contenido y se saltan); (2) al terminar, TODAS las preparadas se publican en UN SOLO commit. Si GitHub limita
 * el ritmo se espera y se reintenta. Se puede parar; lo ya preparado se publica con «Publicar preparadas». Si falla la publicación,
 * no se registra nada y se reintenta con la misma lista.
 */
export function LibraryUpload({ enabled, collections, onDone }: { enabled: boolean; collections: string[]; onDone: () => void }) {
  const [meta, setMeta] = useState<UploadMeta>({ collection: '', tags: '', credit: '', kind: 'item' });
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [ignored, setIgnored] = useState(0);
  const stop = useRef(false);
  const seq = useRef(0);
  const rowsRef = useRef<Row[]>([]);

  useEffect(() => () => { for (const r of rowsRef.current) URL.revokeObjectURL(r.url); }, []);

  /** La referencia se actualiza al instante (no dentro del actualizador de React, que puede ejecutarse más tarde): `publish` la lee justo después del último `patch`. */
  const update = (fn: (all: Row[]) => Row[]) => { rowsRef.current = fn(rowsRef.current); setRows(rowsRef.current); };
  const patch = (id: number, p: Partial<Row>) => update((all) => all.map((r) => (r.id === id ? { ...r, ...p } : r)));

  async function stageAll(batch: Row[]) {
    stop.current = false;
    setRunning(true);
    for (const row of batch) {
      if (stop.current) break;
      patch(row.id, { state: 'sending', message: undefined });
      for (let attempt = 0; ; attempt++) {
        try {
          const r = await stageLibraryImageRequest(row.file, { ...meta, ...row.over });
          if (r.existed) patch(row.id, { state: 'dup', message: 'Ya estaba en la biblioteca' });
          else if (rowsRef.current.some((o) => o.id !== row.id && o.staged?.hash === r.staged.hash)) patch(row.id, { state: 'dup', message: 'Repetida en este lote (mismo contenido)' });
          else patch(row.id, { state: 'ready', staged: r.staged, message: `${r.staged.width}×${r.staged.height} · ${Math.round(r.staged.bytes / 1024)} KB · preparada` });
          break;
        } catch (e) {
          const limited = e instanceof ApiError && (e.status === 429 || e.code === 'rate_limited');
          if (limited && attempt < 3 && !stop.current) {
            patch(row.id, { message: `GitHub pide ir más despacio: reintento en 20 s (${attempt + 1}/3)…` });
            await sleep(20_000);
            continue;
          }
          patch(row.id, { state: 'error', message: e instanceof Error ? e.message : 'No se pudo preparar' });
          break;
        }
      }
    }
    setRunning(false);
    if (!stop.current) await publish();
    else onDone();
  }

  /** Publica TODAS las preparadas en un único commit (en trozos de 500 solo si hay más). */
  async function publish() {
    const ready = rowsRef.current.filter((r) => r.state === 'ready' && r.staged);
    if (ready.length === 0) { onDone(); return; }
    setPublishing(true);
    setCommitError(null);
    try {
      for (let i = 0; i < ready.length; i += COMMIT_CHUNK) {
        const chunk = ready.slice(i, i + COMMIT_CHUNK);
        const r = await commitLibraryRequest(chunk.map((c) => c.staged!));
        for (const c of chunk) patch(c.id, { state: 'ok', staged: undefined, message: `Publicada en el commit ${r.commit.slice(0, 7)}` });
      }
    } catch (e) {
      setCommitError(e instanceof Error ? e.message : 'No se pudo publicar el lote');
    } finally {
      setPublishing(false);
      onDone();
    }
  }

  async function add(files: File[]) {
    // Una carpeta preparada con `npm run library:fetch` trae un manifest.csv: colección, título, tipo y crédito de cada foto.
    const manifestFile = files.find((f) => f.name.toLowerCase() === 'manifest.csv');
    const manifest = manifestFile ? parseManifestCsv(await manifestFile.text()) : [];
    const byPath = new Map<string, ManifestRow>(manifest.map((m) => [`${m.coleccion}/${m.archivo}`, m]));
    const byName = new Map<string, ManifestRow>(manifest.map((m) => [m.archivo, m]));
    const SIDE = /\.(csv|json|txt|html|md)$/i; // archivos de apoyo de la carpeta: no son imágenes ni se cuentan como ignorados
    const candidates = files.filter((f) => !SIDE.test(f.name) && !f.name.startsWith('.'));
    const valid = candidates.filter((f) => IMAGE.test(f.name) || /^image\/(jpeg|png|webp)$/.test(f.type));
    setIgnored((n) => n + candidates.length - valid.length);
    const batch: Row[] = valid.map((file) => {
      const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? '';
      const parts = rel.split('/');
      const m = byPath.get(parts.slice(-2).join('/')) ?? byName.get(file.name);
      const over: Partial<UploadMeta> | undefined = m ? { collection: m.coleccion, title: m.titulo, credit: creditOf(m), kind: m.tipo, tags: meta.tags } : undefined;
      return { id: ++seq.current, file, url: URL.createObjectURL(file), state: 'wait', over };
    });
    update((all) => [...all, ...batch]);
  }

  /** Quita una imagen de la lista (solo si aún no se ha publicado). */
  function remove(id: number) {
    const r = rowsRef.current.find((x) => x.id === id);
    if (r) URL.revokeObjectURL(r.url);
    update((all) => all.filter((x) => x.id !== id));
  }

  function clearDone() {
    for (const r of rowsRef.current) if (r.state === 'ok' || r.state === 'dup') URL.revokeObjectURL(r.url);
    update((all) => all.filter((r) => r.state === 'wait' || r.state === 'ready' || r.state === 'error'));
  }

  const finished = rows.filter((r) => r.state === 'ready' || r.state === 'ok' || r.state === 'dup' || r.state === 'error').length;
  const count = (s: Row['state']) => rows.filter((r) => r.state === s).length;
  const pending = rows.filter((r) => r.state === 'wait').length;
  const ready = count('ready');
  const busy = running || publishing;

  return (
    <div className="space-y-3" data-testid="library-upload">
      <div className="grid gap-3 md:grid-cols-4">
        <label className="text-sm font-semibold">Colección
          <input list="library-collections" aria-label="Colección de la subida" maxLength={60} value={meta.collection} onChange={(e) => setMeta({ ...meta, collection: e.target.value })} placeholder="Halloween, Chocolates, Paisajes…" className={`${input} mt-1`} />
          <datalist id="library-collections">{collections.map((c) => <option key={c} value={c} />)}</datalist>
        </label>
        <label className="text-sm font-semibold">Etiquetas (separadas por comas)
          <input aria-label="Etiquetas de la subida" value={meta.tags} onChange={(e) => setMeta({ ...meta, tags: e.target.value })} placeholder="terror, otoño" className={`${input} mt-1`} />
        </label>
        <label className="text-sm font-semibold">Crédito (opcional)
          <input aria-label="Crédito de la subida" maxLength={200} value={meta.credit} onChange={(e) => setMeta({ ...meta, credit: e.target.value })} placeholder="Autoría o fuente" className={`${input} mt-1`} />
        </label>
        <label className="text-sm font-semibold">Tipo de imagen
          <select aria-label="Tipo de imagen" value={meta.kind} onChange={(e) => setMeta({ ...meta, kind: e.target.value as UploadMeta['kind'] })} className={`${input} mt-1`}>
            <option value="item">Objeto o producto (768 px, ligera)</option>
            <option value="scene">Escena o paisaje (1536×1024)</option>
          </select>
        </label>
      </div>

      <div
        data-testid="library-dropzone"
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (enabled) void add(Array.from(e.dataTransfer.files)); }}
        className={`rounded-2xl border-2 border-dashed p-5 text-center text-sm ${over ? 'border-gold bg-gold/10' : 'border-white/20 bg-night-900'}`}
      >
        {enabled ? (
          <div className="space-y-3">
            <p className="font-bold">Arrastra aquí tus imágenes (50, 100, 200…) o elígelas</p>
            <p className="text-xs text-white/60">¿Preparaste una carpeta con <code>npm run library:fetch</code>? Elígela con «Elegir una carpeta»: lee su <code>manifest.csv</code> y cada foto entra con su colección, título y crédito.</p>
            <div className="flex flex-wrap justify-center gap-2">
              <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-white/10 px-4 py-2 font-bold hover:bg-white/15">
                <ImagePlus className="size-5" aria-hidden /> Elegir imágenes
                <input type="file" multiple accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label="Elegir imágenes para la biblioteca" onChange={(e) => { void add(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
              </label>
              <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-white/10 px-4 py-2 font-bold hover:bg-white/15">
                <FolderUp className="size-5" aria-hidden /> Elegir una carpeta
                <input type="file" multiple className="sr-only" aria-label="Elegir una carpeta de imágenes" {...({ webkitdirectory: '', directory: '' } as Record<string, string>)} onChange={(e) => { void add(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
              </label>
            </div>
            <p className="text-xs text-white/60">Se reducen al formato interno (WebP ligero), se preparan una a una y <b>todo el lote se publica en un único commit</b> en tu repositorio público de fotos (no en Supabase). El título sale del nombre del archivo. Sube solo imágenes que puedas usar; anota su origen en el crédito.</p>
          </div>
        ) : (
          <p className="text-white/70" data-testid="uploads-disabled">La subida no está configurada: define <code>GITHUB_ASSETS_REPO</code> y <code>GITHUB_ASSETS_TOKEN</code> en Vercel (ver docs/BIBLIOTECA.md).</p>
        )}
      </div>

      {rows.length > 0 || ignored > 0 ? (
        <div className="space-y-2" data-testid="library-queue">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <progress value={finished} max={rows.length} className="h-2 min-w-40 flex-1 accent-[#fbbf24]" aria-label="Progreso de la subida" />
            <span data-testid="library-progress" className="font-semibold">{finished}/{rows.length} · {count('ok') + ready} nuevas · {count('dup')} repetidas · {count('error')} con error</span>
            {running ? <Button size="sm" variant="secondary" onClick={() => { stop.current = true; }}><Square className="size-4" aria-hidden /> Parar</Button> : null}
            {!busy && pending > 0 ? <Button size="sm" variant="primary" onClick={() => void stageAll(rowsRef.current.filter((r) => r.state === 'wait'))} data-testid="library-start">{finished > 0 ? `Continuar (${pending})` : `Subir ${pending} imágenes`}</Button> : null}
            {!busy && pending > 0 ? <Button size="sm" variant="ghost" onClick={() => { for (const r of rowsRef.current) if (r.state === 'wait') URL.revokeObjectURL(r.url); update((all) => all.filter((r) => r.state !== 'wait')); }}>Quitar las pendientes</Button> : null}
            {!busy && ready > 0 ? <Button size="sm" variant="primary" onClick={() => void publish()} data-testid="library-publish">Publicar {ready} preparadas en un commit</Button> : null}
            {!busy ? <Button size="sm" variant="ghost" onClick={clearDone}>Limpiar lo hecho</Button> : null}
          </div>
          {publishing ? <p role="status" data-testid="library-publishing" className="rounded-xl bg-gold/10 px-3 py-2 text-sm font-semibold text-gold-soft">Publicando {ready} imágenes en un único commit…</p> : null}
          {commitError ? <p role="alert" className="rounded-xl bg-rose/15 px-3 py-2 text-sm text-rose">No se pudo publicar el lote (no se ha registrado nada): {commitError}. Pulsa «Publicar» para reintentarlo.</p> : null}
          <ul className="grid max-h-[28rem] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8" aria-label="Imágenes elegidas" data-testid="library-queue-grid">
            {rows.map((r) => {
              const removable = r.state === 'wait' || r.state === 'ready' || r.state === 'error';
              const tone = r.state === 'ok' ? 'text-teal' : r.state === 'error' ? 'text-rose' : r.state === 'dup' || r.state === 'ready' ? 'text-gold-soft' : 'text-white/70';
              return (
                <li key={r.id} data-testid="library-queue-item" data-state={r.state} title={`${r.file.name}${r.message ? ` · ${r.message}` : ''}`} className={`relative overflow-hidden rounded-xl border bg-night-900 ${r.state === 'error' ? 'border-rose/60' : 'border-white/10'}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- vista previa local (blob:) */}
                  <img src={r.url} alt="" loading="lazy" decoding="async" className={`aspect-square w-full object-cover ${r.state === 'dup' ? 'opacity-50' : ''}`} />
                  {removable && !publishing && !(running && r.state !== 'wait') ? (
                    <button type="button" onClick={() => remove(r.id)} aria-label={`Quitar ${r.file.name}`} className="absolute right-1 top-1 grid size-7 place-items-center rounded-full bg-night-950/85 text-white hover:bg-rose focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/70"><X className="size-4" aria-hidden /></button>
                  ) : null}
                  <span className={`absolute left-1 top-1 grid size-6 place-items-center rounded-full bg-night-950/85 text-xs font-bold ${tone}`} aria-hidden>{r.state === 'ok' ? '✔' : r.state === 'dup' ? '＝' : r.state === 'ready' ? '◔' : r.state === 'error' ? '✖' : r.state === 'sending' ? '…' : ''}</span>
                  <span className="block truncate px-1.5 pt-1 text-[11px] font-semibold">{r.file.name}</span>
                  <span className={`block truncate px-1.5 pb-1 text-[10px] ${r.state === 'error' ? 'text-rose' : 'text-white/60'}`}>{r.state === 'wait' ? 'pendiente' : r.state === 'sending' ? (r.message ?? 'preparando…') : r.message}</span>
                </li>
              );
            })}
          </ul>
          {ignored > 0 ? <p className="text-xs text-white/60" data-testid="library-ignored">{ignored} archivo(s) ignorados: solo se admiten JPG, PNG y WebP.</p> : null}
        </div>
      ) : null}
    </div>
  );
}
