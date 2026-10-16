'use client';

import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { downloadText, slug } from '@/lib/client/download';
import { templateFromSnapshot } from '@/lib/domain/template';
import { Card } from './bits';
import type { HostCtx } from './host-context';

/** Exporta esta partida como plantilla (JSON) para reutilizarla o editarla fuera de la app. Las fotos no se exportan (sus URLs son temporales). */
export function TemplateExportCard({ ctx }: { ctx: HostCtx }) {
  const { snapshot } = ctx;
  return (
    <Card title="Plantilla de esta partida">
      <p className="mb-3 text-sm text-white/70">Descarga el nombre, la temática, las reglas, los jugadores y el catálogo como un archivo que puedes editar y volver a importar en «Nueva partida». Las fotos no se incluyen: añade su URL (https) en el campo «foto» de cada elemento.</p>
      <Button type="button" variant="secondary" size="lg" data-testid="template-export" onClick={() => downloadText(`plantilla-${slug(snapshot.game.name)}.json`, JSON.stringify(templateFromSnapshot(snapshot), null, 2) + '\n')}>
        <Download className="size-5" aria-hidden /> Exportar como plantilla
      </Button>
    </Card>
  );
}
