/**
 * En modo móviles, quien NUNCA llegó a entrar (su móvil jamás se identificó) no sale en el resultado final ni en la votación:
 * `joined` lo calcula la base de datos (siempre verdadero en modo anfitrión y en snapshots antiguos sin el campo).
 */
export const joinedPlayers = <T extends { joined?: boolean }>(players: T[]): T[] => players.filter((p) => p.joined !== false);
