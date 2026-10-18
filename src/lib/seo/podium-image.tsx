/* eslint-disable @next/next/no-img-element -- satori (next/og) solo renderiza <img> */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ImageResponse } from 'next/og';
import sharp from 'sharp';
import { formatOhros } from '@/lib/domain/money';
import { joinedPlayers } from '@/lib/domain/players';
import { computeRanking, rankingRuleLabel } from '@/lib/domain/ranking';
import type { Player, PublicSnapshot } from '@/lib/domain/types';
import type { ImageStorage } from '@/lib/storage/types';
import { SITE_NAME } from './site';

export const PODIUM_SIZE = { width: 1200, height: 630 } as const;
const NIGHT = '#050816';
const CARD = '#111a35';
const GOLD = '#fbbf24';
const MAX_SHOWN = 5;

export interface PodiumRow {
  name: string;
  color: string;
  rank: number | null;
  score: string;
  /** Casa final como data URI PNG (puede faltar). */
  house: string | null;
}

/** Quita emojis y caracteres de control: satori intentaría descargar el emoji de un CDN externo y los nombres son texto libre. */
export const plainText = (s: string, max = 18): string => {
  const t = s.replace(/[\p{Extended_Pictographic}\p{Cc}‍️]/gu, '').trim() || 'Jugador';
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

function scoreText(rule: PublicSnapshot['game']['ranking_rule'], p: Player): string {
  if (rule === 'items') return `${p.purchases.length} ${p.purchases.length === 1 ? 'elemento' : 'elementos'}`;
  if (rule === 'votes') return `${p.votes} ${p.votes === 1 ? 'voto' : 'votos'}`;
  return formatOhros(p.balance_cents); // «balance» y «sin clasificación»: saldo final en Ohros
}

/** Filas del podio: solo jugadores que entraron (`joinedPlayers`), con su puntuación según la regla de la partida. */
export function podiumRows(snapshot: PublicSnapshot): { rows: Omit<PodiumRow, 'house'>[]; ids: string[]; players: Player[]; ruleLabel: string } {
  const rule = snapshot.game.ranking_rule;
  const players = joinedPlayers(snapshot.players);
  const ranking = computeRanking(players, rule);
  const ordered = ranking ? ranking.map((r) => ({ player: r.player, rank: r.rank as number | null })) : players.map((player) => ({ player, rank: null as number | null }));
  return {
    rows: ordered.map(({ player, rank }) => ({ name: plainText(player.name), color: player.color, rank, score: scoreText(rule, player) })),
    ids: ordered.map(({ player }) => player.id),
    players: ordered.map(({ player }) => player),
    ruleLabel: ranking ? rankingRuleLabel(rule) : 'Saldo final',
  };
}

/** Casa final reducida a PNG (satori no lee WebP). Si no se puede leer, null: el podio sale igualmente sin la miniatura. */
async function houseThumb(storage: Pick<ImageStorage, 'get'>, p: Player): Promise<string | null> {
  const sp = p.current_image?.storage_path;
  if (!sp || /^https?:/i.test(sp)) return null;
  try {
    const img = await storage.get(sp);
    const png = await sharp(Buffer.from(img.bytes)).resize(220, 165, { fit: 'cover' }).png().toBuffer();
    return `data:image/png;base64,${png.toString('base64')}`;
  } catch {
    return null;
  }
}

let logoUri: string | null = null;
async function logo(): Promise<string> {
  if (!logoUri) {
    const buf = await readFile(path.join(process.cwd(), 'public', 'assets', 'brand', 'logo-compact.png'));
    logoUri = `data:image/png;base64,${buf.toString('base64')}`;
  }
  return logoUri;
}

/** PNG 1200×630 del podio final: nombre de la partida, jugadores con su puntuación en Ohros y sus casas. Solo datos públicos. */
export async function renderPodiumImage(snapshot: PublicSnapshot, storage: Pick<ImageStorage, 'get'>, download: boolean): Promise<ImageResponse> {
  const { rows, players, ruleLabel } = podiumRows(snapshot);
  const shown = rows.slice(0, MAX_SHOWN);
  const houses = await Promise.all(players.slice(0, MAX_SHOWN).map((p) => houseThumb(storage, p)));
  const logoSrc = await logo();
  const extra = rows.length - shown.length;
  const name = plainText(snapshot.game.name, 34);
  const col = Math.floor(1104 / Math.max(shown.length, 1)) - 16;
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: `radial-gradient(circle at 20% 0%, #2a3a6e 0%, ${NIGHT} 70%)`, color: '#ffffff', padding: 48, fontFamily: 'sans-serif' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 58, fontWeight: 800, color: GOLD }}>Fin de la subasta</div>
            <div style={{ fontSize: 34, fontWeight: 700, color: '#e8ecff', marginTop: 4 }}>{name}</div>
            <div style={{ fontSize: 24, color: '#aab4d6', marginTop: 4 }}>{ruleLabel}</div>
          </div>
          <img src={logoSrc} width={250} height={Math.round(250 * (424 / 712))} alt="" />
        </div>
        <div style={{ display: 'flex', flex: 1, alignItems: 'flex-end', justifyContent: 'center', gap: 16, marginTop: 20 }}>
          {shown.map((r, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: col, background: CARD, border: `4px solid ${r.rank === 1 ? GOLD : r.color}`, borderRadius: 24, padding: 14, height: r.rank === null ? 330 : r.rank === 1 ? 400 : r.rank === 2 ? 360 : 330 }}>
              {houses[i] ? (
                <img src={houses[i]!} width={Math.min(col - 28, 220)} height={Math.round(Math.min(col - 28, 220) * 0.75)} style={{ borderRadius: 14 }} alt="" />
              ) : (
                <div style={{ display: 'flex', width: Math.min(col - 28, 220), height: Math.round(Math.min(col - 28, 220) * 0.75), borderRadius: 14, background: '#1b2547' }} />
              )}
              {r.rank !== null ? <div style={{ fontSize: 40, fontWeight: 800, color: r.rank === 1 ? GOLD : '#e8ecff', marginTop: 10 }}>{`${r.rank}.º`}</div> : null}
              <div style={{ fontSize: 30, fontWeight: 800, color: r.color, marginTop: 6, textAlign: 'center' }}>{r.name}</div>
              <div style={{ fontSize: 26, fontWeight: 700, color: '#ffffff', marginTop: 6 }}>{r.score}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16, fontSize: 24, color: '#aab4d6' }}>
          <div>{extra > 0 ? `y ${extra} jugador${extra === 1 ? '' : 'es'} más` : ''}</div>
          <div>{SITE_NAME}</div>
        </div>
      </div>
    ),
    {
      ...PODIUM_SIZE,
      headers: {
        'Cache-Control': 'public, max-age=0, s-maxage=120, stale-while-revalidate=300',
        ...(download ? { 'Content-Disposition': `attachment; filename="podio-${snapshot.game.room_code}.png"` } : {}),
      },
    },
  );
}
