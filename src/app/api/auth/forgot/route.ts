import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { z } from 'zod';
import { assertSameOrigin, handle, json, limit } from '@/lib/api';
import { getRuntimeMode, getSupabaseConfig } from '@/lib/config/env';
import { DomainError } from '@/lib/domain/errors';

const bodySchema = z.object({ email: z.string().trim().email().max(254) });

/** Origen público de la app (para el enlace del correo): cabeceras del proxy o, si no, el de la petición. */
function origin(req: Request): string {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  const proto = req.headers.get('x-forwarded-proto') ?? (host?.startsWith('localhost') ? 'http' : 'https');
  return host ? `${proto}://${host}` : new URL(req.url).origin;
}

/**
 * «He olvidado mi contraseña»: pide a Supabase Auth que envíe el correo de recuperación.
 * La respuesta es SIEMPRE la misma exista o no la cuenta (no revela qué correos están registrados) y se limita por IP y por correo.
 */
export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  if (getRuntimeMode() !== 'supabase') throw new DomainError('invalid_input', 'La recuperación de contraseña solo existe con Supabase Auth (en modo demo no hay contraseñas).', 400);
  const ip = req.headers.get('x-forwarded-for') ?? 'local';
  limit(req, 'forgot-ip', ip, 8, 600_000);
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) throw new DomainError('invalid_input', 'Escribe un correo electrónico válido.', 400);
  limit(req, 'forgot-mail', body.data.email.toLowerCase(), 3, 600_000);
  const cfg = getSupabaseConfig();
  const store = await cookies();
  const supabase = createServerClient(cfg.url, cfg.anonKey, {
    cookies: { getAll: () => store.getAll(), setAll: (list) => list.forEach(({ name, value, options }) => store.set(name, value, options)) },
  });
  const { error } = await supabase.auth.resetPasswordForEmail(body.data.email, { redirectTo: `${origin(req)}/auth/callback?next=/reset-password` });
  // Un fallo del proveedor se registra pero no se distingue de un éxito (evita enumerar cuentas); el límite de envíos de Supabase sí se avisa.
  if (error && /rate/i.test(error.message)) throw new DomainError('rate_limited');
  return json({ ok: true });
});
