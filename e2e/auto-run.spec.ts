import { expect, test } from '@playwright/test';

test('subasta automática: anuncia sola tras la pausa, adjudica y, al agotar las rondas, termina la partida; sin imagen inicial no se empieza', async ({ browser }) => {
  const hostCtx = await browser.newContext();
  const host = hostCtx.request;
  expect((await host.post('/api/auth/demo')).ok()).toBeTruthy();
  const created = await host.post('/api/games', {
    data: { name: 'Auto run E2E', max_rounds: 1, integer_bids: true, initial_budget_cents: 2000, players: ['Ana', 'Beto'].map((name) => ({ name })) },
  });
  const code = (await created.json()).room_code as string;
  const act = (data: Record<string, unknown>) => host.post(`/api/games/${code}/actions`, { data });
  const state = async () => (await (await host.get(`/api/games/${code}`)).json()).snapshot;

  // Imagen inicial obligatoria
  const refused = await act({ type: 'game.start' });
  expect(refused.status()).toBe(409);
  expect((await refused.json()).error.code).toBe('initial_image_required');
  expect((await act({ type: 'image.set_initial_all', catalog_id: 'house' })).ok()).toBeTruthy();
  expect((await act({ type: 'game.start' })).ok()).toBeTruthy();

  // Pujas enteras: 1,50 € se rechaza
  expect((await state()).game).toMatchObject({ integer_bids: true, max_rounds: 1, total_rounds: 1 });

  const tv = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await tv.goto(`/game/${code}/screen`);
  await expect(tv.getByText('Auto run E2E').first()).toBeVisible({ timeout: 60_000 });

  expect((await act({ type: 'game.set_auto_run', enabled: true, gap_seconds: 4, idle_seconds: 60, auto_award_seconds: 4 })).ok()).toBeTruthy();
  await expect(tv.getByTestId('tv-next-auction')).toBeVisible({ timeout: 20_000 });
  // El servidor anuncia el primer elemento por su cuenta (lo dispara la lectura de la TV)
  await expect.poll(async () => (await state()).auction?.status, { timeout: 45_000 }).toBe('open');
  // Mientras no hay pujas la TV avisa de cuánto queda para que se salte al siguiente elemento
  await expect(tv.getByTestId('auto-run-skip-clock')).toContainText('se salta en', { timeout: 20_000 });
  const s = await state();
  const ana = s.players.find((p: { name: string }) => p.name === 'Ana').id;
  const bad = await act({ type: 'auction.bid', auction_id: s.auction.id, player_id: ana, amount_cents: 150, idempotency_key: crypto.randomUUID() });
  expect(bad.status()).toBe(409);
  expect((await bad.json()).error.code).toBe('bid_not_whole');
  expect((await act({ type: 'auction.bid', auction_id: s.auction.id, player_id: ana, amount_cents: 200, idempotency_key: crypto.randomUUID() })).ok()).toBeTruthy();
  // Se adjudica sola y, al ser la única ronda, la partida termina sola
  await expect.poll(async () => (await state()).stats.purchases_count, { timeout: 45_000 }).toBe(1);
  await expect(tv.getByTestId('tv-last-round').or(tv.getByText('¡Fin de la subasta!')).first()).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => (await state()).game.status, { timeout: 60_000 }).toBe('finished');
});
