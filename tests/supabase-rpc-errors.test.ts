import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseDb } from '@/lib/db/supabase';

const fake = (error: { code?: string; message: string }) => ({ rpc: async () => ({ data: null, error }) }) as unknown as SupabaseClient;

describe('errores de Supabase RPC', () => {
  it('una función inexistente (migración sin aplicar) se explica en vez de «error interno»', async () => {
    const db = createSupabaseDb(fake({ code: 'PGRST202', message: 'Could not find the function public.ss_set_sound(p) in the schema cache' }));
    await expect(db.rpc('ss_set_sound', {})).rejects.toMatchObject({ code: 'migration_pending', status: 501, message: expect.stringContaining('ss_set_sound') });
  });
});
