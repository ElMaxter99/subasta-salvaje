import { expect, test, type Page } from '@playwright/test';
import { createGameViaWizard } from './new-game-helper';

/**
 * Comprobaciones de accesibilidad automáticas y sin librerías (no sustituyen a una auditoría manual con lector de pantalla):
 * idioma, un solo h1, nombres accesibles en controles, imágenes con alt, enlace «saltar al contenido» (menos en la TV),
 * etiquetas de formulario y objetivos táctiles en el móvil del jugador.
 */
interface Finding { rule: string; detail: string }

async function audit(page: Page, opts: { skipLink?: boolean; oneH1?: boolean } = {}): Promise<Finding[]> {
  const found = await page.evaluate(() => {
    const out: { rule: string; detail: string }[] = [];
    const visible = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const text = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    const nameOf = (el: Element): string => {
      const aria = el.getAttribute('aria-label')?.trim();
      if (aria) return aria;
      const by = el.getAttribute('aria-labelledby');
      if (by) { const t = by.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim(); if (t) return t; }
      const id = (el as HTMLElement).id;
      if (id) { const l = document.querySelector(`label[for="${CSS.escape(id)}"]`); if (l && text(l)) return text(l); }
      const wrap = el.closest('label');
      if (wrap && text(wrap)) return text(wrap);
      if (el.getAttribute('title')?.trim()) return el.getAttribute('title')!.trim();
      if (text(el)) return text(el);
      const img = el.querySelector('img[alt]');
      if (img && img.getAttribute('alt')?.trim()) return img.getAttribute('alt')!.trim();
      const svgTitle = el.querySelector('svg title');
      if (svgTitle && text(svgTitle)) return text(svgTitle);
      if ((el as HTMLInputElement).type === 'submit' || (el as HTMLInputElement).type === 'button') return (el as HTMLInputElement).value ?? '';
      return '';
    };
    const desc = (el: Element) => `<${el.tagName.toLowerCase()}${(el as HTMLElement).id ? `#${(el as HTMLElement).id}` : ''} class="${String(el.getAttribute('class') ?? '').slice(0, 60)}">`;
    if (document.documentElement.lang !== 'es') out.push({ rule: 'lang', detail: `lang="${document.documentElement.lang}"` });
    for (const el of document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=checkbox], [role=radio]')) {
      if (!visible(el) && !(el instanceof HTMLInputElement && (el.type === 'radio' || el.type === 'checkbox' || el.type === 'file'))) continue;
      if (el.closest('[aria-hidden=true]')) continue;
      if (!nameOf(el)) out.push({ rule: 'nombre-accesible', detail: desc(el) });
    }
    for (const img of document.querySelectorAll('img')) if (!img.hasAttribute('alt') && !img.closest('[aria-hidden=true]')) out.push({ rule: 'img-sin-alt', detail: img.getAttribute('src') ?? '' });
    const ids = new Map<string, number>();
    for (const el of document.querySelectorAll('[id]')) ids.set(el.id, (ids.get(el.id) ?? 0) + 1);
    for (const [id, n] of ids) if (n > 1) out.push({ rule: 'id-duplicado', detail: id });
    return out;
  });
  const h1 = await page.locator('h1:visible').count();
  if (h1 !== 1) found.push({ rule: 'h1', detail: `${h1} h1 visibles` });
  void opts.oneH1;
  const skip = await page.locator('a[href^="#"]', { hasText: /saltar al contenido/i }).count();
  if (opts.skipLink === false ? skip !== 0 : skip !== 1) found.push({ rule: 'saltar-al-contenido', detail: `${skip} enlaces` });
  return found;
}

const expectClean = async (page: Page, label: string, opts?: Parameters<typeof audit>[1]) => {
  const f = await audit(page, opts);
  expect(f, `${label}: ${JSON.stringify(f, null, 1)}`).toEqual([]);
};

test('accesibilidad: portada, acceso, asistente, panel del anfitrión, móvil del jugador, TV y resultados', async ({ page, context, browser }) => {
  // Portada y acceso
  await page.goto('/');
  await expect(page.locator('h1')).toBeVisible();
  await expectClean(page, 'portada');
  await page.goto('/login');
  await expect(page.getByRole('button', { name: /Entrar como anfitrión/ })).toBeVisible();
  await expectClean(page, 'login');
  await page.goto('/join');
  await expect(page.getByLabel('Código de sala')).toBeVisible();
  await expectClean(page, 'unirse');

  // Foco visible: el primer Tab llega a un elemento con contorno propio (:focus-visible de globals.css)
  await page.keyboard.press('Tab');
  const outline = await page.evaluate(() => { const s = getComputedStyle(document.activeElement!); return { w: s.outlineWidth, st: s.outlineStyle }; });
  expect(outline.st).not.toBe('none');
  expect(parseFloat(outline.w)).toBeGreaterThanOrEqual(2);
  // El enlace «saltar al contenido» mueve el foco al <main>
  await page.getByRole('link', { name: /saltar al contenido/i }).click();
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('MAIN');

  // Asistente de nueva partida (cada paso)
  await page.goto('/login');
  await page.getByRole('button', { name: /Entrar como anfitrión/ }).click();
  await page.waitForURL('**/');
  await page.goto('/new-game');
  await page.getByRole('radio', { name: /Cada jugador desde su móvil/ }).check();
  await expectClean(page, 'asistente paso 1');
  await page.getByRole('button', { name: /Siguiente/ }).click();
  await expectClean(page, 'asistente paso 2');
  await page.getByRole('button', { name: /Siguiente/ }).click();
  await expectClean(page, 'asistente paso 3');

  // Crear la partida y recorrer el panel del anfitrión
  await createGameViaWizard(page, { name: 'Noche accesible', mobile: true, players: ['Ana', 'Beto'] });
  await page.waitForURL(/\/game\/[A-Z0-9]{6}\/host/);
  const code = page.url().match(/game\/([A-Z0-9]{6})\//)![1]!;
  await expect(page.getByRole('tab', { name: /Resumen/ })).toBeVisible();
  for (const tab of [/Resumen/, /Subasta/, /Jugadores/, /Catálogo|Cat/, /Imágenes/, /Ajustes/]) {
    await page.getByRole('tab', { name: tab }).first().click();
    await expectClean(page, `anfitrión ${String(tab)}`);
  }
  await expect(page.getByRole('link', { name: /Exportar partida \(ZIP\)/ }).or(page.getByText('Exportar partida (ZIP)'))).toBeVisible();

  // Diálogo: se cierra con Escape y el foco vuelve al botón que lo abrió
  const del = page.getByRole('button', { name: 'Borrar partida' });
  await del.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  expect(await page.evaluate(() => document.activeElement?.textContent ?? '')).toContain('Borrar partida');

  // Móvil del jugador (390 px): nombres accesibles y objetivos táctiles >= 44 px
  const host = context.request;
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const p = await phone.newPage();
  await p.goto('/join');
  await p.getByLabel('Código de sala').fill(code);
  await p.getByRole('button', { name: /Unirme/ }).click();
  await p.waitForURL(`**/game/${code}/play`);
  await expect(p.getByRole('heading', { name: /Quién eres/ })).toBeVisible();
  await expectClean(p, 'móvil: elegir jugador');
  await p.getByRole('button', { name: /Ana/ }).first().click();
  await p.getByRole('button', { name: /Sí, soy yo/ }).click();
  expect((await host.post(`/api/games/${code}/actions`, { data: { type: 'image.set_initial_all', catalog_id: 'house' } })).ok()).toBeTruthy();
  expect((await host.post(`/api/games/${code}/actions`, { data: { type: 'game.start' } })).ok()).toBeTruthy();
  const snap = (await (await host.get(`/api/games/${code}`)).json()).snapshot;
  expect((await host.post(`/api/games/${code}/actions`, { data: { type: 'auction.announce', item_id: snap.items[0].id } })).ok()).toBeTruthy();
  await expect(p.getByRole('button', { name: /más 1 Ohro/ }).first()).toBeVisible();
  await expectClean(p, 'móvil: subasta', { skipLink: true });
  const small = await p.evaluate(() => [...document.querySelectorAll('button, a[href], input, select, textarea')]
    .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1 && !el.closest('[aria-hidden=true]'); })
    .map((el) => ({ el: `${el.tagName.toLowerCase()} ${(el.textContent ?? '').trim().slice(0, 30)}`, h: Math.round(el.getBoundingClientRect().height), w: Math.round(el.getBoundingClientRect().width) }))
    .filter((x) => x.h < 44 || x.w < 44));
  expect(small, `objetivos táctiles < 44 px: ${JSON.stringify(small)}`).toEqual([]);

  // Zoom y texto grande: el viewport no bloquea el zoom y a 360 px con el texto al 200 % no hay desbordamiento horizontal
  const vp = await p.locator('meta[name=viewport]').getAttribute('content');
  expect(vp ?? '').not.toMatch(/maximum-scale|user-scalable\s*=\s*(no|0)/);
  await p.setViewportSize({ width: 360, height: 740 });
  await p.addStyleTag({ content: 'html{font-size:200% !important}' });
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const culprits = overflow <= 1 ? [] : await p.evaluate(() => [`iw=${innerWidth} cw=${document.documentElement.clientWidth} sw=${document.documentElement.scrollWidth}`, ...[...document.querySelectorAll('body *')].filter((el) => el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && !el.matches('a, main, main > div, .mx-auto')).slice(0, 12).map((el) => `SCROLL ${el.tagName}.${String(el.getAttribute('class') ?? '').slice(0, 40)} ${el.scrollWidth}/${el.clientWidth}`)].concat([...document.querySelectorAll('body *')].filter((el) => el.getBoundingClientRect().right > 361 && !el.closest(".pointer-events-none")).slice(0, 6).map((el) => `${el.tagName.toLowerCase()}.${String(el.getAttribute('class') ?? '').slice(0, 50)} «${(el.textContent ?? '').trim().slice(0, 25)}»`)));
  expect(overflow, `desbordamiento horizontal a 360 px con texto al 200 %: ${JSON.stringify(culprits)}`).toBeLessThanOrEqual(1);
  // Con tanto texto las barras fijas dejarían poco hueco: pasan a ser normales (no sticky) en viewports bajos
  await expect.poll(() => p.evaluate(() => getComputedStyle(document.querySelector('header')!).position), { timeout: 5000 }).toBe('static');
  // La cuenta atrás no es región viva (cambiaría cada segundo) y los avisos puntuales sí
  expect(await p.locator('[data-testid="auto-award-countdown"][role], [data-testid^="auto-run-"][role]').count()).toBe(0);
  // prefers-reduced-motion: ninguna animación en la mascota ni en la moneda
  await p.emulateMedia({ reducedMotion: 'reduce' });
  const animated = await p.evaluate(() => [...document.querySelectorAll('.ss-mascot, [data-mascot]')].filter((el) => getComputedStyle(el).animationName !== 'none').length);
  expect(animated, 'elementos animados con reduced-motion').toBe(0);
  await phone.close();

  // TV: sin enlace de saltar (pantalla pública sin teclado) pero con nombres accesibles e imágenes con alt
  const tv = await context.newPage();
  await tv.goto(`/game/${code}/screen`);
  await expect(tv.getByTestId('screen-player').first()).toBeVisible({ timeout: 60_000 });
  await expectClean(tv, 'TV', { skipLink: false });
  await tv.close();

  // Resultados (partida terminada)
  expect((await host.post(`/api/games/${code}/actions`, { data: { type: 'game.finish' } })).ok()).toBeTruthy();
  await page.goto(`/game/${code}/results`);
  await expect(page.locator('main')).toBeVisible();
  await expectClean(page, 'resultados');
});
