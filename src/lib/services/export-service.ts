import { DomainError } from '@/lib/domain/errors';
import { formatOhros } from '@/lib/domain/money';
import { computeRanking, rankingRuleLabel } from '@/lib/domain/ranking';
import { roomCodeSchema } from '@/lib/domain/schemas';
import type { Player, RankingRule } from '@/lib/domain/types';
import type { ZipEntry } from '@/lib/domain/zip-write';
import { isExternalRef } from '@/lib/storage/hosted';
import type { ImageStorage } from '@/lib/storage/types';
import { extensionForMime, mimeForPath } from '@/lib/storage/types';
import type { AppContext } from './context';

type Ctx = Pick<AppContext, 'db' | 'storage'>;

/** Límites de la exportación: protegen la función (memoria/tiempo) y el tamaño de la respuesta. */
export const EXPORT_LIMITS = { imageBytes: 40 * 1024 * 1024, images: 600 } as const;

type Row = Record<string, unknown> & { id?: string };
interface ExportData {
  game: Row;
  players: Row[];
  items: Row[];
  auctions: Row[];
  bids: Row[];
  purchases: Row[];
  image_versions: Row[];
  events: Row[];
}

const ohros = (cents: unknown) => (typeof cents === 'number' ? formatOhros(cents) : null);
const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const safeName = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'jugador';
const isoDay = (v: unknown) => String(v ?? '').slice(0, 19).replace(/[-:T]/g, '').replace(/^(\d{8})(\d{6})$/, '$1-$2');

export interface GameExport {
  filename: string;
  entries: AsyncGenerator<ZipEntry>;
  /** Resumen para pruebas y registro (sin datos personales). */
  summary: { players: number; images: number; hosted: number; skipped: number };
}

/**
 * Reúne TODOS los datos de una partida del anfitrión propietario (`ss_export_game`, solo lectura) y prepara el contenido del ZIP.
 * Las comprobaciones (existe, es tuya) ocurren aquí, antes de empezar a emitir bytes. Las imágenes se leen una a una al consumir `entries`.
 */
export async function exportGame(ctx: Ctx, roomCode: string, hostId: string, now = new Date()): Promise<GameExport> {
  const parsed = roomCodeSchema.safeParse(roomCode);
  if (!parsed.success) throw new DomainError('game_not_found');
  const data = await ctx.db.rpc<ExportData>('ss_export_game', { room_code: parsed.data, host_id: hostId });

  const planned: { player: Row; index: number; version: Row; path: string; zipPath: string }[] = [];
  const hostedRefs: { jugador: string | null; version_id?: string; elemento?: string; url: string }[] = [];
  const skipped: string[] = [];
  let budget: number = EXPORT_LIMITS.imageBytes;

  const addFile = (player: Row | null, prefixDir: string, label: string, ref: string, size: unknown, meta: Row) => {
    if (isExternalRef(ref)) { hostedRefs.push({ jugador: (player?.name as string | undefined) ?? null, ...(meta as object), url: ref }); return null; }
    const bytes = typeof size === 'number' ? size : 0;
    if (planned.length >= EXPORT_LIMITS.images || bytes > budget) { skipped.push(`${prefixDir}/${label}`); return null; }
    budget -= bytes;
    return ref;
  };

  const sortedPlayers = data.players;
  sortedPlayers.forEach((player, i) => {
    const dir = `jugadores/${pad(i + 1)}-${safeName(String(player.name))}`;
    const versions = data.image_versions.filter((v) => v.player_id === player.id && v.generation_status === 'completed' && typeof v.storage_path === 'string');
    versions.forEach((v, n) => {
      const ref = v.storage_path as string;
      const ext = (() => { try { return extensionForMime(String(v.mime_type ?? mimeForPath(ref))); } catch { return 'webp'; } })();
      const label = `${pad(n + 1, 3)}-${String(v.origin)}-${isoDay(v.created_at)}.${ext}`;
      const ok = addFile(player, dir, label, ref, v.bytes, { version_id: v.id as string });
      if (ok) planned.push({ player, index: i, version: v, path: ok, zipPath: `${dir}/${label}` });
    });
  });
  const itemFiles: { path: string; zipPath: string }[] = [];
  for (const [n, it] of data.items.entries()) {
    if (typeof it.image_path !== 'string' || !it.image_path) continue;
    if (isExternalRef(it.image_path)) { hostedRefs.push({ jugador: null, elemento: String(it.name), url: it.image_path }); continue; }
    if (itemFiles.length + planned.length >= EXPORT_LIMITS.images) { skipped.push(`catalogo/${String(it.name)}`); continue; }
    let ext = 'webp';
    try { ext = extensionForMime(mimeForPath(it.image_path)); } catch { /* se queda en webp */ }
    itemFiles.push({ path: it.image_path, zipPath: `catalogo/${pad(n + 1, 3)}-${safeName(String(it.name))}.${ext}` });
  }

  // --- partida.json ---
  const playersById = new Map(data.players.map((p) => [String(p.id), p]));
  const itemsById = new Map(data.items.map((x) => [String(x.id), x]));
  const auctionsById = new Map(data.auctions.map((a) => [String(a.id), a]));
  const nameOf = (id: unknown) => (id ? String(playersById.get(String(id))?.name ?? '') || null : null);
  const withOhros = <T extends Row>(r: T, ...keys: string[]) => {
    const out: Row = { ...r };
    for (const k of keys) out[k.replace(/_cents$/, '_ohros')] = ohros(r[k]);
    return out;
  };

  const purchases: Row[] = data.purchases.map((x) => ({
    ...withOhros(x, 'price_cents'),
    jugador: nameOf(x.player_id),
    elemento: String(itemsById.get(String(x.auction_item_id))?.name ?? ''),
  }));
  const players = data.players.map((p, i) => ({
    ...withOhros(p, 'balance_cents'),
    carpeta_imagenes: `jugadores/${pad(i + 1)}-${safeName(String(p.name))}`,
    compras: purchases.filter((x) => x.player_id === p.id).length,
    imagenes_en_zip: planned.filter((x) => x.index === i).map((x) => x.zipPath),
  }));
  const rule = (data.game.ranking_rule as RankingRule | undefined) ?? 'none';
  const ranking = computeRanking(
    data.players.map((p) => ({ ...p, purchases: purchases.filter((x) => x.player_id === p.id) }) as unknown as Player),
    rule,
  );
  const resultados = {
    regla: rankingRuleLabel(rule),
    clasificacion: ranking ? ranking.map((e) => ({ posicion: e.rank, jugador: e.player.name, puntuacion: e.score })) : null,
    jugadores: data.players.map((p) => {
      const spent = purchases.filter((x) => x.player_id === p.id).reduce((s, x) => s + (x.price_cents as number), 0);
      return { jugador: p.name, saldo_final_centimos: p.balance_cents, saldo_final_ohros: ohros(p.balance_cents), gastado_centimos: spent, gastado_ohros: ohros(spent), elementos: purchases.filter((x) => x.player_id === p.id).length, votos: p.votes };
    }),
  };

  const doc = {
    formato: 'subasta-salvaje-exportacion-v1',
    exportado_en: now.toISOString(),
    moneda: 'Ohros (los importes *_centimos son enteros: 100 = 1 Ohro)',
    ajustes: data.game,
    jugadores: players,
    catalogo: data.items,
    subastas: data.auctions.map((a) => ({ ...withOhros(a, 'current_bid_cents', 'final_price_cents'), elemento: String(itemsById.get(String(a.auction_item_id))?.name ?? ''), ganador: nameOf(a.winner_id) })),
    pujas: data.bids.map((b) => ({ ...withOhros(b, 'amount_cents'), jugador: nameOf(b.player_id), elemento: String(itemsById.get(String(auctionsById.get(String(b.auction_id))?.auction_item_id))?.name ?? '') })),
    compras: purchases,
    versiones_de_imagen: data.image_versions.map((v) => ({ id: v.id, jugador: nameOf(v.player_id), origen: v.origin, proveedor: v.provider, estado: v.generation_status, creada: v.created_at, prompt: v.prompt_used ?? null, guardada_en_zip: planned.find((x) => x.version === v)?.zipPath ?? null })),
    eventos: data.events,
    resultados,
    imagenes_alojadas_no_descargadas: hostedRefs,
    imagenes_omitidas_por_limite: skipped,
  };

  const readme = [
    `Exportación de la partida «${String(data.game.name)}» (sala ${String(data.game.room_code)}) de Subasta Salvaje`,
    `Generada el ${now.toISOString()}.`,
    '',
    'Contenido',
    '- partida.json: ajustes, jugadores (nombre, color y saldo final), catálogo, subastas, pujas, compras, eventos y resultados.',
    '  Los importes van en céntimos enteros (100 = 1 Ohro) y también en texto en Ohros.',
    '- jugadores/NN-nombre/: las imágenes del historial de versiones de cada jugador guardadas en nuestro almacenamiento.',
    '- catalogo/: imágenes de elementos del catálogo guardadas en nuestro almacenamiento.',
    '',
    'Qué NO incluye',
    '- Imágenes alojadas en un repositorio externo (enlaces https): no se descargan, se listan en partida.json (imagenes_alojadas_no_descargadas).',
    `- Más de ${EXPORT_LIMITS.images} imágenes o ${Math.round(EXPORT_LIMITS.imageBytes / 1048576)} MB de imágenes: el resto se lista en imagenes_omitidas_por_limite.`,
    '- Datos de acceso de los jugadores (identificadores de sesión) ni de tu cuenta.',
    '- Solo los últimos 5000 eventos del registro.',
    '',
    'Es una copia de tus datos para que los conserves; puedes pedirla cuando quieras mientras la partida exista (las partidas se borran solas tras un tiempo sin actividad).',
    '',
  ].join('\n');

  async function* entries(): AsyncGenerator<ZipEntry> {
    const enc = new TextEncoder();
    yield { name: 'partida.json', data: enc.encode(JSON.stringify(doc, null, 2) + '\n'), deflate: true };
    const failed: string[] = [];
    for (const f of [...planned.map((x) => ({ path: x.path, zipPath: x.zipPath })), ...itemFiles]) {
      try {
        yield { name: f.zipPath, data: (await (ctx.storage as ImageStorage).get(f.path)).bytes };
      } catch {
        failed.push(f.zipPath);
      }
    }
    const extra = failed.length ? `\nNo se pudieron leer del almacenamiento (${failed.length}):\n${failed.map((x) => `- ${x}`).join('\n')}\n` : '';
    yield { name: 'LEEME.txt', data: enc.encode(readme + extra), deflate: true };
  }

  return {
    filename: `partida-${String(data.game.room_code).toLowerCase()}.zip`,
    entries: entries(),
    summary: { players: data.players.length, images: planned.length + itemFiles.length, hosted: hostedRefs.length, skipped: skipped.length },
  };
}
