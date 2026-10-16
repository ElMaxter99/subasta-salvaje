import { expect, test } from '@playwright/test';

test('la pantalla final muestra la imagen FINAL (después) de cada jugador, no la inicial', async ({ browser }) => {
  const hostCtx = await browser.newContext();
  const host = hostCtx.request;
  expect((await host.post('/api/auth/demo')).ok()).toBeTruthy();
  const created = await host.post('/api/games', { data: { name: 'Final E2E', initial_budget_cents: 2000, players: ['Ana', 'Beto'].map((name) => ({ name })) } });
  const code = (await created.json()).room_code as string;
  const act = (data: Record<string, unknown>) => host.post(`/api/games/${code}/actions`, { data });
  const state = async () => (await (await host.get(`/api/games/${code}`)).json()).snapshot;
  await act({ type: 'image.set_initial_all', catalog_id: 'house' });
  await act({ type: 'game.start' });
  let s = await state();
  const ana = s.players.find((p: { name: string }) => p.name === 'Ana').id;
  await act({ type: 'auction.announce', item_id: s.items[0].id });
  s = await state();
  await act({ type: 'auction.bid', auction_id: s.auction.id, player_id: ana, amount_cents: 300, idempotency_key: crypto.randomUUID() });
  await act({ type: 'auction.award', auction_id: s.auction.id, expected_winner_id: ana, expected_price_cents: 300, idempotency_key: crypto.randomUUID() });
  await host.post(`/api/games/${code}/jobs`);
  await expect.poll(async () => (await state()).jobs.filter((j: { status: string }) => j.status !== 'completed').length, { timeout: 30_000 }).toBe(0);
  await act({ type: 'game.finish' });
  const done = await state();
  const a = done.players.find((p: { id: string }) => p.id === ana);
  expect(a.current_image.id).not.toBe(a.initial_image.id);

  const page = await (await browser.newContext()).newPage();
  await page.goto(`/game/${code}/results`);
  const card = page.getByRole('article').filter({ hasText: 'Ana' });
  await expect(card.getByAltText('Casa final de Ana')).toBeVisible({ timeout: 30_000 });
  const finalSrc = await card.getByAltText('Casa final de Ana').getAttribute('src');
  const beforeSrc = await card.getByAltText('Casa inicial de Ana').first().getAttribute('src');
  console.log('FINAL', finalSrc, 'ANTES', beforeSrc);
  expect(finalSrc).not.toBe(beforeSrc);
});

test('TV: en «Fin de la subasta» la imagen «Después» se ve completa (3:2, sin recortar) y visible', async ({ browser }, info) => {
  const hostCtx = await browser.newContext();
  const host = hostCtx.request;
  expect((await host.post('/api/auth/demo')).ok()).toBeTruthy();
  const created = await host.post('/api/games', { data: { name: 'Final TV', initial_budget_cents: 2000, players: ['Ana', 'Beto', 'Carla'].map((name) => ({ name })) } });
  const code = (await created.json()).room_code as string;
  const act = (data: Record<string, unknown>) => host.post(`/api/games/${code}/actions`, { data });
  const state = async () => (await (await host.get(`/api/games/${code}`)).json()).snapshot;
  await act({ type: 'image.set_initial_all', catalog_id: 'house' });
  await act({ type: 'game.start' });
  let s = await state();
  const ana = s.players.find((p: { name: string }) => p.name === 'Ana').id;
  await act({ type: 'auction.announce', item_id: s.items[0].id });
  s = await state();
  await act({ type: 'auction.bid', auction_id: s.auction.id, player_id: ana, amount_cents: 300, idempotency_key: crypto.randomUUID() });
  await act({ type: 'auction.award', auction_id: s.auction.id, expected_winner_id: ana, expected_price_cents: 300, idempotency_key: crypto.randomUUID() });
  await host.post(`/api/games/${code}/jobs`);
  await expect.poll(async () => (await state()).jobs.filter((j: { status: string }) => j.status !== 'completed').length, { timeout: 30_000 }).toBe(0);
  await act({ type: 'game.finish' });

  for (const size of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }]) {
    const tv = await (await browser.newContext({ viewport: size })).newPage();
    await tv.goto(`/game/${code}/screen`);
    const after = tv.getByAltText('Casa final de Ana');
    await expect(after).toBeVisible({ timeout: 60_000 });
    await tv.waitForTimeout(3000); // el servidor de desarrollo en frío puede recargar la página una vez
    await expect(after).toBeVisible();
    await expect.poll(async () => Number(await after.evaluate((el) => getComputedStyle(el).opacity).catch(() => '-1')), { timeout: 20_000 }).toBe(1);
    const box = (await after.boundingBox())!;
    expect(box.width / box.height).toBeGreaterThan(1.4);
    expect(box.width / box.height).toBeLessThan(1.6);
    // todas las tarjetas caben en la pantalla (nada cortado)
    const bottoms = await tv.getByRole('article').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().bottom));
    for (const b of bottoms) expect(b).toBeLessThanOrEqual(size.height + 1);
    await tv.screenshot({ path: info.outputPath(`tv-final-${size.width}.png`) });
  }
});
