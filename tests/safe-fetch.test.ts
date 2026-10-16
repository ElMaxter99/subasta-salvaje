import { describe, expect, it } from 'vitest';
import { assertSafeUrl, createSafeLookup, fetchImageBytes, isBlockedAddress, SafeFetchError, type Transport } from '@/lib/security/safe-fetch';

const resp = (status: number, headers: Record<string, string>, chunks: Uint8Array[] = []) => ({
  status,
  headers,
  body: (async function* () { for (const c of chunks) yield c; })(),
  destroy: () => undefined,
});

describe('descarga segura de imágenes (SSRF)', () => {
  it('bloquea direcciones privadas, de bucle, enlace local, CGNAT, metadatos y IPv6 internas', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fe80::1', 'fc00::1', 'fd12::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', 'basura']) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '93.184.216.34', '2606:4700:4700::1111']) expect(isBlockedAddress(ip), ip).toBe(false);
  });

  it('solo URL https de dominios públicos: sin http, credenciales, puertos, IP literales ni nombres internos', () => {
    expect(assertSafeUrl('https://ejemplo.com/a.jpg').hostname).toBe('ejemplo.com');
    for (const bad of ['http://ejemplo.com/a.jpg', 'ftp://ejemplo.com/a', 'javascript:alert(1)', 'file:///etc/passwd', 'https://user:pw@ejemplo.com/a', 'https://ejemplo.com:8443/a', 'https://127.0.0.1/a', 'https://[::1]/a', 'https://169.254.169.254/latest', 'https://localhost/a', 'https://intranet/a', 'https://servidor.local/a', 'https://db.internal/a', 'no es url']) {
      expect(() => assertSafeUrl(bad), bad).toThrow(SafeFetchError);
    }
  });

  it('el lookup anclado rechaza el dominio si CUALQUIERA de sus direcciones es privada (anti DNS rebinding)', async () => {
    const run = (list: { address: string; family: number }[], all = false) =>
      new Promise<{ err: Error | null; address?: unknown }>((res) => createSafeLookup(async () => list)('x.com', { all }, (err, address) => res({ err, address })));
    expect((await run([{ address: '8.8.8.8', family: 4 }])).address).toBe('8.8.8.8');
    expect((await run([{ address: '8.8.8.8', family: 4 }], true)).address).toEqual([{ address: '8.8.8.8', family: 4 }]);
    expect((await run([{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.5', family: 4 }])).err).toBeInstanceOf(SafeFetchError);
    expect((await run([{ address: '127.0.0.1', family: 4 }])).err).toBeInstanceOf(SafeFetchError);
    expect((await run([])).err).toBeInstanceOf(SafeFetchError);
  });

  it('devuelve los bytes de una imagen y revalida cada redirección', async () => {
    const seen: string[] = [];
    const t: Transport = async (u) => {
      seen.push(u.toString());
      if (u.hostname === 'a.com') return resp(302, { location: 'https://b.com/final.png' });
      return resp(200, { 'content-type': 'image/png' }, [new Uint8Array([1, 2]), new Uint8Array([3])]);
    };
    expect([...(await fetchImageBytes('https://a.com/x.png', { transport: t }))]).toEqual([1, 2, 3]);
    expect(seen).toEqual(['https://a.com/x.png', 'https://b.com/final.png']);
    // Una redirección hacia una red interna se rechaza aunque el primer salto sea público
    const evil: Transport = async () => resp(302, { location: 'https://169.254.169.254/latest/meta-data' });
    await expect(fetchImageBytes('https://a.com/x.png', { transport: evil })).rejects.toMatchObject({ reason: 'blocked' });
    const loop: Transport = async () => resp(302, { location: 'https://a.com/otra' });
    await expect(fetchImageBytes('https://a.com/x.png', { transport: loop })).rejects.toMatchObject({ reason: 'status' });
  });

  it('rechaza lo que no es imagen, lo que pesa de más (declarado o real) y los errores HTTP', async () => {
    await expect(fetchImageBytes('https://a.com/x', { transport: async () => resp(200, { 'content-type': 'text/html' }, [new Uint8Array(3)]) })).rejects.toMatchObject({ reason: 'type' });
    await expect(fetchImageBytes('https://a.com/x', { transport: async () => resp(404, {}) })).rejects.toMatchObject({ reason: 'status' });
    await expect(fetchImageBytes('https://a.com/x', { maxBytes: 10, transport: async () => resp(200, { 'content-type': 'image/png', 'content-length': '999' }) })).rejects.toMatchObject({ reason: 'size' });
    await expect(fetchImageBytes('https://a.com/x', { maxBytes: 10, transport: async () => resp(200, { 'content-type': 'image/png' }, [new Uint8Array(6), new Uint8Array(6)]) })).rejects.toMatchObject({ reason: 'size' });
    await expect(fetchImageBytes('https://a.com/x', { transport: async () => { throw Object.assign(new Error('x'), { code: 'ECONNREFUSED' }); } })).rejects.toMatchObject({ reason: 'network' });
  });
});
