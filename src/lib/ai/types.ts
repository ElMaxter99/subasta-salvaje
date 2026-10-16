export interface ImageData {
  bytes: Uint8Array;
  mime: string;
}

export interface GeneratedImage extends ImageData {
  /** Prompt realmente enviado al proveedor (se guarda en image_versions.prompt_used). */
  prompt: string;
  model: string;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    /** true si tiene sentido reintentar (red, 429, 5xx). false si es un rechazo definitivo (moderación, 400). */
    public readonly retryable: boolean,
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
  readonly id: 'openai' | 'cloudflare' | 'demo';
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
}
