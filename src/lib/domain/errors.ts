import { redactSecrets } from '@/lib/security/redact';

/** Códigos de error de dominio (coinciden con `RAISE EXCEPTION 'ERR:<codigo>'` en SQL). */
export const ERROR_MESSAGES: Record<string, string> = {
  game_not_found: 'No existe ninguna partida con ese código.',
  not_host: 'No tienes permisos para controlar esta partida.',
  unauthenticated: 'Debes iniciar sesión como anfitrión.',
  rate_limited: 'Demasiadas solicitudes. Espera unos segundos.',
  invalid_input: 'Los datos enviados no son válidos.',
  invalid_amount: 'El importe debe ser positivo.',
  insufficient_balance: 'El jugador no tiene saldo suficiente.',
  bid_below_minimum: 'La puja no alcanza la puja mínima de la partida.',
  bid_too_low: 'La puja debe superar la puja actual.',
  auction_closed: 'La subasta ya está cerrada.',
  auction_not_found: 'La subasta no existe.',
  auction_in_progress: 'Hay una subasta en curso. Ciérrala o cancélala primero.',
  auction_already_awarded: 'Esta subasta ya fue adjudicada con otros datos.',
  no_bids: 'No hay pujas: no se puede adjudicar.',
  stale_state: 'La puja cambió mientras confirmabas. Revisa los datos y vuelve a intentarlo.',
  game_paused: 'La partida está en pausa.',
  game_not_active: 'La partida no está en curso.',
  game_not_started: 'La partida todavía no ha empezado.',
  game_already_started: 'Esta acción solo se puede hacer antes de empezar.',
  game_finished: 'La partida ha finalizado.',
  invalid_game_state: 'La partida no está en un estado válido para esto.',
  not_enough_players: 'Hacen falta al menos 2 jugadores.',
  no_items: 'Añade al menos un elemento al catálogo.',
  too_many_players: 'El máximo es de 12 jugadores.',
  player_not_found: 'El jugador no existe.',
  item_not_found: 'El elemento no existe.',
  item_not_available: 'El elemento ya no está disponible.',
  item_locked: 'El elemento ya se ha subastado o está en subasta.',
  bid_not_found: 'La puja no existe.',
  job_not_found: 'El trabajo de imagen no existe.',
  job_already_completed: 'El trabajo ya terminó correctamente.',
  version_not_found: 'La versión de imagen no existe.',
  version_not_restorable: 'Esa versión no se puede restaurar.',
  voting_disabled: 'La votación no está activada en esta partida.',
  invalid_action: 'Acción no válida.',
  ai_disabled_for_user: 'El administrador ha desactivado la IA para tu cuenta: usa el modo pegatinas.',
  host_blocked: 'Tu cuenta está bloqueada. Contacta con el administrador.',
  signups_closed: 'El registro está cerrado: necesitas una invitación del administrador.',
  bid_not_whole: 'En esta partida solo se puede pujar en euros enteros (1, 2, 3…).',
  initial_image_required: 'Falta la imagen inicial: todos los jugadores necesitan su casa de partida antes de empezar (sube una, elige una de la galería o genérala).',
  rounds_below_played: 'El máximo de rondas no puede ser menor que las rondas ya jugadas.',
  purchase_not_found: 'Esa compra no existe (quizá ya se deshizo).',
  not_last_purchase: 'Solo se puede deshacer la última adjudicación de la partida.',
  image_job_running: 'La imagen de esa compra se está generando ahora mismo. Espera unos segundos y reinténtalo.',
  tax_no_recipients: 'No hay nadie con menos saldo que el más rico: no hay a quién repartir el impuesto.',
  nothing_to_tax: 'El saldo del más rico es demasiado pequeño para cobrar un impuesto.',
  gallery_not_open: 'La galería final solo está disponible cuando la partida ha terminado.',
  gallery_closed: 'La votación de la galería ya está cerrada.',
  cannot_vote_self: 'No puedes votarte a ti mismo.',
  image_quota_exceeded: 'Se alcanzó el máximo de imágenes de esta partida.',
  retry_limit: 'Este trabajo ya se reintentó demasiadas veces.',
  ai_not_available: 'La IA no está configurada en este despliegue: usa el modo pegatinas o configura un proveedor (IMAGE_PROVIDER).',
  room_closed: 'La sala está cerrada: el anfitrión no admite más jugadores.',
  new_names_disabled: 'El anfitrión no admite nombres nuevos: elige uno de la lista.',
  already_joined: 'Este móvil ya está identificado en la partida. Sal primero si quieres cambiar de jugador.',
  player_taken: 'Ese jugador ya está conectado desde otro móvil.',
  not_player: 'Tu móvil no está identificado en esta partida. Vuelve a unirte.',
  already_leading: 'Ya vas ganando esta puja.',
  mobile_disabled: 'Esta partida no admite jugadores desde el móvil.',
  duplicate_name: 'Ya existe un jugador con ese nombre.',
  idempotency_conflict: 'La clave de operación ya se usó para otra acción.',
  lease_lost: 'El trabajo fue reasignado a otro worker.',
  provider_not_configured: 'El proveedor de IA no está configurado.',
  migration_pending: 'Falta aplicar una migración de la base de datos (ejecuta «npx supabase db push»).',
  internal: 'Error interno. Inténtalo de nuevo.',
};

export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message?: string,
    public readonly status: number = statusFor(code),
  ) {
    super(message ?? ERROR_MESSAGES[code] ?? ERROR_MESSAGES.internal);
    this.name = 'DomainError';
  }
}

function statusFor(code: string): number {
  switch (code) {
    case 'unauthenticated':
      return 401;
    case 'not_host':
      return 403;
    case 'game_not_found':
    case 'auction_not_found':
    case 'player_not_found':
    case 'item_not_found':
    case 'bid_not_found':
    case 'job_not_found':
    case 'version_not_found':
      return 404;
    case 'rate_limited':
      return 429;
    case 'invalid_input':
    case 'invalid_amount':
    case 'invalid_action':
      return 400;
    case 'internal':
    case 'provider_not_configured':
      return 500;
    default:
      return 409;
  }
}

/** Convierte un error de base de datos (`ERR:codigo`) en DomainError. */
/** Reconoce DomainError aunque el módulo se haya cargado dos veces (chunks distintos del bundler). */
export function isDomainError(err: unknown): err is DomainError {
  return err instanceof DomainError || (typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'DomainError' && typeof (err as { code?: unknown }).code === 'string');
}

export function toDomainError(err: unknown): DomainError {
  if (isDomainError(err)) return err;
  const message = typeof err === 'object' && err && 'message' in err ? String((err as { message: unknown }).message) : String(err);
  const match = /ERR:([a-z_]+)/.exec(message);
  if (match?.[1]) return new DomainError(match[1]);
  console.error('[db-error]', redactSecrets(message));
  return new DomainError('internal');
}
