import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { getRuntimeMode, getSupabaseConfig } from '@/lib/config/env';

/** Refresca la sesión de Supabase Auth (cookies) en cada navegación. En modo demo no hace nada. */
export async function proxy(request: NextRequest) {
  if (getRuntimeMode() !== 'supabase') return NextResponse.next();
  let response = NextResponse.next({ request });
  const cfg = getSupabaseConfig();
  const supabase = createServerClient(cfg.url, cfg.anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/demo-images|api/public|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
