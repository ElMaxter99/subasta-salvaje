import type { Metadata } from 'next';
import { HistoryView } from '@/components/host/history-view';
import { ForbiddenNotice } from '@/components/ui/forbidden';
import { loadHostPage } from '@/lib/services/page-data';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Historial de imágenes', robots: { index: false, follow: false } };

export default async function HistoryPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const data = await loadHostPage(code, `/game/${code}/history`);
  if (data.kind === 'forbidden') return <ForbiddenNotice roomCode={code.toUpperCase()} />;
  return <HistoryView roomCode={data.snapshot.game.room_code} initial={data.snapshot} runtime={data.runtime} />;
}
