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
  /** Superadmin: correo en SUPERADMIN_EMAILS (confirmado) o, en modo demo, el anfitrión local. */
  superadmin?: boolean;
}

export type HostDenial = 'blocked' | 'closed';

/** Segundo factor del superadmin: `enroll` = aún no tiene TOTP; `verify` = lo tiene pero no lo ha introducido en esta sesión. */
export type MfaPending = 'enroll' | 'verify';

/** ¿Se exige TOTP al superadmin? Opt-in con SUPERADMIN_REQUIRE_MFA=true (para no dejar a nadie fuera por sorpresa). */
export function superadminMfaRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  return /^(1|true|yes)$/i.test(env.SUPERADMIN_REQUIRE_MFA?.trim() ?? '');
}

/** Traduce el nivel de aseguramiento de Supabase (aal1/aal2) a lo que falta por hacer. null = ya está en aal2. */
export function mfaPendingFor(level: { currentLevel: string | null; nextLevel: string | null } | null): MfaPending | null {
  if (level?.currentLevel === 'aal2') return null;
  return level?.nextLevel === 'aal2' ? 'verify' : 'enroll';
}

/** Correos de superadmin (variable de entorno SUPERADMIN_EMAILS, separados por comas). */
export function superadminEmails(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.SUPERADMIN_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
}

// Caché corta del veredicto de acceso por usuario: evita una consulta a la BD en cada petición.
// Un bloqueo del superadmin se aplica al instante en este proceso (se vacía la caché) y en <20 s en los demás.
const ACCESS_TTL_MS = 20_000;
const accessCache = new Map<string, { at: number; denial: HostDenial | null }>();
export function clearHostAccessCache(): void {
  accessCache.clear();
}

async function hostDenial(user: { id: string; email: string | null }): Promise<HostDenial | null> {
  const hit = accessCache.get(user.id);
  if (hit && Date.now() - hit.at < ACCESS_TTL_MS) return hit.denial;
  const { getContext } = await import('@/lib/services/context');
  const ctx = await getContext();
  const r = await ctx.db.rpc<{ allowed: boolean; reason?: HostDenial }>('ss_host_access', { user_id: user.id, email: user.email });
  const denial = r.allowed ? null : (r.reason ?? 'closed');
  if (accessCache.size > 500) accessCache.clear();
  accessCache.set(user.id, { at: Date.now(), denial });
  return denial;
}

export interface HostResolution {
  identity: HostIdentity | null;
  /** Hay sesión de Supabase pero no se permite el acceso (cuenta bloqueada o registro cerrado sin invitación). */
  denial: HostDenial | null;
  email: string | null;
  /** Superadmin (por correo) al que le falta el segundo factor: no tiene poderes de admin hasta completarlo. */
  mfa?: MfaPending;
}

/** Resuelve quién es el anfitrión y si tiene acceso. */
export async function resolveHost(): Promise<HostResolution> {
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
    if (error || !data.user) return { identity: null, denial: null, email: null };
    const email = data.user.email ?? null;
    // Opcional: restringe quién puede ser anfitrión (evita que cualquiera con la URL gaste créditos de IA).
    const allowed = process.env.ALLOWED_HOST_EMAILS?.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
    const superEmail = Boolean(email && data.user.email_confirmed_at && superadminEmails().includes(email.toLowerCase()));
    // Con SUPERADMIN_REQUIRE_MFA, los poderes de admin exigen sesión aal2 (TOTP verificado). Como anfitrión normal sigue entrando.
    let mfa: MfaPending | undefined;
    if (superEmail && superadminMfaRequired()) {
      const aal = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      mfa = mfaPendingFor(aal.error ? null : aal.data) ?? undefined;
    }
    const superadmin = superEmail && !mfa;
    if (!superEmail && allowed?.length && !allowed.includes((email ?? '').toLowerCase())) return { identity: null, denial: 'closed', email };
    // El superadmin nunca queda fuera (ni por bloqueo ni por registro cerrado).
    const denial = superEmail ? null : await hostDenial({ id: data.user.id, email });
    if (denial) return { identity: null, denial, email };
    if (superEmail) await hostDenial({ id: data.user.id, email }).catch(() => undefined); // registra su perfil
    return { identity: { id: data.user.id, email, demo: false, superadmin }, denial: null, email, ...(mfa ? { mfa } : {}) };
  }
  if (mode === 'demo') {
    const v = store.get(DEMO_COOKIE)?.value;
    if (v && UUID.test(v)) return { identity: { id: v, email: null, demo: true, superadmin: true }, denial: null, email: null };
  }
  return { identity: null, denial: null, email: null };
}

/** Supabase Auth en producción; cookie de anfitrión de demostración en modo demo. */
export async function getHostIdentity(): Promise<HostIdentity | null> {
  return (await resolveHost()).identity;
}

export async function requireHost(): Promise<HostIdentity> {
  const id = await getHostIdentity();
  if (!id) throw new DomainError('unauthenticated');
  return id;
}

/** Solo el superadmin. Cualquier otro (o sin sesión) recibe «no encontrado» para no revelar que el panel existe. */
export async function requireSuperadmin(): Promise<HostIdentity> {
  const id = await getHostIdentity();
  if (!id?.superadmin) throw new DomainError('game_not_found');
  return id;
}
