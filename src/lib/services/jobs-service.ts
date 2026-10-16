import { randomUUID } from 'node:crypto';
import { validateProviderOutput } from '@/lib/ai/image-validation';
import { ProviderError, type GeneratedImage, type ImageGenerationProvider } from '@/lib/ai/types';
import { emptySceneFor } from '@/lib/domain/themes';
import { extensionForMime } from '@/lib/storage/types';
import type { AppContext } from './context';

type Ctx = Pick<AppContext, 'db' | 'storage' | 'publisher'> & { provider: ImageGenerationProvider | null };

interface ClaimedJob {
  job_id: string;
  kind: 'initial' | 'edit' | 'item';
  attempts: number;
  max_attempts: number;
  game_id: string;
  room_code: string;
  theme: string;
  player_id: string | null;
  player_name: string | null;
  item_id: string | null;
  item_name: string | null;
  item_description: string | null;
  purchase_id: string | null;
  base_storage_path: string | null;
  base_mime_type: string | null;
}

export interface ProcessResult {
  processed: number;
  succeeded: number;
  failed: number;
  skipped?: 'provider_not_configured';
}

/**
 * Procesa trabajos de imagen pendientes. Es seguro llamarlo desde varios sitios a la vez
 * (cron, `after()` tras adjudicar, botón del anfitrión, `npm run worker`): la reclamación es
 * atómica en SQL y los trabajos con lease caducado se recuperan.
 *
 * NUNCA modifica saldos ni compras: sólo crea versiones de imagen.
 */
export async function processImageJobs(
  ctx: Ctx,
  opts: { maxJobs?: number; deadlineMs?: number; workerId?: string; gameId?: string } = {},
): Promise<ProcessResult> {
  const result: ProcessResult = { processed: 0, succeeded: 0, failed: 0 };
  const provider = ctx.provider;
  if (!provider) return { ...result, skipped: 'provider_not_configured' };

  const maxJobs = opts.maxJobs ?? 10;
  const deadline = Date.now() + (opts.deadlineMs ?? 240_000);
  const workerId = opts.workerId ?? `worker-${randomUUID().slice(0, 8)}`;

  while (result.processed < maxJobs && Date.now() < deadline) {
    const job = await ctx.db.rpc<ClaimedJob | null>('ss_claim_image_job', {
      worker_id: workerId,
      lease_seconds: 300,
      ...(opts.gameId ? { game_id: opts.gameId } : {}),
    });
    if (!job) break;
    result.processed++;
    const ok = await runJob(ctx, provider, job, workerId);
    if (ok) result.succeeded++;
    else result.failed++;
  }
  return result;
}

async function generate(ctx: Ctx, provider: ImageGenerationProvider, job: ClaimedJob): Promise<GeneratedImage> {
  if (job.kind === 'initial') {
    return provider.generateInitialScene({
      theme: job.theme,
      sceneDescription: emptySceneFor(job.theme),
      playerName: job.player_name ?? 'Jugador',
    });
  }
  const { itemEmoji, previousItems } = await jobContext(ctx, job);
  if (job.kind === 'item') {
    return provider.generateItemImage({
      theme: job.theme,
      itemName: job.item_name ?? 'objeto',
      itemDescription: job.item_description ?? '',
      itemEmoji,
    });
  }
  if (!job.base_storage_path) throw new ProviderError('No hay imagen base para editar', false);
  const base = await ctx.storage.get(job.base_storage_path);
  return provider.editScene({
    base: { bytes: base.bytes, mime: job.base_mime_type ?? base.mime },
    theme: job.theme,
    itemName: job.item_name ?? 'objeto',
    itemDescription: job.item_description ?? '',
    itemEmoji,
    previousItems,
  });
}

async function jobContext(ctx: Ctx, job: ClaimedJob): Promise<{ itemEmoji: string | null; previousItems: string[] }> {
  // Datos secundarios (emoji y elementos previos) leídos de la instantánea pública.
  const snap = await ctx.db.rpc<{ items: { id: string; emoji: string | null }[]; players: { id: string; purchases: { purchase_id: string; name: string }[] }[] }>(
    'ss_get_state',
    { room_code: job.room_code, view: 'public' },
  );
  const itemEmoji = snap.items.find((i) => i.id === job.item_id)?.emoji ?? null;
  const player = snap.players.find((p) => p.id === job.player_id);
  const previousItems = (player?.purchases ?? []).filter((p) => p.purchase_id !== job.purchase_id).map((p) => p.name);
  return { itemEmoji, previousItems };
}

async function runJob(ctx: Ctx, provider: ImageGenerationProvider, job: ClaimedJob, workerId: string): Promise<boolean> {
  try {
    const image = await generate(ctx, provider, job);
    const mime = validateProviderOutput(image, provider.id === 'demo');
    const folder = job.kind === 'item' ? `items/${job.item_id}` : `players/${job.player_id}`;
    const storagePath = `games/${job.game_id}/${folder}/${randomUUID()}.${extensionForMime(mime)}`;
    await ctx.storage.put(storagePath, image.bytes, mime);
    const done = await ctx.db.rpc<{ room_code: string }>('ss_complete_image_job', {
      job_id: job.job_id,
      worker_id: workerId,
      storage_path: storagePath,
      mime_type: mime,
      bytes: image.bytes.length,
      prompt: image.prompt,
      provider: provider.id,
    });
    await publish(ctx, done.room_code);
    return true;
  } catch (err) {
    const retryable = err instanceof ProviderError ? err.retryable : true;
    const message = err instanceof Error ? err.message : String(err);
    try {
      const failed = await ctx.db.rpc<{ room_code: string }>('ss_fail_image_job', {
        job_id: job.job_id,
        worker_id: workerId,
        error: toDomainErrorMessage(message),
        retryable,
        provider: provider.id,
      });
      await publish(ctx, failed.room_code);
    } catch (e) {
      console.error('[jobs] no se pudo registrar el fallo del trabajo', job.job_id, e);
    }
    return false;
  }
}

function toDomainErrorMessage(message: string): string {
  return message.replace(/(sk-[A-Za-z0-9_-]{8,})/g, '[redactado]').slice(0, 800);
}

async function publish(ctx: Ctx, roomCode: string): Promise<void> {
  const snap = await ctx.db.rpc<{ version: number }>('ss_get_state', { room_code: roomCode, view: 'public' });
  await ctx.publisher.publish(roomCode, snap.version);
}
