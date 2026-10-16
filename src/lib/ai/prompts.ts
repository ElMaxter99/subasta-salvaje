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

/**
 * Prompt de edición acumulativa. Prioriza: conservar escena y perspectiva, añadir SÓLO el
 * nuevo elemento, mantener lo anterior, integrar luz/escala/sombras, sin texto.
 */
export function buildEditPrompt(input: EditSceneInput): string {
  const previous = input.previousItems.length
    ? `The scene already contains these purchased items, which must remain exactly where they are and unchanged: ${input.previousItems.join(', ')}.`
    : 'The scene is still empty apart from its original architecture.';
  return [
    `Edit the provided image of a "${input.theme}" scene by adding exactly ONE new element: "${input.itemName}" (${input.itemDescription || 'no further description'}).`,
    'Keep the original composition, camera angle, perspective, architecture, colors and every existing object exactly as they are. Do NOT redraw the scene, do NOT remove, move, resize or restyle anything that is already there.',
    previous,
    'Place the new element in a free area where it fits naturally. Match the lighting, scale, materials, perspective and cast shadows of the existing scene so it looks like it was always part of it.',
    'Add only the requested element and nothing else.',
    NO_TEXT,
  ].join(' ');
}

export function buildItemImagePrompt(input: ItemImageInput): string {
  return [
    `A single centered ${input.itemName} (${input.itemDescription || 'no further description'}) for a "${input.theme}" themed game.`,
    'Isolated object on a simple soft gradient background, stylized 3D render, vivid colors, lots of personality.',
    NO_TEXT,
  ].join(' ');
}
