'use client';

/**
 * Motor de audio sintetizado con Web Audio (sin archivos de sonido, sin licencias, sin dependencias).
 * Preferencias locales por dispositivo (localStorage, siempre con try/catch). El navegador bloquea el audio hasta que haya
 * un gesto del usuario: `armed` indica si el contexto está ya sonando; si no, la interfaz muestra «Activar sonido».
 */

export type SoundName =
  | 'click' | 'announce' | 'bid' | 'tick' | 'tickUrgent' | 'closed' | 'award' | 'finish'
  | 'outbid' | 'leading' | 'won' | 'bidSent' | 'event' | 'join' | 'leave' | 'allReady' | 'unsold' | 'draw' | 'reaction';
export type MusicScene = 'waiting' | 'lobby' | 'auction' | 'tense' | null;
export type AudioRole = 'tv' | 'host' | 'play';

export interface AudioPrefs { enabled: boolean; music: boolean; volume: number }
export interface AudioSnapshot extends AudioPrefs { armed: boolean }

const DEFAULTS: Record<AudioRole, AudioPrefs> = {
  tv: { enabled: true, music: true, volume: 0.7 },
  host: { enabled: true, music: false, volume: 0.6 },
  play: { enabled: false, music: false, volume: 0.6 }, // en el móvil, silencio salvo que el jugador lo active
};

let role: AudioRole = 'tv';
let prefs: AudioPrefs = { ...DEFAULTS.tv };
let armed = false;
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let fx: GainNode | null = null;
let mus: GainNode | null = null;
let snap: AudioSnapshot = { ...prefs, armed };
const listeners = new Set<() => void>();
// Permisos externos (el anfitrión puede silenciar la TV desde su panel)
let gate = { effects: true, music: true };

function emit() {
  snap = { ...prefs, armed };
  listeners.forEach((l) => l());
}
export const subscribeAudio = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
export const getAudioSnapshot = (): AudioSnapshot => snap;
const SERVER_SNAPSHOT: AudioSnapshot = { ...DEFAULTS.tv, enabled: false, armed: false };
export const getServerAudioSnapshot = (): AudioSnapshot => SERVER_SNAPSHOT; // debe ser estable (referencia fija)

const key = () => `ss_audio_${role}`;
function load(): AudioPrefs {
  try {
    const raw = window.localStorage.getItem(key());
    if (raw) {
      const p = JSON.parse(raw) as Partial<AudioPrefs>;
      return { enabled: p.enabled ?? DEFAULTS[role].enabled, music: p.music ?? DEFAULTS[role].music, volume: Math.min(1, Math.max(0, p.volume ?? DEFAULTS[role].volume)) };
    }
  } catch { /* sin almacenamiento */ }
  return { ...DEFAULTS[role] };
}
function save() {
  try { window.localStorage.setItem(key(), JSON.stringify(prefs)); } catch { /* ignorado */ }
}

/** Fija el rol del dispositivo (tv, host, play) y carga sus preferencias. */
export function initAudio(r: AudioRole): void {
  role = r;
  prefs = load();
  emit();
  if (typeof window !== 'undefined') {
    const unlock = () => { if (prefs.enabled) void arm(); };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
  }
}

function applyVolumes() {
  if (!ctx || !master || !fx || !mus) return;
  const t = ctx.currentTime;
  master.gain.setTargetAtTime(prefs.enabled ? prefs.volume : 0, t, 0.05);
  fx.gain.setTargetAtTime(gate.effects ? 1 : 0, t, 0.05);
  mus.gain.setTargetAtTime(prefs.music && gate.music ? 0.45 : 0, t, 0.4);
}

/** Crea/reanuda el contexto. Debe llamarse desde un gesto del usuario. */
export async function arm(): Promise<void> {
  if (typeof window === 'undefined') return;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  if (!ctx) {
    ctx = new AC();
    master = ctx.createGain();
    fx = ctx.createGain();
    mus = ctx.createGain();
    fx.connect(master);
    mus.connect(master);
    master.connect(ctx.destination);
    ctx.addEventListener('statechange', () => { armed = ctx?.state === 'running'; emit(); });
  }
  try { await ctx.resume(); } catch { /* bloqueado: se reintenta con el siguiente gesto */ }
  armed = ctx.state === 'running';
  applyVolumes();
  emit();
}

export function setPrefs(p: Partial<AudioPrefs>): void {
  prefs = { ...prefs, ...p, volume: Math.min(1, Math.max(0, p.volume ?? prefs.volume)) };
  save();
  if (prefs.enabled) void arm(); else musicStop();
  if (prefs.enabled && prefs.music) resumeMusic(); else musicPause();
  applyVolumes();
  emit();
}

/** Lo que permite el anfitrión (interruptores de la partida). Afecta solo a este dispositivo cuando es la TV. */
export function setGate(g: { effects: boolean; music: boolean }): void {
  gate = g;
  // La música se PAUSA (se recuerda la escena) en vez de cancelarse: al volver a permitirla, retoma sola.
  if (!g.music) musicPause(); else resumeMusic();
  applyVolumes();
}

// ---------------------------------------------------------------- síntesis
const now = () => ctx!.currentTime;
const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

function tone(out: GainNode, f: number, t: number, dur: number, { type = 'triangle' as OscillatorType, gain = 0.25, slideTo, attack = 0.005 }: { type?: OscillatorType; gain?: number; slideTo?: number; attack?: number } = {}) {
  const o = ctx!.createOscillator();
  const g = ctx!.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.05);
}
let noiseBuf: AudioBuffer | null = null;
function noise(out: GainNode, t: number, dur: number, { gain = 0.2, freq = 1800, q = 0.7, type = 'bandpass' as BiquadFilterType } = {}) {
  if (!noiseBuf) {
    noiseBuf = ctx!.createBuffer(1, ctx!.sampleRate, ctx!.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const s = ctx!.createBufferSource();
  s.buffer = noiseBuf;
  s.loop = true;
  const f = ctx!.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx!.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(out);
  s.start(t);
  s.stop(t + dur + 0.05);
}

/** Efecto de sonido. `n` (opcional) afina el tono (p. ej. número de pujas: cada puja suena un poco más alta). */
export function play(name: SoundName, n = 0): void {
  if (!ctx || !fx || !armed || !prefs.enabled || !gate.effects) return;
  const t = now();
  const o = fx;
  switch (name) {
    case 'click': tone(o, 900, t, 0.05, { type: 'square', gain: 0.08 }); break;
    case 'announce': [72, 76, 79, 84].forEach((m, i) => tone(o, midi(m), t + i * 0.09, 0.4, { gain: 0.22 })); break;
    case 'bid': { const m = 72 + Math.min(Math.max(n, 0), 12); tone(o, midi(m), t, 0.18, { type: 'square', gain: 0.12 }); tone(o, midi(m + 7), t + 0.07, 0.22, { type: 'triangle', gain: 0.16 }); break; }
    case 'tick': tone(o, 1100, t, 0.05, { type: 'square', gain: 0.1 }); break;
    case 'tickUrgent': tone(o, 1500, t, 0.07, { type: 'square', gain: 0.16 }); tone(o, 750, t, 0.07, { type: 'square', gain: 0.1 }); break;
    case 'closed': for (let i = 0; i < 8; i++) noise(o, t + i * 0.06, 0.06, { gain: 0.14 + i * 0.02, freq: 220, q: 1, type: 'lowpass' }); tone(o, 110, t + 0.5, 0.3, { type: 'sine', gain: 0.3, slideTo: 60 }); break;
    case 'award': {
      noise(o, t, 0.12, { gain: 0.5, freq: 900, q: 0.5 });
      tone(o, 160, t, 0.25, { type: 'sine', gain: 0.55, slideTo: 55 });
      [72, 76, 79, 84].forEach((m, i) => tone(o, midi(m), t + 0.25 + i * 0.1, 0.5, { type: 'sawtooth', gain: 0.13 }));
      [96, 100, 103, 108].forEach((m, i) => tone(o, midi(m), t + 0.7 + i * 0.06, 0.25, { type: 'sine', gain: 0.1 })); // monedas
      break;
    }
    case 'finish': [72, 72, 72, 76, 79, 76, 79, 84].forEach((m, i) => tone(o, midi(m), t + i * 0.16, i === 7 ? 1.2 : 0.3, { type: 'sawtooth', gain: 0.14 })); break;
    case 'outbid': tone(o, midi(76), t, 0.14, { gain: 0.2 }); tone(o, midi(69), t + 0.12, 0.3, { gain: 0.2 }); break;
    case 'leading': tone(o, midi(79), t, 0.12, { type: 'square', gain: 0.1 }); tone(o, midi(84), t + 0.08, 0.2, { gain: 0.15 }); break;
    case 'won': [76, 79, 84, 88].forEach((m, i) => tone(o, midi(m), t + i * 0.08, 0.4, { type: 'sawtooth', gain: 0.12 })); break;
    case 'bidSent': tone(o, midi(84), t, 0.07, { type: 'square', gain: 0.08 }); break;
    // Presencia en la TV: entrar = dos notas que suben (sonrisa), salir = dos que bajan (suave) y «todos listos» = fanfarria corta y acorde final
    case 'join': tone(o, midi(74), t, 0.12, { type: 'sine', gain: 0.2 }); tone(o, midi(81), t + 0.1, 0.25, { type: 'sine', gain: 0.22 }); break;
    case 'leave': tone(o, midi(67), t, 0.14, { type: 'triangle', gain: 0.16 }); tone(o, midi(60), t + 0.12, 0.3, { type: 'triangle', gain: 0.14 }); break;
    case 'allReady':
      [67, 67, 72].forEach((m, i) => tone(o, midi(m), t + i * 0.12, 0.14, { type: 'square', gain: 0.1 }));
      [72, 76, 79, 84].forEach((m) => tone(o, midi(m), t + 0.42, 0.9, { type: 'sawtooth', gain: 0.1 }));
      [96, 100, 103].forEach((m, i) => tone(o, midi(m), t + 0.55 + i * 0.07, 0.3, { type: 'sine', gain: 0.08 }));
      break;
    case 'unsold': // «¡Nadie lo quiere!»: trombón triste descendente
      [67, 66, 65].forEach((m, i) => tone(o, midi(m), t + i * 0.32, 0.3, { type: 'sawtooth', gain: 0.13 }));
      tone(o, midi(64), t + 0.96, 0.9, { type: 'sawtooth', gain: 0.14, slideTo: midi(58) });
      break;
    case 'draw': // sorteo del elemento al azar: traqueteo de dado y campanilla
      [0, 1, 2, 3, 4, 5].forEach((i) => tone(o, midi(72 + ((i * 5) % 9)), t + i * 0.07, 0.05, { type: 'square', gain: 0.08 }));
      [79, 84].forEach((m, i) => tone(o, midi(m), t + 0.5 + i * 0.1, 0.35, { gain: 0.18 }));
      break;
    case 'reaction': tone(o, midi(88), t, 0.08, { gain: 0.05 }); break; // «pop» muy suave
    case 'event': tone(o, midi(60), t, 0.5, { type: 'sawtooth', gain: 0.15, slideTo: midi(84) }); break;
  }
}

// ---------------------------------------------------------------- música (secuenciador con anticipación)
const SCENES = {
  // Sala de espera: alegre y saltarina (do mayor pentatónico, ritmo de «fiesta que empieza»), distinta de la música de la subasta
  waiting: { bpm: 112, bass: [48, 55, 52, 55, 53, 57, 55, 52], lead: [76, 0, 79, 81, 79, 0, 76, 74, 72, 0, 76, 79, 81, 0, 84, 0], kick: true },
  // Entre subastas: tranquila
  lobby: { bpm: 96, bass: [48, 0, 55, 0, 52, 0, 55, 0], lead: [72, 0, 76, 0, 79, 0, 76, 0, 74, 0, 77, 0, 81, 0, 77, 0], kick: false },
  auction: { bpm: 126, bass: [48, 48, 55, 48, 53, 53, 55, 53], lead: [72, 76, 79, 76, 74, 77, 81, 77, 72, 79, 84, 79, 76, 74, 72, 0], kick: true },
  tense: { bpm: 156, bass: [45, 45, 52, 45, 45, 45, 52, 57], lead: [81, 0, 81, 84, 0, 84, 88, 0, 81, 0, 81, 84, 0, 88, 84, 0], kick: true },
} as const;
let scene: MusicScene = null;
let step = 0;
let nextTime = 0;
let timer: ReturnType<typeof setInterval> | null = null;

function schedule() {
  if (!ctx || !mus || !scene) return;
  const s = SCENES[scene];
  const dur = 60 / s.bpm / 2; // corcheas
  while (nextTime < ctx.currentTime + 0.25) {
    const i = step % 16;
    if (s.kick && i % 4 === 0) tone(mus, 120, nextTime, 0.18, { type: 'sine', gain: 0.5, slideTo: 45 });
    if (s.kick && i % 2 === 1) noise(mus, nextTime, 0.04, { gain: 0.06, freq: 7000, q: 1, type: 'highpass' });
    const b = s.bass[(i >> 1) % s.bass.length]!;
    if (i % 2 === 0 && b) tone(mus, midi(b), nextTime, dur * 1.8, { type: 'triangle', gain: 0.3 });
    const l = s.lead[i % s.lead.length]!;
    if (l) tone(mus, midi(l), nextTime, dur * 0.9, { type: 'square', gain: 0.05 });
    nextTime += dur;
    step++;
  }
}

/** Cambia de escena musical (null = silencio). Solo suena si el dispositivo y el anfitrión lo permiten. */
export function setMusicScene(next: MusicScene): void {
  if (next === scene) return;
  scene = next;
  step = 0;
  if (!next) return musicStop();
  if (!ctx || !armed || !gate.music || timer) { if (ctx && armed) nextTime = ctx.currentTime + 0.05; return; }
  nextTime = ctx.currentTime + 0.05;
  timer = setInterval(schedule, 80);
}
function musicPause() {
  if (timer) { clearInterval(timer); timer = null; }
}
function musicStop() {
  scene = null;
  if (timer) { clearInterval(timer); timer = null; }
}
/** Reanuda el planificador cuando se arma el contexto con una escena ya pedida. */
export function resumeMusic(): void {
  if (scene && ctx && armed && gate.music && prefs.music && prefs.enabled && !timer) { nextTime = ctx.currentTime + 0.05; timer = setInterval(schedule, 80); }
}
