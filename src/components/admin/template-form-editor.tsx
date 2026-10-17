'use client';

import { ArrowDown, ArrowUp, Plus, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Template } from '@/lib/domain/template';
import type { AssetTarget } from '@/lib/domain/template-assets';
import { addItem, emptyToNull, moveItem, removeItem, updateItem } from '@/lib/domain/template-edit';

const input = 'w-full rounded-xl border border-white/15 bg-night-900 px-3 py-2 text-sm';
const label = 'block text-xs font-bold uppercase tracking-wide text-white/60';

/** Miniatura de una imagen por URL (se oculta si no carga). Solo https. */
function Thumb({ url, className = 'h-16 w-24' }: { url?: string | null; className?: string }) {
  if (!url || !/^https:\/\//i.test(url)) return <span className={`${className} flex items-center justify-center rounded-lg border border-dashed border-white/20 text-[10px] text-white/40`}>sin imagen</span>;
  // eslint-disable-next-line @next/next/no-img-element -- previsualización de una imagen alojada en el CDN del propietario
  return <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" className={`${className} rounded-lg object-cover`} onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />;
}

function UploadButton({ ariaLabel, disabled, onFile }: { ariaLabel: string; disabled: boolean; onFile: (f: File) => void }) {
  return (
    <label className={`inline-flex items-center gap-1 rounded-lg bg-white/10 px-2 py-1 text-xs font-bold ${disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer hover:bg-white/15'}`}>
      <Upload className="size-3" aria-hidden /> Subir
      <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label={ariaLabel} disabled={disabled} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f); }} />
    </label>
  );
}

/** Número en euros/enteros que se confirma al salir del campo (así se puede escribir «12,5» sin que se corrija a medias). */
function NumberField({ id, text, value, onCommit, placeholder }: { id: string; text: string; value: number | undefined; onCommit: (n: number | undefined) => void; placeholder?: string }) {
  return (
    <div>
      <label htmlFor={id} className={label}>{text}</label>
      <input
        id={id}
        key={String(value)}
        inputMode="decimal"
        defaultValue={value ?? ''}
        placeholder={placeholder}
        className={`${input} mt-1`}
        onBlur={(e) => {
          const raw = e.target.value.trim().replace(',', '.');
          if (raw === '') return onCommit(undefined);
          const n = Number(raw);
          if (Number.isFinite(n)) onCommit(n);
        }}
      />
    </div>
  );
}

export function TemplateFormEditor({ template: t, onChange, onUpload, uploadsEnabled }: { template: Template; onChange: (t: Template) => void; onUpload: (file: File, target: AssetTarget) => void; uploadsEnabled: boolean }) {
  const reglas = t.reglas;
  const setRules = (patch: Partial<Template['reglas']>) => onChange({ ...t, reglas: { ...reglas, ...patch } });
  const catalog = t.catalogo ?? [];

  return (
    <div className="space-y-5" data-testid="template-form">
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label htmlFor="tpl-nombre" className={label}>Nombre de la partida</label>
          <input id="tpl-nombre" maxLength={80} value={t.nombre} onChange={(e) => onChange({ ...t, nombre: e.target.value })} className={`${input} mt-1`} />
        </div>
        <div>
          <label htmlFor="tpl-tematica" className={label}>Temática</label>
          <input id="tpl-tematica" maxLength={120} value={t.tematica} onChange={(e) => onChange({ ...t, tematica: e.target.value })} className={`${input} mt-1`} />
        </div>
      </div>

      <div>
        <label htmlFor="tpl-creditos" className={label}>Créditos de las imágenes (autoría o fuente; se muestra en la tarjeta)</label>
        <input id="tpl-creditos" maxLength={200} value={t.creditos ?? ''} placeholder="p. ej. Wikimedia Commons (CC BY-SA) y generadas con IA" onChange={(e) => onChange({ ...t, creditos: emptyToNull(e.target.value) })} className={`${input} mt-1`} />
      </div>

      <fieldset className="space-y-3 rounded-2xl border border-white/10 p-3">
        <legend className="px-1 text-sm font-bold">Reglas</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          <NumberField id="tpl-presupuesto" text="Presupuesto (€)" value={reglas.presupuesto} placeholder="20" onCommit={(n) => setRules({ presupuesto: n })} />
          <NumberField id="tpl-pujamin" text="Puja mínima (€)" value={reglas.puja_minima} placeholder="1" onCommit={(n) => setRules({ puja_minima: n })} />
          <NumberField id="tpl-rondas" text="Rondas máximas" value={reglas.rondas_maximas} placeholder="todas" onCommit={(n) => setRules({ rondas_maximas: n })} />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="tpl-clasif" className={label}>Clasificación</label>
            <select id="tpl-clasif" value={reglas.clasificacion ?? 'ninguna'} onChange={(e) => setRules({ clasificacion: e.target.value as Template['reglas']['clasificacion'] })} className={`${input} mt-1`}>
              <option value="ninguna">Ninguna</option><option value="saldo">Por saldo</option><option value="elementos">Por elementos</option><option value="votos">Por votos</option>
            </select>
          </div>
          <div>
            <label htmlFor="tpl-modo" className={label}>Modo de juego</label>
            <select id="tpl-modo" value={reglas.modo_juego ?? 'anfitrion'} onChange={(e) => setRules({ modo_juego: e.target.value as Template['reglas']['modo_juego'] })} className={`${input} mt-1`}>
              <option value="anfitrion">Anfitrión puja por todos</option><option value="movil">Cada jugador desde su móvil</option>
            </select>
          </div>
          <div>
            <label htmlFor="tpl-imagenes" className={label}>Imágenes</label>
            <select id="tpl-imagenes" value={reglas.modo_imagenes ?? 'pegatinas'} onChange={(e) => setRules({ modo_imagenes: e.target.value as Template['reglas']['modo_imagenes'] })} className={`${input} mt-1`}>
              <option value="pegatinas">Pegatinas (sin IA)</option><option value="ia">Con IA</option>
            </select>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={reglas.pujas_enteras ?? true} onChange={(e) => setRules({ pujas_enteras: e.target.checked })} /> Pujas en euros enteros
        </label>
      </fieldset>

      <div>
        <label htmlFor="tpl-jugadores" className={label}>Jugadores sugeridos (uno por línea, hasta 10; opcional)</label>
        <textarea id="tpl-jugadores" key={t.jugadores.join('\n')} rows={3} defaultValue={t.jugadores.join('\n')} className={`${input} mt-1`} onBlur={(e) => onChange({ ...t, jugadores: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {([['cover', 'Portada de la tarjeta', t.portada, 'tpl-portada'], ['scene', 'Casa inicial (imagen de partida)', t.casa_inicial, 'tpl-casa']] as const).map(([kind, text, url, id]) => (
          <div key={kind} className="space-y-1 rounded-2xl border border-white/10 p-3">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor={id} className={label}>{text}</label>
              <UploadButton ariaLabel={`Subir ${text}`} disabled={!uploadsEnabled} onFile={(f) => onUpload(f, { kind })} />
            </div>
            <div className="flex gap-3">
              <Thumb url={url} className="h-20 w-32 shrink-0" />
              <input id={id} value={url ?? ''} placeholder="https://…" onChange={(e) => onChange(kind === 'cover' ? { ...t, portada: emptyToNull(e.target.value) } : { ...t, casa_inicial: emptyToNull(e.target.value) })} className={`${input} self-start`} />
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-sm font-bold">Catálogo ({catalog.length} {catalog.length === 1 ? 'elemento' : 'elementos'}; el orden es el de las rondas)</h4>
          <Button type="button" size="sm" variant="secondary" onClick={() => onChange(addItem(t))} disabled={catalog.length >= 100}><Plus className="size-4" aria-hidden /> Añadir elemento</Button>
        </div>
        <ul className="space-y-2">
          {catalog.map((it, i) => (
            <li key={i} className="grid gap-2 rounded-2xl border border-white/10 bg-night-900 p-3 sm:grid-cols-[auto_1fr_auto]" data-testid="catalog-item">
              <Thumb url={it.foto} className="h-16 w-24" />
              <div className="grid gap-2 sm:grid-cols-6">
                <input aria-label={`Título del elemento ${i + 1}`} maxLength={80} value={it.titulo} onChange={(e) => onChange(updateItem(t, i, { titulo: e.target.value }))} className={`${input} sm:col-span-3`} placeholder="Título" />
                <input aria-label={`Emoji del elemento ${i + 1}`} maxLength={8} value={it.emoji ?? ''} onChange={(e) => onChange(updateItem(t, i, { emoji: emptyToNull(e.target.value) }))} className={`${input} sm:col-span-1`} placeholder="🙂" />
                <input aria-label={`Crédito de la foto del elemento ${i + 1}`} maxLength={120} value={it.credito ?? ''} onChange={(e) => onChange(updateItem(t, i, { credito: emptyToNull(e.target.value) }))} className={`${input} sm:col-span-2`} placeholder="Crédito (opcional)" />
                <input aria-label={`Descripción del elemento ${i + 1}`} maxLength={500} value={it.descripcion ?? ''} onChange={(e) => onChange(updateItem(t, i, { descripcion: e.target.value }))} className={`${input} sm:col-span-6`} placeholder="Descripción" />
                <input aria-label={`Foto (URL) del elemento ${i + 1}`} value={it.foto ?? ''} onChange={(e) => onChange(updateItem(t, i, { foto: emptyToNull(e.target.value) }))} className={`${input} sm:col-span-5`} placeholder="Foto: https://…" />
                <div className="sm:col-span-1"><UploadButton ariaLabel={`Subir foto del elemento ${i + 1}`} disabled={!uploadsEnabled} onFile={(f) => onUpload(f, { kind: 'item', index: i })} /></div>
              </div>
              <div className="flex gap-1 sm:flex-col">
                <Button type="button" size="sm" variant="ghost" aria-label={`Subir el elemento ${i + 1}`} disabled={i === 0} onClick={() => onChange(moveItem(t, i, -1))}><ArrowUp className="size-4" aria-hidden /></Button>
                <Button type="button" size="sm" variant="ghost" aria-label={`Bajar el elemento ${i + 1}`} disabled={i === catalog.length - 1} onClick={() => onChange(moveItem(t, i, 1))}><ArrowDown className="size-4" aria-hidden /></Button>
                <Button type="button" size="sm" variant="ghost" aria-label={`Quitar el elemento ${i + 1}`} onClick={() => onChange(removeItem(t, i))}><Trash2 className="size-4" aria-hidden /></Button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
