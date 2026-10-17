'use client';

import { useRef, useState } from 'react';
import { FolderUp, ImagePlus, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/client/api';
import { uploadLibraryImageRequest, type UploadMeta } from '@/lib/client/library-api';

interface Row { id: number; file: File; state: 'wait' | 'sending' | 'ok' | 'dup' | 'error'; message?: string }

const input = 'w-full rounded-xl border border-white/15 bg-night-900 px-3 py-2';
const IMAGE = /\.(jpe?g|png|webp)$/i;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Subida masiva: se sueltan (o eligen) decenas o cientos de imágenes —también carpetas enteras— y se envían de UNA en una
 * (GitHub no admite commits simultáneos en la misma rama). Si GitHub limita el ritmo se espera y se reintenta; las fotos ya
 * registradas se detectan por su contenido y no se vuelven a subir. Se puede parar en cualquier momento.
 */
export function LibraryUpload({ enabled, collections, onDone }: { enabled: boolean; collections: string[]; onDone: () => void }) {
  const [meta, setMeta] = useState<UploadMeta>({ collection: '', tags: '', credit: '', kind: 'item' });
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const [over, setOver] = useState(false);
  const stop = useRef(false);
  const seq = useRef(0);

  const patch = (id: number, p: Partial<Row>) => setRows((all) => all.map((r) => (r.id === id ? { ...r, ...p } : r)));

  async function run(batch: Row[]) {
    stop.current = false;
    setRunning(true);
    for (const row of batch) {
      if (stop.current) break;
      patch(row.id, { state: 'sending', message: undefined });
      for (let attempt = 0; ; attempt++) {
        try {
          const r = await uploadLibraryImageRequest(row.file, meta);
          patch(row.id, r.existed ? { state: 'dup', message: 'Ya estaba en la biblioteca' } : { state: 'ok', message: `${r.image.width}×${r.image.height} · ${Math.round((r.image.bytes ?? 0) / 1024)} KB` });
          break;
        } catch (e) {
          const limited = e instanceof ApiError && (e.status === 429 || e.code === 'rate_limited');
          if (limited && attempt < 3 && !stop.current) {
            patch(row.id, { message: `GitHub pide ir más despacio: reintento en 20 s (${attempt + 1}/3)…` });
            await sleep(20_000);
            continue;
          }
          patch(row.id, { state: 'error', message: e instanceof Error ? e.message : 'No se pudo subir' });
          break;
        }
      }
    }
    setRunning(false);
    onDone();
  }

  function add(files: File[]) {
    const valid = files.filter((f) => IMAGE.test(f.name) || /^image\/(jpeg|png|webp)$/.test(f.type));
    const skipped = files.length - valid.length;
    const batch: Row[] = valid.map((file) => ({ id: ++seq.current, file, state: 'wait' }));
    if (skipped > 0) batch.push({ id: ++seq.current, file: new File([], `${skipped} archivo(s) que no son JPG, PNG ni WebP`), state: 'error', message: 'Ignorados' });
    setRows((all) => [...all, ...batch]);
    if (!running) void run(batch.filter((b) => b.state === 'wait'));
  }

  const done = rows.filter((r) => r.state === 'ok' || r.state === 'dup' || r.state === 'error').length;
  const count = (s: Row['state']) => rows.filter((r) => r.state === s).length;
  const pending = rows.filter((r) => r.state === 'wait' || r.state === 'sending').length;

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
        onDrop={(e) => { e.preventDefault(); setOver(false); if (enabled) add(Array.from(e.dataTransfer.files)); }}
        className={`rounded-2xl border-2 border-dashed p-5 text-center text-sm ${over ? 'border-gold bg-gold/10' : 'border-white/20 bg-night-900'}`}
      >
        {enabled ? (
          <div className="space-y-3">
            <p className="font-bold">Arrastra aquí tus imágenes (50, 100, 200…) o elígelas</p>
            <div className="flex flex-wrap justify-center gap-2">
              <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-white/10 px-4 py-2 font-bold hover:bg-white/15">
                <ImagePlus className="size-5" aria-hidden /> Elegir imágenes
                <input type="file" multiple accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label="Elegir imágenes para la biblioteca" onChange={(e) => { add(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
              </label>
              <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-white/10 px-4 py-2 font-bold hover:bg-white/15">
                <FolderUp className="size-5" aria-hidden /> Elegir una carpeta
                <input type="file" multiple className="sr-only" aria-label="Elegir una carpeta de imágenes" {...({ webkitdirectory: '', directory: '' } as Record<string, string>)} onChange={(e) => { add(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
              </label>
            </div>
            <p className="text-xs text-white/60">Se reducen al formato interno (WebP ligero) y se suben una a una a tu repositorio público de fotos (no a Supabase). El título sale del nombre del archivo. Sube solo imágenes que puedas usar; anota su origen en el crédito.</p>
          </div>
        ) : (
          <p className="text-white/70" data-testid="uploads-disabled">La subida no está configurada: define <code>GITHUB_ASSETS_REPO</code> y <code>GITHUB_ASSETS_TOKEN</code> en Vercel (ver docs/BIBLIOTECA.md).</p>
        )}
      </div>

      {rows.length > 0 ? (
        <div className="space-y-2" data-testid="library-queue">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <progress value={done} max={rows.length} className="h-2 min-w-40 flex-1 accent-[#fbbf24]" aria-label="Progreso de la subida" />
            <span data-testid="library-progress" className="font-semibold">{done}/{rows.length} · {count('ok')} nuevas · {count('dup')} repetidas · {count('error')} con error</span>
            {running ? <Button size="sm" variant="secondary" onClick={() => { stop.current = true; }}><Square className="size-4" aria-hidden /> Parar</Button> : null}
            {!running && pending > 0 ? <Button size="sm" variant="primary" onClick={() => void run(rows.filter((r) => r.state === 'wait'))}>Continuar</Button> : null}
            {!running ? <Button size="sm" variant="ghost" onClick={() => setRows((all) => all.filter((r) => r.state === 'wait' || r.state === 'error'))}>Limpiar lo hecho</Button> : null}
          </div>
          <ul className="max-h-64 space-y-1 overflow-y-auto" aria-label="Cola de subida">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-night-900 px-3 py-1.5 text-sm">
                <span className={r.state === 'ok' ? 'text-teal' : r.state === 'error' ? 'text-rose' : r.state === 'dup' ? 'text-gold-soft' : 'text-white/60'} aria-hidden>{r.state === 'ok' ? '✔' : r.state === 'dup' ? '＝' : r.state === 'error' ? '✖' : '…'}</span>
                <span className="font-semibold">{r.file.name}</span>
                <span className="text-xs text-white/65">{r.state === 'wait' ? 'en cola' : r.state === 'sending' ? (r.message ?? 'subiendo…') : r.message}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
