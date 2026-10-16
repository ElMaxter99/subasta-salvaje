import dns from 'node:dns';
import https from 'node:https';
import net from 'node:net';
import type { IncomingHttpHeaders } from 'node:http';

/**
 * Descarga SEGURA de imágenes desde una URL que da el usuario (fotos de plantillas). Defiende contra SSRF:
 *  · solo https, sin credenciales ni puertos raros, sin IP literales ni «localhost»;
 *  · la conexión se ANCLA a la IP ya comprobada (el `lookup` valida y es lo que usa el socket: sin «DNS rebinding»);
 *  · se rechazan direcciones privadas, de bucle, enlace local, CGNAT y metadatos de la nube (IPv4 e IPv6);
 *  · redirecciones manuales (máx. 3), cada salto se revalida; tiempo y tamaño máximos.
 * El contenido NO se da por bueno: quien lo use debe validar que de verdad es una imagen (`validateImage`).
 */
export class SafeFetchError extends Error {
  constructor(public readonly reason: 'url' | 'blocked' | 'status' | 'size' | 'type' | 'timeout' | 'network', message: string) {
    super(message);
    this.name = 'SafeFetchError';
  }
}

export interface TransportResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: AsyncIterable<Uint8Array>;
  destroy: () => void;
}
export type Transport = (url: URL, opts: { timeoutMs: number }) => Promise<TransportResponse>;

/** ¿Es una IP que nunca debe alcanzarse desde el servidor? */
export function isBlockedAddress(ip: string): boolean {
  const v = net.isIP(ip);
  if (v === 4) {
    const [a = 0, b = 0, c = 0] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 || // «esta red», privada, bucle, multicast y reservadas
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 169 && b === 254) || // enlace local y metadatos de la nube (169.254.169.254)
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && c === 0) || // IETF
      (a === 198 && (b === 18 || b === 19)) || // pruebas de rendimiento
      (a === 192 && b === 0 && c === 2) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113) // documentación
    );
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4 dentro de IPv6
    if (mapped) return isBlockedAddress(mapped[1]!);
    const first = parseInt(s.split(':')[0] || '0', 16);
    return s === '::' || s === '::1' || (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00 || s.startsWith('2001:db8') || s.startsWith('64:ff9b');
  }
  return true; // lo que no es una IP válida no se acepta
}

/** Comprueba la URL antes de conectar. Devuelve la URL normalizada o lanza SafeFetchError('url'|'blocked'). */
export function assertSafeUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new SafeFetchError('url', 'La URL no es válida.');
  }
  if (u.protocol !== 'https:') throw new SafeFetchError('url', 'Solo se admiten URL https://.');
  if (u.username || u.password) throw new SafeFetchError('url', 'La URL no puede llevar usuario ni contraseña.');
  if (u.port && u.port !== '443') throw new SafeFetchError('url', 'Solo se admite el puerto estándar (443).');
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (net.isIP(host)) throw new SafeFetchError('blocked', 'No se admiten direcciones IP, solo nombres de dominio.');
  if (host === 'localhost' || !host.includes('.') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')) throw new SafeFetchError('blocked', 'Ese dominio no es público.');
  return u;
}

type Resolver = (hostname: string) => Promise<{ address: string; family: number }[]>;
const defaultResolver: Resolver = (h) => dns.promises.lookup(h, { all: true, verbatim: true });

/** `lookup` para https.request: resuelve, rechaza si ALGUNA dirección es bloqueada y devuelve la que se usará para conectar. */
export function createSafeLookup(resolve: Resolver = defaultResolver) {
  return (hostname: string, options: { all?: boolean }, cb: (err: Error | null, address?: unknown, family?: number) => void) => {
    resolve(hostname).then(
      (list) => {
        if (list.length === 0 || list.some((a) => isBlockedAddress(a.address))) return cb(new SafeFetchError('blocked', 'Ese dominio apunta a una dirección no permitida.'));
        if (options?.all) cb(null, list);
        else cb(null, list[0]!.address, list[0]!.family);
      },
      (e: Error) => cb(e),
    );
  };
}

const httpsTransport: Transport = (url, { timeoutMs }) =>
  new Promise((resolve, reject) => {
    const req = https.request(
      url,
      { method: 'GET', timeout: timeoutMs, lookup: createSafeLookup() as never, headers: { 'User-Agent': 'SubastaSalvaje-plantillas/1', Accept: 'image/png,image/jpeg,image/webp,image/*;q=0.5' } },
      (res) => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: res as AsyncIterable<Uint8Array>, destroy: () => res.destroy() }),
    );
    req.on('timeout', () => req.destroy(new SafeFetchError('timeout', 'La descarga tardó demasiado.')));
    req.on('error', reject);
    req.end();
  });

export interface FetchImageOptions {
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  transport?: Transport;
}

/** Descarga los bytes de una imagen. Lanza SafeFetchError con un motivo concreto. */
export async function fetchImageBytes(rawUrl: string, { maxBytes = 7 * 1024 * 1024, timeoutMs = 8000, maxRedirects = 3, transport = httpsTransport }: FetchImageOptions = {}): Promise<Uint8Array> {
  let url = assertSafeUrl(rawUrl);
  for (let hop = 0; hop <= maxRedirects; hop++) {
    let res: TransportResponse;
    try {
      res = await transport(url, { timeoutMs });
    } catch (e) {
      if (e instanceof SafeFetchError) throw e;
      const code = (e as { code?: string }).code;
      throw new SafeFetchError(code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT' ? 'timeout' : 'network', 'No se pudo conectar con ese servidor.');
    }
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      res.destroy();
      const loc = res.headers.location;
      if (!loc) throw new SafeFetchError('status', 'Redirección sin destino.');
      url = assertSafeUrl(new URL(loc, url).toString()); // cada salto se revalida
      continue;
    }
    if (res.status !== 200) {
      res.destroy();
      throw new SafeFetchError('status', `El servidor respondió ${res.status}.`);
    }
    const type = String(res.headers['content-type'] ?? '').toLowerCase();
    if (!type.startsWith('image/')) {
      res.destroy();
      throw new SafeFetchError('type', 'La URL no es una imagen.');
    }
    const declared = Number(res.headers['content-length'] ?? 0);
    if (declared > maxBytes) {
      res.destroy();
      throw new SafeFetchError('size', 'La imagen supera el máximo de 7 MB.');
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    const timer = setTimeout(() => res.destroy(), timeoutMs * 2);
    try {
      for await (const c of res.body) {
        total += c.length;
        if (total > maxBytes) {
          res.destroy();
          throw new SafeFetchError('size', 'La imagen supera el máximo de 7 MB.');
        }
        chunks.push(c);
      }
    } catch (e) {
      if (e instanceof SafeFetchError) throw e;
      throw new SafeFetchError('network', 'Se cortó la descarga.');
    } finally {
      clearTimeout(timer);
    }
    return Buffer.concat(chunks);
  }
  throw new SafeFetchError('status', 'Demasiadas redirecciones.');
}
