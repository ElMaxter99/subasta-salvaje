import { auditCloudflare, auditPollinations, type CloudflareAudit, type PollinationsAudit } from '@/lib/ai/audit';
import { cloudflareConfig, getImageProviderIds, pollinationsConfig } from '@/lib/config/env';
import type { AppContext } from './context';
import { effectiveQuota, getSettings } from './settings';

export interface AiAudit {
  generatedAt: string;
  configured: string[];
  pollinations: PollinationsAudit | null;
  cloudflare: CloudflareAudit | null;
  /** Lo que cuenta la propia app (no el proveedor): reservas de hoy por proveedor y topes vigentes. */
  local: { today: Record<string, number>; perDay: number; perGame: number; providerLimits: Record<string, number>; providersOff: string[] };
}

const TTL_MS = 60_000;
let cache: { at: number; value: AiAudit } | null = null;

/** Auditoría con caché de 60 s (cada consulta llama a las APIs de los proveedores). `force` la salta. */
export async function getAiAudit(ctx: Pick<AppContext, 'db'>, force = false): Promise<AiAudit> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const cf = cloudflareConfig();
  const pol = pollinationsConfig();
  const settings = await getSettings(ctx.db);
  const quota = effectiveQuota(settings);
  const [pollinations, cloudflare, today] = await Promise.all([
    pol ? auditPollinations(pol) : Promise.resolve(null),
    cf ? auditCloudflare(cf) : Promise.resolve(null),
    ctx.db.rpc<Record<string, number>>('ss_provider_usage', {}).catch(() => ({}) as Record<string, number>),
  ]);
  const value: AiAudit = {
    generatedAt: new Date().toISOString(),
    configured: getImageProviderIds(),
    pollinations,
    cloudflare,
    local: { today, perDay: quota.perDay, perGame: quota.perGame, providerLimits: settings.ai_provider_limits ?? {}, providersOff: settings.ai_providers_off ?? [] },
  };
  cache = { at: Date.now(), value };
  return value;
}
