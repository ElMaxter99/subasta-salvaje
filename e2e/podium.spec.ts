import { expect, test } from '@playwright/test';

test('votación entre jugadores: al votar todos la TV pasa sola al podio (y la página de resultados también)', async ({ browser }) => {
  const hostCtx = await browser.newContext();
  const host = hostCtx.request;
  expect((await host.post('/api/auth/demo')).ok()).toBeTruthy();
  const created = await host.post('/api/games', { data: { name: 'Podio E2E', play_mode: 'mobile', initial_budget_cents: 2000, players: ['Ana', 'Beto', 'Carla', 'Dani'].map((name) => ({ name })) } });
  const code = (await created.json()).room_code as string;
  const act = (data: Record<string, unknown>) => host.post(`/api/games/${code}/actions`, { data });
  const state = async () => (await (await host.get(`/api/games/${code}`)).json()).snapshot;
  const ids: Record<string, string> = Object.fromEntries((await state()).players.map((p: { name: string; id: string }) => [p.name, p.id]));

  // Cada jugador, con su propio «móvil» (cookie propia)
  const phones: Record<string, import('@playwright/test').APIRequestContext> = {};
  for (const n of ['Ana', 'Beto', 'Carla', 'Dani']) {
    phones[n] = (await browser.newContext()).request;
    expect((await phones[n]!.post(`/api/play/${code}/join`, { data: { player_id: ids[n] } })).ok()).toBeTruthy();
  }
  expect((await act({ type: 'image.set_initial_all', catalog_id: 'house' })).ok()).toBeTruthy();
  expect((await act({ type: 'game.start' })).ok()).toBeTruthy();
  expect((await act({ type: 'game.finish' })).ok()).toBeTruthy();

  const tv = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await tv.goto(`/game/${code}/screen`);
  await expect(tv.getByTestId('gallery-open')).toBeVisible({ timeout: 60_000 });
  await expect(tv.getByTestId('podium')).toHaveCount(0);

  const vote = (who: string, target: string) => phones[who]!.post(`/api/play/${code}/vote`, { data: { target_id: ids[target] } });
  // Dani no puede votarse; Ana, Beto y Carla votan y la votación sigue abierta (falta Dani)
  expect((await vote('Dani', 'Dani')).status()).toBe(409);
  for (const [who, target] of [['Ana', 'Beto'], ['Beto', 'Ana'], ['Carla', 'Beto']] as const) expect((await vote(who, target)).ok()).toBeTruthy();
  expect((await state()).gallery).toMatchObject({ open: true, closed: false });
  await expect(tv.getByTestId('podium')).toHaveCount(0);

  // Vota el último: la votación termina sola y la TV cambia al podio sin recargar
  expect((await vote('Dani', 'Beto')).ok()).toBeTruthy();
  await expect(tv.getByTestId('podium-view')).toBeVisible({ timeout: 45_000 });
  await expect(tv.getByTestId('podium-player-1')).toContainText('Beto');
  await expect(tv.getByTestId('podium-player-1')).toContainText('3 votos');
  await expect(tv.getByTestId('podium-player-2')).toContainText('Ana');
  await expect(tv.getByTestId('podium-player-2')).toContainText('1 voto');
  await expect(tv.getByTestId('podium').getByText('Carla')).toHaveCount(0); // sin votos: fuera del podio, en «resto»
  await expect(tv.getByLabel('Resto de jugadores')).toContainText('Carla');

  // La página pública de resultados también muestra el podio
  const results = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await results.goto(`/game/${code}/results`);
  await expect(results.getByTestId('podium-view')).toBeVisible({ timeout: 60_000 });
  await expect(results.getByTestId('podium-player-1')).toContainText('Beto');
});
