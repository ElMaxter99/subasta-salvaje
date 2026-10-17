import { createServer } from 'node:http';
import { expect, test } from '@playwright/test';
import sharp from 'sharp';

const stamp = Date.now().toString(36); // la base del e2e persiste entre ejecuciones: nombres únicos
const TITLE = `Noche en la luna ${stamp}`;
const template = {
  formato: 'subasta-salvaje/plantilla@1',
  nombre: TITLE,
  tematica: 'Base lunar',
  reglas: { presupuesto: 30, puja_minima: 2, rondas_maximas: 2, pujas_enteras: true, clasificacion: 'saldo', modo_juego: 'anfitrion', modo_imagenes: 'pegatinas' },
  jugadores: ['Ana', 'Beto'],
  catalogo: [
    { titulo: 'Cráter', descripcion: 'Un cráter enorme.', emoji: '🌑' },
    { titulo: 'Rover', descripcion: 'Vehículo lunar.', emoji: '🚙' },
  ],
};

/** Avanza `n` pasos del asistente del superadmin con «Siguiente». */
async function next(page: import('@playwright/test').Page, n: number) {
  for (let i = 0; i < n; i++) await page.getByRole('button', { name: /Siguiente/ }).click();
}

test('partidas del sistema: el superadmin crea y publica una plantilla; el anfitrión la ve, la carga y crea la partida', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  expect((await ctx.request.post('/api/auth/demo')).ok()).toBeTruthy(); // en demo el anfitrión local es superadmin
  const page = await ctx.newPage();

  // Sin plantillas publicadas no aparece la sección
  await page.goto('/new-game');
  await expect(page.getByTestId('template-import')).toBeVisible({ timeout: 60_000 });

  // Superadmin: el MISMO asistente que el anfitrión, con un paso de ficha; se importa el JSON y se guarda como borrador
  await page.goto('/admin/plantillas');
  await page.getByRole('link', { name: 'Nueva plantilla' }).click();
  await expect(page.getByTestId('wizard-step-1')).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(2500);
  await page.getByTestId('template-open').click();
  await page.getByTestId('template-input').setInputFiles({ name: 'mala.json', mimeType: 'application/json', buffer: Buffer.from('{ "formato": "mal" }') });
  await expect(page.getByTestId('template-errors')).toBeVisible();
  await page.getByTestId('template-input').setInputFiles({ name: 'buena.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(template)) });
  await expect(page.getByTestId('summary-catalog')).toContainText('2 elementos'); // salta al resumen con la plantilla cargada
  await page.getByRole('button', { name: 'Editar Ficha del sistema' }).click();
  await expect(page.getByTestId('system-step')).toBeVisible();
  await page.getByLabel('Identificador (carpeta de las fotos)').fill(`noche-luna-${stamp}`);
  await page.getByLabel('Descripción (hasta 300 caracteres)').fill('Una subasta lunar para empezar rápido');
  await next(page, 1);
  await page.getByRole('button', { name: 'Guardar borrador' }).click();
  await page.waitForURL(/\/admin\/plantillas(\?|$)/, { timeout: 30_000 });
  const row = page.getByTestId('system-template-row').filter({ hasText: TITLE });
  await expect(row).toContainText('Borrador');

  // Un borrador no lo ve el anfitrión
  const titles = async () => (((await (await ctx.request.get('/api/system-templates')).json()) as { templates: { title: string }[] }).templates).map((t) => t.title);
  expect(await titles()).not.toContain(TITLE);

  // Publicar (sin imágenes no hay nada que descargar)
  await row.getByRole('button', { name: 'Publicar' }).click();
  await expect(row).toContainText('Publicada');
  await expect(page.getByText('Plantilla publicada')).toBeVisible();

  // Anfitrión: la tarjeta aparece, se usa y rellena el asistente
  await page.goto('/new-game');
  await expect(page.getByTestId('template-import')).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(2500);
  await page.getByTestId('template-open').click();
  const card = page.getByTestId('system-template-card').filter({ hasText: TITLE });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText('2 elementos');
  await card.getByRole('button', { name: /Usar la partida del sistema/ }).click();
  await expect(page.getByTestId('summary-catalog')).toContainText('2 elementos'); // el asistente salta al Resumen con la plantilla cargada
  await page.getByRole('button', { name: /Crear partida/ }).click();
  await page.waitForURL(/\/game\/[A-Z0-9]{6}\/host/, { timeout: 60_000 });
  await expect(page.getByText(TITLE).first()).toBeVisible();

  // Retirar: vuelve a ser borrador y desaparece para los anfitriones
  await page.goto('/admin/plantillas');
  await page.getByTestId('system-template-row').filter({ hasText: TITLE }).getByRole('button', { name: 'Retirar' }).click();
  await expect(page.getByTestId('system-template-row').filter({ hasText: TITLE })).toContainText('Borrador');
  expect(await titles()).not.toContain(TITLE);

  // Limpieza: borrar la plantilla de la prueba
  await page.getByTestId('system-template-row').filter({ hasText: TITLE }).getByRole('button', { name: 'Borrar' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Borrar' }).click();
  await expect(page.getByTestId('system-template-row').filter({ hasText: TITLE })).toHaveCount(0);

  // Un anfitrión que no es superadmin recibe 404 en las rutas de administración
  const anon = await browser.newContext();
  expect((await anon.request.get('/api/admin/system-templates')).status()).toBe(404);
  expect((await anon.request.post('/api/admin/system-templates', { data: { op: 'delete', id: '00000000-0000-4000-8000-000000000000' }, headers: { origin: 'http://localhost:3210' } })).status()).toBe(404);
  await anon.close();
  await ctx.close();
});

test('arrastrar y soltar: las imágenes se suben al repositorio de fotos (simulado), no a Supabase, y rellenan el JSON', async ({ browser }) => {
  // Servidor local que imita la API de GitHub (el servidor de la app apunta aquí por GITHUB_ASSETS_API_BASE)
  const puts: string[] = [];
  const stub = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'PUT') {
        puts.push(decodeURIComponent(req.url ?? ''));
        res.statusCode = 201;
        res.end(JSON.stringify({ commit: { sha: 'stub0000sha' } }));
      } else if (req.url?.includes('/commits/')) res.end(JSON.stringify({ sha: 'stub0000sha' }));
      else { res.statusCode = 404; res.end('{}'); }
    });
  });
  await new Promise<void>((r) => stub.listen(3299, '127.0.0.1', r));
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    expect((await ctx.request.post('/api/auth/demo')).ok()).toBeTruthy();
    const page = await ctx.newPage();
    await page.goto('/admin/plantillas/editor');
    await expect(page.getByTestId('wizard-step-1')).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(2500);
    await next(page, 5); // Quién puja → Casas → Partida → Reglas → Jugadores → Ficha
    await expect(page.getByTestId('template-dropzone')).toBeVisible();

    const photo = (color: string) => sharp({ create: { width: 1600, height: 1200, channels: 3, background: color } }).jpeg().toBuffer();
    const file = async (name: string, color: string) => ({ name, mimeType: 'image/jpeg', buffer: await photo(color) });

    // Sin slug no se sube nada y se explica
    await page.getByLabel('Identificador (carpeta de las fotos)').fill('');
    await page.getByLabel('Elegir imágenes').setInputFiles(await file('portada.jpg', '#cc3333'));
    await expect(page.getByText('Pon primero el identificador')).toBeVisible();

    await page.getByLabel('Título de la tarjeta').fill(`Subida ${stamp}`);
    await page.getByLabel('Identificador (carpeta de las fotos)').fill(`subida-${stamp}`);
    await page.getByLabel('Elegir imágenes').setInputFiles([await file('portada.jpg', '#cc3333'), await file('Casa-Inicial.jpg', '#33cc33'), await file('piscina-infinita.jpg', '#3333cc'), await file('IMG_0001.jpg', '#cccc33')]);
    const list = page.getByTestId('upload-list');
    await expect(list.getByText(/^Portada · \d+×\d+/)).toBeVisible({ timeout: 60_000 });
    await expect(list.getByText(/^Casa inicial · \d+×\d+/)).toBeVisible();
    await expect(list.getByText(/^Elemento · Piscina infinita · \d+×\d+/)).toBeVisible();
    await expect(list.getByText('No encaja con la portada')).toBeVisible();

    // La imagen suelta se asigna a mano a un elemento
    await list.getByLabel('Asignar IMG_0001.jpg').selectOption({ label: 'Elemento · Sofá gigante' });
    await expect(list.getByText(/^Elemento · Sofá gigante · \d+×\d+/)).toBeVisible({ timeout: 60_000 });
    expect(puts).toHaveLength(4);
    expect(puts.every((p) => p.endsWith('.webp'))).toBe(true);

    // Resumen y guardado: la plantilla lleva los enlaces fijados al commit (nada se guardó en Supabase)
    await next(page, 1);
    await expect(page.getByText(/Portada: ✔ · Casa inicial: ✔ · Fotos: 2\//)).toBeVisible();
    await page.getByRole('button', { name: 'Guardar borrador' }).click();
    await page.waitForURL(/\/admin\/plantillas(\?|$)/, { timeout: 30_000 });
    const row = page.getByTestId('system-template-row').filter({ hasText: `subida-${stamp}` });
    await expect(row).toContainText('casa inicial');
    const id = (await (await ctx.request.get('/api/admin/system-templates')).json()).templates.find((t: { slug: string }) => t.slug === `subida-${stamp}`).id as string;
    const full = (await (await ctx.request.post('/api/admin/system-templates', { data: { op: 'get', id }, headers: { origin: 'http://localhost:3210' } })).json()) as { data: { portada: string; casa_inicial: string; catalogo: { titulo: string; foto?: string }[] } };
    expect(full.data.portada).toMatch(new RegExp(`^https://cdn\\.jsdelivr\\.net/gh/e2e/fotos@stub0000sha/plantillas/subida-${stamp}/cover-portada-[0-9a-f]{12}\\.webp$`));
    expect(full.data.casa_inicial).toContain('/scene-casa-inicial-');
    expect(full.data.catalogo.find((i) => i.titulo === 'Piscina infinita')!.foto).toContain('/item-piscina-infinita-');
    expect(full.data.catalogo.find((i) => i.titulo === 'Sofá gigante')!.foto).toContain('/item-img-0001-');

    // Borrar el borrador de la prueba
    await row.getByRole('button', { name: 'Borrar' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Borrar' }).click();
    await expect(row).toHaveCount(0);
    await ctx.close();
  } finally {
    await new Promise<void>((r) => stub.close(() => r()));
  }
});

test('editor visual: editar sin tocar el JSON (espacios, catálogo, orden, créditos) y ver los créditos en la tarjeta', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  expect((await ctx.request.post('/api/auth/demo')).ok()).toBeTruthy();
  const page = await ctx.newPage();
  const TV = `Visual ${stamp}`;
  await page.goto('/admin/plantillas/editor');
  await expect(page.getByTestId('wizard-step-1')).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(2500);
  await next(page, 2); // Quién puja → Casas → Partida

  // Escribir con espacios no se «come» el espacio final mientras se teclea
  const nombre = page.getByLabel('Nombre de la partida');
  await nombre.fill('');
  await nombre.pressSequentially('Noche de prueba total');
  await expect(nombre).toHaveValue('Noche de prueba total');
  await next(page, 3); // Reglas → Jugadores → Ficha

  // Ficha: título, identificador y créditos (sin portada, así no hay imágenes que descargar al publicar)
  await page.getByLabel('Título de la tarjeta').fill(TV);
  await page.getByLabel('Identificador (carpeta de las fotos)').fill(`visual-${stamp}`);
  await page.getByLabel('Créditos de las imágenes (opcional)').fill('Dibujos propios y Wikimedia Commons');
  await next(page, 1);

  // Catálogo (el de la temática, ya editable): añadir uno, renombrarlo, subirlo al principio y quitar otro
  await page.getByRole('button', { name: 'Editar el catálogo' }).click();
  const total = await page.locator('[data-testid^="catalog-row-"]').count();
  await page.getByRole('button', { name: 'Añadir elemento' }).click();
  await expect(page.locator('[data-testid^="catalog-row-"]')).toHaveCount(total + 1);
  await page.getByLabel(`Título del elemento ${total + 1}`).fill('Calabaza gigante');
  await page.getByLabel(`Crédito de la foto del elemento ${total + 1}`).fill('Autor X · CC BY');
  for (let i = total + 1; i > 1; i--) await page.getByLabel(`Subir el elemento ${i}`).click();
  await expect(page.getByLabel('Título del elemento 1', { exact: true })).toHaveValue('Calabaza gigante');
  await page.getByLabel('Quitar el elemento 2', { exact: true }).click();
  await expect(page.locator('[data-testid^="catalog-row-"]')).toHaveCount(total);
  await page.getByRole('button', { name: 'Listo' }).click();

  // Guardar, publicar y ver la tarjeta con sus créditos
  await page.getByRole('button', { name: 'Guardar borrador' }).click();
  await page.waitForURL(/\/admin\/plantillas(\?|$)/, { timeout: 30_000 });
  const row = page.getByTestId('system-template-row').filter({ hasText: TV });
  await expect(row).toContainText('Borrador');
  await row.getByRole('button', { name: 'Publicar' }).click();
  await expect(row).toContainText('Publicada');
  await page.goto('/new-game');
  await expect(page.getByTestId('template-import')).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(2500);
  await page.getByTestId('template-open').click();
  const card = page.getByTestId('system-template-card').filter({ hasText: TV });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card.getByTestId('system-template-credits')).toContainText('Dibujos propios y Wikimedia Commons');

  // Limpieza
  await page.goto('/admin/plantillas');
  const r2 = page.getByTestId('system-template-row').filter({ hasText: TV });
  await r2.getByRole('button', { name: 'Borrar' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Borrar' }).click();
  await expect(r2).toHaveCount(0);
  await ctx.close();
});
