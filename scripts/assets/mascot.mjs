import { arm, emblem, groundShadow, head, legs, shoe, torso, glove, crown } from './lib.mjs';
import { confetti, hammer, megaphone, sparkle, speedLines, timer } from './props.mjs';

const SL = [365, 520]; // hombro izquierdo (del espectador)
const SR = [635, 520];
const HEAD = { x: 500, y: 290 };

const placeHead = (opts) => `<g transform="translate(${HEAD.x} ${HEAD.y})">${head(opts)}</g>`;
const feet = (jump = 0) => `${shoe({ x: 410, y: 884 - jump, rot: -4 })}${shoe({ x: 590, y: 884 - jump, flip: -1, rot: 4 })}`;

/** Personaje completo (cuerpo entero) para una pose concreta. Lienzo lógico de 1000×1000. */
export function mascotFull({ expr = 'neutral', pose = 'stand' } = {}) {
  const armsDown = [arm(SL, [335, 610], [348, 700], { kind: 'fist' }), arm(SR, [665, 610], [652, 700], { kind: 'fist' })];
  const base = (jump = 0, shadowRx = 230) => `${groundShadow(500, 925, shadowRx, 26, 0.5)}${legs({ jump })}${feet(jump)}${torso()}`;
  switch (pose) {
    case 'hero': // martillo en una mano, señalando con la otra (como la referencia)
      return `${base()}${arm(SR, [715, 545], [790, 465], { kind: 'point', rot: 50 })}${placeHead({ expr: 'happy' })}${arm(SL, [300, 560], [248, 520], { kind: 'fist' })}${hammer({ x: 248, y: 540, s: 0.95, rot: -38 })}${glove({ x: 248, y: 520, kind: 'fist', rot: -38 })}${sparkle({ x: 826, y: 410, s: 0.18 })}`;
    case 'presenting_item':
      return `${base()}${arm(SL, [310, 610], [378, 700], { kind: 'fist' })}${placeHead({ expr: 'happy' })}${arm(SR, [735, 560], [830, 470], { kind: 'palm', rot: 70 })}${sparkle({ x: 880, y: 400, s: 0.2 })}${sparkle({ x: 800, y: 350, s: 0.1, rot: 15 })}`;
    case 'announcing_bid':
      return `${base()}${arm(SL, [310, 610], [378, 700], { kind: 'fist' })}${placeHead({ expr: 'surprised' })}${megaphone({ x: 700, y: 410, s: 1.15, rot: -12 })}${arm(SR, [700, 560], [686, 440], { kind: 'fist', rot: -20 })}${speedLines({ x: 880, y: 360, s: 0.7, rot: -14 })}`;
    case 'countdown':
      return `${base()}${placeHead({ expr: 'focus' })}${timer({ x: 500, y: 640, s: 0.9 })}${arm(SL, [330, 615], [376, 655], { kind: 'fist', rot: 80 })}${arm(SR, [670, 615], [624, 655], { kind: 'fist', rot: -80 })}`;
    case 'hammer_auction':
      return `${base()}${arm(SL, [310, 610], [378, 700], { kind: 'fist' })}${placeHead({ expr: 'happy' })}${hammer({ x: 760, y: 330, s: 0.95, rot: 28 })}${arm(SR, [740, 470], [760, 340], { kind: 'fist', rot: 28 })}${speedLines({ x: 640, y: 120, s: 0.55, rot: 150 })}${sparkle({ x: 860, y: 240, s: 0.14 })}`;
    case 'celebration':
      return `${base(40, 170)}${arm(SL, [300, 410], [262, 290], { kind: 'fist', rot: -10 })}${arm(SR, [700, 410], [738, 290], { kind: 'fist', rot: 10 })}${placeHead({ expr: 'hype' })}${confetti({ x: 500, y: 420, spread: 440, count: 46 })}${sparkle({ x: 170, y: 170, s: 0.14 })}${sparkle({ x: 840, y: 190, s: 0.12, rot: 20 })}`;
    default: // stand
      return `${base()}${armsDown.join('')}${placeHead({ expr })}`;
  }
}

/** Busto (cabeza + hombros + manos) para las expresiones: mismo encuadre en todas. */
export function mascotBust({ expr }) {
  const shoulders = `${torso()}`;
  const hands = {
    happy: [arm([640, 530], [720, 560], [758, 488], { kind: 'thumb', rot: 8 }, 60), arm([360, 530], [290, 560], [262, 500], { kind: 'thumb', rot: -8 }, 60)],
    surprised: [arm([640, 530], [700, 480], [650, 400], { kind: 'open', rot: -20 }, 56), arm([360, 530], [300, 480], [350, 400], { kind: 'open', rot: 20 }, 56)],
    wink: [arm([640, 530], [725, 560], [760, 485], { kind: 'thumb', rot: 8 }, 60), arm([360, 530], [320, 610], [345, 690], { kind: 'fist' }, 60)],
    thinking: [arm([640, 530], [690, 560], [596, 478], { kind: 'fist', rot: -30 }, 56), arm([360, 530], [320, 610], [345, 690], { kind: 'fist' }, 60)],
    sad: [arm([640, 530], [670, 610], [655, 690], { kind: 'fist' }, 60), arm([360, 530], [330, 610], [345, 690], { kind: 'fist' }, 60)],
    angry: [arm([640, 530], [690, 600], [640, 650], { kind: 'fist', rot: -60 }, 60), arm([360, 530], [310, 600], [360, 650], { kind: 'fist', rot: 60 }, 60)],
    celebrating: [arm([640, 530], [740, 480], [790, 370], { kind: 'fist', rot: 20 }, 58), arm([360, 530], [260, 480], [210, 370], { kind: 'fist', rot: -20 }, 58)],
    hype: [arm([640, 530], [735, 500], [770, 400], { kind: 'fist', rot: 15 }, 58), arm([360, 530], [265, 500], [230, 400], { kind: 'fist', rot: -15 }, 58)],
  }[expr];
  const extras = {
    angry: `<g transform="translate(662 150)"><path d="M0 -26 L8 -8 L26 -2 L8 6 L0 24 L-8 6 L-26 -2 L-8 -8Z" fill="#F54DB7" stroke="#FFD1F0" stroke-width="3"/></g>`,
    celebrating: confetti({ x: 500, y: 250, spread: 420, count: 40, seed: 11 }),
    hype: `${sparkle({ x: 200, y: 170, s: 0.12 })}${sparkle({ x: 810, y: 140, s: 0.15, rot: 12 })}${confetti({ x: 500, y: 260, spread: 400, count: 22, seed: 5 })}`,
    happy: `${sparkle({ x: 830, y: 250, s: 0.07 })}`,
    wink: `${sparkle({ x: 800, y: 260, s: 0.08 })}`,
    surprised: speedLines({ x: 730, y: 170, s: 0.35, rot: -60 }),
  }[expr] ?? '';
  const h = `<g transform="translate(${HEAD.x} ${HEAD.y})">${head({ expr: expr === 'focus' ? 'angry' : expr })}</g>`;
  const thinkHand = expr === 'thinking' ? '' : '';
  return `${groundShadow(500, 760, 250, 22, 0.25)}${shoulders}${h}${hands.join('')}${thinkHand}${extras}`;
}

/** Vistas base: front (cuerpo entero), half, head, back, side. */
export function mascotView(view) {
  switch (view) {
    case 'front_neutral':
      return mascotFull({ pose: 'stand', expr: 'neutral' });
    case 'full_body':
      return mascotFull({ pose: 'hero' });
    case 'half_body': {
      return `${torso()}${arm(SL, [335, 610], [348, 700], { kind: 'fist' })}${arm(SR, [665, 610], [652, 700], { kind: 'fist' })}${placeHead({ expr: 'happy' })}`;
    }
    case 'head':
      return placeHead({ expr: 'happy' });
    case 'back':
      return `${groundShadow(500, 925, 230, 26, 0.5)}${legs()}${feet()}${torso({ view: 'back' })}${arm(SL, [335, 610], [348, 700], { kind: 'fist' })}${arm(SR, [665, 610], [652, 700], { kind: 'fist' })}<g transform="translate(${HEAD.x} ${HEAD.y})">${head({ view: 'back' })}</g>`;
    case 'side': {
      const sideLegs = `<line x1="500" y1="730" x2="496" y2="850" stroke="#0A0D33" stroke-width="96" stroke-linecap="round"/><line x1="500" y1="730" x2="496" y2="850" stroke="#1B1F63" stroke-width="88" stroke-linecap="round"/>`;
      const sideBody = `<path d="M400 488 Q392 620 410 748 Q500 782 590 748 Q608 620 600 488 Q500 530 400 488Z" fill="url(#gNavy)" stroke="#0A0D33" stroke-width="4"/>`;
      return `${groundShadow(500, 925, 200, 24, 0.5)}${sideLegs}${shoe({ x: 520, y: 884 })}${sideBody}${emblem(520, 610, 0.7)}${arm([500, 520], [510, 610], [524, 690], { kind: 'fist' }, 70)}<g transform="translate(${HEAD.x} ${HEAD.y})">${head({ view: 'side' })}</g>`;
    }
    default:
      throw new Error(`vista desconocida ${view}`);
  }
}
export { crown };
