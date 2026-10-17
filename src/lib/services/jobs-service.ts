import { applyEditGuard } from '@/lib/ai/region-guard';
import { imageEditGuard } from '@/lib/config/env';
import { fetchImageBytes } from '@/lib/security/safe-fetch';
import { isExternalRef, isHostedImage, mimeFromExtension } from '@/lib/storage/hosted';
import { randomUUID } from 'node:crypto';
import { validateProviderOutput } from '@/lib/ai/image-validation';
import { normalizeImage } from '@/lib/images/normalize';
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
  /** Proveedor forzado al regenerar (solo ese, sin la cadena). */
  force_provider?: string | null;
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
  let chosen: ImageGenerationProvider;
  if (!ctx.stickers) chosen = ctx.provider!;
  else {
    const snap = await ctx.db.rpc<{ game: { image_mode: 'stickers' | 'ai' } }>('ss_get_state', { room_code: job.room_code, view: 'public' });
    chosen = snap.game.image_mode === 'ai' && ctx.provider ? ctx.provider : ctx.stickers;
  }
  // «Regenerar con…» fuerza UN proveedor (sin cadena) para comparar modelos; si no está configurado el trabajo falla con un mensaje claro.
  if (job.force_provider && chosen === ctx.provider) {
    const only = ctx.provider?.only?.(job.force_provider) ?? (ctx.provider?.id === job.force_provider ? ctx.provider : null);
    if (only) return only;
    const msg = `El proveedor ${job.force_provider} no está configurado en IMAGE_PROVIDERS (o no tiene sus credenciales). Se conserva la imagen anterior.`;
    const fail = async (): Promise<never> => { throw new ProviderError(msg, false, false, 'unsupported'); };
    return { ...chosen, generateInitialScene: fail, generateItemImage: fail, editScene: fail };
  }
  return chosen;
}

/**
 * Lee una imagen guardada. Las de nuestro repositorio de fotos (referencias `https://…` de plantillas) no se copiaron a la partida:
 * se leen por enlace en el momento de usarlas (solo de NUESTRO repositorio). Las demás, del almacenamiento de la partida.
 */
async function readStored(ctx: Ctx, ref: string): Promise<{ bytes: Uint8Array; mime: string }> {
  if (!isExternalRef(ref)) return ctx.storage.get(ref);
  if (!isHostedImage(ref)) throw new ProviderError('La imagen de referencia no está en el repositorio de fotos.', false, false);
  try {
    return { bytes: await fetchImageBytes(ref), mime: mimeFromExtension(ref) };
  } catch (e) {
    throw new ProviderError(`No se pudo leer la imagen alojada: ${e instanceof Error ? e.message : 'error de red'}`, true);
  }
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
  if (!job.base_storage_path) throw new ProviderError('No hay imagen base para editar', false, false);
  const base = await readStored(ctx, job.base_storage_path);
  if (provider.id === 'openai' && (job.base_mime_type ?? base.mime) === 'image/svg+xml') {
    throw new ProviderError('La imagen base es un SVG de la galería/demo y OpenAI sólo edita PNG, JPEG o WebP. Sube una imagen PNG/JPG o genera la inicial con IA.', false, false);
  }
  // Foto del elemento del catálogo (subida por el anfitrión o generada): se MEZCLA con la casa del ganador.
  let itemImage: { bytes: Uint8Array; mime: string } | undefined;
  if (itemImagePath) {
    try {
      const stored = await readStored(ctx, itemImagePath);
      itemImage = { bytes: stored.bytes, mime: stored.mime };
    } catch {
      itemImage = undefined; // la foto ya no existe: se edita sólo con el texto, sin fallar
    }
  }
  const edited = await provider.editScene({
    base: { bytes: base.bytes, mime: job.base_mime_type ?? base.mime },
    ...(itemImage ? { itemImage } : {}),
    theme: job.theme,
    itemName: job.item_name ?? 'objeto',
    itemDescription: job.item_description ?? '',
    itemEmoji,
    previousItems,
  });
  // Red de seguridad: con compras anteriores, si el modelo «pierde» un objeto añadido antes se restaura (modo por defecto `cores`; ver
  // IMAGE_EDIT_GUARD). La composición (collage) ya lo conserva por construcción.
  if (previousItems.length > 0 && !edited.model.endsWith('+compose') && (job.base_mime_type ?? base.mime) !== 'image/svg+xml') {
    const g = await applyEditGuard(imageEditGuard(), base.bytes, edited.bytes, previousItems.length);
    if (g.applied) return { ...edited, bytes: g.bytes, mime: 'image/png', prompt: `${edited.prompt} [guardia de zona: ${g.note}]` };
  }
  return edited;
}

async function jobContext(ctx: Ctx, job: ClaimedJob): Promise<{ itemEmoji: string | null; previousItems: string[]; itemImagePath: string | null }> {
  // Datos secundarios (emoji y elementos previos) leídos de la instantánea pública.
  const snap = await ctx.db.rpc<{ items: { id: string; emoji: string | null; image_path: string | null }[]; players: { id: string; purchases: { purchase_id: string; name: string; created_at: string }[] }[] }>(
    'ss_get_state',
    { room_code: job.room_code, view: 'public' },
  );
  const item = snap.items.find((i) => i.id === job.item_id);
  const itemEmoji = item?.emoji ?? null;
  const itemImagePath = item?.image_path ?? null;
  const player = snap.players.find((p) => p.id === job.player_id);
  // Solo las compras ANTERIORES a esta: si hay trabajos atrasados, las posteriores aún no están en la imagen (el prompt no debe decir que sí).
  const all = player?.purchases ?? [];
  const mine = all.find((p) => p.purchase_id === job.purchase_id);
  const previousItems = all
    .filter((p) => p.purchase_id !== job.purchase_id && (!mine || p.created_at < mine.created_at || (p.created_at === mine.created_at && p.purchase_id < mine.purchase_id)))
    .map((p) => p.name);
  return { itemEmoji, previousItems, itemImagePath };
}

/** Por qué se usó este proveedor, para el historial: cadena y saltos, proveedor forzado al regenerar o proveedor único. */
function providerNote(provider: ImageGenerationProvider, job: ClaimedJob, notes: string | undefined): string {
  if (job.force_provider) return `Regenerado forzando ${job.force_provider} (se ignora la cadena)${notes && !notes.startsWith('proveedor forzado') ? `; ${notes}` : ''}`;
  if (provider.id === 'demo') return 'Pegatinas (sin IA)';
  if (notes) return notes.slice(0, 600);
  return provider.only ? 'Cadena de proveedores' : `Único proveedor configurado: ${provider.id}`;
}

async function runJob(ctx: Ctx, provider: ImageGenerationProvider, job: ClaimedJob, workerId: string): Promise<boolean> {
  let reserved = false;
  try {
    // Sin capacidad de edición no se gasta cuota: se falla con un mensaje claro y la imagen anterior se conserva.
    if (job.kind === 'edit' && !provider.capabilities.edit) {
      throw new ProviderError('El proveedor configurado sólo genera imágenes nuevas y no puede editar la casa existente. Se conserva la imagen anterior.', false);
    }
    reserved = await reserveQuota(ctx, provider, job);
    let image = await generate(ctx, provider, job);
    let mime = validateProviderOutput(image, provider.id === 'demo');
    if (mime !== 'image/svg+xml') {
      // Formato interno único: la salida de cualquier proveedor se reduce y se pasa a WebP antes de guardarla.
      try {
        const n = await normalizeImage(image.bytes, job.kind === 'item' ? 'item' : 'scene');
        image = { ...image, bytes: n.bytes, mime: n.mime };
        mime = n.mime;
      } catch (e) {
        throw new ProviderError(`Imagen devuelta no válida: ${(e as Error).message}`, true);
      }
    }
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
      provider_note: providerNote(provider, job, image.notes),
      provider: image.provider ?? provider.id,
      model: image.model ?? null,
    });
    // Si la cadena respondió con otro proveedor, el uso (y los topes diarios) se atribuyen al que respondió.
    if (reserved && image.provider && image.provider !== provider.id) {
      await ctx.db.rpc('ss_set_usage_provider', { job_id: job.job_id, provider: image.provider }).catch((e) => console.error('[jobs] no se pudo atribuir el uso', redactSecrets(String(e))));
    }
    await publish(ctx, done.room_code);
    return true;
  } catch (err) {
    const retryable = err instanceof ProviderError ? err.retryable : true;
    // Si el proveedor NO llegó a gastar nada (sin conexión, credenciales, cuota suya agotada…), se devuelve la unidad reservada.
    if (reserved && err instanceof ProviderError && !err.consumed) {
      await ctx.db.rpc('ss_release_image_quota', { job_id: job.job_id }).catch((e) => console.error('[jobs] no se pudo devolver la cuota', redactSecrets(String(e))));
    }
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
async function reserveQuota(ctx: Ctx, provider: ImageGenerationProvider, job: ClaimedJob): Promise<boolean> {
  if (provider.id === 'demo') return false;
  const q = effectiveQuota(await getSettings(ctx.db));
  const r = await ctx.db.rpc<{ ok: boolean; reason?: 'game' | 'day'; used?: number; limit?: number }>('ss_reserve_image_quota', {
    job_id: job.job_id,
    provider: provider.id,
    game_limit: q.perGame,
    day_limit: q.perDay,
  });
  if (r.ok) return true;
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
