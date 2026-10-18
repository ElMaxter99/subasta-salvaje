import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import type { Player, PlayerStat, PublicSnapshot } from '@/lib/domain/types';
import { PODIUM_FORMATS, PODIUM_SIZES, parsePodiumFormat, podiumDate, renderPodiumImage } from '@/lib/seo/podium-image';
import { createMemoryStorage } from '@/lib/storage/local';

let seq = 0;
const COLORS = ['#fb7185', '#2dd4bf', '#a78bfa', '#fbbf24', '#60a5fa', '#34d399', '#f472b6', '#f97316', '#22d3ee', '#a3e635'];
const NAMES = ['Ana', 'Beto', 'Carla', 'Dani', 'Elena', 'Fran', 'Gloria', 'Hugo', 'Irene', 'Javi'];

/** Instantánea sintética (no necesita base de datos): jugadores con saldo y compras, opcionalmente con casa en Storage. */
function snap(n: number, o: { names?: string[]; rule?: 'balance' | 'none' | 'items' | 'votes'; balances?: number[]; stats?: boolean; gallery?: boolean; houses?: boolean; generating?: boolean } = {}): { s: PublicSnapshot; storage: ReturnType<typeof createMemoryStorage> } {
  const storage = createMemoryStorage();
  const players: Player[] = Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    name: o.names?.[i] ?? NAMES[i]!,
    color: COLORS[i % COLORS.length]!,
    sort_order: i,
    balance_cents: o.balances?.[i] ?? (10 - i) * 350,
    votes: n - i,
    claimed: true,
    joined: true,
    current_image_version_id: 'v',
    current_image: o.houses === false ? null : { id: `img${i}`, storage_path: `games/x/p${i}.png`, provider: 'demo', created_at: '2026-01-01' },
    initial_image: null,
    purchases: Array.from({ length: i % 4 }, (_, k) => ({ purchase_id: `${i}-${k}`, item_id: `it${k}`, name: `Objeto ${k}`, emoji: '🎁', price_cents: 300, created_at: '2026-01-01' })),
    generating: o.generating && i === 0 ? [{ job_id: 'j', kind: 'edit' as const, status: 'running' as const, item_name: null }] : [],
  }));
  const bg = (i: number) => ({ create: { width: 640, height: 480, channels: 3 as const, background: COLORS[i % COLORS.length]! } });
  if (o.houses !== false) for (let i = 0; i < n; i++) storage.files.set(`games/x/p${i}.png`, { bytes: new Uint8Array(0), mime: 'image/png' });
  const player_stats: PlayerStat[] | undefined = o.stats === false ? undefined : players.map((p, i) => ({ player_id: p.id, bids_count: 2 + i * 3, max_bid_cents: 500 + i * 100, auctions_bid: 3 + i, wins: i % 4, spent_cents: (i % 4) * 300 + i * 40, yields_count: i === 2 ? 2 : 0 }));
  const s = {
    version: 7,
    server_time: '2026-10-18T20:00:00Z',
    game: { id: `g${n}-${seq++}`, room_code: 'ABC123', name: o.names ? 'Subasta de la Familia Fernández-Villalobos de los Montes' : 'Noche de Subasta', status: 'finished', theme: 'house', ranking_rule: o.rule ?? 'balance', finished_at: '2026-10-18T19:30:00Z', created_at: '2026-10-18T17:00:00Z', total_rounds: 8, rounds_completed: 8 },
    players,
    items: [],
    auction: null,
    last_award: null,
    stats: { purchases_count: 14, total_spent_cents: 123450, bids_count: 87, cancelled_auctions: 0 },
    player_stats,
    gallery: o.gallery ? { enabled: true, open: false, closed: true, voters: [], results: players.map((p, i) => ({ player_id: p.id, votes: i === 1 ? 4 : 1 })) } : undefined,
  } as unknown as PublicSnapshot;
  void bg;
  return { s, storage };
}

/** Rellena Storage con una imagen distinta por jugador (degradados) para ver miniaturas reales. */
async function fillHouses(s: PublicSnapshot, storage: ReturnType<typeof createMemoryStorage>) {
  for (const [i, p] of s.players.entries()) {
    const sp = p.current_image?.storage_path;
    if (!sp) continue;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${p.color}"/><stop offset="1" stop-color="#1e1b4b"/></linearGradient></defs><rect width="640" height="480" fill="url(#g)"/><rect x="${160 + (i % 3) * 30}" y="220" width="320" height="200" fill="#fff" opacity=".85"/><polygon points="140,230 320,90 500,230" fill="#fbbf24"/><rect x="290" y="320" width="60" height="100" fill="#7c2d12"/></svg>`;
    storage.files.set(sp, { bytes: new Uint8Array(await sharp(Buffer.from(svg)).webp().toBuffer()), mime: 'image/webp' });
  }
}

const OUT = process.env.PODIUM_DUMP; // p. ej. PODIUM_DUMP=/tmp/x npx vitest run tests/podium-image.test.ts → guarda los PNG para revisarlos a ojo
const dump = (name: string, bytes: Buffer) => {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, `${name}.png`), bytes);
};

describe('imagen del podio: formatos', () => {
  it('lista cerrada: sin valor = horizontal; valores desconocidos se rechazan', () => {
    expect(parsePodiumFormat(null)).toBe('landscape');
    expect(parsePodiumFormat('')).toBe('landscape');
    for (const f of PODIUM_FORMATS) expect(parsePodiumFormat(f)).toBe(f);
    for (const bad of ['STORY', 'story ', '../x', 'portrait', '1080x1350', 'story&x=1']) expect(parsePodiumFormat(bad)).toBeNull();
  });

  it('la fecha sale en español y en zona de Madrid', () => {
    expect(podiumDate(snap(2).s)).toBe('18 de octubre de 2026');
  });

  const cases: [string, number, Parameters<typeof snap>[1]][] = [
    ['2-jugadores', 2, {}],
    ['5-jugadores', 5, {}],
    ['10-jugadores-nombres-largos', 10, { names: ['Alexandra María de los Ángeles', 'Bartolomé 🔥🔥', 'WWWWWWWWWWWWWWWWWWWW', 'Dani', 'Elena', 'Fran', 'iiiiiiiiiiiiiiiiiiiiiiii', 'Hugo', 'Irene', 'Javi'] }],
    ['empates', 5, { balances: [900, 900, 500, 500, 500] }],
    ['sin-clasificacion', 6, { rule: 'none' }],
    ['sin-premios', 4, { stats: false }],
    ['galeria', 5, { gallery: true }],
    ['sin-casas', 3, { houses: false }],
    ['un-jugador', 1, {}],
    ['cero-jugadores', 0, {}],
  ];
  for (const [name, n, opts] of cases) {
    for (const format of PODIUM_FORMATS) {
      it(`${name} · ${format}: PNG del tamaño exacto`, async () => {
        const { s, storage } = snap(n, opts);
        if (opts?.houses !== false) await fillHouses(s, storage);
        const res = await renderPodiumImage(s, storage, true, format);
        expect(res.headers.get('content-type')).toBe('image/png');
        const bytes = Buffer.from(await res.arrayBuffer());
        const meta = await sharp(bytes).metadata();
        expect([meta.width, meta.height]).toEqual([PODIUM_SIZES[format].width, PODIUM_SIZES[format].height]);
        dump(`${name}-${format}`, bytes);
      });
    }
  }

  it('descarga con nombre por formato, caché corta y más corta mientras se generan las casas', async () => {
    const a = snap(3);
    await fillHouses(a.s, a.storage);
    const story = await renderPodiumImage(a.s, a.storage, true, 'story');
    expect(story.headers.get('content-disposition')).toContain('podio-ABC123-story.png');
    expect((await renderPodiumImage(a.s, a.storage, true)).headers.get('content-disposition')).toContain('filename="podio-ABC123.png"');
    expect((await renderPodiumImage(a.s, a.storage, false)).headers.get('content-disposition')).toBeNull();
    expect(story.headers.get('cache-control')).toContain('s-maxage=120');
    const b = snap(3, { generating: true });
    expect((await renderPodiumImage(b.s, b.storage, false, 'square')).headers.get('cache-control')).toContain('s-maxage=10');
  });

  it('con la misma versión devuelve exactamente los mismos bytes (caché en proceso)', async () => {
    const a = snap(4);
    await fillHouses(a.s, a.storage);
    const x = Buffer.from(await (await renderPodiumImage(a.s, a.storage, false, 'square')).arrayBuffer());
    const y = Buffer.from(await (await renderPodiumImage(a.s, a.storage, false, 'square')).arrayBuffer());
    expect(x.equals(y)).toBe(true);
  });
});
