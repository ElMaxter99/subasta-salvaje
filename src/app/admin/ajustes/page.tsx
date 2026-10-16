import { requireSuperadmin } from '@/lib/auth/host';
import { getContext } from '@/lib/services/context';
import { adminSettings } from '@/lib/services/admin-service';
import { SettingsForm } from '@/components/admin/settings-form';
import { gameTtlHours, getImageProviderId, quotaConfig } from '@/lib/config/env';

export const metadata = { title: 'Superadmin · Ajustes' };

export default async function SettingsPage() {
  await requireSuperadmin();
  const settings = await adminSettings(await getContext());
  const q = quotaConfig();
  return <SettingsForm settings={settings} defaults={{ ttlHours: gameTtlHours(), perGame: q.perGame, perDay: q.perDay }} aiConfigured={getImageProviderId() !== null} />;
}
