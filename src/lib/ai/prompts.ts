import { slotFor } from './compose';
import type { EditSceneInput, InitialSceneInput, ItemImageInput } from './types';

const STYLE =
  'Polished stylized 3D diorama render, warm cinematic lighting, rich colors, clean readable composition, 3:2 landscape framing.';
const NO_TEXT = 'Do not add any text, letters, numbers, captions, logos or watermarks anywhere in the image.';

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
function previousClause(input: EditSceneInput): string {
  const n = input.previousItems.length;
  const zone = `If the base is a place or a scene with free space, put the new element preferably in the ${regionFor(n)} part of it; otherwise integrate it wherever it makes the most natural and funny sense.`;
  if (n === 0) return `Nothing has been added to the base picture yet. ${zone}`;
  return `Image 0 ALREADY contains ${n === 1 ? 'this element' : 'these elements'}, added in earlier rounds: ${input.previousItems.join(', ')}. ${n === 1 ? 'It stays' : 'They all stay'} fully visible and recognizable in the final image, with the same look: the new element must NOT replace, cover, overlap or hide ${n === 1 ? 'it' : 'any of them'}. ${zone}`;
}

/** Recordatorio final (los modelos pesan más lo último): nada de lo anterior desaparece ni se cambia por otra cosa. */
function finalCheck(input: EditSceneInput): string {
  return input.previousItems.length === 0
    ? 'Final check: the base picture is unchanged except for the one added element.'
    : `Final check: ${input.previousItems.join(', ')} ${input.previousItems.length === 1 ? 'is' : 'are'} still clearly visible exactly where ${input.previousItems.length === 1 ? 'it was' : 'they were'}, nothing existing was replaced by something else, and the only difference from the base picture is the one new element.`;
}

/** Reglas comunes: la imagen base puede ser CUALQUIER cosa y el resultado debe ser una sola imagen coherente, natural y divertida. */
const MIX_RULES = [
  'Image 0 is the BASE picture of a funny photo-mixing game: it can be anything (a house, a room, a drink, a food, an object, an animal, a person, a landscape). You are given no further context, so decide by yourself from what you see.',
  'Merge the new element into the base in the most natural, believable and funny way: if the base is a place or a scene, put the element in it as a real object that belongs there (same scale, perspective, lighting and cast shadows); if the base is a food, a drink or an object, use the element as something that is added to it (an ingredient, a topping, a decoration, an accessory) blended in naturally; if the base is a living being, the element becomes an accessory, a companion or a prop that interacts with it.',
  'The final image must look like ONE coherent photograph or picture in the style of the base, not a collage: no sticker look, no cut-out edges, no white or dark halos around the element. The element must rest or attach to the scene in a physically believable way (on the floor, on a table, held, worn or mixed in as appropriate) with contact shadows, never floating or pasted on a wall unless that is natural for it. Keep the base picture\'s framing, aspect ratio, colors and style. Do NOT redraw, restyle or remove anything that was already there.',
];

/**
 * Prompt de edición acumulativa (sin foto del elemento: se describe con texto). Prioriza: la base puede ser cualquier cosa, integrar
 * de forma natural y divertida, conservar lo anterior, añadir SÓLO el nuevo elemento, sin texto.
 */
export function buildEditPrompt(input: EditSceneInput): string {
  if (input.itemImage) return buildBlendPrompt(input);
  return [
    `Add exactly ONE new element to image 0: "${input.itemName}" (${input.itemDescription || 'no further description'}).`,
    ...MIX_RULES,
    previousClause(input),
    'Add only that element and nothing else.',
    finalCheck(input),
    NO_TEXT,
  ].join(' ');
}

/**
 * Mezcla de dos imágenes: la base (imagen 0) y la foto del elemento comprado (imagen 1). El elemento debe verse como en la foto de
 * referencia (p. ej. un conejo rosa con un lazo azul sigue siendo rosa con lazo azul) pero integrado de forma natural y divertida.
 */
export function buildBlendPrompt(input: EditSceneInput): string {
  return [
    `Image 1 is a reference picture of the new element "${input.itemName}" (${input.itemDescription || 'no further description'}). Add exactly ONE new element to image 0: the object shown in image 1, reproduced faithfully (its shape, colors, markings and distinctive details exactly as in the reference). Take only the object itself: leave out the background and the unrelated people or scenery of the reference photo unless they are clearly part of the element.`,
    ...MIX_RULES,
    previousClause(input),
    'Add only that element and nothing else.',
    finalCheck(input),
    NO_TEXT,
  ].join(' ');
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
