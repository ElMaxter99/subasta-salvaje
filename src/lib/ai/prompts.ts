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
 * Lo ya comprado debe SEGUIR VISIBLE: los modelos de edición tienden a «reemplazar» el objeto anterior por el nuevo si se les
 * dice solo que añadan uno. Se pide explícitamente no taparlo ni sustituirlo y se sugiere una zona distinta.
 */
function previousClause(input: EditSceneInput): string {
  if (input.previousItems.length === 0) return 'The scene is still empty apart from its original architecture.';
  return `Image 0 ALREADY contains ${input.previousItems.length === 1 ? 'this purchased object' : 'these purchased objects'}: ${input.previousItems.join(', ')}. ${input.previousItems.length === 1 ? 'It stays' : 'They all stay'} fully visible in the final image, with the same position, size and appearance: the new object must NOT replace, cover, overlap or hide ${input.previousItems.length === 1 ? 'it' : 'any of them'}. Put the new object in a different, empty spot, preferably in the ${regionFor(input.previousItems.length)} part of the scene.`;
}

/**
 * Prompt de edición acumulativa. Prioriza: conservar escena y perspectiva, añadir SÓLO el
 * nuevo elemento, mantener lo anterior, integrar luz/escala/sombras, sin texto.
 */
export function buildEditPrompt(input: EditSceneInput): string {
  if (input.itemImage) return buildBlendPrompt(input);
  const previous = previousClause(input);
  return [
    `Edit the provided image of a "${input.theme}" scene by adding exactly ONE new element: "${input.itemName}" (${input.itemDescription || 'no further description'}).`,
    'Keep the original composition, camera angle, perspective, architecture, colors and every existing object exactly as they are. Do NOT redraw the scene, do NOT remove, move, resize or restyle anything that is already there.',
    previous,
    'Place the new element in a free area where it fits naturally. Match the lighting, scale, materials, perspective and cast shadows of the existing scene so it looks like it was always part of it.',
    'Add only the requested element and nothing else.',
    NO_TEXT,
  ].join(' ');
}

/**
 * Mezcla de dos imágenes: la escena del jugador (imagen 0) y la foto del elemento comprado (imagen 1). El objeto debe verse
 * como en la foto de referencia (p. ej. un conejo rosa con un lazo azul sigue siendo rosa con lazo azul) pero integrado en la casa.
 */
export function buildBlendPrompt(input: EditSceneInput): string {
  const previous = previousClause(input);
  return [
    `Image 0 is the existing "${input.theme}" scene. Image 1 is a reference picture of the object "${input.itemName}" (${input.itemDescription || 'no further description'}).`,
    'Edit image 0 by adding exactly ONE new element: the object shown in image 1. Reproduce that object faithfully (its shape, colors, markings and distinctive details exactly as in the reference) and place it in the scene.',
    'Keep the original composition, camera angle, perspective, architecture, colors and every existing object exactly as they are. Do NOT redraw the scene, do NOT remove, move, resize or restyle anything that is already there.',
    previous,
    'Place the object in a free area where it fits naturally, matching the lighting, scale, perspective and cast shadows of the scene so it looks like it was always part of it.',
    'Add only that object and nothing else.',
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
