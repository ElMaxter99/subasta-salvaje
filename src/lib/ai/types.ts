export interface ImageData {
  bytes: Uint8Array;
  mime: string;
}

export interface GeneratedImage extends ImageData {
  /** Prompt realmente enviado al proveedor (se guarda en image_versions.prompt_used). */
  prompt: string;
  model: string;
  /** Proveedor que respondió realmente (lo rellena la cadena; si falta, el `id` del proveedor usado). */
  provider?: string;
  /** Qué pasó en la cadena antes de este resultado (p. ej. «cloudflare omitido: cuota agotada»); se anota en el historial. */
  notes?: string;
}

/**
 * Por qué falló un proveedor. Decide si la cadena (`chain.ts`) pasa al siguiente: cuota, límite de ritmo, credenciales,
 * red, servidor caído o «no sé hacer esto» permiten probar otro proveedor; moderación, entrada inválida o desconocido NO
 * (el mismo contenido se rechazaría igual y no se reparte por varios terceros).
 */
export type ProviderErrorKind = 'quota' | 'rate_limit' | 'auth' | 'network' | 'server' | 'unsupported' | 'moderation' | 'input' | 'invalid_output' | 'unknown';

export class ProviderError extends Error {
  constructor(
    message: string,
    /** true si tiene sentido reintentar (red, 429, 5xx). false si es un rechazo definitivo (moderación, 400). */
    public readonly retryable: boolean,
    /**
     * ¿La llamada llegó a gastar cuota/créditos del proveedor? `false` cuando se sabe que NO (sin conexión, credenciales rechazadas,
     * cuota del proveedor agotada, entrada mal preparada): entonces se devuelve la unidad reservada en el contador local.
     * Por defecto `true` (prudente: ante la duda se cuenta).
     */
    public readonly consumed: boolean = true,
    public readonly kind: ProviderErrorKind = 'unknown',
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export interface InitialSceneInput {
  theme: string;
  sceneDescription: string;
  playerName: string;
}

export interface EditSceneInput {
  base: ImageData;
  theme: string;
  itemName: string;
  itemDescription: string;
  itemEmoji: string | null;
  /** Nombres de los elementos ya presentes (se deben conservar). */
  previousItems: string[];
  /**
   * Imagen del elemento del catálogo (subida por el anfitrión o generada con IA). Si existe, la edición debe MEZCLARLA con la
   * imagen de la casa: el objeto añadido tiene que parecerse a esta referencia (formas, colores, detalles).
   */
  itemImage?: ImageData;
}

export interface ItemImageInput {
  theme: string;
  itemName: string;
  itemDescription: string;
  itemEmoji: string | null;
  /** true: objeto aislado sobre fondo blanco liso (para recortarlo y componerlo sobre otra imagen). */
  isolated?: boolean;
}

/** Abstracción del proveedor de imágenes. Todas las llamadas se ejecutan en el servidor. */
export interface ImageGenerationProvider {
  /** `demo` genera imágenes de muestra locales y NO usa IA. */
  readonly id: 'openai' | 'cloudflare' | 'pollinations' | 'aihorde' | 'huggingface' | 'demo';
  /**
   * ¿Edita DE VERDAD con imagen de referencia (modelo de edición)? `false` = solo genera desde cero y su «edición» es una composición
   * (collage). La cadena lo usa para asignar tareas: generar desde cero primero con los que solo generan y reservar los que editan
   * (y su cuota) para editar. Si falta se deduce de `capabilities.edit`.
   */
  readonly realEdit?: boolean;
  /** Qué sabe hacer el modelo configurado. `edit=false`: sólo genera imágenes nuevas (no puede editar la casa existente). */
  readonly capabilities: { edit: boolean };
  generateInitialScene(input: InitialSceneInput): Promise<GeneratedImage>;
  editScene(input: EditSceneInput): Promise<GeneratedImage>;
  generateItemImage(input: ItemImageInput): Promise<GeneratedImage>;
  /**
   * Sólo para proveedores asíncronos con polling. OpenAI Images es síncrono, así que no lo implementa;
   * la persistencia y los reintentos se resuelven con la tabla image_jobs.
   */
  getJobStatus?(externalId: string): Promise<{ status: 'pending' | 'completed' | 'failed' }>;
  /** Solo la cadena: el proveedor `id` por sí solo (con los ajustes del superadmin), para forzarlo al regenerar; null si no está en la cadena. */
  only?(id: string): ImageGenerationProvider | null;
}
