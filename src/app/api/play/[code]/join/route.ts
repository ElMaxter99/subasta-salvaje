import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { assertSameOrigin, handle, limit, noStore } from '@/lib/api';
import { clientIp } from '@/lib/auth/rate-limit';
import { getContext } from '@/lib/services/context';
import { kickJobsAfter } from '@/lib/services/kick';
import { joinGame, playerCookieName } from '@/lib/services/play-service';

export const maxDuration = 300;

/** Un jugador se une desde su móvil: reclama su casilla o crea una nueva. Emite su cookie de identidad. */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ code: string }> }) => {
  assertSameOrigin(req);
  const { code } = await params;
  // Límite por IP (primer salto: en Vercel la plataforma fija la IP real) y por sala.
  limit(req, 'join-ip', clientIp(req.headers), 20);
  limit(req, 'join-room', code.toUpperCase(), 40);
  const ctx = await getContext();
  const current = (await cookies()).get(playerCookieName(code))?.value;
  const out = await joinGame(ctx, code, await req.json().catch(() => null), current);
  // Si la imagen inicial de los jugadores nuevos se GENERA, se procesa el trabajo recién creado.
  if (out.snapshot.game.new_player_image_kind === 'generate') kickJobsAfter(ctx, out.snapshot.game.id);
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
