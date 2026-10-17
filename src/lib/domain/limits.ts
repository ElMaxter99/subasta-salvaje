/**
 * Tope de la aplicación para jugadores por partida, y valor por defecto. Es la única definición en TypeScript (formularios,
 * validación y plantillas); la regla de verdad está en SQL (`ss_max_players_cap()`, migración …4000) y un test comprueba
 * que ambas coinciden.
 */
export const MAX_PLAYERS = 10;
