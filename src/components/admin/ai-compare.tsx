'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { LibraryImagePicker } from './library-image-picker';
import { Section } from './widgets';
import { compareModelsRequest, type CompareMetaInput, type CompareResult } from '@/lib/client/ai-compare-api';
import { shrinkForUpload } from '@/lib/client/image-shrink';
import type { LibraryImage } from '@/lib/client/library-api';

const field = 'w-full rounded-xl border border-white/15 bg-night-900 px-3 py-2 text-base';

/** Una imagen elegida: archivo subido o imagen de la biblioteca (por id; nunca una URL escrita). */
interface Pick { file: File | null; libraryId: string | null; preview: string; label: string }

function ImageSlot({ title, value, onChange, testid }: { title: string; value: Pick | null; onChange: (p: Pick | null) => void; testid: string }) {
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => () => { if (value?.file) URL.revokeObjectURL(value.preview); }, [value]);
  return (
    <div className="space-y-2 rounded-2xl bg-night-900 p-3">
      <p className="text-sm font-bold">{title}</p>
      {value ? (
        // eslint-disable-next-line @next/next/no-img-element -- vista previa local o del CDN de la biblioteca
        <img src={value.preview} alt={value.label} referrerPolicy="no-referrer" className="aspect-[3/2] w-full rounded-xl object-cover" />
      ) : <div className="grid aspect-[3/2] w-full place-items-center rounded-xl border border-dashed border-white/20 text-xs text-white/55">Sin imagen</div>}
      {value ? <p className="truncate text-xs text-white/65">{value.label}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => input.current?.click()}>Subir archivo</Button>
        <Button size="sm" onClick={() => setOpen(true)}>De la biblioteca</Button>
        {value ? <Button size="sm" variant="ghost" onClick={() => onChange(null)}>Quitar</Button> : null}
      </div>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label={`${title}: archivo`} data-testid={testid}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onChange({ file: f, libraryId: null, preview: URL.createObjectURL(f), label: f.name });
        }} />
      <LibraryImagePicker open={open} title={title} onClose={() => setOpen(false)} onPick={(i: LibraryImage) => { onChange({ file: null, libraryId: i.id, preview: i.url, label: i.title || 'Biblioteca' }); setOpen(false); }} />
    </div>
  );
}

export function AiCompare({ providers, aiEnabled, max }: { providers: { id: string; off: boolean }[]; aiEnabled: boolean; max: number }) {
  const [base, setBase] = useState<Pick | null>(null);
  const [items, setItems] = useState<(Pick | null)[]>([null]);
  const [names, setNames] = useState<string[]>(['']);
  const [theme, setTheme] = useState('');
  const [chosen, setChosen] = useState<string[]>(() => providers.filter((p) => !p.off).slice(0, max).map((p) => p.id));
  const [results, setResults] = useState<CompareResult[]>([]);
  const [running, setRunning] = useState<string[]>([]);
  const [error, setError] = useState('');

  const ready = base && items.every(Boolean) && names.every((n) => n.trim()) && chosen.length > 0;

  async function run(ids: string[]) {
    setError('');
    setRunning((r) => [...r, ...ids]);
    try {
      const shrink = async (p: Pick | null) => (p?.file ? await shrinkForUpload(p.file) : null);
      const res = await compareModelsRequest(
        { providers: ids as CompareMetaInput['providers'], theme, items: names.map((name) => ({ name, description: '' })), baseLibraryId: base?.libraryId ?? null, itemLibraryIds: items.map((i) => i?.libraryId ?? null) },
        { base: await shrink(base), items: await Promise.all(items.map(shrink)) },
      );
      // Reemplaza solo los proveedores relanzados y conserva el orden en pantalla.
      setResults((prev) => {
        const byId = new Map(prev.map((r) => [r.provider, r]));
        for (const r of res.results) byId.set(r.provider, r);
        const order = [...new Set([...prev.map((r) => r.provider), ...res.results.map((r) => r.provider)])];
        return order.map((id) => byId.get(id)!);
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo comparar.');
    } finally {
      setRunning((r) => r.filter((id) => !ids.includes(id)));
    }
  }

  if (providers.length === 0) {
    return (
      <Section title="Comparar modelos">
        <p role="status" data-testid="compare-no-providers" className="rounded-2xl bg-night-900 p-4 text-sm text-white/80">
          {aiEnabled
            ? 'No hay ningún proveedor de IA real configurado (IMAGE_PROVIDERS y sus credenciales). El comparador no simula resultados y el modo pegatinas (sin IA) no es comparable: configura al menos un proveedor gratuito para usarlo.'
            : 'La IA está apagada en los ajustes del superadmin, así que no hay nada que comparar.'}
        </p>
      </Section>
    );
  }

  return (
    <div className="space-y-5">
      <Section title="Comparar modelos" hint={`Ejecuta la misma edición que una compra real (mismo prompt, tamaños y guardia de zona) con hasta ${max} proveedores a la vez. Cada llamada cuenta en la cuota diaria global. Los resultados no se guardan en ningún sitio.`}>
        <div className="grid gap-3 md:grid-cols-3">
          <ImageSlot title="Imagen base" value={base} onChange={setBase} testid="compare-base-file" />
          {items.map((it, i) => (
            <div key={i} className="space-y-2">
              <ImageSlot title={`Elemento ${i + 1}`} value={it} onChange={(p) => setItems((l) => l.map((x, j) => (j === i ? p : x)))} testid={`compare-item-file-${i}`} />
              <input aria-label={`Nombre del elemento ${i + 1}`} placeholder="Nombre del elemento" maxLength={80} value={names[i] ?? ''} onChange={(e) => setNames((l) => l.map((x, j) => (j === i ? e.target.value : x)))} className={field} />
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {items.length < 2 ? <Button size="sm" onClick={() => { setItems((l) => [...l, null]); setNames((l) => [...l, '']); }}>+ Añadir segundo elemento (en orden)</Button> : <Button size="sm" variant="ghost" onClick={() => { setItems((l) => l.slice(0, 1)); setNames((l) => l.slice(0, 1)); }}>Quitar segundo elemento</Button>}
          <input aria-label="Tema (opcional)" placeholder="Tema (opcional)" maxLength={60} value={theme} onChange={(e) => setTheme(e.target.value)} className={`${field} sm:max-w-xs`} />
        </div>
        <fieldset className="mt-4">
          <legend className="text-sm font-bold">Proveedores a comparar (máximo {max})</legend>
          <div className="mt-1 flex flex-wrap gap-3">
            {providers.map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={chosen.includes(p.id)} disabled={!chosen.includes(p.id) && chosen.length >= max}
                  onChange={(e) => setChosen((c) => (e.target.checked ? [...c, p.id] : c.filter((x) => x !== p.id)))} />
                <span className="font-mono">{p.id}</span>
                {p.off ? <span className="rounded bg-rose/20 px-1.5 text-xs text-rose">apagado en Ajustes</span> : null}
              </label>
            ))}
          </div>
        </fieldset>
        {error ? <p role="alert" className="mt-3 rounded-xl bg-rose/15 px-3 py-2 text-sm text-rose">{error}</p> : null}
        <div className="mt-4">
          <Button variant="primary" disabled={!ready} loading={running.length > 0} onClick={() => { setResults([]); void run(chosen); }}>Comparar</Button>
          <span className="ml-3 text-xs text-white/55">{chosen.length * items.length} llamada(s) reales en total.</span>
        </div>
      </Section>

      {results.length > 0 ? (
        <Section title="Resultados" hint="Cada proveedor es independiente: si uno falla, se explica por qué y los demás siguen. La semilla se elige sola en cada llamada (va en las notas).">
          <ul className="grid gap-3 md:grid-cols-2" data-testid="compare-results">
            {results.map((r) => (
              <li key={r.provider} className="space-y-2 rounded-2xl bg-night-900 p-3" data-testid="compare-result">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-mono font-bold">{r.provider}</p>
                  <p className="text-xs tabular-nums text-white/60">{(r.ms / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 })} s</p>
                </div>
                {r.ok && r.dataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- data URL generada en el servidor, no se guarda
                  <img src={r.dataUrl} alt={`Resultado de ${r.provider}`} className="aspect-[3/2] w-full rounded-xl object-contain bg-black/40" />
                ) : <p role="alert" className="rounded-xl bg-rose/15 px-3 py-2 text-sm text-rose">{r.error}</p>}
                <p className="text-xs text-white/65">Modelo: <span className="font-mono">{r.model ?? '—'}</span>{r.ok ? (r.realEdit ? ' · edición real' : ' · composición (collage), no edición real') : ''}</p>
                {r.notes ? <p className="break-words text-xs text-white/55">{r.notes}</p> : null}
                {r.prompts.length ? (
                  <details className="text-xs text-white/65"><summary className="cursor-pointer font-bold">Prompt enviado</summary>{r.prompts.map((p, i) => <p key={i} className="mt-1 break-words rounded bg-night-950 p-2 font-mono">{p}</p>)}</details>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" disabled={running.includes(r.provider) || !ready} loading={running.includes(r.provider)} onClick={() => void run([r.provider])}>Repetir con otra semilla</Button>
                  {r.ok && r.dataUrl ? <a href={r.dataUrl} download={`comparar-${r.provider}.${r.dataUrl.startsWith('data:image/png') ? 'png' : 'webp'}`} className="inline-flex min-h-9 items-center rounded-lg border border-white/10 bg-night-700 px-3 py-1.5 text-sm font-bold hover:bg-night-600">Descargar</a> : null}
                </div>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}
