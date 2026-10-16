import { describe, expect, it } from 'vitest';
import { blankTemplate, CUSTOM_THEME, parseTemplate, templateFromSnapshot, templateToForm, TEMPLATE_FORMAT } from '@/lib/domain/template';
import { createGameSchema } from '@/lib/domain/schemas';

const ok = (o: unknown) => parseTemplate(JSON.stringify(o));
const base = { formato: TEMPLATE_FORMAT, nombre: 'Mi partida', tematica: 'Casa' };

describe('plantillas de partida', () => {
  it('la plantilla vacía de ejemplo es válida y se convierte a valores del asistente', () => {
    const r = parseTemplate(JSON.stringify(blankTemplate()));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const f = templateToForm(r.template);
    expect(f).toMatchObject({ name: 'Noche de Subasta Salvaje', themeChoice: 'house', budget: '20', minBid: '1', maxRounds: '3', integerBids: true, ranking: 'none', playMode: 'mobile', imageMode: 'stickers' });
    expect(f.players).toEqual(['Ana', 'Beto']);
    expect(f.items).toHaveLength(3);
    expect(f.items![1]).toMatchObject({ name: 'Sofá gigante', photoUrl: 'https://ejemplo.com/fotos/sofa.jpg' });
    expect(f.items![0]!.photoUrl).toBeNull();
  });

  it('lo mínimo (formato, nombre y temática) basta; el resto toma valores por defecto', () => {
    const r = ok(base);
    expect(r.ok).toBe(true);
    if (r.ok) expect(templateToForm(r.template)).toMatchObject({ budget: '20', playMode: 'host', items: null, players: [] });
  });

  it('una temática libre se carga como «otra»; una predefinida se reconoce por id o etiqueta', () => {
    const libre = ok({ ...base, tematica: 'Base lunar' });
    if (libre.ok) expect(templateToForm(libre.template)).toMatchObject({ themeChoice: CUSTOM_THEME, customTheme: 'Base lunar' });
    const isla = ok({ ...base, tematica: 'isla desierta' });
    if (isla.ok) expect(templateToForm(isla.template).themeChoice).toBe('island');
  });

  it('los importes en euros admiten decimales y coma en el formulario', () => {
    const r = ok({ ...base, reglas: { presupuesto: 12.5, puja_minima: 0.5, pujas_enteras: false } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(templateToForm(r.template)).toMatchObject({ budget: '12,5', minBid: '0,5', integerBids: false });
  });

  it('errores legibles: JSON roto, formato equivocado, campos obligatorios y por elemento', () => {
    expect(parseTemplate('{ no es json')).toMatchObject({ ok: false, errors: [expect.stringContaining('JSON válido')] });
    expect(parseTemplate('[]')).toMatchObject({ ok: false });
    const f = ok({ ...base, formato: 'otro' });
    expect(f).toMatchObject({ ok: false, errors: [expect.stringContaining('formato')] });
    const n = ok({ formato: TEMPLATE_FORMAT, tematica: 'Casa' });
    expect(n.ok).toBe(false);
    if (!n.ok) expect(n.errors.join(' ')).toMatch(/nombre/i);
    const c = ok({ ...base, catalogo: [{ titulo: 'Bien' }, { titulo: '' }, { descripcion: 'sin título' }] });
    expect(c.ok).toBe(false);
    if (!c.ok) {
      expect(c.errors.join('\n')).toContain('Elemento 2 del catálogo');
      expect(c.errors.join('\n')).toContain('Elemento 3 del catálogo');
    }
  });

  it('límites: demasiados elementos o jugadores, nombres repetidos y puja mínima con céntimos y pujas enteras', () => {
    expect(ok({ ...base, catalogo: Array.from({ length: 101 }, (_, i) => ({ titulo: `E${i}` })) }).ok).toBe(false);
    expect(ok({ ...base, jugadores: Array.from({ length: 13 }, (_, i) => `J${i}`) }).ok).toBe(false);
    expect(ok({ ...base, jugadores: ['Ana', 'ana'] })).toMatchObject({ ok: false, errors: [expect.stringContaining('repetidos')] });
    expect(ok({ ...base, reglas: { puja_minima: 1.5 } })).toMatchObject({ ok: false, errors: [expect.stringContaining('euro entero')] });
    expect(ok({ ...base, reglas: { puja_minima: 1.5, pujas_enteras: false } }).ok).toBe(true);
  });

  it('avisos: campos desconocidos, fotos que no son https, rondas por encima del catálogo (no bloquean)', () => {
    const r = ok({ ...base, extra: 1, reglas: { rondas_maximas: 9 }, catalogo: [{ titulo: 'A', foto: 'http://inseguro.com/a.jpg' }, { titulo: 'B', foto: 'javascript:alert(1)' }] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings.join('\n')).toMatch(/desconocido «extra»/);
    expect(r.warnings.join('\n')).toMatch(/Elemento 1.*https/);
    expect(r.warnings.join('\n')).toMatch(/rondas máximas/);
    expect(templateToForm(r.template).items!.map((i) => i.photoUrl)).toEqual([null, null]); // solo https
  });

  it('el texto se limpia (control, invisibles) y el archivo enorme se rechaza', () => {
    const r = ok({ ...base, nombre: '  Mi​   partida\u0007  ' });
    if (r.ok) expect(r.template.nombre).toBe('Mi partida');
    expect(parseTemplate('x'.repeat(600 * 1024))).toMatchObject({ ok: false });
  });

  it('lo que genera el asistente a partir de una plantilla es aceptado por createGameSchema', () => {
    const r = parseTemplate(JSON.stringify(blankTemplate()));
    if (!r.ok) throw new Error('inválida');
    const f = templateToForm(r.template);
    const input = createGameSchema.safeParse({
      name: f.name, theme: 'house', initial_budget_cents: 2000, min_bid_cents: 100, play_mode: f.playMode, image_mode: f.imageMode, max_rounds: 3, integer_bids: f.integerBids,
      players: f.players.map((name) => ({ name })), items: f.items!.map((i) => ({ name: i.name, description: i.description, emoji: i.emoji })),
    });
    expect(input.success).toBe(true);
  });

  it('exportar una partida produce una plantilla válida (sin fotos) que se puede volver a importar', () => {
    const t = templateFromSnapshot({
      game: { name: 'Exportada', theme: 'island', initial_budget_cents: 1550, min_bid_cents: 100, total_rounds: 2, integer_bids: true, ranking_rule: 'votes', play_mode: 'mobile', image_mode: 'ai' },
      players: [{ name: 'Ana' }, { name: 'Beto' }],
      items: [{ name: 'Volcán', description: 'Humea', emoji: '🌋' }, { name: 'Muelle', description: '', emoji: null }],
    } as never);
    const r = parseTemplate(JSON.stringify(t));
    expect(r.ok).toBe(true);
    if (r.ok) expect(templateToForm(r.template)).toMatchObject({ budget: '15,5', ranking: 'votes', playMode: 'mobile', imageMode: 'ai', themeChoice: 'island', maxRounds: '2' });
  });
});
