import { expect, test } from '@playwright/test';

test('ceder la puja: el jugador cede desde su móvil y, si ceden todos menos el líder, se adjudica al instante', async ({ browser }) => {
  const hostCtx = await browser.newContext();
  const host = hostCtx.request;
  expect((await host.post('/api/auth/demo')).ok()).toBeTruthy();
  const created = await host.post('/api/games', {
    data: { name: 'Ceder E2E', play_mode: 'mobile', initial_budget_cents: 2000, players: ['Ana', 'Beto'].map((name) => ({ name })) },
  });
  const code = (await created.json()).room_code as string;
  const act = (data: Record<string, unknown>) => host.post(`/api/games/${code}/actions`, { data });
  const state = async () => (await (await host.get(`/api/games/${code}`)).json()).snapshot;

  const phone = async (name: string) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    const p = await ctx.newPage();
    await p.goto('/join');
    await p.getByLabel('Código de sala').fill(code);
    await p.getByRole('button', { name: /Unirme/ }).click();
    await p.waitForURL(`**/game/${code}/play`);
    await p.getByRole('button', { name: new RegExp(name) }).first().click();
    await p.getByRole('button', { name: /Sí, soy yo/ }).click();
    return p;
  };
  const ana = await phone('Ana');
  const beto = await phone('Beto');
  await expect.poll(async () => (await state()).players.filter((x: { claimed: boolean }) => x.claimed).length).toBe(2);

  expect((await act({ type: 'image.set_initial_all', catalog_id: 'house' })).ok()).toBeTruthy();
  expect((await act({ type: 'game.start' })).ok()).toBeTruthy();
  expect((await act({ type: 'game.set_auto_award', enabled: true, seconds: 60 })).ok()).toBeTruthy();
  expect((await act({ type: 'auction.announce', item_id: (await state()).items[0].id })).ok()).toBeTruthy();

  await ana.getByRole('button', { name: /más 1 Ohro/ }).first().click();
  await expect.poll(async () => (await state()).auction?.current_bid_cents).toBe(100);
  // El líder no ve el botón; Beto sí
  await expect(ana.getByTestId('yield-button')).toHaveCount(0);
  await expect(beto.getByTestId('yield-button')).toBeVisible({ timeout: 30_000 });

  await beto.getByTestId('yield-button').click();
  await beto.getByRole('button', { name: /Sí, cedo/ }).click();
  // Con la adjudicación automática y todos cedidos, se adjudica sin esperar los 60 s
  await expect.poll(async () => (await state()).last_award?.price_cents, { timeout: 30_000 }).toBe(100);
  const s = await state();
  expect(s.players.find((p: { name: string }) => p.name === 'Ana').balance_cents).toBe(1900);
  expect(s.players.find((p: { name: string }) => p.name === 'Beto').balance_cents).toBe(2000);
});
