import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { z } from 'zod';
import { assertSameOrigin, handle, json, limit } from '@/lib/api';
import { getRuntimeMode, getSupabaseConfig } from '@/lib/config/env';
import { DomainError } from '@/lib/domain/errors';
import { getContext } from '@/lib/services/context';
import { signUpWithEmail } from '@/lib/services/auth-mail';
import { getAuthMailDeps } from '@/lib/services/auth-mail-context';

const bodySchema = z.object({ email: z.string().trim().email().max(254), password: z.string().min(8).max(200) });

/** Estado público del registro (para que el formulario muestre «cerrado» sin esperar al envío). */
export const GET = handle(async () => {
  if (getRuntimeMode() !== 'supabase') return json({ open: false });
  const ctx = await getContext();
  const r = await ctx.db.rpc<{ open: boolean }>('ss_signup_allowed', {});
  return json({ open: r.open });
});

/**
 * Alta de anfitrión. La comprueba el SERVIDOR contra el ajuste del superadmin (registro abierto o correo invitado)
 * y crea la cuenta con la API de administración (clave de servicio), sin usar el registro público de Supabase: así se puede
 * desactivar «Allow new users to sign up» en Supabase → Authentication y la app sigue funcionando.
 */
export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  if (getRuntimeMode() !== 'supabase') throw new DomainError('invalid_input');
  limit(req, 'signup', req.headers.get('x-forwarded-for') ?? 'local', 10, 600_000);
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) throw new DomainError('invalid_input');
  const ctx = await getContext();
  const gate = await ctx.db.rpc<{ allowed: boolean }>('ss_signup_allowed', { email: body.data.email });
  if (!gate.allowed) throw new DomainError('signups_closed');
  const deps = getAuthMailDeps();
  const r = await signUpWithEmail(body.data.email, body.data.password, deps);
  if (r.status === 'confirmation_sent') return json({ ok: true, session: false, confirmation: true });
  // Sin correo propio la cuenta ya está confirmada: se inicia sesión en el servidor con las credenciales recién creadas.
  const cfg = getSupabaseConfig();
  const store = await cookies();
  const supabase = createServerClient(cfg.url, cfg.anonKey, {
    cookies: { getAll: () => store.getAll(), setAll: (list) => list.forEach(({ name, value, options }) => store.set(name, value, options)) },
  });
  const { data, error } = await supabase.auth.signInWithPassword(body.data);
  if (error) throw new DomainError('invalid_input', error.message, 400);
  return json({ ok: true, session: Boolean(data.session), confirmation: false });
});
