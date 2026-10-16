import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { catalogToCsv, parseCatalogCsv } from '@/lib/domain/template-csv';
import { parseTemplateZip, readZip } from '@/lib/domain/template-zip';
import { blankTemplate } from '@/lib/domain/template';
import { makeZip } from './helpers-zip';

describe('catálogo en CSV', () => {
  it('lee cabecera, comillas, saltos de línea, BOM y el separador de Excel en español (;)', () => {
    const csv = '﻿titulo;descripcion;emoji;foto\r\nPiscina;"Con agua; turquesa";🏊;https://x.com/p.jpg\r\n"Sofá ""XL""";"Línea 1\nLínea 2";🛋️;\r\nChimenea;;;\r\n';
    const r = parseCatalogCsv(csv);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.items.map((i) => i.name)).toEqual(['Piscina', 'Sofá "XL"', 'Chimenea']);
    expect(r.items[0]).toMatchObject({ description: 'Con agua; turquesa', emoji: '🏊', photoUrl: 'https://x.com/p.jpg' });
    expect(r.items[1]!.description).toBe('Línea 1 Línea 2');
    expect(r.items[2]).toMatchObject({ emoji: null, photoUrl: null });
  });

  it('acepta comas y tabuladores y alias de columnas (nombre, imagen…)', () => {
    const r = parseCatalogCsv('Nombre,Imagen\nVolcán,https://x.com/v.png\nMuelle,\n');
    expect(r.ok && r.items.map((i) => [i.name, i.photoUrl])).toEqual([['Volcán', 'https://x.com/v.png'], ['Muelle', null]]);
    const t = parseCatalogCsv('titulo\tdescripcion\nA\tuna\n');
    expect(t.ok && t.items[0]!.description).toBe('una');
  });

  it('errores por fila de la hoja y avisos (no bloquean) para fotos no https y títulos repetidos', () => {
    expect(parseCatalogCsv('descripcion\nx\n')).toMatchObject({ ok: false, errors: [expect.stringContaining('titulo')] });
    expect(parseCatalogCsv('titulo\n')).toMatchObject({ ok: false });
    const bad = parseCatalogCsv('titulo;emoji\nBien;🙂\n;🙂\n' + 'x'.repeat(81) + ';🙂\n');
    expect(bad).toMatchObject({ ok: false });
    if (!bad.ok) expect(bad.errors.join(' ')).toMatch(/Fila 3.*título/);
    const warn = parseCatalogCsv('titulo;foto\nA;http://inseguro.com/a.jpg\nA;fotos/a.jpg\n');
    expect(warn.ok).toBe(true);
    if (warn.ok) {
      expect(warn.warnings.join('\n')).toMatch(/Fila 2.*https/);
      expect(warn.warnings.join('\n')).toMatch(/mismo título/);
      expect(warn.items.every((i) => i.photoUrl === null && i.photoPath === null)).toBe(true); // fuera de un ZIP las rutas se ignoran
    }
    const inZip = parseCatalogCsv('titulo;foto\nA;fotos/a.jpg\n', { zip: true });
    expect(inZip.ok && inZip.items[0]!.photoPath).toBe('fotos/a.jpg');
    expect(parseCatalogCsv('titulo\n' + Array.from({ length: 101 }, (_, i) => `E${i}`).join('\n'))).toMatchObject({ ok: false });
  });

  it('exportar y volver a leer conserva títulos, descripciones con ; y emojis', () => {
    const csv = catalogToCsv([{ name: 'Sofá; "XL"', description: 'Con\nsalto', emoji: '🛋️' }, { name: 'B', description: '', emoji: null }]);
    const r = parseCatalogCsv(csv);
    expect(r.ok && r.items.map((i) => i.name)).toEqual(['Sofá; "XL"', 'B']);
  });
});

describe('plantilla en ZIP (con fotos incrustadas)', () => {
  it('lee plantilla.json y resuelve las fotos de fotos/ (stored y deflate)', async () => {
    const png = new Uint8Array(await sharp({ create: { width: 8, height: 8, channels: 3, background: '#33aa33' } }).png().toBuffer());
    const t = { ...blankTemplate(), catalogo: [{ titulo: 'Sofá', descripcion: '', emoji: '🛋️', foto: 'fotos/sofa.png' }, { titulo: 'Piscina', descripcion: '', emoji: null, foto: 'piscina.png' }, { titulo: 'Falta', descripcion: '', emoji: null, foto: 'fotos/no-existe.jpg' }, { titulo: 'Web', descripcion: '', emoji: null, foto: 'https://x.com/w.jpg' }] };
    for (const deflate of [false, true]) {
      const zip = makeZip({ 'plantilla.json': JSON.stringify(t), 'fotos/sofa.png': png, 'fotos/piscina.png': png, '__MACOSX/._x': 'basura', 'fotos/.oculto': 'x' }, { deflate });
      const r = await parseTemplateZip(zip);
      expect(r.ok, `deflate=${deflate}`).toBe(true);
      if (!r.ok) return;
      const items = r.values.items!;
      expect(items[0]!.photoFile).toMatchObject({ type: 'image/png', name: 'fotos/sofa.png' });
      expect([...items[0]!.photoFile!.data]).toEqual([...png]);
      expect(items[1]!.photoFile?.name).toBe('fotos/piscina.png'); // «piscina.png» se busca también en fotos/
      expect(items[2]!.photoFile).toBeNull();
      expect(items[3]).toMatchObject({ photoUrl: 'https://x.com/w.jpg', photoFile: null });
      expect(r.warnings.join('\n')).toMatch(/no se encontró la foto «fotos\/no-existe\.jpg»/);
    }
  });

  it('errores: no es ZIP, sin plantilla.json, JSON inválido, contraseña, compresión rara, demasiados archivos o foto enorme', async () => {
    expect(await parseTemplateZip(new Uint8Array([1, 2, 3]))).toMatchObject({ ok: false, errors: [expect.stringContaining('ZIP válido')] });
    expect(await parseTemplateZip(makeZip({ 'otra.txt': 'x' }))).toMatchObject({ ok: false, errors: [expect.stringContaining('plantilla.json')] });
    expect(await parseTemplateZip(makeZip({ 'plantilla.json': '{ roto' }))).toMatchObject({ ok: false, errors: [expect.stringContaining('JSON')] });
    expect(await parseTemplateZip(makeZip({ 'plantilla.json': '{}' }, { flags: 1 }))).toMatchObject({ ok: false, errors: [expect.stringContaining('contraseña')] });
    const many = Object.fromEntries(Array.from({ length: 301 }, (_, i) => [`f${i}.txt`, 'x']));
    await expect(readZip(makeZip(many))).rejects.toThrow(/demasiados/);
    await expect(readZip(makeZip({ 'fotos/grande.png': new Uint8Array(8 * 1024 * 1024) }))).rejects.toThrow(/demasiado grande/);
  });

  it('una «zip bomb» (declara poco y descomprime mucho) se corta por el tamaño real', async () => {
    const bomb = makeZip({ 'fotos/b.png': new Uint8Array(7 * 1024 * 1024 + 10) }, { deflate: true });
    // El escritor declara el tamaño real; falsificamos el declarado a 1 KB para simular una bomba
    const view = new DataView(bomb.buffer, bomb.byteOffset);
    for (let i = 0; i < bomb.length - 4; i++) {
      if (view.getUint32(i, true) === 0x02014b50) view.setUint32(i + 24, 1024, true);
    }
    await expect(readZip(bomb)).rejects.toThrow(/demasiado grande/);
  });
});
