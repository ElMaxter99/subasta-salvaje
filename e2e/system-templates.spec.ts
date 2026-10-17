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

test('partidas del sistema: el superadmin crea y publica una plantilla; el anfitrión la ve, la carga y crea la partida', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  expect((await ctx.request.post('/api/auth/demo')).ok()).toBeTruthy(); // en demo el anfitrión local es superadmin
  const page = await ctx.newPage();

  // Sin plantillas publicadas no aparece la sección
  await page.goto('/new-game');
  await expect(page.getByTestId('template-import')).toBeVisible({ timeout: 60_000 });

  // Superadmin: nueva plantilla con JSON no válido → errores; válido → borrador
  await page.goto('/admin/plantillas');
  await page.getByRole('button', { name: 'Nueva plantilla' }).click();
  await page.getByLabel('Título', { exact: true }).fill(TITLE);
  await page.getByLabel('Identificador').fill(`noche-luna-${stamp}`);
  await page.getByLabel('Descripción', { exact: true }).fill('Una subasta lunar para empezar rápido');
  await page.getByLabel('Plantilla JSON', { exact: true }).fill('{ "formato": "mal" }');
  await expect(page.locator('ul[role="alert"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Guardar borrador' })).toBeDisabled();
  await page.getByLabel('Plantilla JSON', { exact: true }).fill(JSON.stringify(template));
  await expect(page.getByTestId('template-valid')).toContainText('2 elementos');
  await page.getByRole('button', { name: 'Guardar borrador' }).click();
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
    await page.goto('/admin/plantillas');
    await page.getByRole('button', { name: 'Nueva plantilla' }).click();
    await expect(page.getByTestId('template-dropzone')).toBeVisible({ timeout: 60_000 });

    const photo = (color: string) => sharp({ create: { width: 1600, height: 1200, channels: 3, background: color } }).jpeg().toBuffer();
    const file = async (name: string, color: string) => ({ name, mimeType: 'image/jpeg', buffer: await photo(color) });

    // Sin slug no se sube nada y se explica
    await page.getByLabel('Elegir imágenes').setInputFiles(await file('portada.jpg', '#cc3333'));
    await expect(page.getByText('Pon primero el identificador')).toBeVisible();

    await page.getByLabel('Título', { exact: true }).fill(`Subida ${stamp}`);
    await page.getByLabel('Identificador').fill(`subida-${stamp}`);
    await page.getByLabel('Elegir imágenes').setInputFiles([await file('portada.jpg', '#cc3333'), await file('Casa-Inicial.jpg', '#33cc33'), await file('piscina-infinita.jpg', '#3333cc'), await file('IMG_0001.jpg', '#cccc33')]);
    const list = page.getByTestId('upload-list');
    await expect(list.getByText(/^Portada · \d+×\d+/)).toBeVisible({ timeout: 60_000 });
    await expect(list.getByText(/^Casa inicial · \d+×\d+/)).toBeVisible();
    await expect(list.getByText(/^Elemento · Piscina infinita · \d+×\d+/)).toBeVisible();
    await expect(list.getByText('No encaja con la portada')).toBeVisible();

    // La imagen suelta se asigna a mano a un elemento
    await list.getByLabel('Asignar IMG_0001.jpg').selectOption({ label: 'Elemento · Sofá gigante' });
    await expect(list.getByText(/^Elemento · Sofá gigante · \d+×\d+/)).toBeVisible({ timeout: 60_000 });

    // El JSON ahora lleva los enlaces fijados al commit y nada se guardó en Supabase (solo llamadas al repositorio simulado)
    const json = JSON.parse(await page.getByLabel('Plantilla JSON', { exact: true }).inputValue()) as { portada: string; casa_inicial: string; catalogo: { titulo: string; foto?: string }[] };
    expect(json.portada).toMatch(new RegExp(`^https://cdn\\.jsdelivr\\.net/gh/e2e/fotos@stub0000sha/plantillas/subida-${stamp}/cover-portada-[0-9a-f]{12}\\.webp$`));
    expect(json.casa_inicial).toContain('/scene-casa-inicial-');
    expect(json.catalogo.find((i) => i.titulo === 'Piscina infinita')!.foto).toContain('/item-piscina-infinita-');
    expect(json.catalogo.find((i) => i.titulo === 'Sofá gigante')!.foto).toContain('/item-img-0001-');
    expect(puts).toHaveLength(4);
    expect(puts.every((p) => p.endsWith('.webp'))).toBe(true);

    // Guardar el borrador con esos enlaces y borrarlo
    await page.getByRole('button', { name: 'Guardar borrador' }).click();
    const row = page.getByTestId('system-template-row').filter({ hasText: `subida-${stamp}` });
    await expect(row).toContainText('casa inicial');
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
  await page.goto('/admin/plantillas');
  await page.getByRole('button', { name: 'Nueva plantilla' }).click();
  await expect(page.getByTestId('template-form')).toBeVisible({ timeout: 60_000 });
  await page.getByLabel('Título', { exact: true }).fill(TV);
  await page.getByLabel('Identificador').fill(`visual-${stamp}`);

  // Escribir con espacios no se «come» el espacio final mientras se teclea
  const nombre = page.getByLabel('Nombre de la partida');
  await nombre.fill('');
  await nombre.pressSequentially('Noche de prueba total');
  await expect(nombre).toHaveValue('Noche de prueba total');

  // Quitar la portada de ejemplo (así no hay imágenes que descargar al publicar) y poner créditos
  await page.locator('#tpl-portada').fill('');
  await page.getByLabel('Créditos de las imágenes').fill('Dibujos propios y Wikimedia Commons');

  // Catálogo: la plantilla vacía trae 3 elementos; añadir uno, renombrarlo, subirlo al principio y quitar otro
  await expect(page.getByTestId('catalog-item')).toHaveCount(3);
  await page.getByRole('button', { name: 'Añadir elemento' }).click();
  await expect(page.getByTestId('catalog-item')).toHaveCount(4);
  await page.getByLabel('Título del elemento 4').fill('Calabaza gigante');
  await page.getByLabel('Crédito de la foto del elemento 4').fill('Autor X · CC BY');
  for (let i = 4; i > 1; i--) await page.getByLabel(`Subir el elemento ${i}`).click();
  await expect(page.getByLabel('Título del elemento 1')).toHaveValue('Calabaza gigante');
  await page.getByLabel('Quitar el elemento 2').click(); // el que era el primero
  await expect(page.getByTestId('catalog-item')).toHaveCount(3);

  // El JSON refleja el formulario (y viceversa)
  const read = async () => JSON.parse(await page.getByLabel('Plantilla JSON', { exact: true }).inputValue()) as { nombre: string; creditos: string; portada?: string | null; catalogo: { titulo: string; credito?: string }[] };
  const json = await read();
  expect(json.nombre).toBe('Noche de prueba total');
  expect(json.creditos).toBe('Dibujos propios y Wikimedia Commons');
  expect(json.catalogo[0]!.titulo).toBe('Calabaza gigante');
  expect(json.catalogo[0]!.credito).toBe('Autor X · CC BY');
  json.catalogo[1]!.titulo = 'Editado en el JSON';
  for (const it of json.catalogo as { foto?: string | null }[]) it.foto = null; // la plantilla vacía trae una foto de ejemplo: sin imágenes no hay nada que descargar al publicar
  await page.getByLabel('Plantilla JSON', { exact: true }).fill(JSON.stringify(json));
  await expect(page.getByLabel('Título del elemento 2')).toHaveValue('Editado en el JSON');

  // Guardar, publicar y ver la tarjeta con sus créditos
  await page.getByRole('button', { name: 'Guardar borrador' }).click();
  const row = page.getByTestId('system-template-row').filter({ hasText: TV });
  await expect(row).toContainText('Borrador');
  await row.getByRole('button', { name: 'Publicar' }).click();
  await expect(row).toContainText('Publicada');
  await page.goto('/new-game');
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
