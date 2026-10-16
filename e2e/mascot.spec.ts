import { expect, test, type Page } from '@playwright/test';

const imagesLoaded = (page: Page) =>
  page.evaluate(() => [...document.querySelectorAll<HTMLImageElement>('[data-mascot] img')].map((i) => ({ src: i.currentSrc, ok: i.complete && i.naturalWidth > 0 })));

test('la mascota aparece en inicio, TV (anuncio, cuenta atrás, adjudicado) y resultados sin tapar información', async ({ browser }, info) => {
  const hostCtx = await browser.newContext();
  const host = hostCtx.request;
  expect((await host.post('/api/auth/demo')).ok()).toBeTruthy();

  // Inicio: mascota principal cargada
  const home = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await home.goto('/');
  await expect(home.locator('[data-mascot="mascot-main"]')).toBeVisible({ timeout: 60_000 });
  await expect.poll(async () => (await imagesLoaded(home).catch(() => [])).filter((i) => !i.ok).length + ((await imagesLoaded(home).catch(() => [])).length === 0 ? 1 : 0), { timeout: 20_000 }).toBe(0);
  await home.screenshot({ path: info.outputPath('home.png') });

  // Partida con adjudicación automática para ver la cuenta atrás
  const created = await host.post('/api/games', { data: { name: 'Mascota E2E', initial_budget_cents: 2000, players: ['Ana', 'Beto', 'Carla'].map((name) => ({ name })) } });
  const code = (await created.json()).room_code as string;
  const act = (data: Record<string, unknown>) => host.post(`/api/games/${code}/actions`, { data });
  const state = async () => (await (await host.get(`/api/games/${code}`)).json()).snapshot;
  await act({ type: 'image.set_initial_all', catalog_id: 'house' });

  const tv = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await tv.goto(`/game/${code}/screen`);
  await expect(tv.locator('[data-mascot="expr-feliz"]').first()).toBeVisible({ timeout: 60_000 }); // sala de espera
  await tv.screenshot({ path: info.outputPath('tv-lobby.png') });

  await act({ type: 'game.start' });
  await act({ type: 'game.set_auto_award', enabled: true, seconds: 14 });
  let s = await state();
  await act({ type: 'auction.announce', item_id: s.items[0].id });
  await expect(tv.locator('[data-mascot="pose-anuncia"]')).toBeVisible({ timeout: 15_000 });
  await tv.screenshot({ path: info.outputPath('tv-anuncia.png') });

  s = await state();
  const ana = s.players.find((p: { name: string }) => p.name === 'Ana').id;
  await act({ type: 'auction.bid', auction_id: s.auction.id, player_id: ana, amount_cents: 300, idempotency_key: crypto.randomUUID() });
  await expect(tv.locator('[data-mascot="pose-cuenta-atras"]')).toBeVisible({ timeout: 20_000 });
  await tv.screenshot({ path: info.outputPath('tv-cuenta.png') });
  await expect(tv.getByTestId('award-mascot').or(tv.locator('[data-mascot="pose-adjudica"]')).first()).toBeVisible({ timeout: 30_000 });
  await tv.screenshot({ path: info.outputPath('tv-adjudica.png') });
  await expect.poll(async () => (await imagesLoaded(tv)).filter((i) => !i.ok).length, { timeout: 15_000 }).toBe(0);

  await act({ type: 'game.finish' });
  await expect(tv.locator('[data-mascot="expr-hype"]')).toBeVisible({ timeout: 20_000 });
  await tv.screenshot({ path: info.outputPath('tv-final.png') });

  const gone = await (await browser.newContext()).newPage();
  await gone.goto('/game/ZZZZZZ/screen');
  await expect(gone.locator('[data-mascot="expr-triste"], [data-mascot="expr-sorprendido"]').first()).toBeVisible({ timeout: 20_000 });
});

test('con prefers-reduced-motion la mascota no se anima', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto('/');
  const m = page.locator('[data-mascot="mascot-main"]');
  await expect(m).toBeVisible({ timeout: 60_000 });
  await expect(m).toHaveClass(/ss-mascot-bob/);
  expect(await m.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  const normal = await (await browser.newContext({ reducedMotion: 'no-preference' })).newPage();
  await normal.goto('/');
  await expect(normal.locator('[data-mascot="mascot-main"]')).toBeVisible({ timeout: 30_000 });
  expect(await normal.locator('[data-mascot="mascot-main"]').evaluate((el) => getComputedStyle(el).animationName)).toBe('ss-mascot-bob');
});

test('mascota en títulos y en el móvil: reacciona a ir ganando y a que te superen', async ({ browser }, info) => {
  const hostCtx = await browser.newContext();
  const host = hostCtx.request;
  expect((await host.post('/api/auth/demo')).ok()).toBeTruthy();

  // Títulos con mascota
  const hostPage = await hostCtx.newPage();
  await hostPage.goto('/new-game');
  await expect(hostPage.locator('[data-mascot="expr-feliz"]').first()).toBeVisible({ timeout: 60_000 });
  const anon = await (await browser.newContext()).newPage();
  await anon.goto('/join');
  await expect(anon.locator('[data-mascot="expr-guino"]')).toBeVisible({ timeout: 30_000 });
  await anon.goto('/');
  await expect(anon.getByText('¡Subasta activa!')).toBeVisible({ timeout: 30_000 });
  await expect(anon.locator('[data-mascot="item-megafono"]')).toBeVisible();

  // Móvil: partida en modo móviles
  const created = await host.post('/api/games', { data: { name: 'Móvil mascota', play_mode: 'mobile', initial_budget_cents: 2000, players: ['Ana', 'Beto'].map((name) => ({ name })) } });
  const code = (await created.json()).room_code as string;
  const act = (data: Record<string, unknown>) => host.post(`/api/games/${code}/actions`, { data });
  const state = async () => (await (await host.get(`/api/games/${code}`)).json()).snapshot;
  let s = await state();
  const [ana, beto] = ['Ana', 'Beto'].map((n) => s.players.find((p: { name: string }) => p.name === n).id as string);
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  expect((await phone.request.post(`/api/play/${code}/join`, { data: { player_id: ana } })).ok()).toBeTruthy();
  await act({ type: 'image.set_initial_all', catalog_id: 'house' });
  await act({ type: 'game.start' });
  const p = await phone.newPage();
  await p.goto(`/game/${code}/play`);
  await expect(p.getByTestId('balance')).toBeVisible({ timeout: 60_000 });
  await expect(p.locator('[data-mascot="item-moneda"]')).toBeVisible();
  await expect(p.locator('[data-mascot="expr-pensativo"]')).toBeVisible();

  s = await state();
  await act({ type: 'auction.announce', item_id: s.items[0].id });
  s = await state();
  expect((await phone.request.post(`/api/play/${code}/bid`, { data: { auction_id: s.auction.id, amount_cents: 200, idempotency_key: crypto.randomUUID() } })).ok()).toBeTruthy();
  await expect(p.getByText('¡Vas ganando!').first()).toBeVisible({ timeout: 20_000 });
  await p.screenshot({ path: info.outputPath('mobile-leading.png') });
  await act({ type: 'auction.bid', auction_id: s.auction.id, player_id: beto, amount_cents: 500, idempotency_key: crypto.randomUUID() });
  await expect(p.getByText('¡Te han superado!')).toBeVisible({ timeout: 20_000 });
});
