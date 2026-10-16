import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createDemoProvider } from '@/lib/ai/demo';
import { assertSameOrigin, handle } from '@/lib/api';
import { DEMO_COOKIE, getHostIdentity } from '@/lib/auth/host';
import { getRuntimeMode } from '@/lib/config/env';
import { DomainError } from '@/lib/domain/errors';
import { getContext } from '@/lib/services/context';
import { seedDemoGame, type SeedStage } from '@/lib/services/seed';

export const maxDuration = 60;
const STAGES: SeedStage[] = ['lobby', 'bidding', 'midgame', 'finished', 'failedjob'];

/** Sólo modo demo: crea una partida de ejemplo y deja la sesión de anfitrión demo iniciada. */
export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  if (getRuntimeMode() !== 'demo') throw new DomainError('not_host', 'No disponible.', 404);
  const body = (await req.json().catch(() => ({}))) as { stage?: string };
  const stage = STAGES.includes(body.stage as SeedStage) ? (body.stage as SeedStage) : 'midgame';
  const existing = await getHostIdentity();
  const hostId = existing?.id ?? randomUUID();
  const ctx = await getContext();
  // El seed nunca gasta créditos de IA real: usa siempre el proveedor de muestra.
  const room = await seedDemoGame({ ...ctx, provider: createDemoProvider() }, hostId, stage);
  const res = NextResponse.json({ room_code: room });
  if (!existing) res.cookies.set(DEMO_COOKIE, hostId, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 30 });
  return res;
});
