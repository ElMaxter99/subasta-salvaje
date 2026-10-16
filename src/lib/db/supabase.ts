import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseConfig } from '@/lib/config/env';
import { DomainError, toDomainError } from '@/lib/domain/errors';
import { assertFnName, type Db } from './types';
import { redactSecrets } from '@/lib/security/redact';

let admin: SupabaseClient | null = null;

/** Cliente con service_role. SOLO servidor. */
export function getSupabaseAdmin(): SupabaseClient {
  if (!admin) {
    const cfg = getSupabaseConfig();
    admin = createClient(cfg.url, cfg.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return admin;
}

export function createSupabaseDb(client: SupabaseClient = getSupabaseAdmin()): Db {
  return {
    async rpc<T>(fn: string, params: Record<string, unknown>): Promise<T> {
      assertFnName(fn);
      const { data, error } = await client.rpc(fn, { p: params });
      if (error) {
        // PGRST202 = la función no existe en la base de datos: faltan migraciones por aplicar (se dice claro en vez de «error interno»).
        if (error.code === 'PGRST202' || /could not find the function/i.test(error.message ?? '')) {
          console.error('[supabase-rpc] función inexistente:', fn);
          throw new DomainError('migration_pending', `Falta aplicar una migración de la base de datos (función ${fn}). Ejecuta «npx supabase db push» y, en el SQL Editor, «notify pgrst, 'reload schema';».`, 501);
        }
        const d = toDomainError(error);
        // Códigos típicos: PGRST202 (función inexistente: faltan migraciones), 42501 (permisos), 401/JWT (clave).
        if (d.code === 'internal') console.error('[supabase-rpc]', fn, error.code, redactSecrets(error.message));
        throw d;
      }
      return data as T;
    },
  };
}
