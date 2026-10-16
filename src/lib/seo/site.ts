import type { Metadata } from 'next';
import { getRuntimeMode } from '@/lib/config/env';
import { computeRanking } from '@/lib/domain/ranking';

export const SITE_NAME = 'Subasta Salvaje';
export const SITE_DESCRIPTION = 'Subasta creativa multijugador: puja, construye tu casa y mira cómo la IA la transforma.';

/** Dominio público para `metadataBase` y los enlaces absolutos de Open Graph (variable → producción de Vercel → localhost). */
export function siteUrl(env: NodeJS.ProcessEnv = process.env): URL {
  const raw = env.NEXT_PUBLIC_SITE_URL?.trim() || (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL.trim()}` : '') || 'http://localhost:3000';
  try {
    return new URL(raw.startsWith('http') ? raw : `https://${raw}`);
  } catch {
    return new URL('http://localhost:3000');
  }
}

/** Datos PÚBLICOS de una partida para títulos e imágenes (nunca del anfitrión). null si no existe o no hay backend. */
export interface GameCard {
  code: string;
  name: string;
  status: 'lobby' | 'active' | 'paused' | 'finished';
  players: string[];
  winner: string | null;
}

export async function loadGameCard(code: string): Promise<GameCard | null> {
  if (getRuntimeMode() === 'unconfigured') return null;
  try {
    const { getContext } = await import('@/lib/services/context');
    const { getPublicState } = await import('@/lib/services/game-service');
    const snap = await getPublicState(await getContext(), code);
    const ranking = snap.game.status === 'finished' ? computeRanking(snap.players, snap.game.ranking_rule) : null;
    return {
      code: snap.game.room_code,
      name: snap.game.name,
      status: snap.game.status as GameCard['status'],
      players: snap.players.map((p) => p.name),
      winner: ranking?.[0] && ranking[0].rank === 1 ? ranking[0].player.name : null,
    };
  } catch {
    return null; // partida inexistente o error: se usa la tarjeta genérica
  }
}

export type GameLinkKind = 'invite' | 'tv' | 'results';

/** Título y descripción de cada tipo de enlace de partida. */
export function gameLinkText(kind: GameLinkKind, g: GameCard | null): { title: string; description: string } {
  if (!g) return { title: SITE_NAME, description: SITE_DESCRIPTION };
  if (kind === 'invite') return { title: `Te han invitado a «${g.name}»`, description: `Entra con el código ${g.code} y puja desde tu móvil en Subasta Salvaje.` };
  if (kind === 'tv') return { title: `Pantalla de TV · ${g.name}`, description: `Sala ${g.code}. Abre este enlace en la tele para seguir la subasta en directo.` };
  return { title: g.winner ? `Resultados de «${g.name}»: gana ${g.winner}` : `Resultados de «${g.name}»`, description: `Así quedaron las casas de ${g.players.length} jugadores en Subasta Salvaje.` };
}

/** Metadatos de un enlace de partida. La imagen la genera `opengraph-image.tsx` de la propia ruta (Next la añade sola). */
export async function gameMetadata(code: string, kind: GameLinkKind): Promise<Metadata> {
  const g = await loadGameCard(code.toUpperCase());
  const { title, description } = gameLinkText(kind, g);
  const path = kind === 'invite' ? `/game/${code.toUpperCase()}/play` : kind === 'tv' ? `/game/${code.toUpperCase()}/screen` : `/game/${code.toUpperCase()}/results`;
  return {
    title: kind === 'invite' ? 'Jugar desde el móvil' : kind === 'tv' ? 'Pantalla de TV' : 'Resultados',
    description,
    robots: { index: false, follow: false }, // las partidas son privadas: que no las indexe ningún buscador
    alternates: { canonical: path },
    openGraph: { type: 'website', siteName: SITE_NAME, title, description, url: path, locale: 'es_ES' },
    twitter: { card: 'summary_large_image', title, description },
  };
}

