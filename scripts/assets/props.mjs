import { crown } from './lib.mjs';

/** Martillo de subasta. Origen = punto de agarre; la cabeza queda arriba y el mango hacia abajo. */
export function hammer({ x = 0, y = 0, s = 1, rot = 0 } = {}) {
  return `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})">
  <rect x="-16" y="-70" width="32" height="300" rx="16" fill="url(#gGoldH)" stroke="#9A5E00" stroke-width="3"/>
  <rect x="-16" y="170" width="32" height="40" rx="14" fill="url(#gPurple)" stroke="#24105B" stroke-width="3"/>
  <g transform="translate(0 -96)">
    <rect x="-118" y="-58" width="236" height="116" rx="38" fill="url(#gWoodH)" stroke="#3D1D08" stroke-width="4"/>
    <rect x="-118" y="-58" width="236" height="52" rx="26" fill="#fff" opacity=".13"/>
    <rect x="-128" y="-64" width="46" height="128" rx="18" fill="url(#gGoldH)" stroke="#9A5E00" stroke-width="3.5"/>
    <rect x="82" y="-64" width="46" height="128" rx="18" fill="url(#gGoldH)" stroke="#9A5E00" stroke-width="3.5"/>
    <rect x="-146" y="-48" width="22" height="96" rx="10" fill="url(#gPurple)" stroke="#24105B" stroke-width="3"/>
    <rect x="124" y="-48" width="22" height="96" rx="10" fill="url(#gPurple)" stroke="#24105B" stroke-width="3"/>
    <rect x="-76" y="-46" width="150" height="14" rx="7" fill="#fff" opacity=".28"/>
  </g></g>`;
}

/** Megáfono. Origen = empuñadura; la boca apunta hacia +x. */
export function megaphone({ x = 0, y = 0, s = 1, rot = 0 } = {}) {
  return `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})">
  <path d="M-10 50 L20 -10 L50 -4 L24 62Z" fill="url(#gPurpleDark)" stroke="#24105B" stroke-width="4" stroke-linejoin="round"/>
  <path d="M-40 -46 L96 -78 L96 74 L-40 40Z" fill="url(#gPurple)" stroke="#24105B" stroke-width="5" stroke-linejoin="round"/>
  <path d="M-40 -46 L96 -78 L96 -52 L-40 -20Z" fill="#fff" opacity=".22"/>
  <rect x="-62" y="-52" width="34" height="100" rx="14" fill="url(#gNavyDark)" stroke="#080B2B" stroke-width="4"/>
  <ellipse cx="96" cy="-2" rx="30" ry="78" fill="url(#gGoldH)" stroke="#9A5E00" stroke-width="5"/>
  <ellipse cx="102" cy="-2" rx="19" ry="60" fill="#1A1060" stroke="#0A0D33" stroke-width="3"/>
  <ellipse cx="98" cy="-26" rx="8" ry="22" fill="#fff" opacity=".25"/>
  </g>`;
}

const SEG = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg' };
function digit(d, x, y, w = 56, h = 100, t = 12) {
  const on = SEG[d];
  const hz = (yy) => `M${x + t * 0.6} ${yy} L${x + t} ${yy - t / 2} L${x + w - t} ${yy - t / 2} L${x + w - t * 0.6} ${yy} L${x + w - t} ${yy + t / 2} L${x + t} ${yy + t / 2}Z`;
  const vt = (xx, y1, y2) => `M${xx} ${y1 + t * 0.6} L${xx + t / 2} ${y1 + t} L${xx + t / 2} ${y2 - t} L${xx} ${y2 - t * 0.6} L${xx - t / 2} ${y2 - t} L${xx - t / 2} ${y1 + t}Z`;
  const m = y + h / 2;
  const paths = { a: hz(y), g: hz(m), d: hz(y + h), f: vt(x, y, m), b: vt(x + w, y, m), e: vt(x, m, y + h), c: vt(x + w, m, y + h) };
  return Object.entries(paths).map(([k, p]) => `<path d="${p}" fill="${on.includes(k) ? '#FFD83D' : '#4A3F12'}" opacity="${on.includes(k) ? 1 : 0.3}"/>`).join('');
}

/** Temporizador digital. Origen = centro. `value` editable (mm:ss). */
export function timer({ x = 0, y = 0, s = 1, rot = 0, value = '00:10' } = {}) {
  const [a, b, , c, d] = value.split('');
  const dg = (ch, px) => digit(Number(ch), px, -50);
  return `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})">
  <rect x="-190" y="-104" width="380" height="208" rx="42" fill="url(#gTimer)" stroke="#1B0F6E" stroke-width="5"/>
  <rect x="-190" y="-104" width="380" height="84" rx="42" fill="#fff" opacity=".12"/>
  <rect x="-166" y="-80" width="332" height="160" rx="26" fill="#0B0E34" stroke="#35D5FF" stroke-width="3" opacity=".98"/>
  <g filter="url(#fGlow)">${dg(a, -140)}${dg(b, -66)}<circle cx="0" cy="-20" r="8" fill="#FFD83D"/><circle cx="0" cy="22" r="8" fill="#FFD83D"/>${dg(c, 20)}${dg(d, 94)}</g>
  <circle cx="-150" cy="-92" r="6" fill="#35D5FF"/><circle cx="150" cy="-92" r="6" fill="#F54DB7"/>
  </g>`;
}

/** Icono de marca: cuadrado redondeado con corona. */
export function logoIcon({ x = 0, y = 0, s = 1 } = {}) {
  return `<g transform="translate(${x} ${y}) scale(${s})">
  <rect x="-180" y="-180" width="360" height="360" rx="92" fill="#0E1040" stroke="url(#gPurple)" stroke-width="14"/>
  <rect x="-166" y="-166" width="332" height="332" rx="80" fill="none" stroke="#35D5FF" stroke-width="3" opacity=".3"/>
  <rect x="-170" y="-170" width="340" height="120" rx="70" fill="#fff" opacity=".07"/>
  ${crown({ x: 0, y: 4, s: 1.05 })}
  </g>`;
}

/** Bocadillo «¡Subasta activa!». El texto usa Inter (si no está instalada: sans-serif). */
export function speechBubble({ x = 0, y = 0, s = 1, text1 = '¡Subasta', text2 = 'activa!' } = {}) {
  return `<g transform="translate(${x} ${y}) rotate(-5) scale(${s})">
  <path d="M-196 -92 Q-196 -112 -174 -112 H178 Q202 -112 202 -88 V58 Q202 82 178 82 H-96 L-150 130 L-132 82 H-174 Q-196 82 -196 60Z" fill="url(#gBubble)" stroke="#6038FF" stroke-width="7" stroke-linejoin="round"/>
  <path d="M-188 -92 Q-188 -104 -174 -104 H178 Q190 -104 192 -90 L192 -50 H-188Z" fill="#fff" opacity=".06"/>
  ${crown({ x: -138, y: -34, s: 0.42 })}
  <text x="-96" y="-22" font-family="Inter, DejaVu Sans, sans-serif" font-weight="800" font-size="62" fill="#FFFFFF">${text1}</text>
  <text x="-96" y="48" font-family="Inter, DejaVu Sans, sans-serif" font-weight="800" font-size="62" fill="#FFD83D">${text2}</text>
  </g>`;
}

/** Moneda de oro con corona grabada. */
export function coin({ x = 0, y = 0, s = 1 } = {}) {
  return `<g transform="translate(${x} ${y}) scale(${s})">
  <circle cx="6" cy="14" r="150" fill="#9A5E00"/>
  <circle r="150" fill="url(#gGold)" stroke="#B87400" stroke-width="6"/>
  <circle r="120" fill="none" stroke="#B87400" stroke-width="8" opacity=".55"/>
  <circle r="108" fill="url(#gGoldH)" opacity=".5"/>
  <path d="M-110 -30 A120 120 0 0 1 20 -116" fill="none" stroke="#FFF7C8" stroke-width="12" stroke-linecap="round" opacity=".85"/>
  <g transform="scale(.9) translate(0 4)"><path d="M-62 40 L-74 -30 L-30 10 L0 -54 L30 10 L74 -30 L62 40 Q0 58 -62 40Z" fill="#E59A0A" stroke="#B87400" stroke-width="4" stroke-linejoin="round"/><path d="M-56 30 L-64 -18 L-28 12 L0 -40" fill="none" stroke="#FFF3B0" stroke-width="6" stroke-linecap="round" opacity=".8"/></g>
  </g>`;
}

/** Brillo dorado de cuatro puntas. */
export function sparkle({ x = 0, y = 0, s = 1, rot = 0, glow = true } = {}) {
  return `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})"${glow ? ' filter="url(#fGlow)"' : ''}><path d="M0 -150 Q14 -16 150 0 Q14 16 0 150 Q-14 16 -150 0 Q-14 -16 0 -150Z" fill="url(#gGold)" stroke="#FFF3B0" stroke-width="4" stroke-linejoin="round"/><path d="M0 -150 Q6 -24 60 -6" fill="none" stroke="#fff" stroke-width="5" opacity=".7" stroke-linecap="round"/></g>`;
}

/** Confeti: piezas de colores dispersas (posiciones deterministas). */
export function confetti({ x = 0, y = 0, s = 1, spread = 320, count = 36, seed = 7 } = {}) {
  const colors = ['#FFD83D', '#35D5FF', '#F54DB7', '#6038FF', '#F6F4FF', '#FFB81C'];
  let r = seed;
  const rnd = () => ((r = (r * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const pieces = Array.from({ length: count }, (_, i) => {
    const px = (rnd() - 0.5) * 2 * spread, py = (rnd() - 0.5) * 2 * spread * 0.85, c = colors[i % colors.length], rot = rnd() * 360, w = 14 + rnd() * 18, h = 8 + rnd() * 12;
    return i % 4 === 0 ? `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${(6 + rnd() * 6).toFixed(1)}" fill="${c}"/>` : `<rect x="${(px - w / 2).toFixed(1)}" y="${(py - h / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${c}" transform="rotate(${rot.toFixed(0)} ${px.toFixed(1)} ${py.toFixed(1)})"/>`;
  }).join('');
  return `<g transform="translate(${x} ${y}) scale(${s})">${pieces}</g>`;
}

/** Líneas de velocidad moradas (afusiladas). Apuntan hacia +x. */
export function speedLines({ x = 0, y = 0, s = 1, rot = 0, color = 'url(#gPurple)' } = {}) {
  const line = (yy, len, w) => `<path d="M0 ${yy} Q${len * 0.5} ${yy - w} ${len} ${yy} Q${len * 0.5} ${yy + w} 0 ${yy}Z" fill="${color}"/>`;
  return `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})">${line(-46, 260, 9)}${line(0, 340, 12)}${line(46, 220, 8)}</g>`;
}
