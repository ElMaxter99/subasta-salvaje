/** Contratos compartidos entre SQL (ss_get_state), servidor y UI. */

export type GameStatus = 'lobby' | 'active' | 'paused' | 'finished';
export type AuctionStatus = 'open' | 'closed' | 'awarded' | 'cancelled';
export type ItemStatus = 'available' | 'in_auction' | 'sold';
export type RankingRule = 'none' | 'balance' | 'items' | 'votes';
/** host = el anfitrión registra todas las pujas; mobile = cada jugador se une con el código y puja desde su móvil. */
export type PlayMode = 'host' | 'mobile';
/** Quién puede unirse en modo móviles: open = casillas + nombres nuevos, slots = sólo casillas existentes, closed = nadie nuevo. */
export type JoinPolicy = 'open' | 'slots' | 'closed';
export type JobKind = 'initial' | 'edit' | 'item';
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
  current_image_version_id: string | null;
  current_image: ImageRef | null;
  initial_image: ImageRef | null;
  purchases: PlayerPurchase[];
  generating: PlayerGenerating[];
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
  item: Pick<AuctionItem, 'id' | 'name' | 'description' | 'emoji' | 'image_path' | 'image_url'>;
  bids: Bid[];
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
  /** Adjudicación automática: por tiempo desde la última puja, o al instante si nadie más puede superar la puja. */
  auto_award_enabled: boolean;
  auto_award_seconds: number;
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
  stats: GameStats;
}

/** Instantánea del anfitrión: añade trabajos, versiones y eventos. */
/** Contador de generaciones REALES de imagen (el proveedor demo no cuenta ni tiene límite). */
export interface ImageUsage {
  provider: 'openai' | 'cloudflare' | 'demo';
  limited: boolean;
  game_used: number;
  game_limit: number | null;
  day_used: number;
  day_limit: number | null;
}

export interface HostSnapshot extends PublicSnapshot {
  usage?: ImageUsage;
  host_id: string;
  jobs: ImageJob[];
  versions: ImageVersion[];
  events: GameEvent[];
}

/** Información de entorno que la UI necesita (sin secretos). */
export interface RuntimeInfo {
  mode: 'supabase' | 'demo';
  aiConfigured: boolean;
  aiProvider: 'openai' | 'cloudflare' | 'demo';
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
