import type { Metadata } from 'next';
import { HostView } from '@/components/host/host-view';
import { ForbiddenNotice } from '@/components/ui/forbidden';
import { loadHostPage } from '@/lib/services/page-data';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Panel del anfitrión', robots: { index: false, follow: false } };

export default async function HostPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const data = await loadHostPage(code, `/game/${code}/host`);
  if (data.kind === 'forbidden') return <ForbiddenNotice roomCode={code.toUpperCase()} />;
  return <HostView roomCode={data.snapshot.game.room_code} initial={data.snapshot} runtime={data.runtime} identity={{ email: data.identity.email, demo: data.identity.demo }} />;
}
