/* eslint-disable @next/next/no-img-element -- satori (next/og) solo renderiza <img> */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ImageResponse } from 'next/og';
import sharp from 'sharp';
import { formatOhros } from '@/lib/domain/money';
import { joinedPlayers } from '@/lib/domain/players';
import { computeAwards, computeRanking, rankingRuleLabel } from '@/lib/domain/ranking';
import type { Player, PublicSnapshot } from '@/lib/domain/types';
import type { ImageStorage } from '@/lib/storage/types';
import { SITE_NAME } from './site';

/**
 * Imagen PNG del podio final, pensada para compartir. Tres formatos (lista cerrada, ver `PODIUM_FORMATS`):
 *  · `landscape` 1200×630 (el original y valor por defecto: tarjeta horizontal),
 *  · `square` 1080×1080,
 *  · `story` 1080×1350 (vertical, para el móvil).
 * Solo datos públicos de la instantánea (nombres, puntuación, casas finales, premios y estadísticas). Sin red en ejecución: todo sale de
 * `public/assets` y de Storage; la tipografía es la que trae `next/og` (satori no lee woff2, así que no se puede usar Baloo 2).
 */
export const PODIUM_FORMATS = ['landscape', 'square', 'story'] as const;
export type PodiumFormat = (typeof PODIUM_FORMATS)[number];
export const PODIUM_SIZES: Record<PodiumFormat, { width: number; height: number }> = {
  landscape: { width: 1200, height: 630 },
  square: { width: 1080, height: 1080 },
  story: { width: 1080, height: 1350 },
};
/** Tamaño del formato por defecto (compatibilidad). */
export const PODIUM_SIZE = PODIUM_SIZES.landscape;

/** Valida `?format=`: null/ausente → `landscape`; cualquier otro valor fuera de la lista cerrada → null (la ruta responde 400). */
export function parsePodiumFormat(raw: string | null): PodiumFormat | null {
  if (raw === null || raw === '') return 'landscape';
  return (PODIUM_FORMATS as readonly string[]).includes(raw) ? (raw as PodiumFormat) : null;
}

const NIGHT = '#050816';
const NIGHT_2 = '#0b1230';
const CARD = '#111a35';
const CARD_2 = '#1b2547';
const GOLD = '#fbbf24';
const MUTED = '#b4bddc';
const SOFT = '#e8ecff';
const MAX_PLAYERS = 10;

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

// ---------- Recursos locales (logo, mascota, iconos): se leen una vez y se guardan como data URI PNG ----------

const assetCache = new Map<string, string>();
async function asset(rel: string, width: number): Promise<string> {
  const key = `${rel}@${width}`;
  const hit = assetCache.get(key);
  if (hit) return hit;
  const buf = await readFile(path.join(process.cwd(), 'public', 'assets', rel));
  const png = await sharp(buf).resize({ width, withoutEnlargement: false }).png().toBuffer();
  const uri = `data:image/png;base64,${png.toString('base64')}`;
  assetCache.set(key, uri);
  return uri;
}

/** Icono (mascota) de cada premio. Un premio nuevo que aún no tenga icono usa el brillo. */
const AWARD_ICON: Record<string, string> = {
  shark: 'mascot/item-martillo.webp',
  spender: 'mascot/item-moneda.webp',
  saver: 'mascot/item-temporizador.webp',
  hothead: 'mascot/item-megafono.webp',
  peacemaker: 'mascot/item-bocadillo.webp',
  unlucky: 'mascot/item-brillo.webp',
  gallery: 'mascot/item-corona.webp',
};
const awardIconPath = (id: string) => AWARD_ICON[id] ?? 'mascot/item-brillo.webp';

/** Casa final recortada a `w`×`h` como data URI PNG (satori no lee WebP). Si no se puede leer, null: se dibuja un marcador elegante. */
async function houseThumb(storage: Pick<ImageStorage, 'get'>, p: Player, w: number, h: number): Promise<string | null> {
  const sp = p.current_image?.storage_path;
  if (!sp || /^https?:/i.test(sp)) return null;
  try {
    const img = await storage.get(sp);
    const png = await sharp(Buffer.from(img.bytes)).resize(w * 2, h * 2, { fit: 'cover' }).png().toBuffer();
    return `data:image/png;base64,${png.toString('base64')}`;
  } catch {
    return null;
  }
}

// ---------- Modelo de dibujo ----------

interface Entry {
  id: string;
  name: string;
  color: string;
  rank: number | null;
  score: string;
  house: string | null;
}
interface Chip {
  icon: string;
  title: string;
  who: string;
  detail: string;
}
interface Stat {
  label: string;
  value: string;
}

/** Jugadores de un premio: «Ana», «Ana y Beto», «Ana, Beto y 2 más». */
function whoText(players: Player[], max = 14): string {
  const names = players.map((p) => plainText(p.name, max));
  if (names.length <= 2) return names.join(' y ');
  return `${names.slice(0, 2).join(', ')} y ${names.length - 2} más`;
}

/** Fecha de la partida en español («18 de octubre de 2026»), sin depender de la zona horaria del servidor. */
export function podiumDate(snapshot: PublicSnapshot): string {
  const iso = snapshot.game.finished_at ?? snapshot.game.created_at;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Madrid' }).format(d);
}

const bold = (color: string, px = 1.4) => ({ color, WebkitTextStroke: `${px}px ${color}` }) as const;
const ell = { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const;

/** Texto de una línea con puntos suspensivos y alineación real (satori ignora `textAlign` junto a `textOverflow`). */
function Line({ w, align = 'center', style, children }: { w: number; align?: 'center' | 'left' | 'right'; style: Record<string, string | number>; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', width: w, justifyContent: align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start' }}>
      <div style={{ ...ell, maxWidth: w, ...style }}>{children}</div>
    </div>
  );
}

const MEDAL: Record<number, [string, string, string]> = {
  1: ['#fde68a', '#f59e0b', '#78350f'],
  2: ['#f1f5f9', '#94a3b8', '#1e293b'],
  3: ['#fdba74', '#b45309', '#431407'],
};

/** Medalla redonda con degradado (oro, plata, bronce) o ficha lisa a partir del 4.º puesto. */
function Medal({ rank, size }: { rank: number; size: number }) {
  const m = MEDAL[rank];
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: size,
        background: m ? `linear-gradient(145deg, ${m[0]}, ${m[1]})` : CARD_2,
        border: `${Math.max(2, Math.round(size / 14))}px solid ${m ? '#fff7d6' : '#3a4775'}`,
        boxShadow: '0 4px 14px rgba(0,0,0,0.45)',
        fontSize: Math.round(size * 0.56),
        ...bold(m ? m[2] : SOFT, 0.8),
      }}
    >
      {rank}
    </div>
  );
}

/** Miniatura de la casa o, si no hay imagen, un marcador con el color del jugador y una casita dibujada. */
function House({ src, w, h, color, radius }: { src: string | null; w: number; h: number; color: string; radius: number }) {
  if (src) return <img src={src} width={w} height={h} style={{ width: w, height: h, borderRadius: radius, objectFit: 'cover' }} alt="" />;
  const s = Math.round(Math.min(w, h) * 0.5);
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: w, height: h, borderRadius: radius, background: `linear-gradient(160deg, ${CARD_2}, ${NIGHT_2})`, border: `2px dashed ${color}` }}>
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 11.5 12 4l9 7.5" />
        <path d="M5.5 10v9.5h13V10" />
        <path d="M10 19.5v-5h4v5" />
      </svg>
    </div>
  );
}

function PodiumColumn({ e, place, colW, thumbH, scale }: { e: Entry; place: number; colW: number; thumbH: number; scale: number }) {
  const rank = e.rank ?? place;
  const pedestal = Math.round((rank === 1 ? 118 : rank === 2 ? 88 : 62) * scale);
  const border = rank === 1 ? GOLD : e.color;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: colW }}>
      <div style={{ display: 'flex', position: 'relative', width: colW, height: thumbH, border: `${Math.round(5 * scale)}px solid ${border}`, borderRadius: Math.round(22 * scale), overflow: 'hidden', background: CARD }}>
        <House src={e.house} w={colW - Math.round(10 * scale)} h={thumbH - Math.round(10 * scale)} color={e.color} radius={0} />
      </div>
      <div style={{ display: 'flex', marginTop: -Math.round(26 * scale) }}>
        <Medal rank={rank} size={Math.round(54 * scale)} />
      </div>
      <Line w={colW} style={{ marginTop: Math.round(6 * scale), fontSize: Math.round(32 * scale), ...bold(e.color, 1) }}>{e.name}</Line>
      <Line w={colW} style={{ fontSize: Math.round(25 * scale), color: SOFT }}>{e.score}</Line>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: colW,
          height: pedestal,
          marginTop: Math.round(10 * scale),
          borderRadius: `${Math.round(14 * scale)}px ${Math.round(14 * scale)}px 0 0`,
          background: rank === 1 ? 'linear-gradient(180deg, #fbbf24, #b45309)' : rank === 2 ? 'linear-gradient(180deg, #cbd5e1, #64748b)' : 'linear-gradient(180deg, #d98a4a, #7c3f12)',
          fontSize: Math.round(54 * scale),
          ...bold(rank === 1 ? '#451a03' : '#0f172a', 1.5),
        }}
      >
        {`${rank}.º`}
      </div>
    </div>
  );
}

/** Podio de los 3 primeros de la lista: el 1.º en el centro, el 2.º a la izquierda y el 3.º a la derecha (empates comparten escalón). */
function Podium({ top, colW, thumbH, scale, gap }: { top: Entry[]; colW: number; thumbH: number; scale: number; gap: number }) {
  const order = [top[1], top[0], top[2]].filter((x): x is Entry => !!x);
  const place = (e: Entry) => top.indexOf(e) + 1;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap }}>
      {order.map((e) => (
        <PodiumColumn key={e.id} e={e} place={place(e)} colW={colW} thumbH={thumbH} scale={scale} />
      ))}
    </div>
  );
}

/** Fila compacta del resto de jugadores (puesto, miniatura, nombre y puntuación). */
function RestRow({ e, w, h, ranked }: { e: Entry; w: number; h: number; ranked: boolean }) {
  const th = h - 8;
  return (
    <div style={{ display: 'flex', alignItems: 'center', width: w, height: h, padding: '0 10px 0 6px', borderRadius: h / 2.6, background: CARD, borderLeft: `6px solid ${e.color}`, gap: 10 }}>
      {ranked && e.rank !== null ? <Medal rank={e.rank} size={Math.round(h * 0.66)} /> : null}
      <House src={e.house} w={Math.round(th * 1.33)} h={th} color={e.color} radius={8} />
      <div style={{ display: 'flex', flex: 1, minWidth: 0 }}>
        <div style={{ ...ell, fontSize: Math.round(h * 0.46), ...bold(e.color, 0.8) }}>{e.name}</div>
      </div>
      <Line w={Math.round(w * 0.34)} align="right" style={{ fontSize: Math.round(h * 0.4), color: SOFT }}>{e.score}</Line>
    </div>
  );
}

function Chips({ chips, w, h, cols, gap }: { chips: Chip[]; w: number; h: number; cols: number; gap: number }) {
  const cw = Math.floor((w - gap * (cols - 1)) / cols);
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap, width: w, justifyContent: 'center' }}>
      {chips.map((c, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', width: cw, height: h, padding: '0 12px 0 8px', gap: 10, borderRadius: h / 2.4, background: 'linear-gradient(135deg, #1b2547, #111a35)', border: '2px solid #34427a' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: h - 14, height: h - 14, borderRadius: h, background: '#0b1230', flexShrink: 0 }}>
            <img src={c.icon} width={h - 26} height={h - 26} alt="" />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
            <div style={{ ...ell, fontSize: Math.round(h * 0.36), ...bold(GOLD, 0.7) }}>{c.title}</div>
            <div style={{ ...ell, fontSize: Math.round(h * 0.28), color: SOFT }}>{c.detail ? `${c.who} · ${c.detail}` : c.who}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Stats({ stats, w, h, gap }: { stats: Stat[]; w: number; h: number; gap: number }) {
  const cw = Math.floor((w - gap * (stats.length - 1)) / stats.length);
  return (
    <div style={{ display: 'flex', gap, width: w }}>
      {stats.map((s) => (
        <div key={s.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: cw, height: h, borderRadius: 16, background: CARD, border: '2px solid #263259' }}>
          <Line w={cw - 16} style={{ fontSize: Math.round(h * 0.42), color: SOFT }}>{s.value}</Line>
          <Line w={cw - 16} style={{ fontSize: Math.round(h * 0.23), color: MUTED }}>{s.label}</Line>
        </div>
      ))}
    </div>
  );
}

/** Confeti estático y determinista (mismas posiciones siempre: la imagen no cambia entre peticiones). */
function Confetti({ w, h, n }: { w: number; h: number; n: number }) {
  const colors = [GOLD, '#fb7185', '#2dd4bf', '#a78bfa', '#60a5fa'];
  return (
    <>
      {Array.from({ length: n }, (_, i) => {
        const x = (i * 7919 + 131) % 1000;
        const y = (i * 104729 + 17) % 1000;
        const size = 8 + ((i * 13) % 12);
        return (
          <div
            key={i}
            style={{ position: 'absolute', left: Math.round((x / 1000) * w), top: Math.round((y / 1000) * h * 0.55), width: size, height: Math.round(size * 0.45), background: colors[i % colors.length], opacity: 0.55, transform: `rotate(${(i * 47) % 180}deg)` }}
          />
        );
      })}
    </>
  );
}

// ---------- Composición por formato ----------

interface Model {
  format: PodiumFormat;
  title: string;
  gameName: string;
  date: string;
  ruleLabel: string;
  entries: Entry[];
  ranked: boolean;
  chips: Chip[];
  stats: Stat[];
  logo: string;
  mascot: string;
  extra: number;
}

function Layout({ m }: { m: Model }) {
  const { width: W, height: H } = PODIUM_SIZES[m.format];
  const story = m.format === 'story';
  const land = m.format === 'landscape';
  const pad = land ? 30 : 44;
  const inner = W - pad * 2;
  const n = m.entries.length;
  const top = m.ranked ? m.entries.slice(0, Math.min(3, n)) : [];
  const rest = m.ranked ? m.entries.slice(top.length) : m.entries;

  const header = land ? (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: inner, height: 84 }}>
      <img src={m.logo} width={150} height={Math.round(150 * (424 / 712))} alt="" />
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, minWidth: 0, padding: '0 20px' }}>
        <Line w={760} style={{ fontSize: 50, ...bold(GOLD, 1.6) }}>{m.title}</Line>
        <Line w={760} style={{ fontSize: 26, color: SOFT }}>{m.gameName}</Line>
      </div>
      <img src={m.mascot} width={84} height={84} style={{ borderRadius: 18 }} alt="" />
    </div>
  ) : (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: inner }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: inner }}>
        <img src={m.logo} width={story ? 156 : 150} height={Math.round((story ? 156 : 150) * (424 / 712))} alt="" />
        <div style={{ display: 'flex', padding: '8px 20px', borderRadius: 30, background: CARD, border: '2px solid #34427a', fontSize: story ? 26 : 24, color: SOFT }}>{m.date}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: inner, marginTop: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, minWidth: 0 }}>
          <Line w={inner - (story ? 170 : 140)} style={{ fontSize: story ? 68 : 58, ...bold(GOLD, 2) }}>{m.title}</Line>
          <Line w={inner - (story ? 170 : 140)} style={{ fontSize: story ? 38 : 32, color: '#ffffff' }}>{m.gameName}</Line>
          <Line w={inner - (story ? 170 : 140)} style={{ fontSize: story ? 24 : 21, color: MUTED }}>{m.ruleLabel}</Line>
        </div>
        <img src={m.mascot} width={story ? 130 : 104} height={story ? 130 : 104} style={{ borderRadius: 28 }} alt="" />
      </div>
    </div>
  );

  // Sección principal: podio + resto (o cuadrícula de casas si no hay clasificación)
  let main: React.ReactNode;
  if (n === 0) {
    main = <div style={{ display: 'flex', fontSize: 34, color: MUTED }}>Esta partida no tuvo jugadores.</div>;
  } else if (!m.ranked) {
    const cols = n <= 3 ? n : n <= 6 ? 3 : 5;
    const rows = Math.ceil(n / cols);
    const availH = land ? 330 : story ? 640 : 470;
    const availW = land ? 700 : inner;
    const cellW = Math.floor((availW - 18 * (cols - 1)) / cols);
    const thumbH = Math.min(Math.round(cellW * 0.75), Math.floor((availH - rows * 70) / rows));
    main = (
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 18, width: availW }}>
        {m.entries.map((e) => (
          <div key={e.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: cellW }}>
            <div style={{ display: 'flex', width: cellW, height: thumbH, border: `4px solid ${e.color}`, borderRadius: 18, overflow: 'hidden' }}>
              <House src={e.house} w={cellW - 8} h={thumbH - 8} color={e.color} radius={0} />
            </div>
            <Line w={cellW} style={{ marginTop: 6, fontSize: cols >= 5 ? 24 : 30, ...bold(e.color, 0.9) }}>{e.name}</Line>
            <Line w={cellW} style={{ fontSize: cols >= 5 ? 20 : 24, color: SOFT }}>{e.score}</Line>
          </div>
        ))}
      </div>
    );
  } else if (land) {
    const showRest = rest.length > 0;
    const rowH = rest.length > 5 ? 34 : 40;
    const restCols = 1;
    main = (
      <div style={{ display: 'flex', width: inner, justifyContent: showRest ? 'space-between' : 'center', alignItems: 'flex-end' }}>
        <Podium top={top} colW={n === 1 ? 240 : 190} thumbH={n === 1 ? 180 : 142} scale={0.82} gap={18} />
        {showRest ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, width: 440 }}>
            {rest.map((e) => (
              <RestRow key={e.id} e={e} w={440 / restCols} h={rowH} ranked />
            ))}
          </div>
        ) : null}
      </div>
    );
  } else {
    const colW = story ? 300 : 250;
    const thumbH = story ? 196 : 168;
    const rowH = story ? 50 : 42;
    const twoCols = rest.length > 3;
    const rw = twoCols ? Math.floor((inner - 16) / 2) : Math.min(inner, 560);
    main = (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: inner, gap: story ? 22 : 14 }}>
        <Podium top={top} colW={colW} thumbH={thumbH} scale={story ? 0.92 : 0.82} gap={story ? 24 : 18} />
        {rest.length > 0 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: story ? 8 : 6, width: inner }}>
            {rest.map((e) => (
              <RestRow key={e.id} e={e} w={rw} h={rowH} ranked />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  const chipH = story ? 62 : 56;
  const maxChips = land ? 0 : story ? (rest.length > 3 ? 4 : 6) : rest.length > 3 ? 2 : 4;
  const chips = m.chips.slice(0, maxChips);
  const footer = (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: inner, fontSize: land ? 20 : 24, color: MUTED }}>
      <div style={{ display: 'flex' }}>{[land ? m.date : '', m.extra > 0 ? `y ${m.extra} jugador${m.extra === 1 ? '' : 'es'} más` : ''].filter(Boolean).join(' · ')}</div>
      <div style={{ display: 'flex', ...bold(MUTED, 0.4) }}>{SITE_NAME}</div>
    </div>
  );

  return (
    <div style={{ position: 'relative', width: W, height: H, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between', padding: `${pad - 8}px ${pad}px ${pad - 14}px`, background: `radial-gradient(circle at 50% -5%, #34417f 0%, ${NIGHT_2} 48%, ${NIGHT} 100%)`, color: '#ffffff', fontFamily: 'sans-serif' }}>
      <Confetti w={W} h={H} n={land ? 18 : 26} />
      {header}
      <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', width: inner }}>{main}</div>
      {land ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: inner }}>
          {m.chips.length > 0 ? <Chips chips={m.chips.slice(0, 3)} w={inner} h={50} cols={Math.min(3, m.chips.length)} gap={10} /> : null}
          <Stats stats={m.stats} w={inner} h={50} gap={10} />
          {footer}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: story ? 14 : 10, width: inner }}>
          {chips.length > 0 ? <Chips chips={chips} w={inner} h={chipH} cols={2} gap={12} /> : null}
          <Stats stats={m.stats} w={inner} h={story ? 76 : 68} gap={12} />
          {footer}
        </div>
      )}
    </div>
  );
}

// ---------- Caché en proceso (clave: partida + formato + versión de la instantánea; las imágenes nuevas suben la versión) ----------

const CACHE_MAX = 24;
const pngCache = new Map<string, Uint8Array>();

/** ¿Alguna casa se está regenerando todavía? Entonces la imagen aún puede cambiar y no conviene cachearla mucho. */
export const podiumStillSettling = (snapshot: PublicSnapshot): boolean => snapshot.players.some((p) => p.generating.length > 0);

/**
 * PNG del podio final. Devuelve una `Response` con el PNG y caché HTTP corta (más corta mientras se generan las casas finales).
 * `download` añade `Content-Disposition: attachment`.
 */
export async function renderPodiumImage(snapshot: PublicSnapshot, storage: Pick<ImageStorage, 'get'>, download: boolean, format: PodiumFormat = 'landscape'): Promise<Response> {
  const { width, height } = PODIUM_SIZES[format];
  const settling = podiumStillSettling(snapshot);
  const cacheKey = `${snapshot.game.id}:${format}:${snapshot.version}`;
  let bytes = pngCache.get(cacheKey);
  if (!bytes) {
    bytes = await draw(snapshot, storage, format);
    if (!settling) {
      if (pngCache.size >= CACHE_MAX) pngCache.delete(pngCache.keys().next().value as string);
      pngCache.set(cacheKey, bytes);
    }
  }
  const body = new Uint8Array(bytes).buffer as ArrayBuffer;
  return new Response(body, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': settling ? 'public, max-age=0, s-maxage=10, stale-while-revalidate=30' : 'public, max-age=30, s-maxage=120, stale-while-revalidate=300',
      'X-Image-Size': `${width}x${height}`,
      ...(download ? { 'Content-Disposition': `attachment; filename="podio-${snapshot.game.room_code}${format === 'landscape' ? '' : `-${format}`}.png"` } : {}),
    },
  });
}

async function draw(snapshot: PublicSnapshot, storage: Pick<ImageStorage, 'get'>, format: PodiumFormat): Promise<Uint8Array> {
  const { rows, players, ruleLabel } = podiumRows(snapshot);
  const ranked = rows.length > 0 && rows[0]!.rank !== null;
  const shownCount = Math.min(rows.length, MAX_PLAYERS);
  const story = format === 'story';
  const land = format === 'landscape';
  // Tamaño de miniatura por puesto: grandes en el podio, pequeñas en la lista
  const thumbSize = (i: number): [number, number] => {
    if (!ranked) return land ? [260, 195] : [300, 225];
    if (i < 3) return story ? [300, 196] : land ? [200, 150] : [250, 168];
    return [80, 60];
  };
  const [logo, mascot, ...icons] = await Promise.all([
    asset('brand/logo-compact.png', 420),
    asset('mascot/expr-celebrando.webp', 260),
    ...Array.from(new Set([...Object.values(AWARD_ICON), 'mascot/item-brillo.webp'])).map((p) => asset(p, 96)),
  ]);
  void icons;
  const houses = await Promise.all(players.slice(0, shownCount).map((p, i) => houseThumb(storage, p, ...thumbSize(i))));
  const entries: Entry[] = rows.slice(0, shownCount).map((r, i) => ({ id: players[i]!.id, name: r.name, color: r.color, rank: r.rank, score: r.score, house: houses[i] ?? null }));

  const awards = computeAwards(players, snapshot.player_stats);
  const chips: Chip[] = [];
  const g = snapshot.gallery;
  if (g?.enabled && g.closed && g.results?.length) {
    const top = Math.max(...g.results.map((r) => r.votes));
    const winners = players.filter((p) => g.results!.find((r) => r.player_id === p.id)?.votes === top);
    if (top > 0 && winners.length > 0) chips.push({ icon: await asset(awardIconPath('gallery'), 96), title: 'Mejor casa', who: whoText(winners), detail: `${top} ${top === 1 ? 'voto' : 'votos'}` });
  }
  for (const a of awards) chips.push({ icon: await asset(awardIconPath(a.id), 96), title: plainText(a.title, 28), who: whoText(a.players), detail: plainText(a.detail, 30) });

  const stats: Stat[] = [
    { label: 'Elementos subastados', value: String(snapshot.stats.purchases_count) },
    { label: 'Dinero gastado', value: formatOhros(snapshot.stats.total_spent_cents) },
    { label: 'Pujas totales', value: String(snapshot.stats.bids_count) },
  ];

  const model: Model = {
    format,
    title: 'Fin de la subasta',
    gameName: plainText(snapshot.game.name, 38),
    date: podiumDate(snapshot),
    ruleLabel,
    entries,
    ranked,
    chips,
    stats,
    logo,
    mascot,
    extra: rows.length - shownCount,
  };
  const res = new ImageResponse(<Layout m={model} />, PODIUM_SIZES[format]);
  return new Uint8Array(await res.arrayBuffer());
}
