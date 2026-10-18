import { requireSuperadmin } from '@/lib/auth/host';
import { getContext } from '@/lib/services/context';
import { adminSettings } from '@/lib/services/admin-service';
import { SettingsForm } from '@/components/admin/settings-form';
import { Section } from '@/components/admin/widgets';
import { ObsSettingsControls } from '@/components/admin/observability-controls';
import { superadminEmails } from '@/lib/auth/host';
import { mailStatus } from '@/lib/mail';
import { gameTtlHours, getImageProviderIds, quotaConfig } from '@/lib/config/env';

export const metadata = { title: 'Superadmin · Ajustes' };

export default async function SettingsPage() {
  await requireSuperadmin();
  const ctx = await getContext();
  const settings = await adminSettings(ctx);
  const q = quotaConfig();
  const configured = getImageProviderIds();
  const usage = configured.length > 0 ? await ctx.db.rpc<Record<string, number>>('ss_provider_usage', {}).catch(() => ({})) : {};
  const obs = await ctx.db.rpc<{ retention_days: number; alert_email: boolean }>('ss_obs_cfg', {}).catch(() => ({ retention_days: 30, alert_email: false }));
  return (
    <div className="space-y-5">
    <SettingsForm
      settings={settings}
      defaults={{ ttlHours: gameTtlHours(), perGame: q.perGame, perDay: q.perDay }}
      aiConfigured={configured.length > 0}
      providers={configured.map((id) => ({ id, used: (usage as Record<string, number>)[id] ?? 0 }))}
    />
    <Section title="Observabilidad: alertas por correo" hint="Opcional y desactivado por defecto. Los errores y métricas están en Superadmin → Observabilidad.">
      <ObsSettingsControls alertEmail={obs.alert_email} retentionDays={obs.retention_days} mailConfigured={mailStatus().configured} recipients={superadminEmails().length} />
    </Section>
    </div>
  );
}
