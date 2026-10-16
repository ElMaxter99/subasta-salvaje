import type { Metadata } from 'next';
import { ScreenView } from '@/components/screen/screen-view';
import { loadPublicPage } from '@/lib/services/page-data';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Pantalla de TV' };

export default async function ScreenPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const { snapshot, runtime } = await loadPublicPage(code);
  return <ScreenView roomCode={snapshot.game.room_code} initial={snapshot} runtime={runtime} />;
}
