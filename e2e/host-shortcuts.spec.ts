import { expect, test } from '@playwright/test';

test('atajos de teclado del anfitrión: A anuncia, C cierra, D y X abren su confirmación; no actúan al escribir', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const host = ctx.request;
  expect((await host.post('/api/auth/demo')).ok()).toBeTruthy();
  const created = await host.post('/api/games', {
    data: { name: 'Atajos E2E', initial_budget_cents: 2000, players: ['Ana', 'Beto'].map((name) => ({ name })) },
  });
  const code = (await created.json()).room_code as string;
  const act = (data: Record<string, unknown>) => host.post(`/api/games/${code}/actions`, { data });
  const state = async () => (await (await host.get(`/api/games/${code}`)).json()).snapshot;
  expect((await act({ type: 'image.set_initial_all', catalog_id: 'house' })).ok()).toBeTruthy();
  expect((await act({ type: 'game.start' })).ok()).toBeTruthy();

  const page = await ctx.newPage();
  await page.goto(`/game/${code}/host`);
  await page.getByRole('tab', { name: /Subasta/ }).or(page.getByRole('button', { name: /^Subasta$/ })).first().click();
  await expect(page.getByTestId('shortcuts-hint')).toContainText('Anunciar el siguiente', { timeout: 60_000 });

  await page.keyboard.press('a');
  await expect.poll(async () => (await state()).auction?.status, { timeout: 30_000 }).toBe('open');
  const s = await state();
  const ana = s.players.find((p: { name: string }) => p.name === 'Ana').id;
  expect((await act({ type: 'auction.bid', auction_id: s.auction.id, player_id: ana, amount_cents: 200, idempotency_key: crypto.randomUUID() })).ok()).toBeTruthy();

  // Escribir en un campo no dispara atajos
  const field = page.getByLabel(/Importe manual/).first();
  await field.click();
  await page.keyboard.type('c');
  expect((await state()).auction.status).toBe('open');
  await field.blur();

  await page.keyboard.press('c');
  await expect.poll(async () => (await state()).auction?.status, { timeout: 30_000 }).toBe('closed');

  // Adjudicar y cancelar solo ABREN la confirmación: nada se cobra con una tecla
  await page.keyboard.press('d');
  await expect(page.getByRole('dialog', { name: /Adjudicar y cobrar/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('x');
  await expect(page.getByRole('dialog', { name: /Cancelar la subasta/ })).toBeVisible();
  await page.keyboard.press('Escape');
  const after = await state();
  expect(after.auction.status).toBe('closed');
  expect(after.players.find((p: { name: string }) => p.name === 'Ana').balance_cents).toBe(2000);
});
