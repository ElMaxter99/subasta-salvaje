import { expect, test } from '@playwright/test';

test('social: reacción del móvil flota en la TV, imagen del podio y repetición del anfitrión', async ({ browser }) => {
  const hostCtx = await browser.newContext();
  const host = hostCtx.request;
  expect((await host.post('/api/auth/demo')).ok()).toBeTruthy();
  const created = await host.post('/api/games', { data: { name: 'Social E2E', play_mode: 'mobile', initial_budget_cents: 2000, players: ['Ana', 'Beto', 'Carla'].map((name) => ({ name })) } });
  const code = (await created.json()).room_code as string;
  const act = (data: Record<string, unknown>) => host.post(`/api/games/${code}/actions`, { data });
  const state = async () => (await (await host.get(`/api/games/${code}`)).json()).snapshot;
  const ana = (await state()).players.find((p: { name: string }) => p.name === 'Ana').id as string;

  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  expect((await phoneCtx.request.post(`/api/play/${code}/join`, { data: { player_id: ana } })).ok()).toBeTruthy();
  expect((await act({ type: 'image.set_initial_all', catalog_id: 'house' })).ok()).toBeTruthy();
  expect((await act({ type: 'game.start' })).ok()).toBeTruthy();

  // Sin identificar no se puede reaccionar; emoji fuera de la lista, tampoco
  const anon = await browser.newContext();
  expect((await anon.request.post(`/api/play/${code}/react`, { data: { emoji: '🔥' } })).status()).toBe(409);
  expect((await phoneCtx.request.post(`/api/play/${code}/react`, { data: { emoji: '💩' } })).ok()).toBeFalsy();

  // TV abierta; el móvil reacciona desde su pantalla y la reacción flota en la TV
  const tv = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await tv.goto(`/game/${code}/screen`);
  await expect(tv.getByTestId('screen-player').first()).toBeVisible({ timeout: 60_000 });
  const phone = await phoneCtx.newPage();
  await phone.goto(`/game/${code}/play`);
  const bar = phone.getByTestId('reaction-bar');
  await expect(bar).toBeVisible({ timeout: 60_000 });
  await bar.getByRole('button').first().click();
  await expect(tv.getByTestId('reaction-float').first()).toBeVisible({ timeout: 30_000 });
  // Segunda reacción inmediata: el límite SQL la rechaza con 429
  const fast = await phoneCtx.request.post(`/api/play/${code}/react`, { data: { emoji: '🔥' } });
  expect(fast.status()).toBe(429);

  // Subasta rápida para tener una ronda en la repetición
  const item = (await state()).items[0];
  expect((await act({ type: 'auction.announce', item_id: item.id })).ok()).toBeTruthy();
  expect((await phoneCtx.request.post(`/api/play/${code}/bid`, { data: { auction_id: (await state()).auction.id, amount_cents: 300, idempotency_key: 'social-bid-0001' } })).ok()).toBeTruthy();
  const a = (await state()).auction;
  expect((await act({ type: 'auction.award', auction_id: a.id, expected_winner_id: ana, expected_price_cents: 300, idempotency_key: crypto.randomUUID() })).ok()).toBeTruthy();

  // La imagen del podio no está disponible hasta que termina la partida
  expect((await host.get(`/api/public/games/${code}/podium`)).ok()).toBeFalsy();
  expect((await act({ type: 'game.finish' })).ok()).toBeTruthy();
  const img = await host.get(`/api/public/games/${code}/podium?download=1`);
  expect(img.status()).toBe(200);
  expect(img.headers()['content-type']).toContain('image/png');
  expect(img.headers()['content-disposition'] ?? '').toContain('attachment');
  expect((await img.body()).subarray(1, 4).toString()).toBe('PNG');

  // Resultados: botón de descarga visible; repetición del anfitrión con la ronda
  const res = await hostCtx.newPage();
  await res.goto(`/game/${code}/results`);
  await expect(res.getByTestId('podium-download').first()).toBeVisible({ timeout: 60_000 });
  await res.goto(`/game/${code}/replay`);
  await expect(res.getByTestId('replay-timeline')).toContainText(item.name, { timeout: 60_000 });
  await res.getByRole('button', { name: /Siguiente/ }).click();
  await expect(res.getByTestId('replay-step')).toContainText('Paso 1');
});
