import { expect, test } from '@playwright/test';
import { createGameViaWizard } from './new-game-helper';

test('presupuesto individual, equipos y sobre cerrado', async ({ page, context }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: /Entrar como anfitrión/ }).click();
  await page.waitForURL('**/');
  await createGameViaWizard(page, { name: 'Reglas extra', mobile: true, players: ['Ana', 'Beto'] });
  await page.waitForURL(/\/game\/[A-Z0-9]{6}\/host/);
  const code = page.url().match(/game\/([A-Z0-9]{6})\//)![1]!;
  const host = context.request;
  const state = async () => (await (await host.get(`/api/games/${code}`)).json()).snapshot;
  const act = (data: Record<string, unknown>) => host.post(`/api/games/${code}/actions`, { data });
  type P = { id: string; name: string; balance_cents: number; team?: string | null };

  let s = await state();
  const ana = s.players.find((p: P) => p.name === 'Ana') as P;
  const beto = s.players.find((p: P) => p.name === 'Beto') as P;

  // Presupuesto individual (en la sala de espera) y equipo
  expect((await act({ type: 'player.set_budget', player_id: ana.id, budget_cents: 5000 })).ok()).toBeTruthy();
  expect((await act({ type: 'player.set_team', player_id: ana.id, team: 'Rojos' })).ok()).toBeTruthy();
  s = await state();
  expect(s.players.find((p: P) => p.name === 'Ana').balance_cents).toBe(5000);
  expect(s.players.find((p: P) => p.name === 'Beto').balance_cents).toBe(2000);
  expect(s.players.find((p: P) => p.name === 'Ana').team).toBe('Rojos');

  expect((await act({ type: 'image.set_initial_all', catalog_id: 'house' })).ok()).toBeTruthy();
  expect((await act({ type: 'game.start' })).ok()).toBeTruthy();
  // Ya empezada: no se puede cambiar
  expect((await act({ type: 'player.set_budget', player_id: beto.id, budget_cents: 100 })).ok()).toBeFalsy();

  // Sobre cerrado: una sola puja por jugador
  s = await state();
  expect((await act({ type: 'auction.announce', item_id: s.items[0].id, wild_event: 'sealed' })).ok()).toBeTruthy();
  s = await state();
  const aid = s.auction.id;
  const bid = (pid: string, cents: number) => act({ type: 'auction.bid', auction_id: aid, player_id: pid, amount_cents: cents, idempotency_key: crypto.randomUUID() });
  expect((await bid(beto.id, 700)).ok()).toBeTruthy();
  const again = await bid(beto.id, 900);
  expect(again.ok()).toBeFalsy();
  expect(JSON.stringify(await again.json())).toMatch(/sealed_already_bid|sobre|una sola/i);
  expect((await bid(ana.id, 900)).ok()).toBeTruthy();

  const tv = await context.newPage();
  await tv.goto(`/game/${code}/screen`);
  await expect(tv.getByTestId('sealed-bidders')).toContainText(/Ana/);
  await expect(tv.getByTestId('sealed-bidders')).toContainText(/Beto/);

  s = await state();
  expect((await act({ type: 'auction.award', auction_id: aid, expected_winner_id: ana.id, expected_price_cents: 900, idempotency_key: crypto.randomUUID() })).ok()).toBeTruthy();
  s = await state();
  expect(s.players.find((p: P) => p.name === 'Ana').balance_cents).toBe(5000 - 900);
});
