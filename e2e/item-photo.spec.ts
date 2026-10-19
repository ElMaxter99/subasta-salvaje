import { expect, test } from '@playwright/test';
import sharp from 'sharp';

test('el anfitrión sube la foto de un elemento del catálogo y puede quitarla', async ({ browser }) => {
  const ctx = await browser.newContext();
  expect((await ctx.request.post('/api/auth/demo')).ok()).toBeTruthy();
  const created = await ctx.request.post('/api/games', { data: { name: 'Fotos E2E', players: ['Ana', 'Beto'].map((name) => ({ name })) } });
  const code = (await created.json()).room_code as string;
  const page = await ctx.newPage();
  await page.goto(`/game/${code}/host`);
  await page.waitForTimeout(4000); // hidratación en frío
  const tab = page.getByRole('tab', { name: /Catálogo/ });
  // La página puede no estar hidratada todavía (servidor de desarrollo en frío): se repite el clic hasta que cambia la pestaña
  await expect(async () => {
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true', { timeout: 2000 });
  }).toPass({ timeout: 60_000 });
  await expect(page.getByText(/mezcla esa foto con la imagen de quien lo gana/)).toBeVisible();

  const first = (await (await ctx.request.get(`/api/games/${code}`)).json()).snapshot.items[0] as { id: string; name: string };
  const photo = await sharp({ create: { width: 120, height: 120, channels: 3, background: { r: 255, g: 105, b: 180 } } }).png().toBuffer();
  await page.locator(`#item-photo-${first.id}`).setInputFiles({ name: 'conejo.png', mimeType: 'image/png', buffer: photo });
  await expect(page.getByText(`Foto de «${first.name}» guardada`)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: `Quitar foto de ${first.name}` })).toBeVisible();
  await expect(page.getByRole('button', { name: `Subir foto de ${first.name}` })).toContainText('Cambiar foto');

  // Un archivo que no es imagen se rechaza en el servidor
  const bad = await ctx.request.post(`/api/games/${code}/item-image`, { multipart: { item_id: first.id, file: { name: 'x.png', mimeType: 'image/png', buffer: Buffer.from('no soy una imagen') } } });
  expect(bad.status()).toBe(400);

  await page.getByRole('button', { name: `Quitar foto de ${first.name}` }).click();
  await expect(page.getByText('Foto quitada')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: `Subir foto de ${first.name}` })).toContainText('Subir foto');
});
