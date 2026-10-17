import { withComposedEdit } from './compose';
import { ProviderError, type EditSceneInput, type GeneratedImage, type ImageGenerationProvider, type InitialSceneInput, type ItemImageInput, type ProviderErrorKind } from './types';

/**
 * Cadena de proveedores GRATUITOS (o propios) con fallback. Es un proveedor más: `jobs-service` no sabe que hay varios.
 *
 *  · Prueba los proveedores en orden. Si uno falla por cuota, límite de ritmo, credenciales, red, servidor o falta de
 *    capacidad, pasa al siguiente. Moderación, entrada inválida o error desconocido NO saltan: el mismo contenido se
 *    rechazaría igual y no se reparte por varios terceros.
 *  · Un proveedor que falla así queda en «enfriamiento» en memoria (hasta las 00:00 UTC si es cuota diaria) para no gastar
 *    peticiones en él. Es una optimización: la verdad de la cuota está en SQL y el enfriamiento se pierde al reiniciar.
 *  · Para editar, si ningún proveedor edita (o todos los que editan fallan de forma saltable), se hace la «edición» por
 *    composición con el objeto generado por el siguiente proveedor disponible.
 *  · La cuota local se reserva UNA vez por trabajo (con el `id` del primer proveedor): cuenta trabajos de IA, no intentos.
 *  · Los proveedores de PAGO no entran aquí (exigen tope de gasto; ver docs/PLAN-PROVEEDORES-IA.md, fase 5).
 */
export const SKIPPABLE: ReadonlySet<ProviderErrorKind> = new Set(['quota', 'rate_limit', 'auth', 'network', 'server', 'unsupported']);

export interface ChainOptions {
  now?: () => number;
  /** Aviso de cada salto (para registro); nunca incluye contenido de las peticiones. */
  onSkip?: (info: { provider: string; kind: ProviderErrorKind; message: string }) => void;
}

/** Cuánto esperar antes de volver a probar un proveedor según el motivo del fallo. */
export function cooldownUntil(kind: ProviderErrorKind, now: number): number {
  if (kind === 'quota') {
    const d = new Date(now);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1); // se renueva a las 00:00 UTC
  }
  if (kind === 'auth') return now + 10 * 60_000;
  if (kind === 'rate_limit') return now + 60_000;
  return now + 30_000; // red, servidor, sin capacidad
}

export function createProviderChain(members: ImageGenerationProvider[], opts: ChainOptions = {}): ImageGenerationProvider {
  if (members.length === 0) throw new Error('La cadena necesita al menos un proveedor');
  if (members.length === 1) return members[0]!; // sin cambio de comportamiento con un solo proveedor
  const now = opts.now ?? Date.now;
  const cooling = new Map<string, number>();

  const available = (p: ImageGenerationProvider) => (cooling.get(p.id) ?? 0) <= now();

  async function run<T extends GeneratedImage>(needsEdit: boolean, call: (p: ImageGenerationProvider) => Promise<T>): Promise<T> {
    const candidates = members.filter((m) => (!needsEdit || m.capabilities.edit) && available(m));
    let last: ProviderError | null = null;
    for (const p of candidates) {
      try {
        const out = await call(p);
        return { ...out, provider: p.id };
      } catch (e) {
        if (!(e instanceof ProviderError) || !SKIPPABLE.has(e.kind)) throw e; // moderación, entrada inválida…: no se reparte
        last = e;
        cooling.set(p.id, cooldownUntil(e.kind, now()));
        opts.onSkip?.({ provider: p.id, kind: e.kind, message: e.message });
      }
    }
    if (last) throw last;
    throw new ProviderError('Ningún proveedor de imágenes está disponible ahora mismo (en enfriamiento o sin capacidad). Se conserva la imagen anterior.', true, false, 'unsupported');
  }

  const self: ImageGenerationProvider = {
    id: members[0]!.id,
    capabilities: { edit: true }, // siempre hay composición como último recurso
    generateInitialScene: (i: InitialSceneInput) => run(false, (p) => p.generateInitialScene(i)),
    generateItemImage: (i: ItemImageInput) => run(false, (p) => p.generateItemImage(i)),
    async editScene(input: EditSceneInput): Promise<GeneratedImage> {
      const editors = members.some((m) => m.capabilities.edit && available(m));
      if (editors) {
        try {
          return await run(true, (p) => p.editScene(input));
        } catch (e) {
          if (!(e instanceof ProviderError) || !SKIPPABLE.has(e.kind)) throw e;
          opts.onSkip?.({ provider: 'chain', kind: e.kind, message: 'edición real no disponible: se usa la composición' });
        }
      }
      // Plan B: composición con el objeto del siguiente proveedor que pueda generar (o con la foto del elemento).
      const generator: ImageGenerationProvider = { ...self, capabilities: { edit: false } };
      const composed = await withComposedEdit(generator).editScene(input);
      return { ...composed, provider: composed.provider ?? self.id };
    },
  };
  return self;
}
