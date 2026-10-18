import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readZip } from '@/lib/domain/template-zip';
import { crc32, zipStream } from '@/lib/domain/zip-write';
import { createGame, getHostState } from '@/lib/services/game-service';
import { exportGame } from '@/lib/services/export-service';
import { processImageJobs } from '@/lib/services/jobs-service';
import { act, key, makeCtx, newHost, playerByName, type TestCtx } from './helpers';

let ctx: TestCtx;
beforeAll(async () => { ctx = await makeCtx(); });
afterAll(async () => { await ctx.db.close(); });

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  const r = stream.getReader();
  for (;;) { const { done, value } = await r.read(); if (done) break; parts.push(value); }
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

async function playedGame(host: string) {
  const { room_code: room } = await createGame(ctx, host, { name: 'Exportable', players: [{ name: 'Ana' }, { name: 'Beto' }] });
  let snap = await getHostState(ctx, room, host);
  for (const p of snap.players) await act(ctx, room, host, { type: 'image.request_initial', player_id: p.id });
  await processImageJobs(ctx, { gameId: snap.game.id });
  await act(ctx, room, host, { type: 'game.start' });
  snap = await getHostState(ctx, room, host);
  const a = await act(ctx, room, host, { type: 'auction.announce', item_id: snap.items[0]!.id });
  const ana = playerByName(snap, 'Ana').id;
  await act(ctx, room, host, { type: 'auction.bid', auction_id: a.snapshot.auction!.id, player_id: ana, amount_cents: 400, idempotency_key: key() });
  await act(ctx, room, host, { type: 'auction.award', auction_id: a.snapshot.auction!.id, expected_winner_id: ana, expected_price_cents: 400, idempotency_key: key() });
  await processImageJobs(ctx, { gameId: snap.game.id });
  return { room, gameId: snap.game.id };
}

describe('exportar partida (ZIP)', () => {
  it('crc32 y el escritor ZIP son correctos y los lee el lector del proyecto', async () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    async function* gen() { yield { name: 'a/ñ.txt', data: new TextEncoder().encode('hola'), deflate: true }; yield { name: 'b.bin', data: Uint8Array.of(1, 2, 3) }; }
    const files = await readZip(await collect(zipStream(gen())));
    expect(new TextDecoder().decode(files.get('a/ñ.txt')!.data)).toBe('hola');
    expect([...files.get('b.bin')!.data]).toEqual([1, 2, 3]);
  });

  it('contiene partida.json, LEEME.txt y las imágenes de cada jugador, sin datos sensibles', async () => {
    const host = newHost();
    const { room, gameId } = await playedGame(host);
    const out = await exportGame(ctx, room, host);
    expect(out.filename).toBe(`partida-${room.toLowerCase()}.zip`);
    const files = await readZip(await collect(zipStream(out.entries)));
    const names = [...files.values()].map((f) => f.name);
    expect(names).toContain('partida.json');
    expect(names).toContain('LEEME.txt');
    const images = names.filter((n) => n.startsWith('jugadores/'));
    expect(images.length).toBeGreaterThanOrEqual(3); // 2 iniciales + la evolución de Ana
    expect(images.filter((n) => n.startsWith('jugadores/01-Ana/')).length).toBeGreaterThanOrEqual(2);
    const doc = JSON.parse(new TextDecoder().decode(files.get('partida.json')!.data));
    expect(doc.ajustes.room_code).toBe(room);
    expect(doc.ajustes.host_id).toBeUndefined();
    const ana = doc.jugadores.find((p: { name: string }) => p.name === 'Ana');
    expect(ana.balance_cents).toBe(2000 - 400);
    expect(ana.balance_ohros).toMatch(/Ohros$/);
    expect(JSON.stringify(doc)).not.toContain('token_hash');
    expect(doc.compras).toHaveLength(1);
    expect(doc.compras[0]).toMatchObject({ price_cents: 400, jugador: 'Ana' });
    expect(doc.compras[0].price_ohros).toBe('4 Ohros');
    expect(doc.pujas.length).toBeGreaterThanOrEqual(1);
    expect(doc.eventos.length).toBeGreaterThan(0);
    expect(doc.resultados.jugadores).toHaveLength(2);
    expect(out.summary.players).toBe(2);
    expect([...ctx.storage.files.keys()].some((k) => k.startsWith(`games/${gameId}/`))).toBe(true);
  });

  it('las referencias https alojadas no se descargan: se listan en el JSON', async () => {
    const host = newHost();
    const { room, gameId } = await playedGame(host);
    const url = 'https://cdn.jsdelivr.net/gh/e2e/fotos@main/casas/casa.webp';
    await ctx.db.pg.query(`update image_versions set storage_path = $2 where id = (select id from image_versions where game_id = $1 order by created_at limit 1)`, [gameId, url]);
    const out = await exportGame(ctx, room, host);
    const files = await readZip(await collect(zipStream(out.entries)));
    const doc = JSON.parse(new TextDecoder().decode(files.get('partida.json')!.data));
    expect(doc.imagenes_alojadas_no_descargadas.map((x: { url: string }) => x.url)).toContain(url);
    expect([...files.values()].some((f) => f.name.includes('casa.webp'))).toBe(false);
    expect(out.summary.hosted).toBeGreaterThanOrEqual(1);
  });

  it('solo el anfitrión propietario; partida inexistente o código inválido', async () => {
    const host = newHost();
    const { room } = await playedGame(host);
    await expect(exportGame(ctx, room, newHost())).rejects.toMatchObject({ code: 'not_host' });
    await expect(exportGame(ctx, 'ZZZZ99', host)).rejects.toMatchObject({ code: 'game_not_found' });
    await expect(exportGame(ctx, '!!', host)).rejects.toMatchObject({ code: 'game_not_found' });
  });
});
