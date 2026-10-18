import { ObservabilityView } from '@/components/admin/observability-view';
import { requireSuperadmin, superadminEmails } from '@/lib/auth/host';
import { mailStatus } from '@/lib/mail';
import { getAdminStats } from '@/lib/services/admin-stats-service';
import { getContext } from '@/lib/services/context';
import { observabilityErrors, observabilityOverview } from '@/lib/services/observability-service';

export const metadata = { title: 'Superadmin · Observabilidad' };
export const dynamic = 'force-dynamic';

const pick = (v: string | string[] | undefined, allowed: string[]) => {
  const s = Array.isArray(v) ? v[0] : v;
  return s && allowed.includes(s) ? s : '';
};

export default async function ObservabilityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireSuperadmin();
  const sp = await searchParams;
  const filter = {
    status: pick(sp.status, ['open', 'new', 'seen', 'resolved']),
    source: pick(sp.source, ['server', 'client', 'job', 'cron']),
    severity: pick(sp.severity, ['high', 'low']),
    q: (Array.isArray(sp.q) ? sp.q[0] : sp.q)?.slice(0, 100) ?? '',
  };
  const ctx = await getContext();
  const [overview, errors, stats] = await Promise.all([
    observabilityOverview(ctx),
    observabilityErrors(ctx, { ...filter, limit: 200 }),
    getAdminStats(ctx).catch(() => null),
  ]);
  return <ObservabilityView overview={overview} errors={errors} filter={filter} mail={{ configured: mailStatus().configured, recipients: superadminEmails().length }} ai={stats?.ai.byProvider ?? []} />;
}
