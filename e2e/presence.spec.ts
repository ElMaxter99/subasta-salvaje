import { expect, test, type Browser } from '@playwright/test';

/** Presencia (latido) y «Sacar de la TV». Sin puertas traseras: el aviso de salida es el real (`pagehide` → sendBeacon). */
async function phone(browser: Browser, code: string, name: string) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const p = await ctx.newPage();
  await p.goto('/join');
  await p.getByLabel('Código de sala').fill(code);
  await p.getByRole('button', { name: /Unirme/ }).click();
  await p.waitForURL(`**/game/${code}/play`);
  await p.getByRole('button', { name: new RegExp(name) }).first().click();
  await p.getByRole('button', { name: /Sí, soy yo/ }).click();
  return p;
}

test('un móvil desconectado sale «Desconectado» en su foto de la TV, se reconecta y el anfitrión puede sacarlo de la TV', async ({ browser }) => {
  const hostCtx = await browser.newContext({ viewport: { width: 1280, height: 1400 } });
  const host = hostCtx.request;
  expect((await host.post('/api/auth/demo')).ok()).toBeTruthy();
  const created = await host.post('/api/games', {
    data: { name: 'Presencia E2E', play_mode: 'mobile', initial_budget_cents: 2000, players: ['Ana', 'Beto'].map((name) => ({ name })) },
  });
  const code = (await created.json()).room_code as string;
  const act = (data: Record<string, unknown>) => host.post(`/api/games/${code}/actions`, { data });
  const state = async () => (await (await host.get(`/api/games/${code}`)).json()).snapshot;

  await phone(browser, code, 'Ana');
  const beto = await phone(browser, code, 'Beto');
  await expect.poll(async () => (await state()).players.filter((x: { claimed: boolean }) => x.claimed).length).toBe(2);
  expect((await act({ type: 'image.set_initial_all', catalog_id: 'house' })).ok()).toBeTruthy();
  expect((await act({ type: 'game.start' })).ok()).toBeTruthy();

  const tv = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await tv.goto(`/game/${code}/screen`);
  await expect(tv.getByTestId('screen-player')).toHaveCount(2, { timeout: 60_000 });
  await expect(tv.getByTestId('player-offline')).toHaveCount(0);

  // Beto cierra la pestaña: se envía el aviso de salida real (pagehide → sendBeacon) y la TV lo marca en SU foto.
  await beto.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
  await expect(tv.getByTestId('player-offline')).toHaveCount(1, { timeout: 30_000 });
  const betoCard = tv.getByTestId('screen-player').filter({ hasText: 'Beto' });
  await expect(betoCard.getByTestId('player-offline')).toContainText('Desconectado');
  await expect(betoCard.getByTestId('house-offline')).toHaveCount(1);
  const s1 = await state();
  expect(s1.players.find((p: { name: string }) => p.name === 'Beto').online).toBe(false);
  expect(s1.events.some((e: { event_type: string }) => e.event_type === 'player_disconnected')).toBe(true);

  // Su pestaña sigue viva y vuelve a latir (≤ 15 s): la TV muestra «Reconectado» y luego se normaliza.
  await expect(tv.getByTestId('player-reconnected')).toBeVisible({ timeout: 40_000 });
  await expect(tv.getByTestId('player-offline')).toHaveCount(0);
  expect((await state()).events.some((e: { event_type: string }) => e.event_type === 'player_reconnected')).toBe(true);

  // El anfitrión ve su estado y lo saca de la TV.
  const panel = await hostCtx.newPage();
  await panel.goto(`/game/${code}/host`);
  await panel.getByRole('tab', { name: /Jugadores/ }).click();
  const betoId = (await state()).players.find((p: { name: string }) => p.name === 'Beto').id as string;
  await expect(panel.getByTestId(`presence-${betoId}`)).toContainText('Conectado', { timeout: 30_000 });
  await panel.getByRole('button', { name: /Sacar de la TV/ }).nth(1).click();
  await expect(tv.getByTestId('screen-player')).toHaveCount(1, { timeout: 30_000 });
  await expect(tv.getByTestId('screen-player').filter({ hasText: 'Beto' })).toHaveCount(0);
  await expect(beto.getByTestId('retired-notice')).toContainText('sacado de la partida', { timeout: 30_000 });
  // Y desde la API del móvil ya no puede pujar.
  await act({ type: 'auction.announce', item_id: (await state()).items[0].id });
  const bid = await beto.evaluate(async (c) => {
    const s = await (await fetch(`/api/public/games/${c}`)).json();
    const r = await fetch(`/api/play/${c}/bid`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ auction_id: s.snapshot.auction.id, amount_cents: 100, idempotency_key: crypto.randomUUID() }) });
    return { status: r.status, code: (await r.json()).error?.code };
  }, code);
  expect(bid.code).toBe('player_retired');

  // Volver a mostrar.
  await panel.getByRole('button', { name: /Volver a mostrar/ }).click();
  await expect(tv.getByTestId('screen-player')).toHaveCount(2, { timeout: 30_000 });
});
