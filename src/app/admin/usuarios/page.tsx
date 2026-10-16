import { requireSuperadmin } from '@/lib/auth/host';
import { getContext } from '@/lib/services/context';
import { adminSettings, adminUsers } from '@/lib/services/admin-service';
import { UsersPanel } from '@/components/admin/users-panel';

export const metadata = { title: 'Superadmin · Usuarios' };

export default async function UsersPage() {
  const admin = await requireSuperadmin();
  const ctx = await getContext();
  const [{ users, invites }, settings] = await Promise.all([adminUsers(ctx), adminSettings(ctx)]);
  return <UsersPanel users={users} invites={invites} signupsOpen={settings.signups_open} meId={admin.id} />;
}
