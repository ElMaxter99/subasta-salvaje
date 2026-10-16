# Sonidos y música

Todo se **sintetiza en el navegador con Web Audio** (`src/lib/audio/engine.ts`): sin archivos de audio, sin licencias y sin dependencias.

## Quién suena y cuándo
| Dispositivo | Música | Efectos | Por defecto |
|---|---|---|---|
| **TV** (`useGameAudio(snap,'tv')`) | Sala de espera (alegre y saltarina, escena propia `waiting`) · entre subastas (suave, `lobby`) · subasta abierta (animada) · últimos 10 s de la cuenta atrás (tensa) | Anuncio, puja (sube de tono con cada puja), tic-tac ≤ 10 s, puja cerrada (redoble), **adjudicado** (martillazo + fanfarria + monedas), fin de partida | Activado |
| **Panel del anfitrión** (`useGameAudio(snap,'host')`) | No | Anuncio, puja, cierre, adjudicado, fin | Activado |
| **Móvil del jugador** (`usePlayerSounds`) | No | Anuncio, «vas ganando», «te han superado», «¡tuyo!» | **Silencio** (lo activa el jugador) |

Los sonidos salen de **comparar cada instantánea con la anterior** (nada suena en el primer render). El sonido nunca aporta información exclusiva: todo sigue escrito en pantalla.

## Control del anfitrión
En el panel (`host/sound-controls.tsx`):
- **TV → Sonido / Música (visible en todas las secciones del panel, también en móvil):** interruptores **de la partida** (`games.sound_enabled`, `games.music_enabled`; acción `game.set_sound` → `ss_set_sound`, migraciones `3000`/`3100`). La TV los lee en su siguiente actualización (≈1–2 s) y silencia efectos o música aunque tenga el sonido activo localmente. Sirve para hablar o controlar algo sin tocar la tele.
- **Este dispositivo:** silencio, volumen (el del propio panel).
En cada dispositivo (TV, panel, móvil) hay además un botón de **silencio, música (en la TV) y volumen**, guardados en `localStorage` por rol (`ss_audio_tv|host|play`).

## Autoplay
Los navegadores bloquean el audio hasta el primer gesto del usuario. Mientras tanto la TV muestra **«Activar sonido»** (`data-testid="sound-activate"`); cualquier clic o tecla lo activa. Con un mando/ratón basta un clic una vez por carga de página.

## Qué NO está verificado
- **Cómo suena de verdad.** El contenedor no tiene salida de audio: los tests comprueban el flujo (interruptores, persistencia, estado), no el sonido. Las melodías, los volúmenes y el equilibrio entre música y efectos hay que **afinarlos escuchando la app** (constantes en `engine.ts`: `SCENES`, ganancias de `play()`).
- La sincronía depende del sondeo/Realtime actual de cada dispositivo (no hay reloj de audio compartido).
- Los interruptores de la partida solo mandan sobre la **TV**; los móviles son personales.
La TV muestra «Silenciado por el anfitrión» cuando este apaga el sonido (e2e `sound.spec.ts`).
