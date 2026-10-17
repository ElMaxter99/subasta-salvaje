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

/** Decide si un proveedor puede usarse ahora (ajustes del superadmin: apagado o tope diario). */
export type ProviderGate = (providerId: string) => Promise<{ ok: true } | { ok: false; reason: 'disabled' | 'day_limit' }>;

export interface ChainOptions {
  gate?: ProviderGate;
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

/** ¿Edita de verdad? (si el proveedor no lo declara, se deduce de su capacidad de edición). */
const isEditor = (p: ImageGenerationProvider): boolean => p.realEdit ?? p.capabilities.edit;

export type ChainTask = 'generate' | 'edit';

/**
 * Asignación de tareas: para GENERAR desde cero (imagen inicial, producto) van primero los que solo generan y después los que también
 * editan (así no se gasta la cuota de los buenos editando en lo que cualquiera hace); para EDITAR solo los que editan de verdad y, si
 * ninguno puede, la composición con lo que generen los demás. Dentro de cada grupo se respeta el orden de IMAGE_PROVIDERS.
 */
export function orderFor(task: ChainTask, members: ImageGenerationProvider[]): ImageGenerationProvider[] {
  const editors = members.filter(isEditor);
  return task === 'edit' ? editors : [...members.filter((m) => !isEditor(m)), ...editors];
}

export function createProviderChain(members: ImageGenerationProvider[], opts: ChainOptions = {}): ImageGenerationProvider {
  if (members.length === 0) throw new Error('La cadena necesita al menos un proveedor');
  if (members.length === 1) return opts.gate ? withGate(members[0]!, opts.gate) : members[0]!; // un solo proveedor: sin enfriamiento ni composición extra
  const now = opts.now ?? Date.now;
  const cooling = new Map<string, number>();
  /** Por qué un proveedor está en enfriamiento (se anota en el historial para entender por qué no se usó). */
  const coolWhy = new Map<string, string>();
  const short = (t: string) => (t.length > 140 ? `${t.slice(0, 137)}…` : t);
  const gate = opts.gate;

  const available = (p: ImageGenerationProvider) => (cooling.get(p.id) ?? 0) <= now();
  /** Filtra por los ajustes del superadmin (asíncrono: consulta ajustes y uso). */
  async function permitted(list: ImageGenerationProvider[]): Promise<ImageGenerationProvider[]> {
    if (!gate) return list;
    const out: ImageGenerationProvider[] = [];
    for (const p of list) {
      const g = await gate(p.id);
      if (g.ok) out.push(p);
      else opts.onSkip?.({ provider: p.id, kind: 'quota', message: g.reason === 'disabled' ? 'apagado por el superadmin' : 'tope diario del proveedor alcanzado' });
    }
    return out;
  }

  async function run<T extends GeneratedImage>(task: ChainTask, call: (p: ImageGenerationProvider) => Promise<T>): Promise<T> {
    const order = orderFor(task, members);
    const notes: string[] = [`${task === 'edit' ? 'edición real' : 'generar desde cero'}: ${order.map((m) => m.id).join(' → ') || '(ninguno)'}`];
    for (const m of members) if (!order.includes(m)) notes.push(`${m.id} solo genera (no edita de verdad)`);
    for (const m of order) if (!available(m)) notes.push(`${m.id} en enfriamiento (${coolWhy.get(m.id) ?? 'fallo reciente'})`);
    const candidates = await permitted(order.filter((m) => available(m)));
    for (const m of order) if (available(m) && !candidates.includes(m)) notes.push(`${m.id} apagado o con el tope diario alcanzado (ajustes del superadmin)`);
    let last: ProviderError | null = null;
    for (const p of candidates) {
      try {
        const out = await call(p);
        const pos = order.findIndex((m) => m.id === p.id) + 1;
        return { ...out, provider: p.id, notes: `${notes.join('; ')}; respondió ${p.id} (${pos}.º de ${order.length})${out.notes ? `; ${out.notes}` : ''}` };
      } catch (e) {
        if (!(e instanceof ProviderError) || !SKIPPABLE.has(e.kind)) throw e; // moderación, entrada inválida…: no se reparte
        last = e;
        cooling.set(p.id, cooldownUntil(e.kind, now()));
        coolWhy.set(p.id, `${e.kind}: ${short(e.message)}`);
        notes.push(`${p.id} falló (${e.kind}: ${short(e.message)})`);
        opts.onSkip?.({ provider: p.id, kind: e.kind, message: e.message });
      }
    }
    if (last) throw new ProviderError(`${last.message} [${notes.join('; ')}]`, last.retryable, last.consumed, last.kind);
    throw new ProviderError('Ningún proveedor de imágenes está disponible ahora mismo (en enfriamiento, apagado, con tope diario o sin capacidad). Se conserva la imagen anterior.', true, false, 'unsupported');
  }

  const self: ImageGenerationProvider = {
    id: members[0]!.id,
    capabilities: { edit: true }, // siempre hay composición como último recurso
    realEdit: members.some(isEditor),
    only: (id: string) => {
      const m = members.find((x) => x.id === id);
      return m ? (gate ? withGate(m, gate) : m) : null;
    },
    generateInitialScene: (i: InitialSceneInput) => run('generate', (p) => p.generateInitialScene(i)),
    generateItemImage: (i: ItemImageInput) => run('generate', (p) => p.generateItemImage(i)),
    async editScene(input: EditSceneInput): Promise<GeneratedImage> {
      const editors = (await permitted(orderFor('edit', members).filter((m) => available(m)))).length > 0;
      if (editors) {
        try {
          return await run('edit', (p) => p.editScene(input));
        } catch (e) {
          if (!(e instanceof ProviderError) || !SKIPPABLE.has(e.kind)) throw e;
          opts.onSkip?.({ provider: 'chain', kind: e.kind, message: 'edición real no disponible: se usa la composición' });
        }
      }
      // Plan B: composición con el objeto del siguiente proveedor que pueda generar (o con la foto del elemento).
      const generator: ImageGenerationProvider = { ...self, capabilities: { edit: false } };
      const composed = await withComposedEdit(generator).editScene(input);
      return { ...composed, provider: composed.provider ?? self.id, notes: `${composed.notes ? `${composed.notes}; ` : ''}ningún proveedor pudo editar de verdad: se usó la composición (collage)` };
    },
  };
  return self;
}

/** Un solo proveedor con filtro de ajustes: si está apagado o sin tope, no se llama (y no se gasta nada). */
function withGate(p: ImageGenerationProvider, gate: ProviderGate): ImageGenerationProvider {
  const guard = async <T>(call: () => Promise<T>): Promise<T> => {
    const g = await gate(p.id);
    if (!g.ok) {
      throw new ProviderError(g.reason === 'disabled' ? `El proveedor ${p.id} está apagado por el superadmin. Se conserva la imagen anterior.` : `El proveedor ${p.id} ha alcanzado su tope diario. Se conserva la imagen anterior; se renueva a las 00:00 UTC.`, false, false, 'quota');
    }
    return call();
  };
  return {
    ...p,
    generateInitialScene: (i) => guard(() => p.generateInitialScene(i)),
    generateItemImage: (i) => guard(() => p.generateItemImage(i)),
    editScene: (i) => guard(() => p.editScene(i)),
  };
}
