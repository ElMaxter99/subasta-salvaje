import { redirect } from 'next/navigation';
import { NewGameForm } from '@/components/landing/new-game-form';
import { DemoBanner } from '@/components/ui/status';
import { getHostIdentity } from '@/lib/auth/host';
import { getRuntimeMode } from '@/lib/config/env';
import { getRuntimeInfo } from '@/lib/services/context';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Nueva partida' };

export default async function NewGamePage() {
  if (getRuntimeMode() === 'unconfigured') redirect('/setup');
  if (!(await getHostIdentity())) redirect('/login?next=/new-game');
  const runtime = getRuntimeInfo();
  return (
    <>
      <DemoBanner runtime={runtime} />
      <NewGameForm />
    </>
  );
}
