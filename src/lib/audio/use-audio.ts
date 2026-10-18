'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useAutoAwardCountdown } from '@/lib/client/auto-award';
import type { Player, PublicSnapshot } from '@/lib/domain/types';
import { presenceSound, type Presence } from './presence';
import { getAudioSnapshot, getServerAudioSnapshot, initAudio, play, resumeMusic, setGate, setMusicScene, subscribeAudio, type AudioRole, type MusicScene } from './engine';

export const useAudioState = () => useSyncExternalStore(subscribeAudio, getAudioSnapshot, getServerAudioSnapshot);

/**
 * Suena lo que pasa en la partida comparando cada instantánea con la anterior (sin disparar nada en el primer render).
 *  · tv: efectos + música; host: solo efectos discretos; play: usa `usePlayerSounds`.
 *  · El anfitrión puede silenciar efectos y música de la TV desde su panel (`game.sound_enabled` / `music_enabled`).
 */
export function useGameAudio(snap: PublicSnapshot, role: Extract<AudioRole, 'tv' | 'host'>): void {
  const { game, auction, last_award } = snap;
  const audio = useAudioState();
  const countdown = useAutoAwardCountdown(snap);
  const prev = useRef<{ id: string | null; bids: number; status: string | null; award: string | null; game: string; tick: number | null } | null>(null);

  useEffect(() => { initAudio(role); }, [role]);
  // Interruptores de la partida: solo mandan sobre la TV.
  useEffect(() => {
    setGate(role === 'tv' ? { effects: game.sound_enabled !== false, music: game.sound_enabled !== false && game.music_enabled !== false } : { effects: true, music: false });
  }, [role, game.sound_enabled, game.music_enabled]);

  // Presencia (solo TV y modo móviles): suena cuando alguien entra o sale y, distinto, cuando están todos los previstos.
  const connected = snap.players.filter((p) => p.claimed).length;
  const presence: Presence | null = role === 'tv' && game.play_mode === 'mobile' ? { connected, total: snap.players.length, lobby: game.status === 'lobby' } : null;
  const prevPresence = useRef<Presence | null>(null);
  const presenceKey = presence ? `${presence.connected}/${presence.total}/${presence.lobby}` : '';
  useEffect(() => {
    const before = prevPresence.current;
    prevPresence.current = presence;
    if (!before || !presence) return;
    const s = presenceSound(before, presence);
    if (s) play(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo cuando cambia la presencia
  }, [presenceKey]);

  // «¡Nadie lo quiere!»: suena una vez por cada elemento perdido nuevo (lo que ya estaba al abrir la pantalla no suena)
  const unsoldId = snap.last_unsold ? snap.last_unsold.event_id : null;
  const prevUnsold = useRef<{ id: number | null } | null>(null);
  useEffect(() => {
    const before = prevUnsold.current;
    prevUnsold.current = { id: unsoldId };
    if (before && unsoldId !== null && unsoldId !== before.id) play('unsold');
  }, [unsoldId]);

  const awardId = last_award ? String(last_award.purchase_id) : null;
  useEffect(() => {
    const cur = { id: auction?.id ?? null, bids: auction ? (auction.bids_count ?? auction.bids.length) : 0, status: auction?.status ?? null, award: awardId, game: game.status, tick: countdown };
    const p = prev.current;
    prev.current = cur;
    if (!p) return;
    if (cur.id && cur.id !== p.id && cur.status === 'open') play('announce');
    else if (cur.id === p.id && cur.bids > p.bids) play('bid', cur.bids);
    if (role === 'tv' && cur.tick !== null && cur.tick !== p.tick && cur.tick > 0 && cur.tick <= 10) play(cur.tick <= 3 ? 'tickUrgent' : 'tick');
    if (cur.status === 'closed' && p.status !== 'closed') play('closed');
    if (cur.award && cur.award !== p.award) play('award');
    if (cur.game === 'finished' && p.game !== 'finished') play('finish');
  }, [auction, awardId, game.status, countdown, role]);

  // Escena de música (solo la TV)
  let scene: MusicScene = null;
  if (role === 'tv') {
    if (game.status === 'lobby') scene = 'waiting';
    else if (game.status === 'active' && auction?.status === 'open') scene = countdown !== null && countdown > 0 && countdown <= 10 ? 'tense' : 'auction';
    else if (game.status === 'active') scene = 'lobby';
  }
  useEffect(() => {
    if (!audio.enabled || !audio.armed) return setMusicScene(null);
    setMusicScene(scene);
    resumeMusic();
  }, [scene, audio.enabled, audio.armed, audio.music]);
}

/** Sonidos personales del móvil: vas ganando, te han superado, te llevaste el objeto. */
export function usePlayerSounds(snap: PublicSnapshot, me: Player): void {
  const { game, auction, last_award } = snap;
  const open = auction?.status === 'open' && game.status === 'active';
  const leading = Boolean(open && !auction!.hidden && auction!.current_bidder_id === me.id);
  const won = last_award?.player_id === me.id ? String(last_award.purchase_id) : null;
  const prev = useRef<{ leading: boolean; won: string | null; id: string | null } | null>(null);
  useEffect(() => { initAudio('play'); setGate({ effects: true, music: false }); }, []);
  useEffect(() => {
    const p = prev.current;
    prev.current = { leading, won, id: auction?.id ?? null };
    if (!p) return;
    if (won && won !== p.won) play('won');
    else if (leading && !p.leading) play('leading');
    else if (!leading && p.leading && open) play('outbid');
    else if (auction?.id && auction.id !== p.id && auction.status === 'open') play('announce');
  }, [leading, won, open, auction?.id, auction?.status]);
}
