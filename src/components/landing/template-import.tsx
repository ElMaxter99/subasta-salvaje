'use client';

import { useRef, useState } from 'react';
import { Download, FileUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { downloadText } from '@/lib/client/download';
import { blankTemplate, parseTemplate, templateSummary, templateToForm, type TemplateFormValues } from '@/lib/domain/template';

/**
 * «¿Tienes una plantilla?»: sube un JSON (o descarga uno vacío con ejemplos) para rellenar el asistente. Todo se valida en el
 * navegador antes de usarlo y se vuelve a validar en el servidor al crear la partida. Nada se crea hasta pulsar «Crear partida».
 */
export function TemplateImport({ onLoaded }: { onLoaded: (values: TemplateFormValues, summary: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loaded, setLoaded] = useState<string | null>(null);

  async function onFile(file: File | undefined) {
    setErrors([]);
    setWarnings([]);
    setLoaded(null);
    if (!file) return;
    const parsed = parseTemplate(await file.text().catch(() => ''));
    if (input.current) input.current.value = ''; // permite volver a elegir el mismo archivo
    if (!parsed.ok) return setErrors(parsed.errors);
    setWarnings(parsed.warnings);
    const summary = templateSummary(parsed.template);
    setLoaded(`«${parsed.template.nombre}» cargada: ${summary}.`);
    onLoaded(templateToForm(parsed.template), summary);
  }

  return (
    <section className="space-y-3 rounded-3xl border border-violet/40 bg-night-800/70 p-4 sm:p-6" aria-label="Plantilla de partida" data-testid="template-import">
      <div>
        <h3 className="font-display text-xl 2xl:text-3xl">¿Tienes una plantilla?</h3>
        <p className="text-sm text-white/70 2xl:text-lg">
          Un archivo con el nombre, la temática, las reglas, los jugadores y el catálogo (título, descripción, emoji y foto por URL). Se carga aquí, lo revisas en el resumen y creas la partida.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <input ref={input} type="file" accept=".json,application/json" className="sr-only" data-testid="template-input" aria-label="Archivo de plantilla (.json)" onChange={(e) => void onFile(e.target.files?.[0])} />
        <Button type="button" variant="secondary" size="lg" onClick={() => input.current?.click()}>
          <FileUp className="size-5" aria-hidden /> Importar plantilla
        </Button>
        <Button type="button" variant="ghost" size="lg" onClick={() => downloadText('plantilla-subasta-salvaje.json', JSON.stringify(blankTemplate(), null, 2) + '\n')}>
          <Download className="size-5" aria-hidden /> Descargar plantilla vacía
        </Button>
      </div>
      {loaded ? <p role="status" className="rounded-xl bg-teal/15 px-4 py-2 text-sm font-semibold text-teal" data-testid="template-loaded">{loaded} Revisa el resumen y pulsa «Crear partida».</p> : null}
      {warnings.length > 0 ? (
        <ul className="list-disc space-y-1 pl-5 text-sm text-gold-soft" data-testid="template-warnings">
          {warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      ) : null}
      {errors.length > 0 ? (
        <div role="alert" className="space-y-1 rounded-xl bg-rose/15 px-4 py-3 text-sm text-rose" data-testid="template-errors">
          <p className="font-bold">No se pudo cargar la plantilla:</p>
          <ul className="list-disc pl-5">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
        </div>
      ) : null}
    </section>
  );
}
