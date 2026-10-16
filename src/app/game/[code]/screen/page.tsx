import type { Metadata } from 'next';
import { ScreenView } from '@/components/screen/screen-view';
import { gameMetadata } from '@/lib/seo/site';
import { loadPublicPage } from '@/lib/services/page-data';

export const dynamic = 'force-dynamic';
export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  return gameMetadata((await params).code, 'tv');
}

export default async function ScreenPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const { snapshot, runtime } = await loadPublicPage(code);
  return <ScreenView roomCode={snapshot.game.room_code} initial={snapshot} runtime={runtime} />;
}
