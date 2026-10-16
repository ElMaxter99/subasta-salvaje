'use client';
import type { PublicSnapshot, RuntimeInfo } from '@/lib/domain/types';
export function PlayView({ initial }: { roomCode: string; initial: PublicSnapshot; runtime: RuntimeInfo; initialPlayerId: string | null }) {
  return <main>{initial.game.name}</main>;
}
