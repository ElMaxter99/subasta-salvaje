import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// AudioContext mínimo: cuenta osciladores creados y guarda el último valor de cada ganancia.
let oscillators = 0;
class FakeParam { value = 1; setValueAtTime(v: number) { this.value = v; } exponentialRampToValueAtTime() {} setTargetAtTime(v: number) { this.value = v; } }
class FakeNode { gain = new FakeParam(); frequency = new FakeParam(); Q = new FakeParam(); type = ''; buffer: unknown = null; loop = false;
  connect(n: unknown) { return n; } start() {} stop() {} }
class FakeCtx {
  state = 'suspended'; currentTime = 0; sampleRate = 8000; destination = new FakeNode(); gains: FakeNode[] = [];
  createGain() { const g = new FakeNode(); this.gains.push(g); return g; }
  createOscillator() { oscillators++; return new FakeNode(); }
  createBiquadFilter() { return new FakeNode(); }
  createBufferSource() { return new FakeNode(); }
  createBuffer(_c: number, n: number) { return { getChannelData: () => new Float32Array(n) }; }
  addEventListener() {}
  async resume() { this.state = 'running'; }
}

describe('motor de audio: pausa y reanuda la música según lo que permita el anfitrión', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    oscillators = 0;
    const store: Record<string, string> = {};
    Object.assign(globalThis, {
      window: globalThis,
      AudioContext: FakeCtx,
      localStorage: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } },
      addEventListener: () => undefined,
    });
    vi.resetModules();
  });
  afterEach(() => vi.useRealTimers());

  it('con la música bloqueada no suena; al permitirla de nuevo retoma la escena sola', async () => {
    const e = await import('@/lib/audio/engine');
    e.initAudio('tv');
    await e.arm();
    e.setMusicScene('auction');
    vi.advanceTimersByTime(500);
    expect(oscillators).toBeGreaterThan(0);

    e.setGate({ effects: false, music: false }); // el anfitrión silencia
    const before = oscillators;
    vi.advanceTimersByTime(2000);
    expect(oscillators).toBe(before); // no se programa nada

    e.setGate({ effects: true, music: true }); // el anfitrión vuelve a activar
    vi.advanceTimersByTime(1000);
    expect(oscillators).toBeGreaterThan(before); // vuelve a sonar sin recargar ni cambiar de escena
  });

  it('los efectos también vuelven a sonar tras silenciar y reactivar', async () => {
    const e = await import('@/lib/audio/engine');
    e.initAudio('tv');
    await e.arm();
    e.setGate({ effects: false, music: false });
    let n = oscillators;
    e.play('announce');
    expect(oscillators).toBe(n);
    e.setGate({ effects: true, music: true });
    n = oscillators;
    e.play('announce');
    expect(oscillators).toBeGreaterThan(n);
  });
});
