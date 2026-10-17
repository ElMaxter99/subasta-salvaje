import { expect, test } from '@playwright/test';

const template = {
  formato: 'subasta-salvaje/plantilla@1',
  nombre: 'Partida de plantilla',
  tematica: 'Base lunar',
  reglas: { presupuesto: 30, puja_minima: 2, rondas_maximas: 2, pujas_enteras: true, clasificacion: 'saldo', modo_juego: 'movil', modo_imagenes: 'pegatinas' },
  jugadores: ['Ana', 'Beto'],
  catalogo: [
    { titulo: 'Cráter', descripcion: 'Un cráter enorme.', emoji: '🌑', foto: 'https://127.0.0.1/crater.png' },
    { titulo: 'Rover', descripcion: 'Vehículo lunar.', emoji: '🚙' },
    { titulo: 'Bandera', descripcion: '', emoji: '🚩' },
  ],
};

test('plantillas: descargar la vacía, importar con errores y bien, crear la partida y exportarla de nuevo', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  expect((await ctx.request.post('/api/auth/demo')).ok()).toBeTruthy();
  const page = await ctx.newPage();
  await page.goto('/new-game');
  await expect(page.getByTestId('template-import')).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(2500); // el servidor de desarrollo en frío puede recargar una vez

  // Plantilla vacía descargable y válida (en el modal, origen «Subir un archivo»)
  await page.getByTestId('template-open').click();
  await page.getByTestId('template-source').selectOption('file');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Descargar plantilla vacía/ }).click()]);
  const blank = JSON.parse(await (await import('node:fs/promises')).readFile((await dl.path())!, 'utf8'));
  expect(blank).toMatchObject({ formato: 'subasta-salvaje/plantilla@1' });
  expect(blank.catalogo.length).toBeGreaterThan(1);

  // Archivo con errores: mensajes por elemento y no cambia nada
  await page.getByTestId('template-input').setInputFiles({ name: 'mala.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ formato: 'subasta-salvaje/plantilla@1', nombre: 'X', tematica: 'Y', catalogo: [{ titulo: 'Bien' }, { titulo: '' }] })) });
  await expect(page.getByTestId('template-errors')).toContainText('Elemento 2 del catálogo');
  await page.getByTestId('template-input').setInputFiles({ name: 'rota.json', mimeType: 'application/json', buffer: Buffer.from('{ esto no es json') });
  await expect(page.getByTestId('template-errors')).toContainText('JSON válido');
  await expect(page.getByTestId('wizard-step-1')).toBeVisible();

  // Plantilla buena: rellena el asistente y salta al resumen
  await page.getByTestId('template-input').setInputFiles({ name: 'buena.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(template)) });
  await expect(page.getByTestId('wizard-step-6')).toBeVisible();
  await expect(page.getByTestId('summary-catalog')).toContainText('3 elementos');
  await expect(page.getByTestId('summary-catalog')).toContainText('1 con foto');
  await expect(page.getByText('Partida de plantilla')).toBeVisible();
  await expect(page.getByText('Ana', { exact: true })).toBeVisible();
  await expect(page.getByText(/2 rondas máximo/)).toBeVisible();
  await page.getByRole('button', { name: /Crear partida/ }).click();
  await page.waitForURL(/\/game\/[A-Z0-9]{6}\/host/, { timeout: 60_000 });
  const code = page.url().match(/game\/([A-Z0-9]{6})\//)![1]!;

  // La partida salió como dice la plantilla
  const s = (await (await ctx.request.get(`/api/games/${code}`)).json()).snapshot;
  expect(s.game).toMatchObject({ name: 'Partida de plantilla', theme: 'Base lunar', initial_budget_cents: 3000, min_bid_cents: 200, play_mode: 'mobile', ranking_rule: 'balance', total_rounds: 2, integer_bids: true });
  expect(s.players.map((p: { name: string }) => p.name)).toEqual(['Ana', 'Beto']);
  expect(s.items.map((i: { name: string }) => i.name)).toEqual(['Cráter', 'Rover', 'Bandera']);
  // La foto apuntaba a una IP interna: se rechaza (SSRF), la partida existe igualmente y se avisa
  await expect(page.getByText(/no se pudo descargar|no se pudieron descargar/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/dirección no permitida|no permitida/)).toBeVisible();

  // Exportar desde Ajustes y volver a importar
  await page.getByRole('tab', { name: /Ajustes/ }).click();
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.getByTestId('template-export').click()]);
  const exported = JSON.parse(await (await import('node:fs/promises')).readFile((await dl2.path())!, 'utf8'));
  expect(exported).toMatchObject({ formato: 'subasta-salvaje/plantilla@1', nombre: 'Partida de plantilla', jugadores: ['Ana', 'Beto'] });
  expect(exported.catalogo.map((i: { titulo: string }) => i.titulo)).toEqual(['Cráter', 'Rover', 'Bandera']);
  expect(exported.reglas).toMatchObject({ presupuesto: 30, puja_minima: 2, clasificacion: 'saldo', modo_juego: 'movil' });
});

test('plantillas: CSV de catálogo (con ;) y ZIP con fotos incrustadas que se suben al crear la partida', async ({ browser }) => {
  const sharp = (await import('sharp')).default;
  const { makeZip } = await import('../tests/helpers-zip');
  const png = new Uint8Array(await sharp({ create: { width: 32, height: 32, channels: 3, background: '#2255cc' } }).png().toBuffer());

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  expect((await ctx.request.post('/api/auth/demo')).ok()).toBeTruthy();
  const page = await ctx.newPage();
  await page.goto('/new-game');
  await expect(page.getByTestId('template-import')).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(2500);

  // CSV: solo el catálogo; el asistente no salta de paso
  await page.getByTestId('template-input').setInputFiles({ name: 'catalogo.csv', mimeType: 'text/csv', buffer: Buffer.from('titulo;descripcion;emoji\r\nCohete;"Con ; punto";🚀\r\nSatélite;;🛰️\r\n') });
  await expect(page.getByTestId('template-loaded')).toContainText('2 elementos');
  await expect(page.getByTestId('wizard-step-1')).toBeVisible();
  await page.getByTestId('template-input').setInputFiles({ name: 'mala.csv', mimeType: 'text/csv', buffer: Buffer.from('descripcion\nsin titulo\n') });
  await expect(page.getByTestId('template-errors')).toContainText('titulo');

  // ZIP con foto incrustada
  const t = { formato: 'subasta-salvaje/plantilla@1', nombre: 'Partida ZIP', tematica: 'Espacio', reglas: { modo_juego: 'movil' }, jugadores: ['Ana', 'Beto'], catalogo: [{ titulo: 'Cohete', descripcion: 'Rojo', emoji: '🚀', foto: 'fotos/cohete.png' }, { titulo: 'Satélite', descripcion: '', emoji: '🛰️', foto: 'fotos/falta.png' }] };
  await page.getByTestId('template-input').setInputFiles({ name: 'plantilla.zip', mimeType: 'application/zip', buffer: Buffer.from(makeZip({ 'plantilla.json': JSON.stringify(t), 'fotos/cohete.png': png }, { deflate: true })) });
  await expect(page.getByTestId('wizard-step-6')).toBeVisible();
  await expect(page.getByTestId('summary-catalog')).toContainText('1 con foto');
  await page.getByRole('button', { name: /Crear partida/ }).click();
  await page.waitForURL(/\/game\/[A-Z0-9]{6}\/host/, { timeout: 60_000 });
  const code = page.url().match(/game\/([A-Z0-9]{6})\//)![1]!;
  await expect.poll(async () => {
    const s = (await (await ctx.request.get(`/api/games/${code}`)).json()).snapshot;
    return s.items.map((i: { name: string; image_path?: string | null; image_url?: string | null }) => `${i.name}:${i.image_path || i.image_url ? 'foto' : 'sin'}`);
  }, { timeout: 30_000 }).toEqual(['Cohete:foto', 'Satélite:sin']);
  // Y la que falta en el ZIP se avisó al importar (aviso en el asistente) sin bloquear nada
});

test('plantillas guardadas: guardar desde el resumen, aparecer en «Mis plantillas», cargar, guardar desde Ajustes y borrar', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  expect((await ctx.request.post('/api/auth/demo')).ok()).toBeTruthy();
  const page = await ctx.newPage();
  await page.goto('/new-game');
  await expect(page.getByTestId('template-import')).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(2500);
  await expect(page.getByTestId('saved-templates')).toHaveCount(0); // sin plantillas guardadas no se muestra

  await page.getByTestId('template-input').setInputFiles({ name: 'p.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(template)) });
  await expect(page.getByTestId('wizard-step-6')).toBeVisible();
  await page.getByLabel('Nombre de la plantilla').fill('Mi base lunar');
  await page.getByRole('button', { name: 'Guardar plantilla' }).click();
  await expect(page.getByTestId('save-template-msg')).toContainText('Plantilla guardada');
  await page.getByRole('button', { name: 'Guardar plantilla' }).click(); // mismo nombre: la sustituye
  await expect(page.getByTestId('save-template-msg')).toContainText('actualizada');
  expect((await (await ctx.request.get('/api/templates')).json()).templates).toHaveLength(1);

  // Otra sesión de «Nueva partida»: aparece en «Mis plantillas» y se carga
  await page.goto('/new-game');
  await expect(page.getByTestId('template-import')).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(2500);
  await page.getByTestId('template-open').click();
  await page.getByTestId('template-source').selectOption('mine'); // puede haber partidas del sistema de otras pruebas
  await expect(page.getByTestId('saved-templates')).toContainText('Mi base lunar', { timeout: 30_000 });
  await expect(page.getByTestId('saved-templates')).toContainText('3 elementos · 2 jugadores');
  await page.getByRole('button', { name: 'Cargar la plantilla Mi base lunar' }).click();
  await expect(page.getByTestId('wizard-step-6')).toBeVisible();
  await expect(page.getByTestId('summary-catalog')).toContainText('3 elementos');
  await expect(page.getByText(/2 rondas máximo/)).toBeVisible();

  // Guardar una partida existente desde Ajustes
  const created = await ctx.request.post('/api/games', { data: { name: 'Desde ajustes', initial_budget_cents: 2000, players: [{ name: 'Ana' }, { name: 'Beto' }] } });
  const code = (await created.json()).room_code as string;
  await page.goto(`/game/${code}/host`);
  await page.getByRole('tab', { name: /Ajustes/ }).click();
  await page.getByTestId('template-save').click();
  await expect(page.getByText(/guardada en tus plantillas/)).toBeVisible({ timeout: 15_000 });
  expect((await (await ctx.request.get('/api/templates')).json()).templates.map((t: { name: string }) => t.name).sort()).toEqual(['Desde ajustes', 'Mi base lunar']);

  // Aislamiento: otro anfitrión no ve nada; y borrar con confirmación
  const other = await browser.newContext();
  expect((await other.request.post('/api/auth/demo')).ok()).toBeTruthy();
  expect((await (await other.request.get('/api/templates')).json()).templates).toHaveLength(0);
  await page.goto('/new-game');
  await expect(page.getByTestId('template-import')).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(2500);
  await page.getByTestId('template-open').click();
  await page.getByTestId('template-source').selectOption('mine');
  await page.getByRole('button', { name: 'Borrar la plantilla Mi base lunar' }).click();
  await page.getByRole('button', { name: 'Confirmar el borrado de Mi base lunar' }).click();
  await expect(page.getByTestId('saved-templates')).not.toContainText('Mi base lunar');
  expect((await (await ctx.request.get('/api/templates')).json()).templates).toHaveLength(1);
});

test('editor de catálogo en el asistente: personalizar el de la temática, editar, reordenar, quitar, añadir y crear', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  expect((await ctx.request.post('/api/auth/demo')).ok()).toBeTruthy();
  const page = await ctx.newPage();
  await page.goto('/new-game');
  await expect(page.getByTestId('template-import')).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(2500);
  const next = () => page.getByRole('button', { name: /Siguiente/ }).click();
  for (let i = 0; i < 5; i++) {
    if (i === 2) await page.getByLabel('Nombre de la partida').fill('Catálogo propio');
    if (i === 4) await page.getByRole('button', { name: /Añadir jugador/ }).click().then(() => page.getByLabel('Nombre del jugador 1').fill('Ana'));
    await next();
  }
  await expect(page.getByTestId('wizard-step-6')).toBeVisible();
  await expect(page.getByTestId('summary-catalog-theme')).toContainText('12 elementos');

  await page.getByRole('button', { name: 'Personalizar el catálogo' }).click();
  const editor = page.getByTestId('catalog-editor');
  await expect(editor).toContainText('Catálogo (12)');
  await expect(page.getByLabel('Título del elemento 1', { exact: true })).toHaveValue('Piscina infinita');

  await page.getByLabel('Título del elemento 1', { exact: true }).fill('Piscina de lava');
  await expect(editor.getByLabel(/URL/i)).toHaveCount(0); // nunca se escribe una URL a mano
  await page.getByRole('button', { name: 'Bajar el elemento 1', exact: true }).click(); // la piscina pasa a la 2.ª posición
  await expect(page.getByLabel('Título del elemento 2', { exact: true })).toHaveValue('Piscina de lava');
  for (let i = 0; i < 9; i++) await page.getByRole('button', { name: 'Quitar el elemento 3', exact: true }).click(); // 12 → 3
  await page.getByRole('button', { name: /Añadir elemento/ }).click();
  await expect(page.getByTestId('catalog-error')).toContainText('Elemento 4 del catálogo: falta el título');
  await page.getByLabel('Título del elemento 4', { exact: true }).fill('Ovni');
  await page.getByLabel('Emoji del elemento 4', { exact: true }).fill('🛸');
  await page.getByLabel('Descripción del elemento 4', { exact: true }).fill('Aparcado en el jardín');
  await editor.getByRole('button', { name: 'Listo' }).click();
  await expect(page.getByTestId('summary-catalog')).toContainText('4 elementos');
  await expect(page.getByTestId('summary-catalog')).toContainText('Ovni');

  await page.getByRole('button', { name: /Crear partida/ }).click();
  await page.waitForURL(/\/game\/[A-Z0-9]{6}\/host/, { timeout: 60_000 });
  const code = page.url().match(/game\/([A-Z0-9]{6})\//)![1]!;
  const s = (await (await ctx.request.get(`/api/games/${code}`)).json()).snapshot;
  expect(s.items.map((i: { name: string }) => i.name)).toEqual(['Sofá gigante', 'Piscina de lava', 'Tobogán interior', 'Ovni']);
  expect(s.items[3]).toMatchObject({ emoji: '🛸', description: 'Aparcado en el jardín' });
  expect(s.game.total_rounds).toBe(4); // las rondas siguen al tamaño del catálogo propio
});

test('el indicador de pasos deja moverse con un clic entre los pasos ya alcanzados (también hacia delante)', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  expect((await ctx.request.post('/api/auth/demo')).ok()).toBeTruthy();
  const page = await ctx.newPage();
  await page.goto('/new-game');
  await expect(page.getByTestId('wizard-step-1')).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(2500);
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: /Siguiente/ }).click();
  await expect(page.getByTestId('wizard-step-4')).toBeVisible();
  // Volver al primero…
  await page.getByRole('button', { name: /^Quién puja \(completado/ }).click();
  await expect(page.getByTestId('wizard-step-1')).toBeVisible();
  // …y saltar de nuevo al 4.º sin pasar por «Siguiente» (los pasos intermedios son válidos)
  await page.getByRole('button', { name: /^Reglas \(completado/ }).click();
  await expect(page.getByTestId('wizard-step-4')).toBeVisible();
  // Un paso intermedio inválido bloquea el salto y lleva a él
  await page.getByRole('button', { name: /^Partida \(completado/ }).click();
  await page.getByLabel('Nombre de la partida').fill('');
  await page.getByRole('button', { name: /^Reglas \(completado/ }).click();
  await expect(page.getByTestId('wizard-step-3')).toBeVisible();
  await expect(page.getByTestId('wizard-error')).toContainText('nombre');
  await ctx.close();
});
