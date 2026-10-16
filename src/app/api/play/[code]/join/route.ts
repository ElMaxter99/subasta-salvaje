import { NextResponse } from 'next/server';
import { assertSameOrigin, handle, limit, noStore } from '@/lib/api';
import { getContext } from '@/lib/services/context';
import { joinGame, playerCookieName } from '@/lib/services/play-service';

/** Un jugador se une desde su móvil: reclama su casilla o crea una nueva. Emite su cookie de identidad. */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ code: string }> }) => {
  assertSameOrigin(req);
  const { code } = await params;
  limit(req, 'join', req.headers.get('x-forwarded-for') ?? 'ip', 30);
  const ctx = await getContext();
  const out = await joinGame(ctx, code, await req.json().catch(() => null));
  const res = NextResponse.json({ player_id: out.player_id, snapshot: out.snapshot }, { headers: noStore });
  res.cookies.set(playerCookieName(code), out.token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 3,
  });
  return res;
});
