import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { z } from 'zod';
import { assertSameOrigin, handle, json, limit } from '@/lib/api';
import { getRuntimeMode, getSupabaseConfig } from '@/lib/config/env';
import { DomainError } from '@/lib/domain/errors';

const bodySchema = z.object({ password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres.').max(200) });

/** Fija la nueva contraseña de la sesión de recuperación (la crea /auth/callback al abrir el enlace del correo). */
export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  if (getRuntimeMode() !== 'supabase') throw new DomainError('invalid_input');
  limit(req, 'reset', req.headers.get('x-forwarded-for') ?? 'local', 10, 600_000);
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) throw new DomainError('invalid_input', body.error.issues[0]?.message ?? 'Contraseña no válida.', 400);
  const cfg = getSupabaseConfig();
  const store = await cookies();
  const supabase = createServerClient(cfg.url, cfg.anonKey, {
    cookies: { getAll: () => store.getAll(), setAll: (list) => list.forEach(({ name, value, options }) => store.set(name, value, options)) },
  });
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new DomainError('unauthenticated', 'El enlace ha caducado. Pide uno nuevo desde «He olvidado mi contraseña».');
  const { error } = await supabase.auth.updateUser({ password: body.data.password });
  if (error) throw new DomainError('invalid_input', error.message, 400);
  return json({ ok: true });
});
