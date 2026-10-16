import { ProviderError, type EditSceneInput, type GeneratedImage, type ImageGenerationProvider, type InitialSceneInput, type ItemImageInput } from './types';

/**
 * Proveedor de MUESTRA para el modo demo (sin credenciales de IA).
 * NO usa inteligencia artificial: dibuja escenas SVG locales y apila "pegatinas" de los
 * elementos comprados. Toda imagen lleva una marca visible "DEMO" y se guarda con provider='demo'.
 */
const W = 1536;
const H = 1024;
export const DEMO_MARKER = 'data-demo-sticker';

const PALETTES: Record<string, { sky: [string, string]; ground: [string, string]; accent: string }> = {
  house: { sky: ['#1e1b4b', '#4338ca'], ground: ['#475569', '#334155'], accent: '#fbbf24' },
  island: { sky: ['#0ea5e9', '#7dd3fc'], ground: ['#fde68a', '#f59e0b'], accent: '#14b8a6' },
  spaceship: { sky: ['#020617', '#1e1b4b'], ground: ['#334155', '#1e293b'], accent: '#22d3ee' },
  castle: { sky: ['#312e81', '#7c3aed'], ground: ['#57534e', '#44403c'], accent: '#f59e0b' },
  shop: { sky: ['#831843', '#be185d'], ground: ['#78716c', '#57534e'], accent: '#fde047' },
  free: { sky: ['#1e1b4b', '#0f766e'], ground: ['#3f3f46', '#27272a'], accent: '#a78bfa' },
};

function xml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);
}

function paletteFor(theme: string) {
  const key = Object.keys(PALETTES).find((k) => theme.toLowerCase().includes(k)) ?? 'free';
  return PALETTES[key]!;
}

function backdrop(theme: string): string {
  const key = Object.keys(PALETTES).find((k) => theme.toLowerCase().includes(k)) ?? 'free';
  switch (key) {
    case 'island':
      return `<ellipse cx="768" cy="720" rx="640" ry="230" fill="#fde68a"/><ellipse cx="768" cy="740" rx="700" ry="260" fill="#0ea5e9" opacity=".25"/>
        <g><rect x="250" y="420" width="16" height="230" fill="#92400e"/><ellipse cx="258" cy="410" rx="90" ry="34" fill="#16a34a"/></g>
        <g><rect x="1260" y="440" width="16" height="210" fill="#92400e"/><ellipse cx="1268" cy="430" rx="80" ry="30" fill="#15803d"/></g>`;
    case 'spaceship':
      return `<rect x="180" y="90" width="1176" height="380" rx="190" fill="#020617" stroke="#475569" stroke-width="14"/>
        ${Array.from({ length: 40 }, (_, i) => `<circle cx="${220 + ((i * 97) % 1100)}" cy="${120 + ((i * 53) % 320)}" r="${1 + (i % 3)}" fill="#e2e8f0"/>`).join('')}
        <circle cx="1100" cy="250" r="80" fill="#38bdf8" opacity=".7"/>`;
    case 'castle':
      return `<rect x="120" y="170" width="1296" height="500" fill="#78716c"/>
        ${Array.from({ length: 14 }, (_, i) => `<rect x="${120 + i * 96}" y="140" width="56" height="50" fill="#78716c"/>`).join('')}
        <rect x="660" y="300" width="216" height="370" rx="108" fill="#1c1917"/>`;
    case 'shop':
      return `<rect x="150" y="150" width="1236" height="520" fill="#e7e5e4"/>
        <rect x="210" y="210" width="400" height="300" fill="#7dd3fc" opacity=".6"/><rect x="926" y="210" width="400" height="300" fill="#7dd3fc" opacity=".6"/>
        <rect x="680" y="250" width="176" height="420" fill="#a8a29e"/>`;
    case 'house':
      return `<rect x="170" y="190" width="1196" height="490" fill="#e2e8f0"/><polygon points="130,200 768,40 1406,200" fill="#7c2d12"/>
        <rect x="260" y="270" width="260" height="190" fill="#7dd3fc" opacity=".7"/><rect x="1016" y="270" width="260" height="190" fill="#7dd3fc" opacity=".7"/>
        <rect x="690" y="350" width="156" height="330" fill="#92400e"/>`;
    default:
      return `<rect x="170" y="190" width="1196" height="490" rx="40" fill="#27272a" opacity=".55"/>`;
  }
}

function watermark(): string {
  return `<g><rect x="24" y="${H - 64}" width="560" height="40" rx="20" fill="#000" opacity=".6"/>
    <text x="44" y="${H - 38}" font-family="system-ui,sans-serif" font-size="22" font-weight="700" fill="#fde047">DEMO · imagen de muestra, no generada por IA</text></g>`;
}

function scene(theme: string, label: string): string {
  const p = paletteFor(theme);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.sky[0]}"/><stop offset="1" stop-color="${p.sky[1]}"/></linearGradient>
    <linearGradient id="gr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.ground[0]}"/><stop offset="1" stop-color="${p.ground[1]}"/></linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#sky)"/>
  <rect y="640" width="${W}" height="${H - 640}" fill="url(#gr)"/>
  ${backdrop(theme)}
  <text x="${W / 2}" y="130" text-anchor="middle" font-family="system-ui,sans-serif" font-size="30" fill="${p.accent}" opacity=".9">${xml(label)}</text>
  <g id="stickers"></g>
  ${watermark()}
</svg>`;
}

const SLOTS = [
  [330, 760], [610, 800], [890, 760], [1170, 800],
  [330, 910], [610, 940], [890, 910], [1170, 940],
  [470, 560], [770, 590], [1070, 560], [230, 590],
] as const;

function sticker(index: number, emoji: string, name: string): string {
  const [cx, cy] = SLOTS[index % SLOTS.length]!;
  return `<g ${DEMO_MARKER}="1" transform="translate(${cx} ${cy})">
    <ellipse cx="0" cy="62" rx="90" ry="18" fill="#000" opacity=".35"/>
    <text x="0" y="40" text-anchor="middle" font-size="120">${xml(emoji)}</text>
    <text x="0" y="96" text-anchor="middle" font-family="system-ui,sans-serif" font-size="22" font-weight="700" fill="#fff" stroke="#000" stroke-width="5" paint-order="stroke">${xml(name)}</text>
  </g>`;
}

const enc = (s: string) => new TextEncoder().encode(s);

export function createDemoProvider(): ImageGenerationProvider {
  return {
    id: 'demo',
    async generateInitialScene(input: InitialSceneInput): Promise<GeneratedImage> {
      return {
        bytes: enc(scene(input.theme, `Escena inicial de ${input.playerName}`)),
        mime: 'image/svg+xml',
        prompt: `[DEMO] Escena vacía local para «${input.theme}» (sin IA)`,
        model: 'demo-svg',
      };
    },
    async editScene(input: EditSceneInput): Promise<GeneratedImage> {
      const svg = new TextDecoder().decode(input.base.bytes);
      if (!svg.includes('</svg>')) throw new ProviderError('La imagen base del modo demo no es un SVG de muestra', false);
      const count = (svg.match(new RegExp(DEMO_MARKER, 'g')) ?? []).length;
      const next = svg.replace('<g id="stickers">', `<g id="stickers">${sticker(count, input.itemEmoji ?? '🎁', input.itemName)}`);
      return {
        bytes: enc(next),
        mime: 'image/svg+xml',
        prompt: `[DEMO] Se apila «${input.itemName}» sobre la imagen anterior (sin IA)`,
        model: 'demo-svg',
      };
    },
    async generateItemImage(input: ItemImageInput): Promise<GeneratedImage> {
      const p = paletteFor(input.theme);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400" width="600" height="400">
  <rect width="600" height="400" fill="${p.sky[1]}"/><rect y="280" width="600" height="120" fill="${p.ground[0]}"/>
  <text x="300" y="250" text-anchor="middle" font-size="190">${xml(input.itemEmoji ?? '🎁')}</text>
  <rect x="16" y="352" width="330" height="32" rx="16" fill="#000" opacity=".6"/>
  <text x="32" y="375" font-family="system-ui,sans-serif" font-size="17" font-weight="700" fill="#fde047">DEMO · imagen de muestra, no IA</text></svg>`;
      return { bytes: enc(svg), mime: 'image/svg+xml', prompt: `[DEMO] Ilustración local de «${input.itemName}» (sin IA)`, model: 'demo-svg' };
    },
  };
}
