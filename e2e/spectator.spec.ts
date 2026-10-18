import { expect, test } from '@playwright/test';

test('modo espectador: /watch sin sesión muestra subasta, saldos y casas, sin controles; a ciegas no revela el importe; el anfitrión puede desactivarlo', async ({ browser }) => {
  const hostCtx = await browser.newContext();
  const host = hostCtx.request;
  expect((await host.post('/api/auth/demo')).ok()).toBeTruthy();
  const created = await host.post('/api/games', {
    data: { name: 'Mirones E2E', initial_budget_cents: 2000, integer_bids: false, players: [{ name: 'Ana' }, { name: 'Beto' }], items: [1, 2].map((n) => ({ name: `Objeto ${n}`, description: '' })) },
  });
  const code = (await created.json()).room_code as string;
  const act = (data: Record<string, unknown>) => host.post(`/api/games/${code}/actions`, { data });
  const state = async () => (await (await host.get(`/api/games/${code}`)).json()).snapshot;
  expect((await act({ type: 'image.set_initial_all', catalog_id: 'house' })).ok()).toBeTruthy();
  expect((await act({ type: 'game.start' })).ok()).toBeTruthy();
  let s = await state();
  const ana = s.players.find((p: { name: string }) => p.name === 'Ana');

  // Espectador: contexto nuevo, sin cookies, móvil
  const viewer = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await viewer.newPage();
  await page.goto(`/game/${code}/watch`);
  expect(await page.locator('meta[name="robots"]').getAttribute('content')).toContain('noindex');
  await expect(page.getByTestId('watch-view')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('watch-players').getByTestId('watch-player')).toHaveCount(2);

  // Subasta normal con puja de Ana
  expect((await act({ type: 'auction.announce', item_id: s.items[0].id })).ok()).toBeTruthy();
  s = await state();
  expect((await act({ type: 'auction.bid', auction_id: s.auction.id, player_id: ana.id, amount_cents: 450, idempotency_key: crypto.randomUUID() })).ok()).toBeTruthy();
  await expect(page.getByTestId('watch-auction')).toContainText('Objeto 1', { timeout: 30_000 });
  await expect(page.getByTestId('watch-price')).toContainText('4,5', { timeout: 30_000 });
  await expect(page.getByTestId('watch-auction')).toContainText('Va ganando');
  await expect(page.getByTestId('watch-auction')).toContainText('Ana');
  await expect(page.getByTestId('watch-bids')).toContainText('Ana');
  await expect(page.getByTestId('watch-players')).toContainText('Beto');
  await expect(page.getByTestId('watch-players')).toContainText('20'); // saldo inicial visible

  // Sin controles: ni botones, ni campos, ni formularios
  const view = page.getByTestId('watch-view'); // (el botón de las herramientas de desarrollo de Next queda fuera de <main>)
  await expect(view.getByRole('button')).toHaveCount(0);
  await expect(view.locator('input, textarea, select, form, a[href]')).toHaveCount(0);
  // Sin desbordamiento horizontal en móvil
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  // El espectador no puede escribir: sin sesión, la acción del anfitrión se rechaza
  const denied = await viewer.request.post(`/api/games/${code}/actions`, { data: { type: 'game.pause' } });
  expect(denied.ok()).toBeFalsy();

  // Adjudicar y subasta a ciegas: el importe NO aparece
  expect((await act({ type: 'auction.award', auction_id: s.auction.id, expected_winner_id: ana.id, expected_price_cents: 450, idempotency_key: crypto.randomUUID() })).ok()).toBeTruthy();
  s = await state();
  expect((await act({ type: 'auction.announce', item_id: s.items.find((i: { status: string }) => i.status === 'available').id, wild_event: 'blind' })).ok()).toBeTruthy();
  s = await state();
  expect((await act({ type: 'auction.bid', auction_id: s.auction.id, player_id: ana.id, amount_cents: 777, idempotency_key: crypto.randomUUID() })).ok()).toBeTruthy();
  await expect(page.getByTestId('watch-price')).toHaveText('¿¿ ??', { timeout: 30_000 });
  await expect(page.getByTestId('watch-wild')).toContainText('ciegas');
  await expect(page.getByTestId('watch-bids')).toHaveCount(0);
  await expect(page.getByTestId('watch-auction')).not.toContainText('Va ganando');
  expect(await page.content()).not.toContain('7,77');
  const pub = await (await viewer.request.get(`/api/public/games/${code}`)).text();
  expect(pub).not.toContain('777');

  // El anfitrión desactiva el modo espectador: aviso y nada más
  expect((await act({ type: 'game.set_spectator', spectator_enabled: false })).ok()).toBeTruthy();
  await expect(page.getByText('ha desactivado el modo espectador')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('watch-auction')).toHaveCount(0);

  // El panel del anfitrión ofrece el enlace
  expect((await act({ type: 'game.set_spectator', spectator_enabled: true })).ok()).toBeTruthy();
  const hostPage = await hostCtx.newPage();
  await hostPage.goto(`/game/${code}/host`);
  await hostPage.getByTestId('spectator-card').locator('summary').click();
  await expect(hostPage.getByTestId('spectator-copy')).toBeVisible({ timeout: 60_000 });
  await expect(hostPage.getByTestId('spectator-card')).toContainText(`/game/${code}/watch`);

  // Final: resultados con estadísticas, también en /watch
  expect((await act({ type: 'auction.cancel', auction_id: s.auction.id })).ok()).toBeTruthy();
  expect((await act({ type: 'game.finish' })).ok()).toBeTruthy();
  await page.reload();
  await expect(page.getByText('¡Fin de la subasta!')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('player-stats')).toBeVisible();
});
