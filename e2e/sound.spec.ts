import { expect, test } from '@playwright/test';

test('sonido: el anfitrión silencia la TV desde su panel; la TV pide activar el sonido hasta el primer gesto', async ({ browser }) => {
  const hostCtx = await browser.newContext();
  const host = hostCtx.request;
  expect((await host.post('/api/auth/demo')).ok()).toBeTruthy();
  const created = await host.post('/api/games', { data: { name: 'Sonido E2E', initial_budget_cents: 2000, players: ['Ana', 'Beto'].map((name) => ({ name })) } });
  const code = (await created.json()).room_code as string;
  const state = async () => (await (await host.get(`/api/games/${code}`)).json()).snapshot;
  expect((await state()).game).toMatchObject({ sound_enabled: true, music_enabled: true });

  const tv = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await tv.goto(`/game/${code}/screen`);
  await expect(tv.getByText('Sonido E2E').first()).toBeVisible({ timeout: 60_000 });
  // Sin gesto del usuario el navegador no deja sonar: la TV muestra «Activar sonido»
  await expect(tv.getByTestId('sound-activate')).toBeVisible({ timeout: 15_000 });

  // Panel del anfitrión
  const page = await hostCtx.newPage();
  await page.goto(`/game/${code}/host`);
  const sw = page.getByTestId('tv-sound-switch');
  await expect(sw).toHaveAttribute('aria-pressed', 'true', { timeout: 60_000 });
  await sw.click();
  await expect(sw).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await state()).game.sound_enabled).toBe(false);
  await page.getByTestId('tv-music-switch').click();
  await expect.poll(async () => (await state()).game.music_enabled).toBe(false);
  // Persiste al recargar
  await page.reload();
  await expect(page.getByTestId('tv-sound-switch')).toHaveAttribute('aria-pressed', 'false', { timeout: 60_000 });
});
