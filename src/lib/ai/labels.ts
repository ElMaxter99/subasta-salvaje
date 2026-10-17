/** Nombre legible de cada proveedor de imágenes (sin importaciones de servidor: se usa también en componentes cliente). */
export type ProviderLabelId = 'openai' | 'cloudflare' | 'pollinations' | 'aihorde' | 'huggingface' | 'demo';

const LABELS: Record<ProviderLabelId, string> = {
  cloudflare: 'Cloudflare Workers AI',
  pollinations: 'Pollinations',
  aihorde: 'AI Horde',
  huggingface: 'Hugging Face',
  openai: 'OpenAI',
  demo: 'pegatinas (sin IA)',
};

export const providerLabel = (id: ProviderLabelId): string => LABELS[id] ?? id;
