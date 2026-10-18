/** Contratos compartidos entre SQL (ss_get_state), servidor y UI. */

export type GameStatus = 'lobby' | 'active' | 'paused' | 'finished';
export type AuctionStatus = 'open' | 'closed' | 'awarded' | 'cancelled';
/** `lost` = subasta sin ninguna puja: el elemento no vuelve a salir. */
export type ItemStatus = 'available' | 'in_auction' | 'sold' | 'lost';
export type RankingRule = 'none' | 'balance' | 'items' | 'votes';
/** host = el anfitrión registra todas las pujas; mobile = cada jugador se une con el código y puja desde su móvil. */
export type PlayMode = 'host' | 'mobile';
/** Quién puede unirse en modo móviles: open = casillas + nombres nuevos, slots = sólo casillas existentes, closed = nadie nuevo. */
/** stickers = pegatinas con emojis sin IA (gratis); ai = generación/edición con IA real (con cuotas). */
export type ImageMode = 'stickers' | 'ai';
export type JoinPolicy = 'open' | 'slots' | 'closed';
export type JobKind = 'initial' | 'edit' | 'item' | 'base';
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface ImageRef {
  id: string;
  storage_path: string | null;
  /** URL pública resuelta por el servidor (no viene de SQL). */
  url?: string | null;
  provider: string;
  created_at: string;
}

export interface PlayerPurchase {
  purchase_id: string;
  item_id: string;
  name: string;
  emoji: string | null;
  price_cents: number;
  created_at: string;
}

export interface PlayerGenerating {
  job_id: string;
  kind: JobKind;
  status: 'queued' | 'running';
  item_name: string | null;
}

export interface Player {
  id: string;
  name: string;
  color: string;
  sort_order: number;
  balance_cents: number;
  votes: number;
  /** true si un móvil ya ha reclamado a este jugador (modo móviles). */
  claimed: boolean;
  /** false = en modo móviles nunca ha entrado: no sale en el resultado final ni cuenta en la votación. */
  joined?: boolean;
  current_image_version_id: string | null;
  current_image: ImageRef | null;
  initial_image: ImageRef | null;
  purchases: PlayerPurchase[];
  generating: PlayerGenerating[];
  /** Etiqueta de equipo (≤ 20 caracteres) o null. Solo agrupa en los resultados; no comparte saldo. */
  team?: string | null;
  /** Saldo inicial de este jugador (individual si el anfitrión lo fijó; si no, el general). */
  initial_balance_cents?: number | null;
}

export interface AuctionItem {
  id: string;
  name: string;
  description: string;
  emoji: string | null;
  image_path: string | null;
  image_url?: string | null;
  sort_order: number;
  status: ItemStatus;
}

export interface Bid {
  id: string;
  player_id: string;
  amount_cents: number;
  created_at: string;
}

export interface Auction {
  id: string;
  status: AuctionStatus;
  round_number: number;
  current_bid_cents: number;
  current_bidder_id: string | null;
  winner_id: string | null;
  final_price_cents: number | null;
  opened_at: string;
  closed_at: string | null;
  /** Momento (hora del servidor) en que se adjudicará sola si nadie puja más; null si no aplica. */
  auto_award_at?: string | null;
  /** Evento sorpresa de esta subasta (null = subasta normal). */
  wild_event?: WildEvent | null;
  /** «Doble o mitad»: resultado del sorteo, sólo tras adjudicar. */
  wild_note?: { outcome: 'half' | 'double'; bid_cents: number; charged_cents: number } | null;
  /** Puja a ciegas en curso: importe, líder y pujas se ocultan en las vistas públicas. */
  hidden?: boolean;
  /** Elemento elegido al azar (botón «Anunciar uno al azar» o subasta automática aleatoria). */
  random?: boolean;
  bids_count?: number;
  /** Relámpago: segundos entre la última puja y la adjudicación automática. */
  flash_seconds?: number;
  /** Sobre cerrado: jugadores que ya han pujado (sin importes). */
  sealed_bidders?: string[];
  item: Pick<AuctionItem, 'id' | 'name' | 'description' | 'emoji' | 'image_path' | 'image_url'>;
  bids: Bid[];
}

/** Elemento que nadie quiso (subasta sin pujas). */
export interface LastUnsold {
  event_id: number;
  item_name: string;
  emoji: string | null;
  at: string;
}

export interface LastAward {
  purchase_id: string;
  player_id: string;
  item_name: string;
  emoji: string | null;
  price_cents: number;
  created_at: string;
}

export interface GameInfo {
  id: string;
  room_code: string;
  name: string;
  status: GameStatus;
  theme: string;
  initial_budget_cents: number;
  min_bid_cents: number;
  ranking_rule: RankingRule;
  play_mode: PlayMode;
  join_policy: JoinPolicy;
  image_mode: ImageMode;
  /** Qué recibirán los jugadores NUEVOS como imagen inicial: 'file' (imagen), 'generate' (se genera) o null. */
  new_player_image_kind?: 'file' | 'generate' | null;
  /** Adjudicación automática: por tiempo desde la última puja, o al instante si nadie más puede superar la puja. */
  auto_award_enabled: boolean;
  auto_award_seconds: number;
  /** Pujas solo en Ohros enteros. */
  integer_bids?: boolean;
  /** Máximo de jugadores de la partida (1..10, por defecto 10). */
  max_players?: number;
  /** Máximo de rondas (null = todos los elementos). `total_rounds` ya incorpora este límite. */
  max_rounds?: number | null;
  /** Subasta automática (anuncia sola los elementos por orden). */
  auto_run_enabled?: boolean;
  auto_run_gap_seconds?: number;
  auto_run_idle_seconds?: number;
  /** Hora (del servidor) en la que se anunciará la siguiente subasta, o null. */
  auto_run_next_at?: string | null;
  /** Subasta automática: elige los elementos al azar en vez de seguir el orden del catálogo. */
  auto_run_random?: boolean;
  /** Efectos y música de la TV (los controla el anfitrión). */
  sound_enabled?: boolean;
  music_enabled?: boolean;
  /** Probabilidad (0-100) de que una subasta salga con evento sorpresa si el anfitrión no elige uno. */
  wild_chance_pct?: number;
  current_auction_id: string | null;
  created_at: string;
  finished_at: string | null;
  total_rounds: number;
  rounds_completed: number;
}

export interface GameStats {
  purchases_count: number;
  total_spent_cents: number;
  bids_count: number;
  cancelled_auctions: number;
}

export interface ImageJob {
  id: string;
  kind: JobKind;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  error_message: string | null;
  player_id: string | null;
  player_name: string | null;
  item_id: string | null;
  item_name: string | null;
  purchase_id: string | null;
  result_version_id: string | null;
  run_after: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface ImageVersion {
  id: string;
  player_id: string;
  parent_version_id: string | null;
  storage_path: string | null;
  url?: string | null;
  source_purchase_id: string | null;
  item_name: string | null;
  origin: 'initial' | 'uploaded' | 'edit';
  provider: string;
  /** Modelo de IA que generó la versión (null en versiones anteriores a registrarlo, subidas y pegatinas). */
  model?: string | null;
  /** Por qué se usó ese proveedor (cadena y saltos, proveedor forzado…). */
  provider_note?: string | null;
  prompt_used: string | null;
  generation_status: 'completed' | 'failed';
  is_approved: boolean;
  error_message: string | null;
  created_at: string;
}

export interface GameEvent {
  id: number;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

/** Instantánea pública (pantalla de TV y resultados). */
export interface PublicSnapshot {
  version: number;
  /** Hora del servidor al generar la instantánea (para cuentas atrás sin depender del reloj del cliente). */
  server_time: string;
  game: GameInfo;
  players: Player[];
  items: AuctionItem[];
  auction: Auction | null;
  last_award: LastAward | null;
  /** Última subasta que terminó sin pujas (la TV muestra una animación una sola vez). */
  last_unsold?: LastUnsold | null;
  stats: GameStats;
  gallery?: Gallery;
  /** Último impuesto al más rico (para avisar en la pantalla). */
  wild_tax?: { id: number; created_at: string; payload: WildTaxPayload } | null;
}

export type WildEvent = 'blind' | 'double' | 'flash' | 'sealed';

export interface WildTaxPayload {
  rate_pct: number;
  payers: { player_id: string; name: string; amount_cents: number }[];
  share_cents: number;
  recipients: number;
}

export interface Gallery {
  enabled: boolean;
  open: boolean;
  closed: boolean;
  /** Quién ya votó (no a quién). */
  voters: string[];
  /** Recuento por jugador: sólo visible para el anfitrión o cuando la votación está cerrada. */
  results: { player_id: string; votes: number }[] | null;
}

/** Instantánea del anfitrión: añade trabajos, versiones y eventos. */
/** Contador de generaciones REALES de imagen (el proveedor demo no cuenta ni tiene límite). */
export interface ImageUsage {
  provider: 'openai' | 'cloudflare' | 'pollinations' | 'aihorde' | 'huggingface' | 'demo';
  limited: boolean;
  game_used: number;
  game_limit: number | null;
  day_used: number;
  day_limit: number | null;
}

export interface HostSnapshot extends PublicSnapshot {
  usage?: ImageUsage;
  /** Momento en que la partida se borrará sola si no hay más actividad. */
  expires_at?: string | null;
  host_id: string;
  jobs: ImageJob[];
  versions: ImageVersion[];
  events: GameEvent[];
}

/** Información de entorno que la UI necesita (sin secretos). */
export interface RuntimeInfo {
  mode: 'supabase' | 'demo';
  aiConfigured: boolean;
  /** Proveedor de IA REAL configurado ('demo' = ninguno: sólo está disponible el modo pegatinas). */
  aiProvider: 'openai' | 'cloudflare' | 'pollinations' | 'aihorde' | 'huggingface' | 'demo';
  /** El proveedor configurado puede EDITAR la imagen existente de una casa (si no, sólo genera imágenes nuevas). */
  aiCanEdit: boolean;
  /** Sólo en Supabase: permite que el navegador se suscriba a Realtime. */
  supabaseUrl?: string;
  supabaseAnonKey?: string;
}

export interface GameSummary {
  room_code: string;
  name: string;
  status: GameStatus;
  theme: string;
  created_at: string;
  players: number;
}
