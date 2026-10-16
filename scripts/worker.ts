/**
 * Worker de generación de imágenes para despliegues con un proceso de larga duración
 * (VPS, Railway, Fly.io, tu portátil…). Alternativa o complemento al cron HTTP de Vercel.
 *
 *   npm run worker            # bucle continuo (cada 5 s)
 *   npm run worker -- --once  # procesa la cola una vez y termina
 *
 * Requiere las mismas variables que la app (Supabase + OPENAI_API_KEY). No funciona en modo demo
 * (la base de datos de demo es un fichero local abierto por el servidor de desarrollo).
 */
import { getRuntimeMode } from '@/lib/config/env';
import { getContext } from '@/lib/services/context';
import { processImageJobs } from '@/lib/services/jobs-service';

const once = process.argv.includes('--once');
const intervalMs = Number(process.env.WORKER_INTERVAL_MS ?? 5000);

async function main() {
  if (getRuntimeMode() !== 'supabase') {
    console.error('El worker externo sólo funciona con Supabase configurado (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY).');
    process.exit(1);
  }
  const ctx = await getContext();
  if (!ctx.provider) {
    console.error('Falta OPENAI_API_KEY: sin proveedor de IA no hay nada que procesar.');
    process.exit(1);
  }
  console.log(`[worker] iniciado (${ctx.provider.id}) ${once ? 'una pasada' : `cada ${intervalMs} ms`}`);
  let stop = false;
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => (stop = true));
  do {
    try {
      const r = await processImageJobs(ctx, { maxJobs: 20, workerId: `worker-${process.pid}` });
      if (r.processed) console.log(`[worker] procesados=${r.processed} ok=${r.succeeded} fallos=${r.failed}`);
    } catch (e) {
      console.error('[worker] error', e);
    }
    if (once || stop) break;
    await new Promise((r) => setTimeout(r, intervalMs));
  } while (!stop);
}

void main();
