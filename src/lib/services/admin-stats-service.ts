import type { AppContext } from './context';
import { effectiveQuota, getSettings } from './settings';

type Ctx = Pick<AppContext, 'db'>;

export interface AdminStats {
  generatedAt: string;
  games: { total: number; perDay: { day: string; count: number }[]; byStatus: Record<string, number> };
  templates: { slug: string; title: string; games: number; last_at: string }[];
  ai: {
    perDay: { day: string; provider: string; ok: number; failed: number }[];
    byProvider: { provider: string; ok: number; failed: number }[];
    jobs: Record<string, number>;
    usageToday: Record<string, number>;
    usageTodayTotal: number;
    dayLimit: number;
  };
}

/** Estadísticas de solo lectura del panel de superadmin (todo sale de funciones SQL `ss_admin_stats_*`). Los días son UTC. */
export async function getAdminStats(ctx: Ctx): Promise<AdminStats> {
  const [games, templates, ai, settings] = await Promise.all([
    ctx.db.rpc<{ total: number; per_day: { day: string; count: number }[]; by_status: Record<string, number> }>('ss_admin_stats_games', {}),
    ctx.db.rpc<AdminStats['templates']>('ss_admin_stats_templates', {}),
    ctx.db.rpc<{ per_day: AdminStats['ai']['perDay']; by_provider: AdminStats['ai']['byProvider']; jobs: Record<string, number>; usage_today: Record<string, number>; usage_today_total: number }>('ss_admin_stats_ai', {}),
    getSettings(ctx.db),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    games: { total: games.total, perDay: games.per_day, byStatus: games.by_status },
    templates,
    ai: { perDay: ai.per_day, byProvider: ai.by_provider, jobs: ai.jobs, usageToday: ai.usage_today, usageTodayTotal: ai.usage_today_total, dayLimit: effectiveQuota(settings).perDay },
  };
}
