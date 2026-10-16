import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { blankTemplate } from '@/lib/domain/template';
import { adminUserOp } from '@/lib/services/admin-service';
import { deleteTemplate, getTemplate, listTemplates, saveTemplate } from '@/lib/services/template-store';
import { makeCtx, newHost, type TestCtx } from './helpers';

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await makeCtx();
});
afterAll(async () => {
  await ctx.db.close();
});

describe('plantillas guardadas del anfitrión', () => {
  it('guarda, lista con resumen, recupera idéntica y la sustituye al guardar con el mismo nombre (sin distinguir mayúsculas)', async () => {
    const host = newHost();
    const t = blankTemplate();
    const saved = await saveTemplate(ctx, host, ' Mi plantilla ', t);
    expect(saved).toMatchObject({ name: 'Mi plantilla', replaced: false });
    let list = await listTemplates(ctx, host);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'Mi plantilla', items: 3, players: 2 });
    expect((await getTemplate(ctx, host, saved.id)).data).toEqual(JSON.parse(JSON.stringify(t)));

    const again = await saveTemplate(ctx, host, 'MI PLANTILLA', { ...t, nombre: 'Cambiada', catalogo: [{ titulo: 'Solo uno', descripcion: '', emoji: null, foto: null }] });
    expect(again).toMatchObject({ id: saved.id, replaced: true });
    list = await listTemplates(ctx, host);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'MI PLANTILLA', items: 1 });
    expect((await getTemplate(ctx, host, saved.id)).data.nombre).toBe('Cambiada');
  });

  it('cada anfitrión solo ve y toca las suyas', async () => {
    const a = newHost();
    const b = newHost();
    const { id } = await saveTemplate(ctx, a, 'De A', blankTemplate());
    expect(await listTemplates(ctx, b)).toEqual([]);
    await expect(getTemplate(ctx, b, id)).rejects.toMatchObject({ code: 'template_not_found' });
    await expect(deleteTemplate(ctx, b, id)).rejects.toMatchObject({ code: 'template_not_found' });
    await saveTemplate(ctx, b, 'De A', blankTemplate()); // mismo nombre en otro anfitrión: son independientes
    expect(await listTemplates(ctx, a)).toHaveLength(1);
    await deleteTemplate(ctx, a, id);
    expect(await listTemplates(ctx, a)).toEqual([]);
    expect(await listTemplates(ctx, b)).toHaveLength(1);
  });

  it('valida: nombre vacío o enorme, plantilla inválida y demasiado grande; máximo 20 por anfitrión', async () => {
    const host = newHost();
    await expect(saveTemplate(ctx, host, '   ', blankTemplate())).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(saveTemplate(ctx, host, 'x'.repeat(81), blankTemplate())).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(saveTemplate(ctx, host, 'Mala', { formato: 'otro' })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(saveTemplate(ctx, host, 'Nula', null)).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(saveTemplate(ctx, host, 'Grande', { ...blankTemplate(), extra: 'x'.repeat(600 * 1024) })).rejects.toMatchObject({ code: 'template_too_large' });
    for (let i = 0; i < 20; i++) await saveTemplate(ctx, host, `P${i}`, blankTemplate());
    await expect(saveTemplate(ctx, host, 'P20', blankTemplate())).rejects.toMatchObject({ code: 'template_limit' });
    await saveTemplate(ctx, host, 'p3', blankTemplate()); // sustituir una existente sí se puede con el cupo lleno
    expect(await listTemplates(ctx, host)).toHaveLength(20);
  });

  it('al borrar al usuario desde el superadmin se borran también sus plantillas', async () => {
    const host = randomUUID();
    await ctx.db.rpc('ss_host_access', { user_id: host, email: 'borrar@x.es' });
    await saveTemplate(ctx, host, 'Mía', blankTemplate());
    expect(await listTemplates(ctx, host)).toHaveLength(1);
    await adminUserOp(ctx, { id: randomUUID(), email: 'root' }, { op: 'delete', user_id: host, confirm: 'borrar@x.es' });
    expect(await listTemplates(ctx, host)).toEqual([]);
  });
});
