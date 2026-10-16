'use client';

import { Download, Save } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { ApiError, saveTemplateRequest } from '@/lib/client/api';
import { Button } from '@/components/ui/button';
import { downloadText, slug } from '@/lib/client/download';
import { templateFromSnapshot } from '@/lib/domain/template';
import { catalogToCsv } from '@/lib/domain/template-csv';
import { Card } from './bits';
import type { HostCtx } from './host-context';

/** Exporta esta partida como plantilla (JSON) para reutilizarla o editarla fuera de la app. Las fotos no se exportan (sus URLs son temporales). */
export function TemplateExportCard({ ctx }: { ctx: HostCtx }) {
  const { snapshot } = ctx;
  const toast = useToast();
  async function save() {
    try {
      const r = await saveTemplateRequest(snapshot.game.name.slice(0, 80), templateFromSnapshot(snapshot));
      toast.success(r.replaced ? `Plantilla «${r.name}» actualizada` : `Plantilla «${r.name}» guardada en tus plantillas`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'No se pudo guardar la plantilla.');
    }
  }
  return (
    <Card title="Plantilla de esta partida">
      <p className="mb-3 text-sm text-white/70">Descarga el nombre, la temática, las reglas, los jugadores y el catálogo como un archivo (o solo el catálogo en CSV, para editarlo en una hoja de cálculo) que puedes editar y volver a importar en «Nueva partida». Las fotos no se incluyen: añade su URL (https) en el campo «foto» de cada elemento.</p>
      <Button type="button" variant="secondary" size="lg" data-testid="template-export" onClick={() => downloadText(`plantilla-${slug(snapshot.game.name)}.json`, JSON.stringify(templateFromSnapshot(snapshot), null, 2) + '\n')}>
        <Download className="size-5" aria-hidden /> Exportar como plantilla
      </Button>
      <Button type="button" variant="secondary" size="lg" className="ml-2" data-testid="template-save" onClick={() => void save()}>
        <Save className="size-5" aria-hidden /> Guardar en mis plantillas
      </Button>
      <Button type="button" variant="ghost" size="lg" className="ml-2" data-testid="catalog-csv-export" onClick={() => downloadText(`catalogo-${slug(snapshot.game.name)}.csv`, catalogToCsv(snapshot.items), 'text/csv')}>
        <Download className="size-5" aria-hidden /> Catálogo en CSV
      </Button>
    </Card>
  );
}
