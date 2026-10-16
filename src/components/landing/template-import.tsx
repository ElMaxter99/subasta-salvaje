'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, FileUp, Trash2 } from 'lucide-react';
import { ApiError, deleteTemplateRequest, getTemplateRequest, listTemplatesRequest, type SavedTemplateSummary } from '@/lib/client/api';
import { Button } from '@/components/ui/button';
import { downloadText } from '@/lib/client/download';
import { blankTemplate, parseTemplate, templateSummary, templateToForm } from '@/lib/domain/template';
import { parseCatalogCsv } from '@/lib/domain/template-csv';
import { parseTemplateZip, type ZipFormValues } from '@/lib/domain/template-zip';

export type LoadedTemplate = ZipFormValues;
export type LoadedCatalog = NonNullable<ZipFormValues['items']>;

/**
 * «¿Tienes una plantilla?»: sube un JSON, un ZIP (plantilla.json + fotos/) o un CSV de catálogo para rellenar el asistente.
 * Todo se valida en el navegador antes de usarlo y el servidor vuelve a validar al crear la partida. Nada se crea hasta pulsar
 * «Crear partida». Un CSV solo trae el catálogo: el resto del asistente se queda como está.
 */
export function TemplateImport({ onTemplate, onCatalog }: { onTemplate: (values: LoadedTemplate) => void; onCatalog: (items: LoadedCatalog) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedTemplateSummary[]>([]);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    listTemplatesRequest().then((l) => alive && setSaved(l)).catch(() => undefined); // sin sesión o sin plantillas: no se muestra nada
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
      onTemplate({ ...v, items: v.items ? v.items.map((i) => ({ ...i, photoFile: null })) : null });
    } catch (e) {
      setErrors([e instanceof ApiError ? e.message : 'No se pudo cargar la plantilla.']);
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

  return (
    <section className="space-y-3 rounded-3xl border border-violet/40 bg-night-800/70 p-4 sm:p-6" aria-label="Plantilla de partida" data-testid="template-import">
      <div>
        <h3 className="font-display text-xl 2xl:text-3xl">¿Tienes una plantilla?</h3>
        <p className="text-sm text-white/70 2xl:text-lg">
          Sube un <b>.json</b> con todo (nombre, temática, reglas, jugadores y catálogo), un <b>.zip</b> (plantilla.json + carpeta fotos/) o un <b>.csv</b> solo con el catálogo (título, descripción, emoji y foto). Lo revisas en el resumen y creas la partida.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <input ref={input} type="file" accept=".json,.zip,.csv,application/json,application/zip,text/csv" className="sr-only" data-testid="template-input" aria-label="Archivo de plantilla (.json, .zip o .csv)" onChange={(e) => void onFile(e.target.files?.[0])} />
        <Button type="button" variant="secondary" size="lg" onClick={() => input.current?.click()}>
          <FileUp className="size-5" aria-hidden /> Importar plantilla
        </Button>
        <Button type="button" variant="ghost" size="lg" onClick={() => downloadText('plantilla-subasta-salvaje.json', JSON.stringify(blankTemplate(), null, 2) + '\n')}>
          <Download className="size-5" aria-hidden /> Descargar plantilla vacía
        </Button>
      </div>
      {saved.length > 0 ? (
        <div className="space-y-2" data-testid="saved-templates">
          <h4 className="text-sm font-bold uppercase tracking-wide text-white/60 2xl:text-base">Mis plantillas</h4>
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
