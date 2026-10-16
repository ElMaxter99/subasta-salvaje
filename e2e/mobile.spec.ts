import { expect, test } from '@playwright/test';
import { createGameViaWizard } from './new-game-helper';

test('modo móviles: unirse con el código, pujar desde el móvil, adjudicar y seguridad', async ({ page, context, browser }) => {
  // Anfitrión crea la partida en modo móviles desde la UI
  await page.goto('/login');
  await page.getByRole('button', { name: /Entrar como anfitrión/ }).click();
  await page.waitForURL('**/');
  await createGameViaWizard(page, { name: 'Noche móviles', mobile: true, players: ['Ana', 'Beto', 'Carla', 'Dani'] });
  await page.waitForURL(/\/game\/[A-Z0-9]{6}\/host/);
  const code = page.url().match(/game\/([A-Z0-9]{6})\//)![1]!;
  const host = context.request;
  const state = async () => (await (await host.get(`/api/games/${code}`)).json()).snapshot;

  expect((await state()).game.play_mode).toBe('mobile');

  // Dos móviles distintos (contextos sin cookies del anfitrión) se unen desde /join
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
  await expect.poll(async () => (await state()).players.filter((x: { claimed: boolean }) => x.claimed).length).toBe(2);

  // El mismo nombre no se puede reclamar desde otro móvil
  const anaId = (await state()).players.find((x: { name: string }) => x.name === 'Ana').id;
  const intruder = await browser.newContext();
  const r = await intruder.request.post(`/api/play/${code}/join`, { data: { player_id: anaId } });
  expect(r.status()).toBe(409);

  // Anfitrión aplica imagen de galería a todos, empieza y anuncia
  for (const act of [{ type: 'image.set_initial_all', catalog_id: 'house' }, { type: 'game.start' }]) {
    expect((await host.post(`/api/games/${code}/actions`, { data: act })).ok()).toBeTruthy();
  }
  const item = (await state()).items[0];
  expect((await host.post(`/api/games/${code}/actions`, { data: { type: 'auction.announce', item_id: item.id } })).ok()).toBeTruthy();

  // Ana puja desde su móvil con el botón rápido y Beto la supera con importe manual
  await ana.p.getByRole('button', { name: /más 1 €/ }).first().click();
  // Primera puja de la subasta: «+1 €» es una puja de 1 €, no de 2 €
  await expect.poll(async () => (await state()).auction?.current_bid_cents).toBe(100);
  expect((await state()).auction.current_bidder_id).toBe(anaId);
  await beto.p.getByRole('textbox').first().fill('4');
  await beto.p.getByRole('button', { name: 'Pujar', exact: true }).click();
  await expect.poll(async () => (await state()).auction?.current_bid_cents).toBe(400);

  // Sin cookie de jugador no se puede pujar
  const anon = await browser.newContext();
  const bad = await anon.request.post(`/api/play/${code}/bid`, {
    data: { auction_id: (await state()).auction.id, amount_cents: 900, idempotency_key: 'abcdefgh-1234' },
  });
  expect(bad.status()).toBe(409);
  expect((await state()).auction.current_bid_cents).toBe(400);

  // El anfitrión adjudica (doble envío simultáneo): saldo de Beto -4 € una sola vez
  const a = (await state()).auction;
  const body = { type: 'auction.award', auction_id: a.id, expected_winner_id: a.current_bidder_id, expected_price_cents: 400 };
  await Promise.all([
    host.post(`/api/games/${code}/actions`, { data: { ...body, idempotency_key: crypto.randomUUID() } }),
    host.post(`/api/games/${code}/actions`, { data: { ...body, idempotency_key: crypto.randomUUID() } }),
  ]);
  const after = await state();
  expect(after.players.find((x: { name: string }) => x.name === 'Beto').balance_cents).toBe(1600);
  expect(after.stats.purchases_count).toBe(1);
  await expect(beto.p.getByText(/Te llevaste/)).toBeVisible({ timeout: 20_000 });

  for (const c of [ana.ctx, beto.ctx, intruder, anon]) await c.close();
});
