import { expect, test } from '@playwright/test';

test('elemento sin pujas: se da por perdido, la TV muestra «¡Nadie lo quiere!» y no vuelve a salir; el anfitrión puede anunciar uno al azar', async ({ browser }) => {
  const hostCtx = await browser.newContext();
  const host = hostCtx.request;
  expect((await host.post('/api/auth/demo')).ok()).toBeTruthy();
  const created = await host.post('/api/games', { data: { name: 'Sin pujas E2E', players: ['Ana', 'Beto'].map((name) => ({ name })) } });
  const code = (await created.json()).room_code as string;
  const act = (data: Record<string, unknown>) => host.post(`/api/games/${code}/actions`, { data });
  const state = async () => (await (await host.get(`/api/games/${code}`)).json()).snapshot;
  expect((await act({ type: 'image.set_initial_all', catalog_id: 'house' })).ok()).toBeTruthy();
  expect((await act({ type: 'game.start' })).ok()).toBeTruthy();

  const tv = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await tv.goto(`/game/${code}/screen`);
  await expect(tv.getByText('Sin pujas E2E').first()).toBeVisible({ timeout: 60_000 });
  await tv.waitForTimeout(2500);
  // La TV evita el salvapantallas (Wake Lock o vídeo mínimo); si el navegador exige un gesto, aparece el botón para activarlo
  const keepOn = tv.getByTestId('keep-awake-on');
  if (!(await keepOn.isVisible().catch(() => false))) await tv.getByTestId('keep-awake-enable').click({ timeout: 15_000 }).catch(() => undefined);
  await expect(keepOn).toBeVisible({ timeout: 20_000 });

  const s0 = await state();
  const first = s0.items[0];
  const a = await (await act({ type: 'auction.announce', item_id: first.id })).json();
  expect((await act({ type: 'auction.cancel', auction_id: a.snapshot.auction.id })).ok()).toBeTruthy();
  await expect(tv.getByTestId('unsold-overlay')).toContainText('¡Nadie lo quiere!', { timeout: 30_000 });
  await expect(tv.getByTestId('unsold-overlay')).toContainText(first.name);
  await expect(tv.getByTestId('unsold-overlay')).toBeHidden({ timeout: 15_000 }); // la animación dura unos 5 s

  const s1 = await state();
  expect(s1.items.find((i: { id: string }) => i.id === first.id).status).toBe('lost');
  const again = await act({ type: 'auction.announce', item_id: first.id });
  expect(again.status()).toBe(409); // perdido: no vuelve a salir

  // Anuncio al azar desde el panel
  const page = await hostCtx.newPage();
  await page.goto(`/game/${code}/host`);
  await page.getByRole('tab', { name: /Subasta/ }).click().catch(() => undefined);
  await page.getByTestId('announce-random').click();
  await expect.poll(async () => (await state()).auction?.status, { timeout: 30_000 }).toBe('open');
  expect((await state()).auction.item.id).not.toBe(first.id);
  await expect(tv.getByTestId('random-badge')).toBeVisible({ timeout: 30_000 }); // la TV indica que se eligió al azar
});
