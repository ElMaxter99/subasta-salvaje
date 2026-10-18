import type { Metadata } from 'next';
import { ReplayView } from '@/components/host/replay-view';
import { ForbiddenNotice } from '@/components/ui/forbidden';
import { getContext } from '@/lib/services/context';
import { loadHostPage } from '@/lib/services/page-data';
import { getReplay } from '@/lib/services/replay-service';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Repetición de la partida', robots: { index: false, follow: false } };

export default async function ReplayPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const data = await loadHostPage(code, `/game/${code}/replay`);
  if (data.kind === 'forbidden') return <ForbiddenNotice roomCode={code.toUpperCase()} />;
  const rounds = await getReplay(await getContext(), code, data.identity.id);
  return <ReplayView roomCode={data.snapshot.game.room_code} snapshot={data.snapshot} rounds={rounds} runtime={data.runtime} />;
}
