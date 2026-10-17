import { requireSuperadmin } from '@/lib/auth/host';
import { getContext } from '@/lib/services/context';
import { adminSettings } from '@/lib/services/admin-service';
import { SettingsForm } from '@/components/admin/settings-form';
import { gameTtlHours, getImageProviderIds, quotaConfig } from '@/lib/config/env';

export const metadata = { title: 'Superadmin · Ajustes' };

export default async function SettingsPage() {
  await requireSuperadmin();
  const ctx = await getContext();
  const settings = await adminSettings(ctx);
  const q = quotaConfig();
  const configured = getImageProviderIds();
  const usage = configured.length > 0 ? await ctx.db.rpc<Record<string, number>>('ss_provider_usage', {}).catch(() => ({})) : {};
  return (
    <SettingsForm
      settings={settings}
      defaults={{ ttlHours: gameTtlHours(), perGame: q.perGame, perDay: q.perDay }}
      aiConfigured={configured.length > 0}
      providers={configured.map((id) => ({ id, used: (usage as Record<string, number>)[id] ?? 0 }))}
    />
  );
}
