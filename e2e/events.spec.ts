import { expect, test } from '@playwright/test';
import { createGameViaWizard } from './new-game-helper';

test('eventos sorpresa, deshacer adjudicación y galería con votación', async ({ page, context, browser }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: /Entrar como anfitrión/ }).click();
  await page.waitForURL('**/');
  await createGameViaWizard(page, { name: 'Noche sorpresa', mobile: true, players: ['Ana', 'Beto', 'Carla'] });
  await page.waitForURL(/\/game\/[A-Z0-9]{6}\/host/);
  const code = page.url().match(/game\/([A-Z0-9]{6})\//)![1]!;
  const host = context.request;
  const state = async () => (await (await host.get(`/api/games/${code}`)).json()).snapshot;
  const act = (data: Record<string, unknown>) => host.post(`/api/games/${code}/actions`, { data });

  const phone = async (name: string) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    const p = await ctx.newPage();
    await p.goto('/join');
    await p.getByLabel('Código de sala').fill(code);
    await p.getByRole('button', { name: /Unirme/ }).click();
    await p.waitForURL(`**/game/${code}/play`);
    await p.getByRole('button', { name: new RegExp(name) }).first().click();
    await p.getByRole('button', { name: /Sí, soy yo/ }).click();
    return { ctx, p };
  };
  const ana = await phone('Ana');
  const beto = await phone('Beto');
  await phone('Carla');

  expect((await act({ type: 'image.set_initial_all', catalog_id: 'house' })).ok()).toBeTruthy();
  expect((await act({ type: 'game.start' })).ok()).toBeTruthy();

  // Puja a ciegas: el móvil de Beto no ve el importe de Ana
  let s = await state();
  expect((await act({ type: 'auction.announce', item_id: s.items[0].id, wild_event: 'blind' })).ok()).toBeTruthy();
  await ana.p.getByRole('button', { name: /más 5 Ohros/ }).first().click();
  await expect(beto.p.getByTestId('current-bid')).toHaveText(/¿¿/);
  await expect(beto.p.getByText(/1 puja hecha/)).toBeVisible();
  s = await state();
  expect(s.auction.current_bid_cents).toBe(500); // el anfitrión sí lo ve
  const tv = await context.newPage();
  await tv.goto(`/game/${code}/screen`);
  await expect(tv.getByTestId('wild-badge')).toBeVisible();
  await expect(tv.getByText('¿¿ ??')).toBeVisible();

  // Adjudica y deshace desde el panel del anfitrión
  const a = s.auction;
  expect((await act({ type: 'auction.award', auction_id: a.id, expected_winner_id: a.current_bidder_id, expected_price_cents: 500, idempotency_key: crypto.randomUUID() })).ok()).toBeTruthy();
  expect((await act({ type: 'auction.clear' })).ok()).toBeTruthy();
  await page.reload();
  await page.getByRole('tab', { name: /Subasta/ }).click().catch(() => {});
  await page.getByRole('button', { name: /Deshacer esta adjudicación/ }).click();
  await page.getByRole('button', { name: /Sí, devolver el dinero/ }).click();
  await expect.poll(async () => (await state()).stats.purchases_count).toBe(0);
  expect((await state()).players.find((p: { name: string }) => p.name === 'Ana').balance_cents).toBe(2000);

  // Impuesto al más rico: avisa en la TV
  expect((await act({ type: 'wild.tax', idempotency_key: crypto.randomUUID() })).status()).toBe(409); // empate a 20 € entre todos: nadie con menos saldo
  // Una compra para romper el empate y cobrar el impuesto
  s = await state();
  const betoId = s.players.find((p: { name: string }) => p.name === 'Beto').id;
  const ann = await (await act({ type: 'auction.announce', item_id: s.items[0].id, wild_event: 'none' })).json();
  await act({ type: 'auction.bid', auction_id: ann.snapshot.auction.id, player_id: betoId, amount_cents: 500, idempotency_key: crypto.randomUUID() });
  await act({ type: 'auction.award', auction_id: ann.snapshot.auction.id, expected_winner_id: betoId, expected_price_cents: 500, idempotency_key: crypto.randomUUID() });
  expect((await act({ type: 'auction.clear' })).ok()).toBeTruthy();
  expect((await act({ type: 'wild.tax', idempotency_key: crypto.randomUUID() })).ok()).toBeTruthy();
  await expect(tv.getByTestId('wild-tax-banner')).toBeVisible({ timeout: 15_000 });

  // Final y galería: Ana vota a Beto desde el móvil; Beto no puede votarse
  expect((await act({ type: 'game.finish' })).ok()).toBeTruthy();
  await expect(ana.p.getByTestId('gallery-vote')).toBeVisible({ timeout: 20_000 });
  await expect(beto.p.getByRole('button', { name: /Casa de Beto/ })).toHaveCount(0);
  await ana.p.getByRole('button', { name: /Casa de Beto/ }).click();
  await expect.poll(async () => (await state()).gallery.results.find((r: { player_id: string }) => r.player_id === betoId).votes).toBe(1);
  const final = await context.newPage();
  await final.goto(`/game/${code}/screen`);
  await expect(final.getByTestId('gallery-open')).toBeVisible();
  expect((await act({ type: 'gallery.close' })).ok()).toBeTruthy();
  await expect(final.getByTestId('gallery-winner')).toContainText('Beto');
  await expect(ana.p.getByTestId('gallery-result')).toContainText('Beto', { timeout: 45_000 });
});
