import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { assetCdnHosts, urlAllowedByCdn } from '@/lib/config/env';
import type { Transport } from '@/lib/security/safe-fetch';
import { checkTemplateImages, deleteSystemTemplate, getSystemTemplate, listSystemTemplates, saveSystemTemplate, setSystemTemplateStatus } from '@/lib/services/system-template-service';
import { makeCtx, type TestCtx } from './helpers';

let ctx: TestCtx;
let webp: Uint8Array;
let bigPng: Uint8Array;
beforeAll(async () => {
  ctx = await makeCtx();
  webp = new Uint8Array(await sharp({ create: { width: 200, height: 200, channels: 3, background: '#cc3333' } }).webp().toBuffer());
  bigPng = new Uint8Array(await sharp({ create: { width: 2000, height: 1500, channels: 3, background: '#3333cc' } }).png().toBuffer());
});
afterAll(async () => {
  await ctx.db.close();
});

const HOSTS = ['cdn.ejemplo.com'];
const tpl = (extra: Record<string, unknown> = {}) => ({
  formato: 'subasta-salvaje/plantilla@1', nombre: 'Noche de playa', tematica: 'Casa',
  reglas: { presupuesto: 20, puja_minima: 1, rondas_maximas: 2, modo_imagenes: 'pegatinas' },
  portada: 'https://cdn.ejemplo.com/portada.webp', casa_inicial: 'https://cdn.ejemplo.com/casa.webp',
  catalogo: [{ titulo: 'Sombrilla', descripcion: 'Roja', emoji: '⛱️', foto: 'https://cdn.ejemplo.com/sombrilla.webp' }, { titulo: 'Hamaca', descripcion: '', emoji: null, foto: null }],
  ...extra,
});
const body = (over: Record<string, unknown> = {}) => ({ slug: 'noche-playa', title: 'Noche de playa', description: 'Una partida veraniega', data: tpl(), ...over });
const serve = (map: Record<string, { bytes: Uint8Array; type?: string; status?: number }>): Transport => async (u) => {
  const hit = map[u.pathname];
  return { status: hit?.status ?? (hit ? 200 : 404), headers: { 'content-type': hit?.type ?? 'image/webp' }, body: (async function* () { if (hit) yield hit.bytes; })(), destroy: () => undefined };
};

describe('lista blanca de servidores de fotos', () => {
  it('sin lista acepta cualquier https; con lista solo esos servidores y sin credenciales', () => {
    expect(assetCdnHosts({ ASSET_CDN_HOSTS: ' CDN.ejemplo.com , otro.com ' } as never)).toEqual(['cdn.ejemplo.com', 'otro.com']);
    expect(urlAllowedByCdn('https://cualquiera.com/a.png', [])).toBe(true);
    expect(urlAllowedByCdn('http://cdn.ejemplo.com/a.png', [])).toBe(false);
    expect(urlAllowedByCdn('https://cdn.ejemplo.com/a.png', HOSTS)).toBe(true);
    expect(urlAllowedByCdn('https://evil.com/a.png', HOSTS)).toBe(false);
    expect(urlAllowedByCdn('https://user:pw@cdn.ejemplo.com/a.png', HOSTS)).toBe(false);
    expect(urlAllowedByCdn('https://cdn.ejemplo.com.evil.com/a.png', HOSTS)).toBe(false);
  });
});

describe('plantillas del sistema (SQL + servicio)', () => {
  it('borrador → solo el superadmin lo ve; publicada → la ven los anfitriones; retirada → vuelve a ser borrador', async () => {
    process.env.ASSET_CDN_HOSTS = HOSTS.join(',');
    try {
      const saved = await saveSystemTemplate(ctx, 'admin@x.com', body());
      expect(saved).toMatchObject({ slug: 'noche-playa', status: 'draft', items: 2, has_initial_image: true, cover_url: 'https://cdn.ejemplo.com/portada.webp' });
      expect(await listSystemTemplates(ctx)).toHaveLength(0);
      expect(await listSystemTemplates(ctx, { admin: true })).toHaveLength(1);
      await expect(getSystemTemplate(ctx, saved.id)).rejects.toMatchObject({ code: 'template_not_found' });
      expect((await getSystemTemplate(ctx, saved.id, { admin: true })).data.nombre).toBe('Noche de playa');

      const transport = serve({ '/portada.webp': { bytes: webp }, '/casa.webp': { bytes: webp }, '/sombrilla.webp': { bytes: webp } });
      const pub = await setSystemTemplateStatus(ctx, 'admin@x.com', saved.id, 'published', { transport });
      expect(pub.template.status).toBe('published');
      expect(pub.checks.every((c) => c.ok && c.internal)).toBe(true);
      expect((await listSystemTemplates(ctx)).map((t) => t.slug)).toEqual(['noche-playa']);
      expect((await getSystemTemplate(ctx, 'noche-playa')).data.casa_inicial).toBe('https://cdn.ejemplo.com/casa.webp'); // por slug también

      await setSystemTemplateStatus(ctx, 'admin@x.com', saved.id, 'draft');
      expect(await listSystemTemplates(ctx)).toHaveLength(0);

      await deleteSystemTemplate(ctx, 'admin@x.com', saved.id);
      await expect(getSystemTemplate(ctx, saved.id, { admin: true })).rejects.toMatchObject({ code: 'template_not_found' });
      const audit = await ctx.db.pg.query<{ action: string }>("select action from admin_audit where action like 'system_template_%' order by id");
      expect(audit.rows.map((r) => r.action)).toEqual(['system_template_created', 'system_template_published', 'system_template_unpublished', 'system_template_deleted']);
    } finally {
      delete process.env.ASSET_CDN_HOSTS;
    }
  });

  it('no se puede publicar con una imagen rota o inalcanzable (y la plantilla sigue siendo borrador)', async () => {
    process.env.ASSET_CDN_HOSTS = HOSTS.join(',');
    try {
      const saved = await saveSystemTemplate(ctx, 'a', body({ slug: 'con-imagen-rota' }));
      const transport = serve({ '/portada.webp': { bytes: webp }, '/casa.webp': { bytes: new Uint8Array([1, 2, 3]) } /* sombrilla: 404 */ });
      await expect(setSystemTemplateStatus(ctx, 'a', saved.id, 'published', { transport })).rejects.toMatchObject({ code: 'template_images_failed' });
      expect((await getSystemTemplate(ctx, saved.id, { admin: true })).status).toBe('draft');
    } finally {
      delete process.env.ASSET_CDN_HOSTS;
    }
  });

  it('una foto fuera del formato interno se acepta pero se avisa; el informe indica tamaño y formato', async () => {
    const checks = await checkTemplateImages(tpl() as never, { hosts: HOSTS, transport: serve({ '/portada.webp': { bytes: webp }, '/casa.webp': { bytes: bigPng, type: 'image/png' }, '/sombrilla.webp': { bytes: webp } }) });
    expect(checks.map((c) => c.ok)).toEqual([true, true, true]);
    const casa = checks.find((c) => c.label === 'Casa inicial')!;
    expect(casa).toMatchObject({ internal: false, format: 'png', width: 2000, height: 1500 });
    expect(casa.note).toMatch(/assets:normalize/);
    expect(checks.find((c) => c.label === 'Portada')!.internal).toBe(true);
  });

  it('valida el contenido: servidor no permitido, slug repetido, formato incorrecto y plantilla enorme', async () => {
    process.env.ASSET_CDN_HOSTS = HOSTS.join(',');
    try {
      await expect(saveSystemTemplate(ctx, 'a', body({ slug: 'otro', data: tpl({ casa_inicial: 'https://evil.com/c.webp' }) }))).rejects.toThrow(/ASSET_CDN_HOSTS/);
      await expect(saveSystemTemplate(ctx, 'a', body({ slug: 'otro', data: tpl({ formato: 'x' }) }))).rejects.toMatchObject({ code: 'invalid_input' });
      await expect(saveSystemTemplate(ctx, 'a', body({ slug: 'Mal Slug!' }))).rejects.toMatchObject({ code: 'invalid_input' });
      const a = await saveSystemTemplate(ctx, 'a', body({ slug: 'repetido' }));
      await expect(saveSystemTemplate(ctx, 'a', body({ slug: 'repetido' }))).rejects.toMatchObject({ code: 'slug_taken' });
      // editar la misma (por id) con su propio slug sí vale
      expect((await saveSystemTemplate(ctx, 'a', body({ id: a.id, slug: 'repetido', title: 'Nuevo título' }))).title).toBe('Nuevo título');
      await expect(saveSystemTemplate(ctx, 'a', body({ slug: 'grande', data: tpl({ catalogo: Array.from({ length: 5 }, () => ({ titulo: 'x'.repeat(80), descripcion: 'y'.repeat(500) })), extra: 'z'.repeat(600_000) }) }))).rejects.toMatchObject({ code: 'template_too_large' });
    } finally {
      delete process.env.ASSET_CDN_HOSTS;
    }
  });
});
