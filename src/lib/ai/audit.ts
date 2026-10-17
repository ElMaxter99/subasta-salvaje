import type { CloudflareConfig, PollinationsConfig } from '@/lib/config/env';
import { redactSecrets } from '@/lib/security/redact';

/**
 * Auditoría de proveedores de IA: consulta, con las propias credenciales del servidor y SOLO en lectura, lo que cada
 * proveedor dice del uso y del presupuesto de la clave. Nunca devuelve credenciales. Cada consulta falla por separado y
 * el resultado es parcial (con los errores a la vista) en lugar de romper el panel.
 *
 *  · Pollinations — endpoints documentados en APIDOCS.md: GET /account/key, /account/balance, /account/key/usage.
 *  · Cloudflare — GraphQL Analytics API, conjunto `aiInferenceAdaptiveGroups` (campo `totalNeurons`). Los nombres de
 *    campos vienen de ejemplos de terceros, NO de la documentación oficial: si Cloudflare los rechaza, el error se muestra.
 *    El token necesita el permiso «Account Analytics: Read».
 */
export interface AuditOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

export interface DayPoint { date: string; requests: number; amount: number }
export interface ModelPoint { model: string; requests: number; amount: number }

export interface PollinationsAudit {
  provider: 'pollinations';
  errors: string[];
  key?: { name: string | null; type: string | null; valid: boolean; expiresAt: string | null; pollenBudget: number | null; permissions: { models: string[] | null; account: string[] | null } };
  /** Pollen restante de la clave (si tiene presupuesto) o de la cuenta. */
  balance?: { remaining: number; total: number | null; paid: number | null; tier: number | null };
  usage?: {
    requests24h: number; requests7d: number; requests30d: number;
    costUsd24h: number; costUsd7d: number; costUsd30d: number;
    avgCostUsd: number | null;
    byModel: ModelPoint[];
    byDay: DayPoint[];
    /** true si la lista llegó cortada por el límite de filas (las cifras serían un mínimo). */
    truncated: boolean;
  };
  /** Imágenes que quedarían con el pollen restante al coste medio observado (estimación). */
  estimatedImagesLeft: number | null;
}

export interface CloudflareAudit {
  provider: 'cloudflare';
  errors: string[];
  freeNeuronsPerDay: number;
  today?: { neurons: number; calls: number };
  last7d?: { neurons: number; calls: number };
  byModel?: ModelPoint[];
  byDay?: DayPoint[];
  remainingToday?: number;
  /** Neuronas medias por llamada hoy, a partir de las llamadas medidas por Cloudflare. */
  neuronsPerCall?: number | null;
}

export const CLOUDFLARE_FREE_NEURONS = 10_000;

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

async function getJson(f: typeof fetch, url: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  let res: Response;
  try {
    res = await f(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    throw new Error(`sin conexión (${redactSecrets((e as Error).message)})`);
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${redactSecrets(text.slice(0, 200))}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('respuesta que no es JSON');
  }
}

export async function auditPollinations(cfg: PollinationsConfig, opts: AuditOptions = {}): Promise<PollinationsAudit> {
  const f = opts.fetchImpl ?? fetch;
  const now = (opts.now ?? Date.now)();
  const t = opts.timeoutMs ?? 8000;
  const base = 'https://gen.pollinations.ai';
  const headers = { Authorization: `Bearer ${cfg.apiKey}` };
  const out: PollinationsAudit = { provider: 'pollinations', errors: [], estimatedImagesLeft: null };
  const LIMIT = 5000;

  const [keyR, balR, useR] = await Promise.allSettled([
    getJson(f, `${base}/account/key`, { headers }, t),
    getJson(f, `${base}/account/balance`, { headers }, t),
    getJson(f, `${base}/account/key/usage?format=json&days=30&limit=${LIMIT}`, { headers }, t),
  ]);

  if (keyR.status === 'fulfilled') {
    const k = keyR.value as Record<string, unknown>;
    const perm = (k.permissions ?? {}) as Record<string, unknown>;
    const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null);
    out.key = {
      name: str(k.name),
      type: str(k.type),
      valid: k.valid === true,
      expiresAt: str(k.expiresAt),
      pollenBudget: typeof k.pollenBudget === 'number' ? k.pollenBudget : null,
      permissions: { models: list(perm.models), account: list(perm.account) },
    };
  } else out.errors.push(`Clave: ${(keyR.reason as Error).message}`);

  if (balR.status === 'fulfilled') {
    const b = balR.value as Record<string, unknown>;
    const acc = (b.accountBalance ?? null) as Record<string, unknown> | null;
    out.balance = { remaining: num(b.balance), total: acc ? num(acc.total) : null, paid: acc ? num(acc.paid) : null, tier: acc ? num(acc.tier) : null };
  } else out.errors.push(`Saldo: ${(balR.reason as Error).message}`);

  if (useR.status === 'fulfilled') {
    const rows = ((useR.value as { usage?: unknown[] }).usage ?? []) as Record<string, unknown>[];
    const day = 86_400_000;
    const agg = { r24: 0, r7: 0, r30: 0, c24: 0, c7: 0, c30: 0 };
    const models = new Map<string, ModelPoint>();
    const days = new Map<string, DayPoint>();
    for (const r of rows) {
      const ts = Date.parse(String(r.timestamp));
      if (!Number.isFinite(ts)) continue;
      const cost = num(r.cost_usd);
      const age = now - ts;
      agg.r30++; agg.c30 += cost;
      if (age <= 7 * day) { agg.r7++; agg.c7 += cost; }
      if (age <= day) { agg.r24++; agg.c24 += cost; }
      const model = str(r.model) ?? 'desconocido';
      const m = models.get(model) ?? { model, requests: 0, amount: 0 };
      m.requests++; m.amount += cost; models.set(model, m);
      const date = new Date(ts).toISOString().slice(0, 10);
      const d = days.get(date) ?? { date, requests: 0, amount: 0 };
      d.requests++; d.amount += cost; days.set(date, d);
    }
    out.usage = {
      requests24h: agg.r24, requests7d: agg.r7, requests30d: agg.r30,
      costUsd24h: round(agg.c24), costUsd7d: round(agg.c7), costUsd30d: round(agg.c30),
      avgCostUsd: agg.r30 > 0 && agg.c30 > 0 ? round(agg.c30 / agg.r30, 6) : null,
      byModel: [...models.values()].map((m) => ({ ...m, amount: round(m.amount) })).sort((a, b) => b.requests - a.requests),
      byDay: [...days.values()].map((d) => ({ ...d, amount: round(d.amount) })).sort((a, b) => a.date.localeCompare(b.date)),
      truncated: rows.length >= LIMIT,
    };
  } else out.errors.push(`Uso: ${(useR.reason as Error).message}`);

  // Estimación: el pollen restante entre el coste medio por petición. Pollen y USD no son la misma unidad garantizada,
  // por eso es solo orientativo (el panel lo indica); el mensaje de error de Pollinations daba ~0,002 pollen por imagen.
  if (out.balance && out.usage?.avgCostUsd) out.estimatedImagesLeft = Math.floor(out.balance.remaining / out.usage.avgCostUsd);
  return out;
}

const CF_QUERY = `query WorkersAiUsage($accountTag: string!, $since: Time!, $until: Time!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      aiInferenceAdaptiveGroups(limit: 5000, filter: { datetime_geq: $since, datetime_leq: $until }) {
        count
        sum { totalNeurons }
        dimensions { modelId datetimeHour }
      }
    }
  }
}`;

export async function auditCloudflare(cfg: CloudflareConfig, opts: AuditOptions = {}): Promise<CloudflareAudit> {
  const f = opts.fetchImpl ?? fetch;
  const now = (opts.now ?? Date.now)();
  const out: CloudflareAudit = { provider: 'cloudflare', errors: [], freeNeuronsPerDay: CLOUDFLARE_FREE_NEURONS };
  let json: { data?: { viewer?: { accounts?: { aiInferenceAdaptiveGroups?: Record<string, unknown>[] }[] } }; errors?: { message?: string }[] };
  try {
    json = (await getJson(
      f,
      'https://api.cloudflare.com/client/v4/graphql',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.apiToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: CF_QUERY, variables: { accountTag: cfg.accountId, since: new Date(now - 7 * 86_400_000).toISOString(), until: new Date(now).toISOString() } }),
      },
      opts.timeoutMs ?? 10_000,
    )) as typeof json;
  } catch (e) {
    out.errors.push(`Analytics: ${(e as Error).message}. Comprueba que el token tiene el permiso «Account Analytics: Read».`);
    return out;
  }
  if (json.errors?.length) {
    out.errors.push(`Analytics: ${redactSecrets(json.errors.map((e) => e.message ?? 'error').join('; ').slice(0, 300))}. Los nombres de campo de esta consulta no están verificados con la documentación oficial.`);
    return out;
  }
  const groups = json.data?.viewer?.accounts?.[0]?.aiInferenceAdaptiveGroups ?? [];
  const today = new Date(now).toISOString().slice(0, 10);
  const models = new Map<string, ModelPoint>();
  const days = new Map<string, DayPoint>();
  const t = { neurons: 0, calls: 0 }, w = { neurons: 0, calls: 0 };
  for (const g of groups) {
    const dims = (g.dimensions ?? {}) as Record<string, unknown>;
    const neurons = num(((g.sum ?? {}) as Record<string, unknown>).totalNeurons);
    const calls = num(g.count);
    const date = (str(dims.datetimeHour) ?? '').slice(0, 10);
    const model = str(dims.modelId) ?? 'desconocido';
    w.neurons += neurons; w.calls += calls;
    if (date === today) { t.neurons += neurons; t.calls += calls; }
    const m = models.get(model) ?? { model, requests: 0, amount: 0 };
    m.requests += calls; m.amount += neurons; models.set(model, m);
    if (date) {
      const d = days.get(date) ?? { date, requests: 0, amount: 0 };
      d.requests += calls; d.amount += neurons; days.set(date, d);
    }
  }
  out.today = t;
  out.last7d = w;
  out.remainingToday = Math.max(0, CLOUDFLARE_FREE_NEURONS - t.neurons);
  out.neuronsPerCall = t.calls > 0 ? Math.round(t.neurons / t.calls) : null;
  out.byModel = [...models.values()].sort((a, b) => b.amount - a.amount);
  out.byDay = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

/**
 * Tope diario de llamadas recomendado a partir de lo medido: deja un 10 % de margen sobre las neuronas gratuitas.
 * null si aún no hay datos suficientes (sin llamadas hoy).
 */
export function suggestDailyCalls(neuronsPerCall: number | null | undefined, freeNeurons = CLOUDFLARE_FREE_NEURONS): number | null {
  if (!neuronsPerCall || neuronsPerCall <= 0) return null;
  return Math.max(1, Math.floor((freeNeurons * 0.9) / neuronsPerCall));
}
