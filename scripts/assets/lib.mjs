// Primitivas SVG del pack de assets «Subasta Salvaje» (degradados y brillos que imitan un acabado 3D de juguete).
export const PALETTE = {
  midnight: '#080B2B', deepPurple: '#24105B', purple: '#6038FF', gold: '#FFB81C', yellow: '#FFD83D',
  white: '#F6F4FF', cyan: '#35D5FF', pink: '#F54DB7',
};

const stops = (list) => list.map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}"${a !== undefined ? ` stop-opacity="${a}"` : ''}/>`).join('');
const lin = (id, list, x1 = 0, y1 = 0, x2 = 0, y2 = 1) => `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops(list)}</linearGradient>`;
const rad = (id, list, cx = 0.35, cy = 0.25, r = 0.9) => `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}">${stops(list)}</radialGradient>`;

/** Definiciones compartidas (se incluyen una vez por SVG). */
export const DEFS = `<defs>
${rad('gWhite', [[0, '#FFFFFF'], [0.55, '#F1EEFF'], [1, '#C6BFF0']])}
${rad('gWhiteGlove', [[0, '#FFFFFF'], [0.6, '#F4F1FF'], [1, '#CFC8F2']], 0.4, 0.3, 0.85)}
${lin('gNavy', [[0, '#343A93'], [0.5, '#1B1F63'], [1, '#0F1242']])}
${lin('gNavyDark', [[0, '#1D2170'], [1, '#0A0D33']])}
${lin('gGold', [[0, '#FFF0A0'], [0.35, '#FFD23F'], [0.7, '#FFB81C'], [1, '#C97A00']])}
${lin('gGoldH', [[0, '#C97A00'], [0.3, '#FFD23F'], [0.5, '#FFF3B0'], [0.7, '#FFC21F'], [1, '#C97A00']], 0, 0, 1, 0)}
${lin('gScreen', [[0, '#171C5C'], [0.6, '#090C31'], [1, '#05071F']])}
${lin('gPurple', [[0, '#9D80FF'], [0.45, '#6038FF'], [1, '#3A1FC4']])}
${lin('gPurpleDark', [[0, '#4A2BD6'], [1, '#24105B']])}
${lin('gWood', [[0, '#C98550'], [0.5, '#8A4A22'], [1, '#55290F']])}
${lin('gWoodH', [[0, '#55290F'], [0.35, '#B8703C'], [0.55, '#D79A62'], [0.8, '#8A4A22'], [1, '#4A230C']], 0, 0, 1, 0)}
${lin('gCyan', [[0, '#9AEBFF'], [1, '#1FA9D6']])}
${lin('gPink', [[0, '#FF8AD6'], [1, '#C4208F']])}
${lin('gTimer', [[0, '#3C57FF'], [0.5, '#6038FF'], [1, '#2A1B9E']])}
${lin('gBubble', [[0, '#1E2273'], [1, '#0E1140']])}
<filter id="fGlow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="7" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="fGlowBig" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="16" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="fSoft" x="-50%" y="-100%" width="200%" height="300%"><feGaussianBlur stdDeviation="14"/></filter>
<filter id="fSoftS" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5"/></filter>
</defs>`;

/** Corona dorada. Dibujada en un cuadro local de 0..240 × 0..170. */
export function crown({ x = 0, y = 0, s = 1, rot = 0 } = {}) {
  return `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s}) translate(-120 -85)">
  <path d="M14 150 L4 38 L66 86 L120 8 L174 86 L236 38 L226 150 Q120 172 14 150Z" fill="url(#gGold)" stroke="#B87400" stroke-width="3" stroke-linejoin="round"/>
  <path d="M30 128 Q120 148 210 128 L206 150 Q120 168 34 150Z" fill="#E59A0A" opacity=".55"/>
  <path d="M22 60 L66 96 L120 30" fill="none" stroke="#FFF7C8" stroke-width="5" stroke-linecap="round" opacity=".75"/>
  <circle cx="4" cy="38" r="13" fill="url(#gGold)" stroke="#B87400" stroke-width="2.5"/><circle cx="120" cy="8" r="15" fill="url(#gGold)" stroke="#B87400" stroke-width="2.5"/><circle cx="236" cy="38" r="13" fill="url(#gGold)" stroke="#B87400" stroke-width="2.5"/>
  <circle cx="120" cy="124" r="12" fill="url(#gPurple)" stroke="#B87400" stroke-width="2.5"/><circle cx="116" cy="120" r="4" fill="#fff" opacity=".7"/>
  </g>`;
}

/** Guante blanco. kind: fist | open | point | thumb | palm */
export function glove({ x, y, s = 1, rot = 0, kind = 'fist' }) {
  const base = `<circle r="38" fill="url(#gWhiteGlove)" stroke="#B9B2E6" stroke-width="2.5"/>`;
  const knuckles = `<path d="M-20 -12 Q-8 -20 4 -12 M-4 -18 Q8 -26 20 -14" fill="none" stroke="#BDB6E8" stroke-width="3" stroke-linecap="round"/>`;
  const cuff = `<rect x="-26" y="26" width="52" height="16" rx="8" fill="#12165A"/>`;
  let extra = '';
  if (kind === 'fist') extra = knuckles + `<ellipse cx="-30" cy="6" rx="12" ry="20" transform="rotate(20 -30 6)" fill="url(#gWhiteGlove)" stroke="#B9B2E6" stroke-width="2.5"/>`;
  if (kind === 'thumb') extra = knuckles + `<ellipse cx="-4" cy="-46" rx="14" ry="30" fill="url(#gWhiteGlove)" stroke="#B9B2E6" stroke-width="2.5"/>`;
  if (kind === 'point') extra = `<ellipse cx="6" cy="-56" rx="13" ry="32" fill="url(#gWhiteGlove)" stroke="#B9B2E6" stroke-width="2.5"/><ellipse cx="-30" cy="4" rx="12" ry="18" transform="rotate(25 -30 4)" fill="url(#gWhiteGlove)" stroke="#B9B2E6" stroke-width="2.5"/>`;
  if (kind === 'open' || kind === 'palm') extra = [-24, -8, 8, 24].map((dx, i) => `<ellipse cx="${dx}" cy="${-38 - (i === 1 || i === 2 ? 6 : 0)}" rx="9" ry="22" fill="url(#gWhiteGlove)" stroke="#B9B2E6" stroke-width="2"/>`).join('') + `<ellipse cx="-38" cy="-4" rx="11" ry="20" transform="rotate(-40 -38 -4)" fill="url(#gWhiteGlove)" stroke="#B9B2E6" stroke-width="2"/>`;
  return `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})">${cuff}${extra}${base}${kind === 'fist' ? '' : ''}<ellipse cx="-12" cy="-14" rx="12" ry="7" fill="#fff" opacity=".7" transform="rotate(-25 -12 -14)"/></g>`;
}

/** Brazo de sudadera (dos tramos) acabado en guante. */
export function arm(from, elbow, hand, glv = { kind: 'fist' }, w = 66) {
  const seg = (a, b) => `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="#0C0F3A" stroke-width="${w + 8}" stroke-linecap="round"/><line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="#1D2170" stroke-width="${w}" stroke-linecap="round"/><line x1="${a[0] - 6}" y1="${a[1] - 8}" x2="${b[0] - 6}" y2="${b[1] - 8}" stroke="#3A41A6" stroke-width="${w * 0.28}" stroke-linecap="round" opacity=".7"/>`;
  const ang = (Math.atan2(hand[1] - elbow[1], hand[0] - elbow[0]) * 180) / Math.PI + 90;
  return `<g>${seg(from, elbow)}${seg(elbow, hand)}${glove({ x: hand[0], y: hand[1], rot: glv.rot ?? ang, kind: glv.kind, s: glv.s ?? 1 })}</g>`;
}

/** Zapatilla navy/blanca/dorada. */
export function shoe({ x, y, flip = 1, rot = 0 }) {
  return `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${flip} 1)">
  <path d="M-84 -2 Q-80 -50 -34 -52 L12 -50 Q62 -44 94 4 Q108 26 94 46 L-92 46 Q-102 24 -84 -2Z" fill="#161A59" stroke="#0A0D33" stroke-width="3"/>
  <path d="M-70 -6 Q-62 -40 -30 -42 L8 -40" fill="none" stroke="#3A41A6" stroke-width="7" stroke-linecap="round" opacity=".8"/>
  <path d="M-96 32 H102 Q114 58 86 68 H-90 Q-108 60 -96 32Z" fill="url(#gWhite)" stroke="#B9B2E6" stroke-width="3"/>
  <path d="M-52 -6 Q6 12 66 12" fill="none" stroke="url(#gGold)" stroke-width="15" stroke-linecap="round"/>
  <path d="M-30 -36 L-4 -30 M-14 -42 L12 -34 M2 -44 L28 -36" stroke="#F6F4FF" stroke-width="5" stroke-linecap="round"/>
  </g>`;
}

/** Emblema de corona dorada para el pecho. */
export function emblem(x, y, s = 1) {
  return `<g transform="translate(${x} ${y}) scale(${s})"><path d="M-46 22 L-54 -22 L-22 4 L0 -40 L22 4 L54 -22 L46 22 Q0 34 -46 22Z" fill="url(#gGold)" stroke="#B87400" stroke-width="2.5" stroke-linejoin="round"/><circle cx="-54" cy="-22" r="7" fill="#FFD23F"/><circle cx="0" cy="-40" r="8" fill="#FFD23F"/><circle cx="54" cy="-22" r="7" fill="#FFD23F"/></g>`;
}

const EYE = '#FFD83D';
const arch = (x, y, w = 36, th = 26, up = true) => `<path d="M${x - w} ${y + (up ? 14 : -10)} Q${x} ${y + (up ? -34 : 38)} ${x + w} ${y + (up ? 14 : -10)}" fill="none" stroke="${EYE}" stroke-width="${th}" stroke-linecap="round" filter="url(#fGlow)"/>`;
const oval = (x, y, rx = 25, ry = 36, dx = 0, dy = 0) => `<g filter="url(#fGlow)"><ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${EYE}"/><ellipse cx="${x + dx - 8}" cy="${y + dy - 14}" rx="7" ry="10" fill="#fff" opacity=".85"/></g>`;
const star = (x, y, r = 40) => {
  const pts = Array.from({ length: 10 }, (_, i) => { const a = (-90 + i * 36) * Math.PI / 180; const rr = i % 2 ? r * 0.45 : r; return `${(x + Math.cos(a) * rr).toFixed(1)},${(y + Math.sin(a) * rr).toFixed(1)}`; }).join(' ');
  return `<polygon points="${pts}" fill="${EYE}" stroke="#FFF2A0" stroke-width="3" stroke-linejoin="round" filter="url(#fGlow)"/>`;
};

/** Cara (ojos/boca) en coordenadas locales: el centro de la pantalla es (0,0). */
export function face(expr) {
  const ex = 86, y = -6;
  switch (expr) {
    case 'happy': return arch(-ex, y) + arch(ex, y);
    case 'celebrating': return arch(-ex, y - 6) + arch(ex, y - 6) + `<path d="M-46 62 Q0 128 46 62Z" fill="#FFD83D" filter="url(#fGlow)"/><path d="M-24 92 Q0 112 24 92 Q0 84 -24 92Z" fill="#F54DB7"/>`;
    case 'surprised': return `<g filter="url(#fGlow)"><circle cx="${-ex}" cy="${y}" r="30" fill="none" stroke="${EYE}" stroke-width="15"/><circle cx="${ex}" cy="${y}" r="30" fill="none" stroke="${EYE}" stroke-width="15"/><circle cx="0" cy="84" r="15" fill="none" stroke="${EYE}" stroke-width="9"/></g>`;
    case 'wink': return arch(-ex, y) + oval(ex, y, 27, 38) + `<path d="M-24 76 Q0 98 24 76" fill="none" stroke="${EYE}" stroke-width="9" stroke-linecap="round" filter="url(#fGlow)"/>`;
    case 'thinking': return oval(-ex + 14, y - 4, 24, 34, 6, -4) + oval(ex + 14, y - 4, 24, 34, 6, -4) + `<path d="M-30 -62 Q-ex -92 -112 -58" fill="none" stroke="${EYE}" stroke-width="0"/>`;
    case 'sad': return `<g opacity=".9">${arch(-ex, y + 6, 34, 24, false)}${arch(ex, y + 6, 34, 24, false)}</g><path d="M-104 44 Q-96 70 -108 78 Q-122 66 -104 44Z" fill="url(#gCyan)" filter="url(#fGlow)"/>`;
    case 'angry': return `<path d="M${-ex - 40} ${y - 26} L${-ex + 34} ${y + 14}" stroke="${EYE}" stroke-width="28" stroke-linecap="round" filter="url(#fGlow)"/><path d="M${ex + 40} ${y - 26} L${ex - 34} ${y + 14}" stroke="${EYE}" stroke-width="28" stroke-linecap="round" filter="url(#fGlow)"/>`;
    case 'focus': return `<path d="M${-ex - 36} ${y - 18} L${-ex + 34} ${y + 6}" stroke="${EYE}" stroke-width="24" stroke-linecap="round" filter="url(#fGlow)"/><path d="M${ex + 36} ${y - 18} L${ex - 34} ${y + 6}" stroke="${EYE}" stroke-width="24" stroke-linecap="round" filter="url(#fGlow)"/>`;
    case 'hype': return star(-ex, y - 2, 44) + star(ex, y - 2, 44) + `<path d="M-40 66 Q0 110 40 66Z" fill="${EYE}" filter="url(#fGlow)"/>`;
    case 'love': {
      const h = (x0) => `<path d="M${x0} ${y + 40} C${x0 - 56} ${y - 4} ${x0 - 46} ${y - 58} ${x0 - 12} ${y - 50} C${x0 - 4} ${y - 48} ${x0} ${y - 40} ${x0} ${y - 36} C${x0} ${y - 40} ${x0 + 4} ${y - 48} ${x0 + 12} ${y - 50} C${x0 + 46} ${y - 58} ${x0 + 56} ${y - 4} ${x0} ${y + 40}Z" fill="#F54DB7" stroke="#FFD1F0" stroke-width="4" filter="url(#fGlow)"/>`;
      return h(-ex) + h(ex) + `<path d="M-26 80 Q0 104 26 80" fill="none" stroke="${EYE}" stroke-width="9" stroke-linecap="round" filter="url(#fGlow)"/>`;
    }
    case 'cool': return `<g filter="url(#fGlow)"><rect x="-150" y="-52" width="124" height="84" rx="30" fill="#0B0E3A" stroke="${EYE}" stroke-width="9"/><rect x="26" y="-52" width="124" height="84" rx="30" fill="#0B0E3A" stroke="${EYE}" stroke-width="9"/><path d="M-26 -22 H26" stroke="${EYE}" stroke-width="9" stroke-linecap="round"/><path d="M-128 -34 L-96 -34 M-112 -20 L-92 -20 M48 -34 L80 -34 M64 -20 L84 -20" stroke="#8FA0FF" stroke-width="7" stroke-linecap="round" opacity=".85"/></g><path d="M-34 84 Q0 112 40 78" fill="none" stroke="${EYE}" stroke-width="9" stroke-linecap="round" filter="url(#fGlow)"/>`;
    case 'laughing': return arch(-ex, y - 10) + arch(ex, y - 10) + `<path d="M-64 54 Q0 160 64 54Z" fill="${EYE}" filter="url(#fGlow)"/><path d="M-30 100 Q0 124 30 100 Q0 90 -30 100Z" fill="#F54DB7"/><path d="M-150 20 Q-136 52 -150 62 Q-168 46 -150 20Z M150 20 Q164 52 150 62 Q168 46 150 20Z" fill="url(#gCyan)" filter="url(#fGlow)"/>`;
    case 'sleepy': return `<path d="M${-ex - 34} ${y + 8} Q${-ex} ${y + 34} ${-ex + 34} ${y + 8}" fill="none" stroke="${EYE}" stroke-width="16" stroke-linecap="round" filter="url(#fGlow)"/><path d="M${ex - 34} ${y + 8} Q${ex} ${y + 34} ${ex + 34} ${y + 8}" fill="none" stroke="${EYE}" stroke-width="16" stroke-linecap="round" filter="url(#fGlow)"/><ellipse cx="0" cy="86" rx="15" ry="19" fill="none" stroke="${EYE}" stroke-width="9" filter="url(#fGlow)"/>`;
    case 'confused': return oval(-ex, y - 6, 27, 40) + oval(ex, y + 4, 15, 20) + `<path d="M-40 88 Q-20 70 0 88 T40 88" fill="none" stroke="${EYE}" stroke-width="9" stroke-linecap="round" filter="url(#fGlow)"/>`;
    case 'shy': return arch(-ex, y + 2, 32, 24) + arch(ex, y + 2, 32, 24) + `<ellipse cx="-122" cy="58" rx="36" ry="17" fill="#F54DB7" opacity=".55" filter="url(#fSoftS)"/><ellipse cx="122" cy="58" rx="36" ry="17" fill="#F54DB7" opacity=".55" filter="url(#fSoftS)"/><path d="M-20 82 Q0 98 20 82" fill="none" stroke="${EYE}" stroke-width="8" stroke-linecap="round" filter="url(#fGlow)"/>`;
    case 'cry': return `<g opacity=".95">${arch(-ex, y + 6, 34, 24, false)}${arch(ex, y + 6, 34, 24, false)}</g><path d="M${-ex - 12} 44 Q${-ex - 30} 110 ${-ex - 14} 140 Q${-ex + 10} 110 ${-ex - 12} 44Z M${ex + 12} 44 Q${ex + 30} 110 ${ex + 14} 140 Q${ex - 10} 110 ${ex + 12} 44Z" fill="url(#gCyan)" filter="url(#fGlow)"/><path d="M-34 96 Q0 66 34 96" fill="none" stroke="${EYE}" stroke-width="9" stroke-linecap="round" filter="url(#fGlow)"/>`;
    case 'side': return oval(70, y, 22, 34, 4, -2);
    default: return oval(-ex, y) + oval(ex, y);
  }
}

/** Casco + pantalla + corona. Origen = centro de la cabeza. view: front | side | back */
export function head({ expr = 'neutral', view = 'front', crownRot = -7, showCrown = true } = {}) {
  const shell = (w) => `<rect x="${-w / 2}" y="-195" width="${w}" height="390" rx="165" fill="url(#gWhite)" stroke="#B9B2E6" stroke-width="4"/>`;
  const rim = (w) => `<rect x="${-w / 2 + 4}" y="-191" width="${w - 8}" height="382" rx="162" fill="none" stroke="#6038FF" stroke-width="10" opacity=".32" filter="url(#fSoftS)" clip-path="inset(0 0 0 55%)"/>`;
  const gloss = `<path d="M-150 -150 Q-60 -196 40 -176" fill="none" stroke="#fff" stroke-width="14" stroke-linecap="round" opacity=".85"/>`;
  const crn = showCrown ? crown({ x: 0, y: -222, s: 1.12, rot: crownRot }) : '';
  if (view === 'back') {
    return `${shell(450)}${rim(450)}${gloss}<path d="M-120 -120 Q0 -170 120 -120" fill="none" stroke="#E4DFFF" stroke-width="6" opacity=".7"/><ellipse cx="0" cy="40" rx="118" ry="70" fill="none" stroke="#D6D0F5" stroke-width="5" opacity=".6"/><circle cx="-238" cy="14" r="34" fill="url(#gWhite)" stroke="#B9B2E6" stroke-width="4"/><circle cx="238" cy="14" r="34" fill="url(#gWhite)" stroke="#B9B2E6" stroke-width="4"/>${crn}`;
  }
  if (view === 'side') {
    return `${shell(330)}${rim(330)}<rect x="-30" y="-140" width="170" height="290" rx="85" fill="url(#gScreen)"/><path d="M-6 -118 Q40 -140 90 -108" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" opacity=".14"/><g transform="translate(50 0)">${face('side')}</g>${gloss.replace('M-150', 'M-120').replace('40 -176', '20 -176')}<circle cx="-70" cy="20" r="40" fill="url(#gWhite)" stroke="#B9B2E6" stroke-width="4"/><circle cx="-70" cy="20" r="20" fill="url(#gGold)"/>${showCrown ? crown({ x: -6, y: -222, s: 1.1, rot: -4 }) : ''}`;
  }
  return `<circle cx="-238" cy="14" r="34" fill="url(#gWhite)" stroke="#B9B2E6" stroke-width="4"/><circle cx="238" cy="14" r="34" fill="url(#gWhite)" stroke="#B9B2E6" stroke-width="4"/>${shell(450)}${rim(450)}
  <rect x="-185" y="-142" width="370" height="296" rx="122" fill="url(#gScreen)" stroke="#2A2F8E" stroke-width="5"/>
  <rect x="-185" y="-142" width="370" height="296" rx="122" fill="none" stroke="#35D5FF" stroke-width="3" opacity=".25"/>
  <path d="M-150 -92 Q-100 -130 -20 -128" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" opacity=".16"/>
  <g transform="translate(0 8)">${face(expr)}</g>${gloss}${crn}`;
}

/** Sombra de contacto suave. */
export const groundShadow = (cx, cy, rx, ry = 26, o = 0.45) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#000" opacity="${o}" filter="url(#fSoft)"/>`;

/** Sudadera (torso + capucha) en coordenadas absolutas del lienzo de 1000. */
export function torso({ view = 'front', lean = 0 } = {}) {
  const hood = `<path d="M330 478 Q500 560 670 478 Q690 430 610 428 Q500 470 390 428 Q310 430 330 478Z" fill="#0F1242" stroke="#080B2B" stroke-width="3"/>`;
  const body = `<path d="M346 486 Q334 620 358 748 Q500 782 642 748 Q666 620 654 486 Q500 540 346 486Z" fill="url(#gNavy)" stroke="#0A0D33" stroke-width="4"/>`;
  const hem = `<path d="M360 726 Q500 764 640 726 L642 750 Q500 790 358 750Z" fill="#0F1242"/>`;
  const sheen = `<path d="M372 520 Q360 620 380 720" fill="none" stroke="#4B53C4" stroke-width="12" stroke-linecap="round" opacity=".5"/>`;
  if (view === 'back') return `${hood}${body}${sheen}${hem}<path d="M400 500 Q500 580 600 500 Q620 560 500 640 Q380 560 400 500Z" fill="#12165A" stroke="#0A0D33" stroke-width="3"/><path d="M500 520 V740" stroke="#0A0D33" stroke-width="3" opacity=".6"/>`;
  return `${hood}${body}${sheen}${hem}${emblem(500, 610, 0.95)}<path d="M470 500 V560 M530 500 V560" stroke="#F6F4FF" stroke-width="7" stroke-linecap="round"/><path d="M420 690 Q500 720 580 690" fill="none" stroke="#0A0D33" stroke-width="4" opacity=".7"/>`;
}

export function legs({ jump = 0 } = {}) {
  const l = (x1) => `<line x1="${x1}" y1="730" x2="${x1 + (x1 < 500 ? -8 : 8)}" y2="${850 - jump}" stroke="#0A0D33" stroke-width="88" stroke-linecap="round"/><line x1="${x1}" y1="730" x2="${x1 + (x1 < 500 ? -8 : 8)}" y2="${850 - jump}" stroke="#1B1F63" stroke-width="80" stroke-linecap="round"/>`;
  return l(440) + l(560);
}
