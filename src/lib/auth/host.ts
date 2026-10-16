import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { getRuntimeMode, getSupabaseConfig } from '@/lib/config/env';
import { DomainError } from '@/lib/domain/errors';

export const DEMO_COOKIE = 'ss_demo_host';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface HostIdentity {
  id: string;
  email: string | null;
  demo: boolean;
}

/** Supabase Auth en producción; cookie de anfitrión de demostración en modo demo. */
export async function getHostIdentity(): Promise<HostIdentity | null> {
  const mode = getRuntimeMode();
  const store = await cookies();
  if (mode === 'supabase') {
    const cfg = getSupabaseConfig();
    const supabase = createServerClient(cfg.url, cfg.anonKey, {
      cookies: {
        getAll: () => store.getAll(),
        // En Server Components no se pueden escribir cookies; el proxy refresca la sesión.
        setAll: (list) => {
          try {
            list.forEach(({ name, value, options }) => store.set(name, value, options));
          } catch {
            /* contexto de solo lectura */
          }
        },
      },
    });
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;
    return { id: data.user.id, email: data.user.email ?? null, demo: false };
  }
  if (mode === 'demo') {
    const v = store.get(DEMO_COOKIE)?.value;
    if (v && UUID.test(v)) return { id: v, email: null, demo: true };
  }
  return null;
}

export async function requireHost(): Promise<HostIdentity> {
  const id = await getHostIdentity();
  if (!id) throw new DomainError('unauthenticated');
  return id;
}
