import { StatsView } from '@/components/admin/stats-view';
import { requireSuperadmin } from '@/lib/auth/host';
import { getAdminStats } from '@/lib/services/admin-stats-service';
import { getContext } from '@/lib/services/context';

export const metadata = { title: 'Superadmin · Estadísticas' };
export const dynamic = 'force-dynamic';

export default async function StatsPage() {
  await requireSuperadmin();
  return <StatsView stats={await getAdminStats(await getContext())} />;
}
