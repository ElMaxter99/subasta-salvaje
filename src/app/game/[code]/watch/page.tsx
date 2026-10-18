import type { Metadata } from 'next';
import { WatchView } from '@/components/spectator/watch-view';
import { gameMetadata } from '@/lib/seo/site';
import { loadPublicPage } from '@/lib/services/page-data';

export const dynamic = 'force-dynamic';
export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  return gameMetadata((await params).code, 'watch');
}

/** Vista de espectador: solo lectura, sin sesión ni token de jugador. Usa únicamente la instantánea pública. */
export default async function WatchPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const { snapshot, runtime } = await loadPublicPage(code);
  return <WatchView roomCode={snapshot.game.room_code} initial={snapshot} runtime={runtime} />;
}
