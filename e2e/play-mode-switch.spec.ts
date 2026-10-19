import { expect, test } from '@playwright/test';
import { createGameViaWizard } from './new-game-helper';

test('cambiar quién puja a mitad de partida desde el Resumen: anfitrión → móviles → anfitrión', async ({ page, context, browser }) => {
  test.setTimeout(180_000);
  await page.goto('/login');
  await page.getByRole('button', { name: /Entrar como anfitrión/ }).click();
  await page.waitForURL('**/');
  await createGameViaWizard(page, { name: 'Cambio de modo', players: ['Ana', 'Beto'] });
  await page.waitForURL(/\/game\/[A-Z0-9]{6}\/host/);
  const code = page.url().match(/game\/([A-Z0-9]{6})\//)![1]!;
  const host = context.request;
  const state = async () => (await (await host.get(`/api/games/${code}`)).json()).snapshot;
  const act = (data: Record<string, unknown>) => host.post(`/api/games/${code}/actions`, { data });

  // Partida en curso con una subasta abierta, en modo anfitrión
  expect((await act({ type: 'image.set_initial_all', catalog_id: 'house' })).ok()).toBeTruthy();
  expect((await act({ type: 'game.start' })).ok()).toBeTruthy();
  let s = await state();
  expect((await act({ type: 'auction.announce', item_id: s.items[0].id })).ok()).toBeTruthy();
  s = await state();
  const auctionId = s.auction.id;
  const beto = s.players.find((p: { name: string }) => p.name === 'Beto').id;
  const ana = s.players.find((p: { name: string }) => p.name === 'Ana').id;
  expect((await act({ type: 'auction.bid', auction_id: auctionId, player_id: beto, amount_cents: 200, idempotency_key: crypto.randomUUID() })).ok()).toBeTruthy();

  // Tarjeta de un toque en el Resumen, con la partida EN CURSO
  await page.reload();
  await page.getByRole('tab', { name: 'Resumen' }).click();
  const card = page.getByTestId('access-card');
  await expect(card).toHaveAttribute('data-mode', 'host');
  await page.getByTestId('open-mobile').click();
  await expect(card).toHaveAttribute('data-mode', 'mobile');
  await expect(card).toHaveAttribute('data-policy', 'open');
  await expect(page.getByText('Unirse desde el móvil')).toBeVisible();
  await expect(page.getByLabel(`Código de sala ${code.split('').join(' ')}`)).toBeVisible();
  expect((await state()).auction.id).toBe(auctionId); // la subasta abierta sigue

  // Ana entra desde su móvil, reclama su casilla y puja
  const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const phone = await pctx.newPage();
  await phone.goto('/join');
  await phone.getByLabel('Código de sala').fill(code);
  await phone.getByRole('button', { name: /Unirme/ }).click();
  await phone.waitForURL(`**/game/${code}/play`);
  await phone.getByRole('button', { name: /Ana/ }).first().click();
  await phone.getByRole('button', { name: /Sí, soy yo/ }).click();
  await phone.getByRole('button', { name: /más 1 Ohro/ }).first().click();
  await expect.poll(async () => (await state()).auction.current_bidder_id).toBe(ana);
  // y el anfitrión sigue pudiendo registrar la puja de Beto
  expect((await act({ type: 'auction.bid', auction_id: auctionId, player_id: beto, amount_cents: 500, idempotency_key: crypto.randomUUID() })).ok()).toBeTruthy();

  // Volver a «Las pujas las registro yo»: confirmación porque hay un móvil conectado
  await page.getByRole('button', { name: /Las pujas las registro yo/ }).click();
  await expect(page.getByRole('dialog')).toContainText(/móvil conectado/);
  await page.getByRole('button', { name: /Sí, las registro yo/ }).click();
  await expect(card).toHaveAttribute('data-mode', 'host');
  // El móvil ve un aviso claro y no tiene pad de puja
  await expect(phone.getByTestId('host-mode-notice')).toBeVisible({ timeout: 20_000 });
  await expect(phone.getByTestId('host-mode-notice')).toContainText('registra las pujas');
  await expect(phone.getByRole('button', { name: 'Pujar', exact: true })).toHaveCount(0);
  // La TV y el panel siguen vivos
  const tv = await context.newPage();
  await tv.goto(`/game/${code}/screen`);
  await expect(tv.getByTestId('screen-player').first()).toBeVisible({ timeout: 60_000 });
  const forced = await pctx.request.post(`/api/play/${code}/bid`, { data: { auction_id: auctionId, amount_cents: 900, idempotency_key: crypto.randomUUID() } });
  expect(forced.ok()).toBeFalsy();
  expect(JSON.stringify(await forced.json())).toMatch(/móvil/i);

  // Cerrar la entrada con móviles abiertos
  await page.getByTestId('open-mobile').click();
  await expect(card).toHaveAttribute('data-mode', 'mobile');
  await page.getByRole('button', { name: /Cerrar la entrada/ }).click();
  await expect(card).toHaveAttribute('data-policy', 'closed');
  await expect(page.getByTestId('join-closed')).toBeVisible();
  await expect(phone.getByTestId('host-mode-notice')).toHaveCount(0, { timeout: 20_000 });
  await pctx.close();
});
