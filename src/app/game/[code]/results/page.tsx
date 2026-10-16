import type { Metadata } from 'next';
import { ResultsView } from '@/components/screen/results-view';
import { loadPublicPage } from '@/lib/services/page-data';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Resultados' };

export default async function ResultsPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const { snapshot, runtime } = await loadPublicPage(code);
  return <ResultsView roomCode={snapshot.game.room_code} initial={snapshot} runtime={runtime} />;
}
