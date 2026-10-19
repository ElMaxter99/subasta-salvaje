'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, FileUp, Layers, Trash2, X } from 'lucide-react';
import { ApiError, deleteTemplateRequest, getSystemTemplateRequest, getTemplateRequest, listSystemTemplatesRequest, listTemplatesRequest, type SavedTemplateSummary, type SystemTemplateCard } from '@/lib/client/api';
import { Button } from '@/components/ui/button';
import { downloadText } from '@/lib/client/download';
import { blankTemplate, parseTemplate, templateSummary, templateToForm } from '@/lib/domain/template';
import { parseCatalogCsv } from '@/lib/domain/template-csv';
import { parseTemplateZip, type ZipFormValues } from '@/lib/domain/template-zip';

type Source = 'system' | 'mine' | 'file';

export type LoadedTemplate = ZipFormValues;
export type LoadedCatalog = NonNullable<ZipFormValues['items']>;

/**
 * «¿Tienes una plantilla?»: sube un JSON, un ZIP (plantilla.json + fotos/) o un CSV de catálogo para rellenar el asistente.
 * Todo se valida en el navegador antes de usarlo y el servidor vuelve a validar al crear la partida. Nada se crea hasta pulsar
 * «Crear partida». Un CSV solo trae el catálogo: el resto del asistente se queda como está.
 */
export function TemplateImport({ onTemplate, onCatalog }: { onTemplate: (values: LoadedTemplate, systemSlug?: string) => void; onCatalog: (items: LoadedCatalog) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedTemplateSummary[]>([]);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [system, setSystem] = useState<SystemTemplateCard[]>([]);
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<Source>('system');
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  function openPicker() {
    setSource(system.length > 0 ? 'system' : saved.length > 0 ? 'mine' : 'file');
    setOpen(true);
  }

  useEffect(() => {
    let alive = true;
    listTemplatesRequest().then((l) => alive && setSaved(l)).catch(() => undefined); // sin sesión o sin plantillas: no se muestra nada
    listSystemTemplatesRequest().then((l) => alive && setSystem(l)).catch(() => undefined);
    return () => { alive = false; };
  }, []);

  async function loadSaved(t: SavedTemplateSummary) {
    setErrors([]);
    setWarnings([]);
    try {
      const r = parseTemplate(JSON.stringify((await getTemplateRequest(t.id)).data));
      if (!r.ok) return setErrors(r.errors);
      setWarnings(r.warnings);
      setLoaded(`Plantilla «${t.name}» cargada: ${templateSummary(r.template)}.`);
      const v = templateToForm(r.template);
      setOpen(false);
      onTemplate({ ...v, items: v.items ? v.items.map((i) => ({ ...i, photoFile: null })) : null });
    } catch (e) {
      setErrors([e instanceof ApiError ? e.message : 'No se pudo cargar la plantilla.']);
    }
  }

  async function loadSystem(t: SystemTemplateCard) {
    setErrors([]);
    setWarnings([]);
    try {
      const r = parseTemplate(JSON.stringify((await getSystemTemplateRequest(t.id)).data));
      if (!r.ok) return setErrors(r.errors);
      setWarnings(r.warnings);
      setLoaded(`Partida del sistema «${t.title}» cargada: ${templateSummary(r.template)}.`);
      const v = templateToForm(r.template);
      setOpen(false);
      onTemplate({ ...v, items: v.items ? v.items.map((i) => ({ ...i, photoFile: null })) : null }, t.slug);
    } catch (e) {
      setErrors([e instanceof ApiError ? e.message : 'No se pudo cargar la partida del sistema.']);
    }
  }

  async function removeSaved(t: SavedTemplateSummary) {
    if (confirmDelete !== t.id) return setConfirmDelete(t.id);
    setConfirmDelete(null);
    try {
      await deleteTemplateRequest(t.id);
      setSaved((l) => l.filter((x) => x.id !== t.id));
    } catch (e) {
      setErrors([e instanceof ApiError ? e.message : 'No se pudo borrar la plantilla.']);
    }
  }

  async function onFile(file: File | undefined) {
    setErrors([]);
    setWarnings([]);
    setLoaded(null);
    if (!file) return;
    setOpen(false);
    const ext = file.name.toLowerCase().split('.').pop();
    try {
      if (ext === 'zip') {
        const r = await parseTemplateZip(new Uint8Array(await file.arrayBuffer()));
        if (!r.ok) return setErrors(r.errors);
        setWarnings(r.warnings);
        const photos = r.values.items?.filter((i) => i.photoFile).length ?? 0;
        setLoaded(`«${r.summary.nombre}» cargada: ${templateSummary(r.summary)}${photos ? ` (${photos} fotos incluidas en el ZIP)` : ''}.`);
        onTemplate(r.values as LoadedTemplate);
      } else if (ext === 'csv') {
        const r = parseCatalogCsv(await file.text());
        if (!r.ok) return setErrors(r.errors);
        setWarnings(r.warnings);
        setLoaded(`Catálogo cargado: ${r.items.length} ${r.items.length === 1 ? 'elemento' : 'elementos'}.`);
        onCatalog(r.items.map((i) => ({ ...i, photoFile: null })));
      } else {
        const r = parseTemplate(await file.text());
        if (!r.ok) return setErrors(r.errors);
        setWarnings(r.warnings);
        setLoaded(`«${r.template.nombre}» cargada: ${templateSummary(r.template)}.`);
        const v = templateToForm(r.template);
        onTemplate({ ...v, items: v.items ? v.items.map((i) => ({ ...i, photoFile: null })) : null });
      }
    } catch {
      setErrors(['No se pudo leer el archivo.']);
    } finally {
      if (input.current) input.current.value = ''; // permite volver a elegir el mismo archivo
    }
  }

  const sources: { id: Source; label: string }[] = [
    ...(system.length > 0 ? [{ id: 'system' as const, label: `Partidas del sistema (${system.length})` }] : []),
    ...(saved.length > 0 ? [{ id: 'mine' as const, label: `Mis plantillas (${saved.length})` }] : []),
    { id: 'file', label: 'Subir un archivo (.json, .zip o .csv)' },
  ];

  return (
    <section className="space-y-4 rounded-3xl border border-violet/40 bg-night-800/70 p-4 text-center sm:p-6" aria-label="Plantilla de partida" data-testid="template-import">
      <div className="space-y-1">
        <h3 className="font-display text-xl 2xl:text-3xl">¿Tienes una plantilla?</h3>
        <p className="mx-auto max-w-prose text-sm text-white/70 2xl:text-lg">Empieza con una partida del sistema, una de las tuyas o un archivo. Lo revisas en el resumen antes de crear la partida.</p>
      </div>
      <input ref={input} type="file" accept=".json,.zip,.csv,application/json,application/zip,text/csv" className="sr-only" data-testid="template-input" aria-label="Archivo de plantilla (.json, .zip o .csv)" tabIndex={-1} onChange={(e) => void onFile(e.target.files?.[0])} />
      <Button type="button" variant="primary" size="lg" className="w-full sm:w-auto" onClick={openPicker} data-testid="template-open">
        <Layers className="size-5" aria-hidden /> Elegir plantilla
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby="template-picker-title"
        onCancel={(e) => { e.preventDefault(); setOpen(false); }}
        onClick={(e) => e.target === dialog.current && setOpen(false)}
        className="m-auto max-h-[90dvh] w-[min(94vw,42rem)] flex-col overflow-hidden rounded-3xl border border-white/15 bg-night-800 p-0 text-left text-white shadow-2xl backdrop:bg-black/70 backdrop:backdrop-blur-sm open:flex 2xl:w-[min(90vw,60rem)]"
      >
        {open ? (
          <>
            <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-6">
              <h2 id="template-picker-title" className="font-display text-xl sm:text-2xl 2xl:text-3xl">Elegir plantilla</h2>
              <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} aria-label="Cerrar"><X className="size-5" aria-hidden /></Button>
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
              <label className="block space-y-1">
                <span className="text-sm font-bold uppercase tracking-wide text-white/60">Origen</span>
                <select value={source} onChange={(e) => setSource(e.target.value as Source)} className="block min-h-12 w-full rounded-2xl border border-white/15 bg-night-900 px-3 text-base text-white" data-testid="template-source">
                  {sources.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
              </label>
              {source === 'file' ? (
                <div className="space-y-3" data-testid="template-file-source">
                  <p className="text-sm text-white/70 2xl:text-lg">
                    Sube un <b>.json</b> con todo (nombre, temática, reglas, jugadores y catálogo), un <b>.zip</b> (plantilla.json + carpeta fotos/) o un <b>.csv</b> solo con el catálogo (título, descripción, emoji y foto).
                  </p>
                  <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                    <Button type="button" variant="secondary" size="lg" onClick={() => input.current?.click()}>
                      <FileUp className="size-5" aria-hidden /> Importar plantilla
                    </Button>
                    <Button type="button" variant="ghost" size="lg" onClick={() => downloadText('plantilla-subasta-salvaje.json', JSON.stringify(blankTemplate(), null, 2) + '\n')}>
                      <Download className="size-5" aria-hidden /> Descargar plantilla vacía
                    </Button>
                  </div>
                </div>
              ) : null}
            {source === 'system' && system.length > 0 ? (
              <div className="space-y-2" data-testid="system-templates">
                <ul className="grid gap-3 sm:grid-cols-2">
                  {system.map((t) => (
                    <li key={t.id} className="flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-night-900" data-testid="system-template-card">
                      {t.cover_url ? (
                        // eslint-disable-next-line @next/next/no-img-element -- portada alojada en el CDN del propietario
                        <img src={t.cover_url} alt="" loading="lazy" referrerPolicy="no-referrer" className="aspect-[1200/630] w-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                      ) : null}
                      <div className="flex flex-1 flex-col gap-1 p-3">
                        <span className="font-bold">{t.title}</span>
                        {t.description ? <span className="text-sm text-white/70">{t.description}</span> : null}
                        {t.credits ? <span className="text-xs italic text-white/50" data-testid="system-template-credits">Imágenes: {t.credits}</span> : null}
                        <span className="text-xs text-white/60">{t.items} elementos · {t.players} jugadores{t.has_initial_image ? ' · con imagen inicial' : ''}</span>
                        <Button type="button" size="sm" variant="primary" className="mt-auto self-start" onClick={() => void loadSystem(t)} aria-label={`Usar la partida del sistema ${t.title}`}>Usar</Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {source === 'mine' && saved.length > 0 ? (
              <div className="space-y-2" data-testid="saved-templates">
                <ul className="space-y-2">
                  {saved.map((t) => (
                    <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 bg-night-900 px-4 py-2">
                      <span className="min-w-0">
                        <span className="block truncate font-bold">{t.name}</span>
                        <span className="text-xs text-white/60">{t.items} elementos · {t.players} jugadores</span>
                      </span>
                      <span className="flex gap-2">
                        <Button type="button" size="sm" variant="secondary" onClick={() => void loadSaved(t)} aria-label={`Cargar la plantilla ${t.name}`}>Cargar</Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => void removeSaved(t)} aria-label={confirmDelete === t.id ? `Confirmar el borrado de ${t.name}` : `Borrar la plantilla ${t.name}`}>
                          <Trash2 className="size-4" aria-hidden /> {confirmDelete === t.id ? '¿Seguro?' : 'Borrar'}
                        </Button>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            </div>
          </>
        ) : null}
      </dialog>
      {loaded ? <p role="status" className="rounded-xl bg-teal/15 px-4 py-2 text-sm font-semibold text-teal" data-testid="template-loaded">{loaded} Revisa el resumen y pulsa «Crear partida».</p> : null}
      {warnings.length > 0 ? (
        <ul className="list-disc space-y-1 pl-5 text-sm text-gold-soft" data-testid="template-warnings">
          {warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      ) : null}
      {errors.length > 0 ? (
        <div role="alert" className="space-y-1 rounded-xl bg-rose/15 px-4 py-3 text-sm text-rose" data-testid="template-errors">
          <p className="font-bold">No se pudo cargar el archivo:</p>
          <ul className="list-disc pl-5">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
        </div>
      ) : null}
    </section>
  );
}
