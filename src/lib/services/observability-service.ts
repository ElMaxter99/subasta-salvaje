import { z } from 'zod';
import { DomainError } from '@/lib/domain/errors';
import { maybeSendAlert, type ObsAlert } from '@/lib/observability/alerts';
import { flushMetrics } from '@/lib/observability/record';
import type { AppContext } from './context';

type Ctx = Pick<AppContext, 'db'>;

export interface ObsFamily { family: string; total: number; s2xx: number; s4xx: number; s429: number; s5xx: number; p50: number | null; p95: number | null }
export interface ObsOverview {
  errors_24h: number;
  errors_7d: number;
  groups_open: number;
  groups_new: number;
  requests_7d: number;
  status_5xx_7d: number;
  status_429_7d: number;
  rate_5xx: number;
  families: ObsFamily[];
  series: { day: string; metric: string; value: number }[];
  alerts: ObsAlert[];
  config: { retention_days: number; alert_email: boolean; max_groups: number };
  domain_errors: { code: string; n: number }[];
}
export interface ObsError {
  fingerprint: string;
  source: 'server' | 'client' | 'job' | 'cron';
  route: string;
  code: string;
  message: string;
  stack: string;
  room_code: string | null;
  release: string;
  env: string;
  severity: 'high' | 'low';
  status: 'new' | 'seen' | 'resolved';
  total: number;
  first_at: string;
  last_at: string;
  count_24h: number;
  count_7d: number;
}

const filterSchema = z.object({
  status: z.enum(['', 'open', 'new', 'seen', 'resolved']).optional(),
  source: z.enum(['', 'server', 'client', 'job', 'cron']).optional(),
  severity: z.enum(['', 'high', 'low']).optional(),
  q: z.string().max(100).optional(),
  limit: z.number().int().min(1).max(500).optional(),
});
export type ObsFilter = z.infer<typeof filterSchema>;

/** Vuelca los contadores pendientes de esta instancia y calcula las métricas de juego de hoy/ayer antes de leer (ambas cosas son tolerantes a fallos). */
export async function refreshObservability(ctx: Ctx): Promise<void> {
  await flushMetrics(ctx.db).catch(() => false);
  await ctx.db.rpc('ss_obs_rollup', { days: 2 }).catch(() => undefined);
}

export async function observabilityOverview(ctx: Ctx): Promise<ObsOverview> {
  await refreshObservability(ctx);
  return ctx.db.rpc<ObsOverview>('ss_obs_overview', {});
}

export async function observabilityErrors(ctx: Ctx, raw: unknown = {}): Promise<ObsError[]> {
  const f = filterSchema.safeParse(raw);
  if (!f.success) throw new DomainError('invalid_input');
  return ctx.db.rpc<ObsError[]>('ss_obs_error_list', { ...f.data });
}

const statusOp = z.object({ op: z.literal('status'), fingerprint: z.string().regex(/^([0-9a-f]{32}|\*)$/), status: z.enum(['new', 'seen', 'resolved']) });
const settingOp = z.discriminatedUnion('key', [
  z.object({ op: z.literal('setting'), key: z.literal('obs_alert_email'), value: z.boolean() }),
  z.object({ op: z.literal('setting'), key: z.literal('obs_retention_days'), value: z.number().int().min(1).max(365) }),
]);
const purgeOp = z.object({ op: z.literal('purge') });
const op = z.union([statusOp, settingOp, purgeOp]);

/** Acciones del superadmin (todas auditadas en SQL). */
export async function observabilityOp(ctx: Ctx, actor: string, raw: unknown): Promise<Record<string, unknown>> {
  const parsed = op.safeParse(raw);
  if (!parsed.success) throw new DomainError('invalid_input');
  const o = parsed.data;
  if (o.op === 'status') return ctx.db.rpc('ss_obs_error_set_status', { fingerprint: o.fingerprint, status: o.status, actor });
  if (o.op === 'setting') return ctx.db.rpc('ss_obs_setting_set', { key: o.key, value: o.value, actor });
  const r = await ctx.db.rpc<Record<string, unknown>>('ss_obs_purge', {});
  await ctx.db.rpc('ss_admin_log', { actor, action: 'observability_purged', target_type: 'app_error', payload: r });
  return r;
}

/** Mantenimiento diario (cron): volcado, métricas de juego, purga y correo-resumen opcional. Nunca lanza. */
export async function runObservabilityMaintenance(ctx: Ctx): Promise<{ purged?: Record<string, unknown>; emails: number; ok: boolean }> {
  try {
    await flushMetrics(ctx.db);
    await ctx.db.rpc('ss_obs_rollup', { days: 3 });
    const purged = await ctx.db.rpc<Record<string, unknown>>('ss_obs_purge', {});
    const emails = await maybeSendAlert(ctx.db);
    return { purged, emails, ok: true };
  } catch {
    return { emails: 0, ok: false };
  }
}

/* ---------- CSV (con defensa contra inyección de fórmulas en hojas de cálculo) ---------- */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const toCsv = (head: string[], rows: unknown[][]): string => `﻿${[head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;

export async function exportErrorsCsv(ctx: Ctx, filter: ObsFilter = {}): Promise<string> {
  const rows = await observabilityErrors(ctx, { ...filter, limit: 500 });
  return toCsv(['huella', 'origen', 'ruta', 'codigo', 'gravedad', 'estado', 'repeticiones_total', 'repeticiones_24h', 'repeticiones_7d', 'primera_vez', 'ultima_vez', 'sala', 'version', 'entorno', 'mensaje'],
    rows.map((e) => [e.fingerprint, e.source, e.route, e.code, e.severity, e.status, e.total, e.count_24h, e.count_7d, e.first_at, e.last_at, e.room_code, e.release, e.env, e.message]));
}
export async function exportUsageCsv(ctx: Ctx): Promise<string> {
  const ov = await observabilityOverview(ctx);
  return toCsv(['dia', 'metrica', 'valor'], ov.series.map((s) => [s.day, s.metric, s.value]));
}
