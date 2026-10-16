import { randomUUID } from 'node:crypto';
import { validateProviderOutput } from '@/lib/ai/image-validation';
import { ProviderError, type GeneratedImage, type ImageGenerationProvider } from '@/lib/ai/types';
import { effectiveQuota, getSettings } from './settings';
import { redactSecrets } from '@/lib/security/redact';
import { emptySceneFor } from '@/lib/domain/themes';
import { extensionForMime } from '@/lib/storage/types';
import type { AppContext } from './context';

type Ctx = Pick<AppContext, 'db' | 'storage' | 'publisher'> & { provider: ImageGenerationProvider | null; stickers?: ImageGenerationProvider };

interface ClaimedJob {
  job_id: string;
  kind: 'initial' | 'edit' | 'item' | 'base';
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
  // Proveedor por MODO de la partida: «stickers» (pegatinas, local, sin IA) o «ai» (proveedor real configurado).
  // Sin `ctx.stickers` (pruebas) se usa `ctx.provider` para todo.
  // Interruptor global de IA (superadmin): apagado = solo se procesan trabajos del modo pegatinas; los de IA quedan en cola.
  const aiOn = (await getSettings(ctx.db)).ai_enabled;
  const realProvider = aiOn ? ctx.provider : null;
  if (!realProvider && !ctx.stickers) return { ...result, skipped: 'provider_not_configured' };
  const modes = ctx.stickers ? ['stickers', ...(realProvider ? ['ai'] : [])] : null;

  const maxJobs = opts.maxJobs ?? 10;
  const deadline = Date.now() + (opts.deadlineMs ?? 240_000);
  const workerId = opts.workerId ?? `worker-${randomUUID()}`;

  let empty = 0;
  while (result.processed < maxJobs && Date.now() < deadline) {
    const job = await ctx.db.rpc<(ClaimedJob & { retry?: boolean }) | null>('ss_claim_image_job', {
      worker_id: workerId,
      lease_seconds: 300,
      ...(opts.gameId ? { game_id: opts.gameId } : {}),
      ...(modes ? { image_modes: modes } : {}),
    });
    if (!job) break;
    if (job.retry) {
      if (++empty > 20) break;
      continue;
    }
    result.processed++;
    const provider = await providerFor(ctx, job);
    const ok = await runJob(ctx, provider, job, workerId);
    if (ok) result.succeeded++;
    else result.failed++;
  }
  return result;
}

/** Elige el proveedor según el modo de imágenes de la partida del trabajo. */
async function providerFor(ctx: Ctx, job: ClaimedJob): Promise<ImageGenerationProvider> {
  if (!ctx.stickers) return ctx.provider!;
  const snap = await ctx.db.rpc<{ game: { image_mode: 'stickers' | 'ai' } }>('ss_get_state', { room_code: job.room_code, view: 'public' });
  return snap.game.image_mode === 'ai' && ctx.provider ? ctx.provider : ctx.stickers;
}

async function generate(ctx: Ctx, provider: ImageGenerationProvider, job: ClaimedJob): Promise<GeneratedImage> {
  if (job.kind === 'initial' || job.kind === 'base') {
    // `base` = la imagen de partida COMPARTIDA: una sola generación que se asigna a todos los jugadores.
    return provider.generateInitialScene({
      theme: job.theme,
      sceneDescription: emptySceneFor(job.theme),
      playerName: job.kind === 'base' ? 'la partida' : (job.player_name ?? 'Jugador'),
    });
  }
  const { itemEmoji, previousItems, itemImagePath } = await jobContext(ctx, job);
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
  if (provider.id === 'openai' && (job.base_mime_type ?? base.mime) === 'image/svg+xml') {
    throw new ProviderError('La imagen base es un SVG de la galería/demo y OpenAI sólo edita PNG, JPEG o WebP. Sube una imagen PNG/JPG o genera la inicial con IA.', false);
  }
  // Foto del elemento del catálogo (subida por el anfitrión o generada): se MEZCLA con la casa del ganador.
  let itemImage: { bytes: Uint8Array; mime: string } | undefined;
  if (itemImagePath) {
    try {
      const stored = await ctx.storage.get(itemImagePath);
      itemImage = { bytes: stored.bytes, mime: stored.mime };
    } catch {
      itemImage = undefined; // la foto ya no existe: se edita sólo con el texto, sin fallar
    }
  }
  return provider.editScene({
    base: { bytes: base.bytes, mime: job.base_mime_type ?? base.mime },
    ...(itemImage ? { itemImage } : {}),
    theme: job.theme,
    itemName: job.item_name ?? 'objeto',
    itemDescription: job.item_description ?? '',
    itemEmoji,
    previousItems,
  });
}

async function jobContext(ctx: Ctx, job: ClaimedJob): Promise<{ itemEmoji: string | null; previousItems: string[]; itemImagePath: string | null }> {
  // Datos secundarios (emoji y elementos previos) leídos de la instantánea pública.
  const snap = await ctx.db.rpc<{ items: { id: string; emoji: string | null; image_path: string | null }[]; players: { id: string; purchases: { purchase_id: string; name: string }[] }[] }>(
    'ss_get_state',
    { room_code: job.room_code, view: 'public' },
  );
  const item = snap.items.find((i) => i.id === job.item_id);
  const itemEmoji = item?.emoji ?? null;
  const itemImagePath = item?.image_path ?? null;
  const player = snap.players.find((p) => p.id === job.player_id);
  const previousItems = (player?.purchases ?? []).filter((p) => p.purchase_id !== job.purchase_id).map((p) => p.name);
  return { itemEmoji, previousItems, itemImagePath };
}

async function runJob(ctx: Ctx, provider: ImageGenerationProvider, job: ClaimedJob, workerId: string): Promise<boolean> {
  try {
    // Sin capacidad de edición no se gasta cuota: se falla con un mensaje claro y la imagen anterior se conserva.
    if (job.kind === 'edit' && !provider.capabilities.edit) {
      throw new ProviderError('El proveedor configurado sólo genera imágenes nuevas y no puede editar la casa existente. Se conserva la imagen anterior.', false);
    }
    await reserveQuota(ctx, provider, job);
    const image = await generate(ctx, provider, job);
    const mime = validateProviderOutput(image, provider.id === 'demo');
    const folder = job.kind === 'item' ? `items/${job.item_id}` : job.kind === 'base' ? 'shared' : `players/${job.player_id}`;
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
      console.error('[jobs] no se pudo registrar el fallo del trabajo', job.job_id, redactSecrets(String(e)));
    }
    return false;
  }
}

/** Reserva atómica de UNA llamada al proveedor real. El proveedor `demo` no consume ni tiene límite. */
async function reserveQuota(ctx: Ctx, provider: ImageGenerationProvider, job: ClaimedJob): Promise<void> {
  if (provider.id === 'demo') return;
  const q = effectiveQuota(await getSettings(ctx.db));
  const r = await ctx.db.rpc<{ ok: boolean; reason?: 'game' | 'day'; used?: number; limit?: number }>('ss_reserve_image_quota', {
    job_id: job.job_id,
    provider: provider.id,
    game_limit: q.perGame,
    day_limit: q.perDay,
  });
  if (r.ok) return;
  throw new ProviderError(
    r.reason === 'game'
      ? `Cuota de generaciones de esta partida alcanzada (${r.used}/${r.limit}). La partida sigue con la imagen anterior. Sube IMAGE_QUOTA_PER_GAME o reintenta el trabajo más tarde.`
      : `Cuota diaria de generaciones alcanzada (${r.used}/${r.limit}). La partida sigue con la imagen anterior; se renueva a las 00:00 UTC. Sube IMAGE_QUOTA_PER_DAY si quieres más.`,
    false,
  );
}

function toDomainErrorMessage(message: string): string {
  return redactSecrets(message).slice(0, 800);
}

async function publish(ctx: Ctx, roomCode: string): Promise<void> {
  const snap = await ctx.db.rpc<{ version: number }>('ss_get_state', { room_code: roomCode, view: 'public' });
  await ctx.publisher.publish(roomCode, snap.version);
}
