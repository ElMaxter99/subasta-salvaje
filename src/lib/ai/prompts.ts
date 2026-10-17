import { slotFor } from './compose';
import type { EditSceneInput, InitialSceneInput, ItemImageInput } from './types';

const STYLE =
  'Polished stylized 3D diorama render, warm cinematic lighting, rich colors, clean readable composition, 3:2 landscape framing.';
const NO_TEXT = 'No text, letters, numbers, logos or watermarks anywhere.';

export function buildInitialScenePrompt(input: InitialSceneInput): string {
  return [
    `Create ${input.sceneDescription}.`,
    `Theme of the game: "${input.theme}". The space must be EMPTY and undecorated: it is the blank starting point that will later be filled item by item.`,
    'Leave clear open floor space so new objects can be added later. Use a fixed, consistent camera angle (slightly elevated three-quarter view).',
    STYLE,
    NO_TEXT,
  ].join(' ');
}

/** Zona sugerida (en palabras) para el elemento n.º `index`: reparte las compras para que no se pisen entre sí. */
export function regionFor(index: number): string {
  const [x, y] = slotFor(index);
  const h = x < 0.33 ? 'left' : x < 0.66 ? 'center' : 'right';
  const v = y >= 0.85 ? 'foreground' : y >= 0.72 ? 'lower-middle' : 'middle';
  return `${v} ${h}`;
}

/**
 * Lo ya añadido en rondas anteriores debe SEGUIR VISIBLE: los modelos de edición tienden a «reemplazar» el objeto anterior por el nuevo
 * si se les dice solo que añadan uno. Se pide explícitamente no taparlo ni sustituirlo. La zona sugerida solo se pide si la imagen
 * base es un lugar con espacio libre (la guardia de `region-guard.ts` usa esa misma zona); si no, el modelo decide cómo integrarlo.
 */
function previousClause(input: EditSceneInput, compact = false): string {
  const n = input.previousItems.length;
  const zone = `If the base is a place with free space, put the new element preferably in the ${regionFor(n)} part; otherwise wherever makes most sense.`;
  if (n === 0) return `Nothing has been added yet. ${zone}`;
  return `Image 0 ALREADY contains ${n === 1 ? 'this element' : 'these elements'}, added in earlier rounds: ${namesList(input.previousItems, compact ? 2 : 5)}. ${n === 1 ? 'It stays' : 'They all stay'} clearly visible and recognizable, never replaced, covered or hidden (the scene around ${n === 1 ? 'it' : 'them'} may change). ${zone}`;
}

/** Lista de nombres acotada: los prompts no pueden pasar de ~2000 caracteres (límite de los proveedores) sin perder el final. */
function namesList(names: string[], max = 5): string {
  const clip = (t: string) => (t.length > 30 ? `${t.slice(0, 27)}…` : t);
  const shown = names.slice(-max).map(clip).join(', ');
  return names.length > max ? `${shown} and ${names.length - max} more` : shown;
}

/**
 * Reglas comunes (cortas a propósito: el prompt completo debe caber en ~2000 caracteres). El juego NO es «pegar un objeto encima»: es
 * EDITAR la imagen base para que la combinación tenga sentido y gracia. La base puede ser cualquier cosa y no hay contexto.
 */
const MIX_RULES = [
  'Image 0 is the BASE picture of a funny photo-mixing game; it can be anything (a place, a room, a drink, a food, an object, an animal, a person) and you get no context: decide from what you see.',
  'Do not just paste the element on top: EDIT the base so the combination makes sense and is fun. You may change the surroundings and make the main subject interact with the element (a boat needs water and a person can sit in it; a hat is worn; an ingredient is poured into the drink and changes it). Pick the most natural, funniest idea.',
  'The result must look like ONE coherent photo in the style of the base, not a collage: no sticker look, cut-out edges or halos, physically believable contact (shadows, reflections, scale, perspective, light), never floating.',
  'Keep the base identity (same main subject, framing, aspect ratio, style): edit it, do not replace it.',
];

function finalCheck(input: EditSceneInput, compact = false): string {
  return input.previousItems.length === 0
    ? 'Final check: clearly the same base picture, edited so the new element is naturally part of it.'
    : `Final check: ${namesList(input.previousItems, compact ? 1 : 3)} still clearly visible, nothing added earlier removed or replaced, and clearly the same base picture, edited so the new element is naturally part of it.`;
}

/**
 * Prompt de edición acumulativa (sin foto del elemento: se describe con texto). Prioriza: la base puede ser cualquier cosa, integrar
 * de forma natural y divertida, conservar lo anterior, añadir SÓLO el nuevo elemento, sin texto.
 */
const MAX_EDIT_PROMPT = 1950; // los proveedores cortan en ~2000 caracteres: el final (comprobación y «sin texto») no debe perderse

/** Construye con el detalle normal y, si no cabe, reduce nombres y descripción hasta que quepa. */
function fitted(build: (compact: boolean) => string): string {
  const full = build(false);
  return full.length <= MAX_EDIT_PROMPT ? full : build(true);
}

export function buildEditPrompt(input: EditSceneInput): string {
  if (input.itemImage) return buildBlendPrompt(input);
  return fitted((compact) => [
    `The new element to combine with image 0 is "${input.itemName.slice(0, compact ? 40 : 60)}" (${(input.itemDescription || 'no further description').slice(0, compact ? 40 : 80)}).`,
    ...MIX_RULES,
    previousClause(input, compact),
    'Add no other new object besides it and the surroundings it needs.',
    finalCheck(input, compact),
    NO_TEXT,
  ].join(' '));
}

/**
 * Mezcla de dos imágenes: la base (imagen 0) y la foto del elemento comprado (imagen 1). El elemento debe verse como en la foto de
 * referencia (p. ej. un conejo rosa con un lazo azul sigue siendo rosa con lazo azul) pero integrado de forma natural y divertida.
 */
export function buildBlendPrompt(input: EditSceneInput): string {
  return fitted((compact) => [
    `Image 1 is a reference photo of the new element "${input.itemName.slice(0, compact ? 40 : 60)}" (${(input.itemDescription || 'no further description').slice(0, compact ? 40 : 80)}): reproduce that object faithfully (shape, colors, markings) but only the object, not its background or unrelated people.`,
    ...MIX_RULES,
    previousClause(input, compact),
    'Add no other new object besides it and the surroundings it needs.',
    finalCheck(input, compact),
    NO_TEXT,
  ].join(' '));
}

export function buildItemImagePrompt(input: ItemImageInput): string {
  return [
    `A single centered ${input.itemName} (${input.itemDescription || 'no further description'}) for a "${input.theme}" themed game.`,
    input.isolated
      ? 'Isolated object on a perfectly plain, flat, pure white background with no floor, no ground, no shadow and no gradient, stylized 3D render, vivid colors, lots of personality, whole object fully visible with margin around it.'
      : 'Isolated object on a simple soft gradient background, stylized 3D render, vivid colors, lots of personality.',
    NO_TEXT,
  ].join(' ');
}
