import { gameTtlHours, quotaConfig, type QuotaConfig } from '@/lib/config/env';
import type { Db } from '@/lib/db/types';

/** Ajustes editables en caliente por el superadmin (tabla app_settings). Las variables de entorno sólo son el respaldo. */
export interface AppSettings {
  signups_open: boolean;
  game_ttl_hours: number | null;
  ai_enabled: boolean;
  quota_per_game: number | null;
  quota_per_day: number | null;
}

const TTL_MS = 5_000;
const cache = new WeakMap<Db, { at: number; value: AppSettings }>();

export async function getSettings(db: Db): Promise<AppSettings> {
  const hit = cache.get(db);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = await db.rpc<AppSettings>('ss_settings_get', {});
  cache.set(db, { at: Date.now(), value });
  return value;
}

export function invalidateSettings(db: Db): void {
  cache.delete(db);
}

/** Horas de inactividad antes de borrar una partida: ajuste del superadmin > GAME_TTL_HOURS > 168 (7 días). */
export const effectiveTtlHours = (s: AppSettings): number => s.game_ttl_hours ?? gameTtlHours();

/** Cuotas efectivas: ajuste del superadmin > variables de entorno > 10 por partida / 50 por día. */
export const effectiveQuota = (s: AppSettings): QuotaConfig => {
  const env = quotaConfig();
  return { perGame: s.quota_per_game ?? env.perGame, perDay: s.quota_per_day ?? env.perDay };
};
