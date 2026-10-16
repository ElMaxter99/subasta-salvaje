import { notFound, redirect } from 'next/navigation';
import { getHostIdentity, type HostIdentity } from '@/lib/auth/host';
import { getRuntimeMode } from '@/lib/config/env';
import { DomainError } from '@/lib/domain/errors';
import type { HostSnapshot, PublicSnapshot, RuntimeInfo } from '@/lib/domain/types';
import { getContext, getRuntimeInfo } from './context';
import { getHostState, getPublicState } from './game-service';

/** Datos para páginas públicas (pantalla de TV, resultados). */
export async function loadPublicPage(code: string): Promise<{ snapshot: PublicSnapshot; runtime: RuntimeInfo }> {
  if (getRuntimeMode() === 'unconfigured') redirect('/setup');
  const ctx = await getContext();
  try {
    return { snapshot: await getPublicState(ctx, code), runtime: getRuntimeInfo(ctx) };
  } catch (e) {
    if (e instanceof DomainError && e.code === 'game_not_found') notFound();
    throw e;
  }
}

export type HostPageData =
  | { kind: 'ok'; snapshot: HostSnapshot; runtime: RuntimeInfo; identity: HostIdentity }
  | { kind: 'forbidden'; runtime: RuntimeInfo };

/** Datos para páginas del anfitrión: exige sesión y propiedad de la partida. */
export async function loadHostPage(code: string, nextPath: string): Promise<HostPageData> {
  if (getRuntimeMode() === 'unconfigured') redirect('/setup');
  const identity = await getHostIdentity();
  if (!identity) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  const ctx = await getContext();
  try {
    return { kind: 'ok', snapshot: await getHostState(ctx, code, identity.id), runtime: getRuntimeInfo(ctx), identity };
  } catch (e) {
    if (e instanceof DomainError && e.code === 'game_not_found') notFound();
    if (e instanceof DomainError && e.code === 'not_host') return { kind: 'forbidden', runtime: getRuntimeInfo(ctx) };
    throw e;
  }
}
