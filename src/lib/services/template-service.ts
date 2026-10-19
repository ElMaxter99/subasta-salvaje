import { DomainError } from '@/lib/domain/errors';
import { fetchImageBytes, SafeFetchError, type FetchImageOptions } from '@/lib/security/safe-fetch';
import type { AppContext } from './context';
import { isHostedImage } from '@/lib/storage/hosted';
import { getHostState, setInitialFromHosted, setItemImageFromHosted, uploadInitialImageForAll, uploadItemImage } from './game-service';

type Ctx = Pick<AppContext, 'db' | 'storage' | 'publisher' | 'provider'>;

export interface PhotoRequest {
  /** Título del elemento del catálogo (se empareja por título y, si hay repetidos, por orden). */
  name: string;
  url: string;
}
export interface PhotoImportResult {
  imported: number;
  failed: { name: string; reason: string }[];
}

const REASON: Record<SafeFetchError['reason'], string> = {
  url: 'URL no válida',
  blocked: 'dirección no permitida',
  status: 'el servidor no entregó la imagen',
  size: 'supera el máximo de 7 MB',
  type: 'no es una imagen',
  timeout: 'tardó demasiado',
  network: 'no se pudo descargar',
};

/**
 * Pone las fotos de una plantilla como foto de los elementos del catálogo de una partida YA creada. Las que ya están en nuestro
 * repositorio de fotos (GitHub + jsDelivr) se usan por ENLACE, sin descargarlas; solo se descargan las de otros servidores.
 * Un fallo de una foto NUNCA bloquea la partida: se devuelve la lista de las que fallaron. Sigue las mismas comprobaciones que
 * la subida manual (tipo real de imagen y 7 MB) y solo funciona para el anfitrión propietario.
 */
export async function importItemPhotos(
  ctx: Ctx,
  code: string,
  hostId: string,
  photos: PhotoRequest[],
  opts: FetchImageOptions & { budgetMs?: number } = {},
): Promise<PhotoImportResult> {
  const state = await getHostState(ctx, code, hostId); // comprueba permisos antes de descargar nada
  const byName = new Map<string, string[]>();
  for (const it of state.items) byName.set(it.name.toLowerCase(), [...(byName.get(it.name.toLowerCase()) ?? []), it.id]);
  const used = new Map<string, number>();
  const jobs = photos.map((p) => {
    const ids = byName.get(p.name.toLowerCase()) ?? [];
    const n = used.get(p.name.toLowerCase()) ?? 0;
    used.set(p.name.toLowerCase(), n + 1);
    return { ...p, itemId: ids[n] ?? null };
  });

  const result: PhotoImportResult = { imported: 0, failed: [] };
  const deadline = Date.now() + (opts.budgetMs ?? 45_000);
  let next = 0;
  async function worker() {
    for (let i = next++; i < jobs.length; i = next++) {
      const job = jobs[i]!;
      if (!job.itemId) {
        result.failed.push({ name: job.name, reason: 'el elemento no existe en la partida' });
        continue;
      }
      if (Date.now() > deadline) {
        result.failed.push({ name: job.name, reason: 'se agotó el tiempo' });
        continue;
      }
      try {
        if (isHostedImage(job.url)) {
          // Ya está alojada en nuestro repositorio de fotos: se usa el enlace, sin descargarla ni guardar una copia.
          await setItemImageFromHosted(ctx, code, hostId, job.itemId, job.url);
        } else {
          const bytes = await fetchImageBytes(job.url, opts);
          await uploadItemImage(ctx, code, hostId, job.itemId, bytes); // valida el tipo real y el tamaño
        }
        result.imported++;
      } catch (e) {
        const reason = e instanceof SafeFetchError ? REASON[e.reason] : e instanceof DomainError ? e.message : 'no se pudo guardar';
        result.failed.push({ name: job.name, reason });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, jobs.length) }, worker));
  return result;
}

/**
 * Imagen inicial que trae una plantilla: si ya está alojada en nuestro repositorio de fotos se usa por enlace; si no, se descarga con las mismas defensas, se normaliza al formato
 * interno y se aplica a los jugadores actuales y a los que se unan después. Un fallo NUNCA bloquea la partida.
 */
export async function importInitialImage(ctx: Ctx, code: string, hostId: string, url: string, opts: FetchImageOptions = {}): Promise<{ ok: boolean; reason?: string }> {
  await getHostState(ctx, code, hostId); // permisos antes de descargar nada
  try {
    if (isHostedImage(url)) {
      await setInitialFromHosted(ctx, code, hostId, url, { current: true, new: true }); // ya alojada: sin descargarla ni copiarla
      return { ok: true };
    }
    const bytes = await fetchImageBytes(url, opts);
    await uploadInitialImageForAll(ctx, code, hostId, bytes, { current: true, new: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof SafeFetchError ? REASON[e.reason] : e instanceof DomainError ? e.message : 'no se pudo guardar' };
  }
}
