import { notFound } from 'next/navigation';
import { NewGameForm, type SystemDraft } from '@/components/landing/new-game-form';
import { requireSuperadmin } from '@/lib/auth/host';
import { getContext, getRuntimeInfo } from '@/lib/services/context';
import { getSystemTemplate, templateUploadsEnabled } from '@/lib/services/system-template-service';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Superadmin · Editor de plantilla', robots: { index: false, follow: false } };

/**
 * Editor de plantillas del sistema: el MISMO asistente que usa un anfitrión para «Nueva partida», con un paso más
 * (ficha: título, portada, imagen inicial, fotos) y «Guardar borrador» en lugar de «Crear partida».
 */
export default async function SystemTemplateEditorPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  await requireSuperadmin();
  const { id } = await searchParams;
  let draft: SystemDraft | null = null;
  if (id) {
    const full = await getSystemTemplate(await getContext(), id, { admin: true }).catch(() => null);
    if (!full) notFound();
    draft = { id: full.id, slug: full.slug, title: full.title, description: full.description, sort_order: full.sort_order, data: full.data };
  }
  const runtime = getRuntimeInfo();
  return <NewGameForm key={id ?? 'nueva'} aiAvailable={runtime.aiConfigured} aiProvider={runtime.aiProvider} systemEditor={{ draft, uploadsEnabled: templateUploadsEnabled() }} />;
}
