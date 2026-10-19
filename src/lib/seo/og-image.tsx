/* eslint-disable @next/next/no-img-element -- satori (next/og) solo renderiza <img> */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ImageResponse } from 'next/og';
import type { GameCard, GameLinkKind } from './site';
import { BODY_FAMILY, loadBrandFonts, TITLE_FAMILY } from './fonts';
import { SITE_NAME } from './site';

export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_ALT = 'Subasta Salvaje';

let logoUri: string | null = null;
async function logo(): Promise<string> {
  if (!logoUri) {
    const buf = await readFile(path.join(process.cwd(), 'public', 'assets', 'brand', 'logo-compact.png'));
    logoUri = `data:image/png;base64,${buf.toString('base64')}`;
  }
  return logoUri;
}
let headUri: string | null = null;
async function head(): Promise<string> {
  if (!headUri) {
    const buf = await readFile(path.join(process.cwd(), 'public', 'assets', 'brand', 'email-head.png'));
    headUri = `data:image/png;base64,${buf.toString('base64')}`;
  }
  return headUri;
}

const NIGHT = '#050816';
const CARD = '#111a35';
const GOLD = '#fbbf24';

/** Imagen Open Graph (1200×630) con la marca. Solo muestra datos públicos de la partida; con `game` null sale la tarjeta genérica. */
export async function renderOg(kind: GameLinkKind | 'generic', game: GameCard | null): Promise<ImageResponse> {
  const [logoSrc, headSrc, fonts] = await Promise.all([logo(), head(), loadBrandFonts()]);
  const title = fonts ? { fontFamily: TITLE_FAMILY } : {};
  const headline = !game
    ? 'Puja. Transforma. Alucina.'
    : kind === 'invite' ? 'Te han invitado a jugar' : kind === 'tv' ? 'Pantalla de TV' : kind === 'watch' ? 'Sigue la subasta en directo' : game.winner ? `Gana ${game.winner}` : 'Fin de la subasta';
  const sub = !game ? 'Subastas creativas para noches de juegos' : game.name;
  const note = !game ? '' : kind === 'invite' ? 'Entra desde tu móvil con este código' : kind === 'tv' ? 'Abre este enlace en la tele' : kind === 'watch' ? 'Solo lectura · sin cuenta ni código' : `${game.players.length} jugadores`;
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', background: `radial-gradient(circle at 20% 0%, #2a3a6e 0%, ${NIGHT} 70%)`, color: '#ffffff', padding: 48, fontFamily: fonts ? BODY_FAMILY : 'sans-serif' }}>
        <div style={{ display: 'flex', flex: 1, flexDirection: 'column', justifyContent: 'space-between' }}>
          <img src={logoSrc} width={340} height={Math.round(340 * (424 / 712))} alt="" />
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 66, fontWeight: 800, lineHeight: 1.05, color: GOLD, ...title }}>{headline}</div>
            <div style={{ fontSize: 40, fontWeight: 700, marginTop: 14, color: '#e8ecff', maxWidth: 640, ...title }}>{sub.length > 40 ? `${sub.slice(0, 39)}…` : sub}</div>
            {note ? <div style={{ fontSize: 28, marginTop: 10, color: '#aab4d6' }}>{note}</div> : null}
          </div>
        </div>
        <div style={{ display: 'flex', width: 380, flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <img src={headSrc} width={170} height={Math.round(170 * (356 / 312))} alt="" />
          {game && kind !== 'results' && kind !== 'watch' ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: 20, background: CARD, border: `4px solid ${GOLD}`, borderRadius: 28, padding: '14px 28px' }}>
              <div style={{ fontSize: 26, color: '#aab4d6' }}>CÓDIGO DE SALA</div>
              <div style={{ fontSize: 84, fontWeight: 800, letterSpacing: 8, color: GOLD, ...title }}>{game.code}</div>
            </div>
          ) : (
            <div style={{ marginTop: 24, fontSize: 30, color: '#aab4d6' }}>{SITE_NAME}</div>
          )}
        </div>
      </div>
    ),
    { ...OG_SIZE, ...(fonts ? { fonts } : {}), headers: { 'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300' } },
  );
}
