import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { SpectatorDenied, WatchView } from '@/components/spectator/watch-view';
import { isDomainError } from '@/lib/domain/errors';
import { getRuntimeMode } from '@/lib/config/env';
import { getContext, getRuntimeInfo } from '@/lib/services/context';
import { getSpectatorState, spectatorKeyValid } from '@/lib/services/spectator-service';

export const dynamic = 'force-dynamic';

// Genérico a propósito: sin clave válida no se debe filtrar el nombre de la partida por la vista previa del enlace. Tampoco se envía
// el Referer (la clave va en la URL del enlace) y nunca se indexa.
export const metadata: Metadata = {
  title: 'Espectador · Subasta Salvaje',
  description: 'Sigue una subasta en directo. Solo lectura.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

/** Vista de espectador: solo lectura, sin sesión. Exige la clave secreta del enlace (`?k=`), que solo conoce el anfitrión y quien la reciba. */
export default async function WatchPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ k?: string | string[] }> }) {
  const { code } = await params;
  const k = (await searchParams).k;
  const key = Array.isArray(k) ? k[0] : k;
  if (getRuntimeMode() === 'unconfigured') redirect('/setup');
  const ctx = await getContext();
  if (!key || !(await spectatorKeyValid(ctx, code, key))) return <SpectatorDenied />;
  let snapshot;
  try {
    snapshot = await getSpectatorState(ctx, code, key);
  } catch (e) {
    if (isDomainError(e) && e.code === 'game_not_found') notFound();
    throw e;
  }
  return <WatchView roomCode={snapshot.game.room_code} initial={snapshot} runtime={getRuntimeInfo(ctx)} accessKey={key} />;
}
