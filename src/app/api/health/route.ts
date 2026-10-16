import { json } from '@/lib/api';
import { getRuntimeMode } from '@/lib/config/env';
import { getSupabaseAdmin } from '@/lib/db/supabase';
import { getContext } from '@/lib/services/context';

export const dynamic = 'force-dynamic';

/** Diagnóstico de despliegue: prueba BD (funciones ss_*) y Storage. No expone secretos. */
export async function GET() {
  const mode = getRuntimeMode();
  if (mode === 'unconfigured') return json({ ok: false, mode, problem: 'Faltan variables de entorno (ver /setup)' }, { status: 503 });
  const checks: Record<string, { ok: boolean; detail?: string }> = {};
  try {
    const ctx = await getContext();
    if (mode === 'supabase') {
      // Llamada directa para ver el error REAL de PostgREST (código y mensaje), sin enmascarar.
      const { data, error } = await getSupabaseAdmin().rpc('ss_list_games', { p: { host_id: '00000000-0000-0000-0000-000000000000' } });
      checks.database = error
        ? { ok: false, detail: `${error.code ?? ''} ${error.message}${error.hint ? ` · pista: ${error.hint}` : ''}`.slice(0, 400) }
        : { ok: Array.isArray(data) };
    } else {
      try {
        await ctx.db.rpc('ss_list_games', { host_id: '00000000-0000-0000-0000-000000000000' });
        checks.database = { ok: true };
      } catch (e) {
        checks.database = { ok: false, detail: String((e as Error).message).slice(0, 300) };
      }
    }
    if (mode === 'supabase') {
      try {
        await ctx.storage.get('__health__/none.png');
      } catch (e) {
        const m = String((e as Error).message);
        // "no encontrado" significa que el bucket existe y es accesible; otros errores indican bucket/clave mal.
        checks.storage = /not found|no encontrado|does not exist|Object not found/i.test(m) && !/bucket/i.test(m)
          ? { ok: true }
          : { ok: false, detail: m.slice(0, 300) };
      }
    }
  } catch (e) {
    checks.context = { ok: false, detail: String((e as Error).message).slice(0, 300) };
  }
  const ok = Object.values(checks).every((c) => c.ok);
  return json({ ok, mode, checks }, { status: ok ? 200 : 503 });
}
