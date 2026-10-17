import type { ProviderGate } from '@/lib/ai/chain';
import type { Db } from '@/lib/db/types';
import { getSettings } from './settings';

const USAGE_TTL_MS = 15_000;

/**
 * Filtro de la cadena de proveedores según los ajustes del superadmin: proveedor apagado o tope diario alcanzado.
 * El tope por proveedor es BLANDO (se consulta el uso con una caché de 15 s, así que con trabajos simultáneos puede
 * pasarse por poco); el tope global duro está en SQL (`ss_reserve_image_quota`).
 */
export function createSettingsGate(db: Db, now: () => number = Date.now): ProviderGate {
  let usage: { at: number; value: Record<string, number> } | null = null;
  const todayUsage = async () => {
    if (!usage || now() - usage.at > USAGE_TTL_MS) usage = { at: now(), value: await db.rpc<Record<string, number>>('ss_provider_usage', {}) };
    return usage.value;
  };
  return async (id) => {
    const s = await getSettings(db);
    if ((s.ai_providers_off ?? []).includes(id)) return { ok: false, reason: 'disabled' };
    const limit = (s.ai_provider_limits ?? {})[id];
    if (limit && ((await todayUsage())[id] ?? 0) >= limit) return { ok: false, reason: 'day_limit' };
    return { ok: true };
  };
}
