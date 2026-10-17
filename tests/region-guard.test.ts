import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { applyEditGuard, preserveOutsideZone, restoreLostCores, zoneBox } from '@/lib/ai/region-guard';

const W = 640, H = 360;
const canvas = (rects: { x: number; y: number; w: number; h: number; c: string }[], w = W, h = H) =>
  sharp({ create: { width: w, height: h, channels: 3, background: '#808080' } })
    .composite(rects.map((r) => ({ input: { create: { width: r.w, height: r.h, channels: 3 as const, background: r.c } }, left: r.x, top: r.y })))
    .png().toBuffer().then((b) => new Uint8Array(b));
const px = async (img: Uint8Array, x: number, y: number) => {
  const { data, info } = await sharp(Buffer.from(img)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * 3;
  return [data[i]!, data[i + 1]!, data[i + 2]!];
};

describe('guardia de zona: lo anterior no puede desaparecer', () => {
  // Compra n.º 2 (índice 1): su zona es el centro-abajo. El objeto anterior (rojo) está a la izquierda, fuera de esa zona.
  const previous = { x: 40, y: 230, w: 80, h: 80, c: '#ff0000' };
  const box = zoneBox(1, W, H);

  it('si el modelo borra el objeto anterior y dibuja el nuevo en su zona, se conserva el anterior y entra el nuevo', async () => {
    const base = await canvas([previous]);
    const modelOutput = await canvas([{ x: 280, y: 220, w: 100, h: 100, c: '#0000ff' }]); // el modelo «perdió» el rojo
    const r = await preserveOutsideZone(base, modelOutput, 1);
    expect(r.note).toBe('lo anterior se conserva fuera de la zona del objeto nuevo');
    expect(r.applied).toBe(true);
    expect(await px(r.bytes, 80, 270)).toEqual([255, 0, 0]); // el objeto anterior sigue ahí
    expect(await px(r.bytes, 330, 270)).toEqual([0, 0, 255]); // el nuevo está en su zona
    expect(box.left).toBeLessThan(280);
  });

  it('un objeto anterior que cae DENTRO de la zona del nuevo también se conserva (caso real: el modelo lo cambió por otra cosa)', async () => {
    const insideBox = { x: 110, y: 250, w: 60, h: 60, c: '#ff0000' }; // núcleo de la 1.ª compra, solapado con la zona de la 2.ª
    const base = await canvas([insideBox]);
    const replaced = await canvas([{ x: 110, y: 250, w: 60, h: 60, c: '#00ff00' }, { x: 300, y: 230, w: 100, h: 100, c: '#0000ff' }]); // cambió el rojo por verde y añadió el azul
    const r = await preserveOutsideZone(base, replaced, 1);
    expect(r.applied).toBe(true);
    expect(await px(r.bytes, 140, 280)).toEqual([255, 0, 0]); // el objeto anterior sigue intacto
    expect(await px(r.bytes, 350, 280)).toEqual([0, 0, 255]); // el nuevo, en su zona
  });

  it('el fondo fuera de la zona queda idéntico al de la imagen anterior aunque el modelo lo haya retocado', async () => {
    const base = await canvas([previous]);
    const retouched = await canvas([{ x: 0, y: 0, w: 640, h: 60, c: '#101010' }, { x: 280, y: 220, w: 100, h: 100, c: '#0000ff' }]); // cambió el cielo
    const r = await preserveOutsideZone(base, retouched, 1);
    expect(r.applied).toBe(true);
    expect(await px(r.bytes, 10, 10)).toEqual([128, 128, 128]); // el cielo original, no el retocado
  });

  it('si el objeto nuevo no está en su zona, no se toca el resultado del modelo', async () => {
    const base = await canvas([previous]);
    const wrongPlace = await canvas([{ x: 10, y: 10, w: 60, h: 60, c: '#00ff00' }]);
    const r = await preserveOutsideZone(base, wrongPlace, 1);
    expect(r.applied).toBe(false);
    expect(r.note).toMatch(/no está en su zona/);
    expect(await px(r.bytes, 30, 30)).toEqual([0, 255, 0]);
  });

  it('si el modelo transformó buena parte de la imagen (mezcla, p. ej. salsa en un batido) no se toca', async () => {
    const base = await canvas([previous]);
    const mixed = await canvas([{ x: 0, y: 0, w: 640, h: 360, c: '#ffffff' }]); // todo el cuadro cambia
    const r = await preserveOutsideZone(base, mixed, 1);
    expect(r.applied).toBe(false);
    expect(r.note).toMatch(/cambio global/);
    expect(await px(r.bytes, 80, 270)).toEqual([255, 255, 255]);
  });

  it('si el modelo devolvió otra proporción, no se toca; y nunca lanza con datos basura', async () => {
    const base = await canvas([previous]);
    const other = await canvas([], 400, 300); // 4:3 frente a 16:9
    expect((await preserveOutsideZone(base, other, 1)).applied).toBe(false);
    const bad = await preserveOutsideZone(base, new Uint8Array([1, 2, 3]), 1);
    expect(bad.applied).toBe(false);
  });

  it('acepta una salida del modelo de otro tamaño pero misma proporción (p. ej. 1024x576 frente a 1536x864)', async () => {
    const base = await canvas([previous], 1280, 720);
    const out = await canvas([{ x: 280, y: 220, w: 100, h: 100, c: '#0000ff' }], 640, 360);
    const r = await preserveOutsideZone(base, out, 1);
    expect(r.applied).toBe(true);
    expect((await sharp(Buffer.from(r.bytes)).metadata()).width).toBe(1280);
  });
});

describe('guardia «cores» (por defecto, edición creativa): solo restaura lo anterior que el modelo pierde', () => {
  const pikachu = { x: 80, y: 250, w: 70, h: 70, c: '#ff0000' }; // objeto de la 1.ª compra, dentro de su núcleo

  it('si el modelo cambia el objeto anterior por otra cosa se restaura, y el resto de la edición creativa se respeta', async () => {
    const base = await canvas([pikachu]);
    // El modelo «creativo» añade agua azul abajo a la derecha y una persona, y de paso cambió el rojo por una ensalada verde
    const edited = await canvas([{ x: 80, y: 250, w: 70, h: 70, c: '#00ff00' }, { x: 300, y: 200, w: 300, h: 140, c: '#0000ff' }]);
    const r = await restoreLostCores(base, edited, 1);
    expect(r.applied).toBe(true);
    expect(await px(r.bytes, 115, 285)).toEqual([255, 0, 0]); // el objeto anterior vuelve
    expect(await px(r.bytes, 450, 270)).toEqual([0, 0, 255]); // el agua de la edición creativa se respeta
  });

  it('si el objeto anterior sigue ahí no se toca nada, aunque el modelo transforme el resto', async () => {
    const base = await canvas([pikachu]);
    const edited = await canvas([pikachu, { x: 300, y: 200, w: 300, h: 140, c: '#0000ff' }]);
    const r = await restoreLostCores(base, edited, 1);
    expect(r.applied).toBe(false);
    expect(r.note).toMatch(/se conserva/);
  });

  it('sin compras anteriores, con otra proporción o si el modelo rehízo casi toda la imagen no interviene; «off» tampoco', async () => {
    const base = await canvas([pikachu]);
    expect((await restoreLostCores(base, await canvas([]), 0)).applied).toBe(false);
    expect((await restoreLostCores(base, await canvas([], 400, 300), 1)).applied).toBe(false);
    expect((await restoreLostCores(base, await canvas([{ x: 0, y: 0, w: 640, h: 360, c: '#ffffff' }]), 1)).note).toMatch(/rehízo casi toda/);
    expect((await applyEditGuard('off', base, await canvas([]), 1)).applied).toBe(false);
    expect((await applyEditGuard('zone', base, await canvas([{ x: 300, y: 230, w: 100, h: 100, c: '#0000ff' }]), 1)).applied).toBe(true);
  });
});
