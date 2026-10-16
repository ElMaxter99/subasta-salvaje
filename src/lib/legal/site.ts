/**
 * Datos centrales de las páginas legales. NADA de esto se inventa: el titular sale de variables de entorno opcionales y,
 * si faltan, las páginas muestran «Titular pendiente de completar por el propietario».
 */
import pkg from '../../../package.json';

export const APP_NAME = 'Subasta Salvaje';
export const APP_VERSION: string = pkg.version;
export const REPO_URL = 'https://github.com/ElMaxter99/subasta-salvaje';

/** Fecha (ISO) de la última revisión de los textos legales. Actualízala cuando cambies cualquiera de ellos. */
export const LEGAL_UPDATED = '2026-10-16';
export const LEGAL_UPDATED_LABEL = '16 de octubre de 2026';

/**
 * Licencia del código. DECISIÓN PENDIENTE DEL PROPIETARIO: el repositorio no tiene archivo LICENSE ni campo `license`.
 * Cámbiala (p. ej. «MIT», «Apache-2.0», «AGPL-3.0», «Propietaria») solo cuando el propietario lo decida.
 */
export const LICENSE_NAME = 'Sin licencia declarada';
export const LICENSE_DECLARED = LICENSE_NAME !== 'Sin licencia declarada';

export interface LegalHolder {
  name?: string;
  email?: string;
  address?: string;
  nif?: string;
  /** true si falta algún dato imprescindible (nombre o correo): se muestra el aviso de «pendiente». */
  incomplete: boolean;
}

const clean = (v: string | undefined) => {
  const t = (v ?? '').trim();
  return t ? t : undefined;
};

/** Lee el titular del entorno. Se pasa `env` para poder probarlo; por defecto usa process.env (NEXT_PUBLIC_* se incrusta al compilar). */
export function getLegalHolder(env: Record<string, string | undefined> = {
  NEXT_PUBLIC_LEGAL_NAME: process.env.NEXT_PUBLIC_LEGAL_NAME,
  NEXT_PUBLIC_LEGAL_EMAIL: process.env.NEXT_PUBLIC_LEGAL_EMAIL,
  NEXT_PUBLIC_LEGAL_ADDRESS: process.env.NEXT_PUBLIC_LEGAL_ADDRESS,
  NEXT_PUBLIC_LEGAL_NIF: process.env.NEXT_PUBLIC_LEGAL_NIF,
}): LegalHolder {
  const name = clean(env.NEXT_PUBLIC_LEGAL_NAME);
  const email = clean(env.NEXT_PUBLIC_LEGAL_EMAIL);
  const address = clean(env.NEXT_PUBLIC_LEGAL_ADDRESS);
  const nif = clean(env.NEXT_PUBLIC_LEGAL_NIF);
  return { name, email, address, nif, incomplete: !name || !email };
}

export const HOLDER_PENDING = 'Titular pendiente de completar por el propietario';
export const LEGAL_DISCLAIMER = 'Este texto es una plantilla informativa, no asesoramiento jurídico. Conviene que lo revise un profesional antes de darlo por válido.';

export const LEGAL_LINKS = [
  { href: '/legal', label: 'Aviso legal' },
  { href: '/privacidad', label: 'Privacidad' },
  { href: '/cookies', label: 'Cookies' },
  { href: '/creditos', label: 'Créditos y licencias de terceros' },
  { href: '/licencia', label: 'Licencia' },
] as const;

/**
 * Cookies y almacenamiento local REALES del código (verificado con grep en src/). Si añades una, actualiza esta lista:
 * `tests/legal.test.ts` comprueba que las claves siguen existiendo en el código y que están aquí.
 */
export interface StorageItem {
  /** Texto buscado en el código para verificar que sigue existiendo. */
  key: string;
  name: string;
  purpose: string;
  duration: string;
  kind: 'Cookie' | 'localStorage' | 'sessionStorage';
  origin: 'Propia' | 'Propia (Supabase Auth)';
  scope: string;
}

export const STORAGE_INVENTORY: StorageItem[] = [
  { key: "'sb-'", name: 'sb-<proyecto>-auth-token (puede dividirse en varios fragmentos)', purpose: 'Mantiene la sesión del anfitrión (Supabase Auth).', duration: 'Sesión de Supabase; el token se renueva mientras uses la app (la duración exacta la define la configuración de tu proyecto de Supabase)', kind: 'Cookie', origin: 'Propia (Supabase Auth)', scope: 'Solo anfitriones con cuenta (modo con Supabase)' },
  { key: 'ss_demo_host', name: 'ss_demo_host', purpose: 'Identifica al anfitrión local en el MODO DEMO (sin cuentas).', duration: '30 días', kind: 'Cookie', origin: 'Propia', scope: 'Solo modo demo / pruebas; no se usa en producción con Supabase' },
  { key: 'ss_p_', name: 'ss_p_<CÓDIGO DE SALA>', purpose: 'Identifica al jugador en su móvil dentro de una sala (una por sala) para poder pujar. Contiene un token opaco, no tu nombre.', duration: '3 días', kind: 'Cookie', origin: 'Propia', scope: 'Jugadores que se unen desde el móvil' },
  { key: 'ss_audio_', name: 'ss_audio_tv · ss_audio_host · ss_audio_play', purpose: 'Recuerda tus preferencias de sonido en este dispositivo (activado, música, volumen).', duration: 'Hasta que lo borres (no caduca)', kind: 'localStorage', origin: 'Propia', scope: 'TV, panel del anfitrión y móvil del jugador' },
  { key: 'ss_import_notice', name: 'ss_import_notice', purpose: 'Pasa a la página del panel el aviso de qué fotos no se pudieron importar al crear la partida.', duration: 'Hasta cerrar la pestaña (se borra al mostrarse)', kind: 'sessionStorage', origin: 'Propia', scope: 'Anfitrión al crear una partida con importación' },
];

export interface ExtraCredit {
  name: string;
  license: string;
  url?: string;
  note: string;
}

/** Créditos que no son paquetes npm. Verificados en el repositorio (ver docs/MARCA.md, docs/MASCOTA.md y docs/ASSETS.md). */
export const EXTRA_CREDITS: ExtraCredit[] = [
  { name: 'Baloo 2 (tipografía de títulos)', license: 'SIL Open Font License 1.1', url: 'https://openfontlicense.org/', note: 'Subconjunto latino alojado en public/assets/fonts/baloo2.woff2. Los autores originales figuran en la distribución de la fuente.' },
  { name: 'Nunito (tipografía de texto)', license: 'SIL Open Font License 1.1', url: 'https://openfontlicense.org/', note: 'Fuente variable alojada en public/assets/fonts/nunito-var.woff2. Los autores originales figuran en la distribución de la fuente.' },
  { name: 'Iconos Lucide', license: 'ISC', url: 'https://lucide.dev/license', note: 'Se usan a través del paquete npm lucide-react (ya listado arriba).' },
];

export const PROJECT_ASSET_NOTES: string[] = [
  'Logotipo y mascota nueva (public/assets/brand/): los entregó el propietario del proyecto como imagen; las versiones recortadas se generan a partir de ese original. Pertenecen al propietario del proyecto.',
  'Expresiones, poses y objetos de la mascota (public/assets/mascot/): recortes de la lámina de referencia entregada por el propietario. Pertenecen al propietario del proyecto.',
  'Mini héroe vectorial, favicon simplificado y paquete de recursos subasta-salvaje-assets/: dibujos vectoriales propios del proyecto generados por scripts (no son renders 3D ni imágenes de IA).',
  'No se ha verificado en el repositorio ninguna licencia concreta para estos recursos gráficos más allá de lo anterior: no se concede ninguna licencia de reutilización sobre ellos.',
];

export const SERVICE_PROVIDERS = [
  { name: 'Supabase', role: 'Base de datos, autenticación, almacenamiento de imágenes y tiempo real.', url: 'https://supabase.com/privacy' },
  { name: 'Vercel', role: 'Alojamiento de la aplicación y tareas programadas.', url: 'https://vercel.com/legal/privacy-policy' },
  { name: 'Cloudflare (Workers AI)', role: 'Generación y edición de imágenes con IA, solo si el anfitrión/propietario la configura.', url: 'https://www.cloudflare.com/privacypolicy/' },
  { name: 'OpenAI', role: 'Generación y edición de imágenes con IA, solo si el propietario lo configura.', url: 'https://openai.com/policies/privacy-policy' },
] as const;
