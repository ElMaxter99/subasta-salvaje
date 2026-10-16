import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { DEMO_COOKIE, getHostIdentity } from '@/lib/auth/host';
import { getRuntimeMode } from '@/lib/config/env';
import { assertSameOrigin, handle } from '@/lib/api';
import { DomainError } from '@/lib/domain/errors';

/** Sólo modo demo: crea (o conserva) una identidad de anfitrión local. */
export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  if (getRuntimeMode() !== 'demo') throw new DomainError('not_host', 'El acceso demo no está disponible.', 404);
  const existing = await getHostIdentity();
  const res = NextResponse.json({ ok: true });
  if (!existing) {
    res.cookies.set(DEMO_COOKIE, randomUUID(), { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 30 });
  }
  return res;
});

export const DELETE = handle(async (req: Request) => {
  assertSameOrigin(req);
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(DEMO_COOKIE);
  return res;
});
