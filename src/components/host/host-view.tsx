'use client';
import type { HostSnapshot, RuntimeInfo } from '@/lib/domain/types';
export function HostView({ initial }: { roomCode: string; initial: HostSnapshot; runtime: RuntimeInfo; identity: { email: string | null; demo: boolean } }) {
  return <main>{initial.game.name}</main>;
}
