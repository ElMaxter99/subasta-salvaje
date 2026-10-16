import { crown } from './lib.mjs';
import { sparkle } from './props.mjs';

export const primaryButton = () => `<g><rect x="-300" y="-84" width="600" height="190" rx="95" fill="#24105B"/>
  <rect x="-300" y="-100" width="600" height="190" rx="95" fill="url(#gPurple)" stroke="#2B148F" stroke-width="5"/>
  <rect x="-280" y="-92" width="560" height="78" rx="39" fill="#fff" opacity=".22"/>
  <rect x="-286" y="-86" width="572" height="164" rx="82" fill="none" stroke="#C7B6FF" stroke-width="3" opacity=".5"/></g>`;

export const secondaryButton = () => `<g><rect x="-300" y="-84" width="600" height="190" rx="95" fill="#0A0D33"/>
  <rect x="-300" y="-100" width="600" height="190" rx="95" fill="url(#gBubble)" stroke="#6038FF" stroke-width="10"/>
  <rect x="-282" y="-88" width="564" height="72" rx="36" fill="#fff" opacity=".07"/>
  <rect x="-300" y="-100" width="600" height="190" rx="95" fill="none" stroke="#35D5FF" stroke-width="2" opacity=".35" transform="scale(.97)"/></g>`;

export const progressBar = (pct = 0.64) => `<g><rect x="-400" y="-34" width="800" height="68" rx="34" fill="#0B0E34" stroke="#2A2F8E" stroke-width="6"/>
  <rect x="-392" y="-26" width="${784 * pct}" height="52" rx="26" fill="url(#gGoldH)"/>
  <rect x="-392" y="-26" width="${784 * pct}" height="22" rx="11" fill="#fff" opacity=".35"/>
  <rect x="${-392 + 784 * pct - 18}" y="-26" width="${784 * (1 - pct) + 18}" height="52" rx="26" fill="#F6F4FF" opacity=".92" transform="translate(0 0)" clip-path="inset(0 0 0 18px)"/></g>`;

export const countdownBar = (pct = 0.55) => `<g><rect x="-400" y="-40" width="800" height="80" rx="40" fill="#0B0E34" stroke="url(#gPurple)" stroke-width="8"/>
  ${Array.from({ length: 9 }, (_, i) => `<line x1="${-320 + i * 80}" y1="-22" x2="${-320 + i * 80}" y2="22" stroke="#2A2F8E" stroke-width="4" stroke-linecap="round"/>`).join('')}
  <rect x="-388" y="-28" width="${776 * pct}" height="56" rx="28" fill="url(#gGoldH)"/><rect x="-388" y="-28" width="${776 * pct}" height="24" rx="12" fill="#fff" opacity=".35"/>
  <circle cx="${-388 + 776 * pct}" cy="0" r="22" fill="#FFF3B0" stroke="#FFB81C" stroke-width="6"/></g>`;

export const backArrow = () => `<g><path d="M60 -150 L-70 0 L60 150" fill="none" stroke="#9A5E00" stroke-width="86" stroke-linecap="round" stroke-linejoin="round" transform="translate(0 10)"/>
  <path d="M60 -150 L-70 0 L60 150" fill="none" stroke="url(#gGold)" stroke-width="78" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M40 -120 L-50 -10" fill="none" stroke="#FFF7C8" stroke-width="12" stroke-linecap="round" opacity=".8"/></g>`;

export const goldCrownIcon = () => crown({ x: 0, y: 0, s: 2.2 });

export const purpleSpeedLines = () => {
  const line = (y, len, w, c) => `<path d="M-${len / 2} ${y} Q0 ${y - w} ${len / 2} ${y} Q0 ${y + w} -${len / 2} ${y}Z" fill="${c}"/>`;
  return `${line(-70, 640, 14, 'url(#gPurple)')}${line(0, 800, 20, '#8A66FF')}${line(70, 540, 12, 'url(#gPurple)')}${line(130, 360, 8, '#35D5FF')}`;
};

export const yellowHighlightShapes = () => `<g fill="url(#gGold)">
  <path d="M-300 -60 Q-160 -130 20 -80 Q160 -40 300 -100 Q230 -20 110 -10 Q-60 10 -300 -60Z"/>
  <path d="M-260 40 Q-100 -10 60 50 Q180 90 290 40 Q220 120 70 120 Q-120 120 -260 40Z" opacity=".9"/></g>
  <g transform="translate(-230 -150)">${sparkle({ s: 0.16 })}</g><g transform="translate(250 130)">${sparkle({ s: 0.12, rot: 20 })}</g>
  <circle cx="-300" cy="150" r="14" fill="#FFD83D"/><circle cx="300" cy="-140" r="10" fill="#FFD83D"/>`;

export const wordmark = () => `<g font-family="Inter, DejaVu Sans, sans-serif" font-weight="900" font-style="italic">
  <text x="0" y="-20" text-anchor="middle" font-size="190" fill="#000" opacity=".35" transform="translate(6 8)">Subasta</text>
  <text x="0" y="-20" text-anchor="middle" font-size="190" fill="#FFFFFF" stroke="#24105B" stroke-width="14" paint-order="stroke">Subasta</text>
  <text x="60" y="150" text-anchor="middle" font-size="190" fill="#000" opacity=".35" transform="translate(6 8)">Salvaje</text>
  <text x="60" y="150" text-anchor="middle" font-size="190" fill="url(#gGold)" stroke="#24105B" stroke-width="14" paint-order="stroke">Salvaje</text></g>`;
