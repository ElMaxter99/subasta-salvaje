import { z } from 'zod';
import { handle, limit } from '@/lib/api';
import { requireSuperadmin } from '@/lib/auth/host';
import { DomainError } from '@/lib/domain/errors';
import { getContext } from '@/lib/services/context';
import { exportErrorsCsv, exportUsageCsv } from '@/lib/services/observability-service';

export const dynamic = 'force-dynamic';

const q = z.object({ kind: z.enum(['errors', 'usage']), status: z.enum(['', 'open', 'new', 'seen', 'resolved']).optional(), source: z.enum(['', 'server', 'client', 'job', 'cron']).optional() });

/** Exportación CSV (GET, solo superadmin): `?kind=errors|usage`. */
export const GET = handle(async (req: Request) => {
  const admin = await requireSuperadmin();
  limit(req, 'admin-export', admin.id, 20);
  const url = new URL(req.url);
  const parsed = q.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) throw new DomainError('invalid_input');
  const ctx = await getContext();
  const body = parsed.data.kind === 'errors' ? await exportErrorsCsv(ctx, { status: parsed.data.status, source: parsed.data.source }) : await exportUsageCsv(ctx);
  return new Response(body, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="observabilidad-${parsed.data.kind}.csv"`, 'Cache-Control': 'no-store' } });
});
