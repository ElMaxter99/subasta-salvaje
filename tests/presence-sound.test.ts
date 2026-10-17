import { describe, expect, it } from 'vitest';
import { presenceSound, type Presence } from '@/lib/audio/presence';

const P = (connected: number, total: number, lobby = true): Presence => ({ connected, total, lobby });

describe('sonido de presencia en la TV (modo móviles)', () => {
  it('entrar y salir suenan distinto', () => {
    expect(presenceSound(P(0, 4), P(1, 4))).toBe('join');
    expect(presenceSound(P(2, 4), P(1, 4))).toBe('leave');
    expect(presenceSound(P(2, 4), P(2, 4))).toBeNull();
  });
  it('al entrar el último de los previstos en la sala de espera suena «todos listos» en lugar de «join»', () => {
    expect(presenceSound(P(3, 4), P(4, 4))).toBe('allReady');
    expect(presenceSound(P(0, 1), P(1, 1))).toBe('allReady');
  });
  it('«todos listos» solo avisa en la sala de espera; a mitad de partida es un «join» normal', () => {
    expect(presenceSound(P(3, 4, false), P(4, 4, false))).toBe('join');
  });
  it('si se sale alguien estando todos, suena «leave» y al volver a completarse vuelve a sonar «todos listos»', () => {
    expect(presenceSound(P(4, 4), P(3, 4))).toBe('leave');
    expect(presenceSound(P(3, 4), P(4, 4))).toBe('allReady');
  });
  it('una entrada y una salida a la vez se compensan y no suenan', () => {
    expect(presenceSound(P(2, 4), P(2, 4))).toBeNull();
  });
});
