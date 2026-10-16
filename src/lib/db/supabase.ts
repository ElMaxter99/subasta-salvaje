import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseConfig } from '@/lib/config/env';
import { toDomainError } from '@/lib/domain/errors';
import { assertFnName, type Db } from './types';

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
      if (error) throw toDomainError(error);
      return data as T;
    },
  };
}
