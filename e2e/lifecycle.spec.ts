import { expect, test } from '@playwright/test';

test('ciclo de vida: pausar, finalizar desde el Resumen y borrar la partida desde Ajustes', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const host = ctx.request;
  expect((await host.post('/api/auth/demo')).ok()).toBeTruthy();
  const created = await host.post('/api/games', { data: { name: 'Ciclo E2E', players: ['Ana', 'Beto'].map((name) => ({ name })) } });
  const code = (await created.json()).room_code as string;
  const act = (data: Record<string, unknown>) => host.post(`/api/games/${code}/actions`, { data });
  await act({ type: 'image.set_initial_all', catalog_id: 'house' });
  await act({ type: 'game.start' });

  // TV abierta aparte
  const tvCtx = await browser.newContext();
  const tv = await tvCtx.newPage();
  await tv.goto(`/game/${code}/screen`);
  await tv.waitForLoadState('networkidle');
  await expect(tv.getByText('Ciclo E2E').first()).toBeVisible({ timeout: 30_000 });

  // Pausar y finalizar desde el Resumen
  await page.goto(`/game/${code}/host`);
  await page.getByRole('tab', { name: 'Resumen' }).click();
  await page.getByRole('button', { name: /^Pausar/ }).click();
  await expect(page.getByRole('button', { name: /Finalizar partida/ })).toBeVisible();
  await page.getByRole('button', { name: /Finalizar partida/ }).click();
  await page.getByPlaceholder('FINALIZAR').fill('FINALIZAR');
  await page.getByRole('button', { name: /Finalizar definitivamente/ }).click();
  await expect.poll(async () => (await (await host.get(`/api/games/${code}`)).json()).snapshot.game.status, { timeout: 20_000 }).toBe('finished');

  // Borrar desde Ajustes (texto de confirmación obligatorio)
  await page.getByRole('tab', { name: 'Ajustes' }).click();
  await page.getByRole('button', { name: 'Borrar partida' }).first().click();
  await page.getByPlaceholder('BORRAR').fill('NO');
  await page.getByRole('button', { name: /Sí, borrar todo/ }).click();
  expect((await host.get(`/api/games/${code}`)).status()).toBe(200); // no se borra sin confirmar bien
  await page.getByPlaceholder('BORRAR').fill('BORRAR');
  await page.getByRole('button', { name: /Sí, borrar todo/ }).click();
  await page.waitForURL('**/');
  expect((await host.get(`/api/games/${code}`)).status()).toBe(404);

  // La TV deja de ver la sala y lo explica
  await expect(tv.getByText('Esta partida ya no existe')).toBeVisible({ timeout: 20_000 });
  expect((await tv.request.get(`/api/public/games/${code}`)).status()).toBe(404);

  // Otro anfitrión no puede borrar partidas ajenas
  const other = await browser.newContext();
  await other.request.post('/api/auth/demo');
  const c2 = await ctx.request.post('/api/games', { data: { name: 'Ajena', players: [] } });
  const code2 = (await c2.json()).room_code as string;
  expect((await other.request.delete(`/api/games/${code2}`)).status()).toBe(403);
  expect((await ctx.request.get(`/api/games/${code2}`)).status()).toBe(200);
  expect((await other.request.post('/api/jobs/purge')).status()).toBe(401); // el purgado por HTTP exige CRON_SECRET

  for (const c of [ctx, tvCtx, other]) await c.close();
});
