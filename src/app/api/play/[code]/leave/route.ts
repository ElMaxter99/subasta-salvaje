import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { assertSameOrigin, handle, limit, noStore } from '@/lib/api';
import { clientIp } from '@/lib/auth/rate-limit';
import { getContext } from '@/lib/services/context';
import { leaveGame, playerCookieName } from '@/lib/services/play-service';

/** El jugador libera su casilla (por si quiere cambiar de móvil). */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ code: string }> }) => {
  assertSameOrigin(req);
  const { code } = await params;
  limit(req, 'leave', `${clientIp(req.headers)}:${code.toUpperCase()}`, 20);
  const token = (await cookies()).get(playerCookieName(code))?.value;
  await leaveGame(await getContext(), code, token);
  const res = NextResponse.json({ ok: true }, { headers: noStore });
  res.cookies.delete(playerCookieName(code));
  return res;
});
