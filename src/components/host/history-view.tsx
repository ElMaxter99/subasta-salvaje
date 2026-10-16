'use client';
import type { HostSnapshot, RuntimeInfo } from '@/lib/domain/types';
export function HistoryView({ initial }: { roomCode: string; initial: HostSnapshot; runtime: RuntimeInfo }) {
  return <main>{initial.game.name}</main>;
}
