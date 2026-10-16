import { expect, test } from '@playwright/test';

test('adjudicación automática: cuenta atrás visible en la TV, adjudica sola por tiempo y al instante, y cobra una vez', async ({ browser }) => {
  const hostCtx = await browser.newContext();
  const host = hostCtx.request;
  expect((await host.post('/api/auth/demo')).ok()).toBeTruthy();
  const created = await host.post('/api/games', {
    data: { name: 'Auto E2E', initial_budget_cents: 2000, players: ['Ana', 'Beto', 'Carla'].map((name) => ({ name })) },
  });
  const code = (await created.json()).room_code as string;
  const act = (data: Record<string, unknown>) => host.post(`/api/games/${code}/actions`, { data });
  const state = async () => (await (await host.get(`/api/games/${code}`)).json()).snapshot;
  await act({ type: 'image.set_initial_all', catalog_id: 'house' });
  await act({ type: 'game.start' });
  expect((await act({ type: 'game.set_auto_award', enabled: true, seconds: 15 })).ok()).toBeTruthy();

  // TV abierta sin sesión
  const tvCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const tv = await tvCtx.newPage();
  await tv.goto(`/game/${code}/screen`);
  // Calentamiento: la primera compilación del servidor de desarrollo puede recargar la página varias veces
  await tv.waitForLoadState('networkidle');
  await expect(tv.getByText('Auto E2E').first()).toBeVisible({ timeout: 30_000 });

  // 1) Por tiempo
  let s = await state();
  await act({ type: 'auction.announce', item_id: s.items[0].id });
  s = await state();
  const auction1 = s.auction.id;
  const ana = s.players.find((p: { name: string }) => p.name === 'Ana').id;
  await act({ type: 'auction.bid', auction_id: auction1, player_id: ana, amount_cents: 300, idempotency_key: crypto.randomUUID() });
  await expect(tv.getByTestId('auto-award-countdown')).toBeVisible({ timeout: 10_000 });
  // La TV (al leer el estado público) dispara la adjudicación cuando vence la cuenta atrás
  await expect.poll(async () => (await state()).auction?.status, { timeout: 45_000 }).toBe('awarded');
  s = await state();
  expect(s.players.find((p: { name: string }) => p.name === 'Ana').balance_cents).toBe(1700);
  expect(s.stats.purchases_count).toBe(1);

  // 2) Instantánea: Beto puja todo su saldo y nadie puede superarlo
  const next = s.items.find((i: { status: string }) => i.status === 'available');
  await act({ type: 'auction.announce', item_id: next.id });
  s = await state();
  const beto = s.players.find((p: { name: string }) => p.name === 'Beto').id;
  const r = await act({ type: 'auction.bid', auction_id: s.auction.id, player_id: beto, amount_cents: 2000, idempotency_key: crypto.randomUUID() });
  expect((await r.json()).result.auto_awarded).toBe(true);
  s = await state();
  expect(s.players.find((p: { name: string }) => p.name === 'Beto').balance_cents).toBe(0);
  expect(s.stats.purchases_count).toBe(2);
  await expect(tv.getByText(/Beto/).first()).toBeVisible();

  await hostCtx.close();
  await tvCtx.close();
});
