import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import type { EmailOtpType } from '@supabase/supabase-js';
import { getRuntimeMode, getSupabaseConfig } from '@/lib/config/env';

const OTP_TYPES = new Set<EmailOtpType>(['signup', 'invite', 'magiclink', 'recovery', 'email_change', 'email']);

/** Solo rutas internas: evita redirecciones abiertas. */
export function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.includes('\\') ? next : '/';
}

/**
 * Destino de los enlaces de los correos de Supabase (recuperar contraseña, confirmar correo…).
 * Acepta `token_hash` + `type` (las plantillas de `supabase/templates`, válidas aunque se abra en otro dispositivo) o `code` (PKCE),
 * crea la sesión y redirige a `next`. Si el enlace no es válido o caducó, vuelve al login con un aviso.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const next = safeNext(url.searchParams.get('next'));
  const code = url.searchParams.get('code');
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') as EmailOtpType | null;
  const byHash = Boolean(tokenHash && type && OTP_TYPES.has(type));
  if (getRuntimeMode() !== 'supabase' || (!code && !byHash)) return NextResponse.redirect(new URL('/login?link=invalid', url.origin));
  const cfg = getSupabaseConfig();
  const store = await cookies();
  const supabase = createServerClient(cfg.url, cfg.anonKey, {
    cookies: { getAll: () => store.getAll(), setAll: (list) => list.forEach(({ name, value, options }) => store.set(name, value, options)) },
  });
  const { error } = byHash ? await supabase.auth.verifyOtp({ type: type!, token_hash: tokenHash! }) : await supabase.auth.exchangeCodeForSession(code!);
  if (error) return NextResponse.redirect(new URL('/login?link=invalid', url.origin));
  return NextResponse.redirect(new URL(next, url.origin));
}
