import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { PlayView } from '@/components/play/play-view';
import { getContext } from '@/lib/services/context';
import { loadPublicPage } from '@/lib/services/page-data';
import { identifyPlayer, playerCookieName } from '@/lib/services/play-service';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Jugar desde el móvil' };

export default async function PlayPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const { snapshot, runtime } = await loadPublicPage(code);
  const token = (await cookies()).get(playerCookieName(snapshot.game.room_code))?.value;
  const playerId = await identifyPlayer(await getContext(), snapshot.game.room_code, token);
  return <PlayView roomCode={snapshot.game.room_code} initial={snapshot} runtime={runtime} initialPlayerId={playerId} />;
}
