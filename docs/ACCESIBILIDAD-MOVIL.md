# Accesibilidad de la vista del jugador (móvil)

Auditoría de `/game/[code]/play` (`src/components/play/*` y los componentes de `src/components/ui/*` que usa). Método: lectura
del código, cálculo de contraste con los colores reales de `src/app/globals.css`, e2e en Chromium móvil (`e2e/a11y.spec.ts`).
**No se ha probado con lectores de pantalla reales** (TalkBack, VoiceOver): lo que sigue sobre ellos es razonamiento a partir de
los roles ARIA, no una prueba de escucha. Ver «Sin probar» al final.

## Hallazgos y arreglos

### 1. Tamaño táctil (≥ 44×44 px)
Estado previo correcto: botones `Button` md/lg (`min-h-11`/`min-h-14`), reacciones `size-12` (48 px, separación 8 px), selector de
jugador `min-h-16`, «Salir» `min-h-11`, campo de importe `min-h-14`. El e2e ya comprobaba ≥ 44 px en la pantalla de subasta.
- **Arreglado:** el control de volumen (`<input type=range>`, ~16 px de alto) → `h-11`.
- **Arreglado:** enlace «Descargar imagen del podio» (solo `text-sm`) → `min-h-11`.
- `Button size="sm"` (`min-h-9`) existe pero no se usa en la vista del jugador.

### 2. Contraste
Cálculo en `tests/contrast.test.ts` (lee los tokens de `globals.css`; falla si alguien los cambia y baja del umbral).
Resultados relevantes (ratio):

| Combinación | Ratio |
|---|---|
| white/50 sobre night-950 / 800 / 700 / 600 | 5,3 / 5,2 / 4,7 / 4,0 |
| white/55 sobre night-950 / 800 / 700 / 600 | 6,3 / 6,0 / 5,4 / 4,5 |
| white/60 sobre night-950 / 800 / 700 / 600 | 7,3 / 6,8 / 6,1 / 5,1 |
| white/70 sobre night-950 / 800 / 700 | 9,7 / 8,9 / 7,8 |
| gold, gold-soft, teal, rose, violet-soft sobre night-950…700 | todos ≥ 4,5 (test) |
| night-950 sobre gold / gold-soft / teal / rose (botones, avisos) | todos ≥ 4,5 (test) |
| violet-soft sobre violet/20–25 encima de night-900/800 | ≥ 4,5 (test) |

Conclusión: **el texto cumple AA**, incluido text-white/55–/70 sobre night-*. Único suspenso real:
- **Arreglado (WCAG 1.4.11, 3:1):** el borde de los campos de texto (`border-white/20` sobre night-950) daba 1,75:1 → `border-white/45`
  en el importe manual (`bid-pad.tsx`) y en el nombre (`picker.tsx`).
- Botones `disabled` (opacidad 45 %, ≈ 3,1:1): exentos por WCAG (componentes inactivos); el motivo se explica con texto («No te queda saldo…»).
- Bordes decorativos de tarjetas (`white/10`) no son información: sin cambios.
- `text-white/50` con night-600 (4,0:1) no aparece en la vista del jugador; el test fija el límite en night-700 con /80.

### 3. Lector de pantalla y regiones vivas
- **Cuenta atrás de adjudicación y reloj de subasta automática** eran `role="status"` y cambian cada segundo: un lector los repetiría sin
  parar. **Arreglado:** ya no son regiones vivas (`player-screen.tsx`, `screen/auto-run-clock.tsx`, que comparte la TV); se leen al
  navegar hasta ellos.
- **Duplicados al pujar/ceder:** la tarjeta «Puja actual» (`aria-live`) y el toast «Puja de X enviada» decían lo mismo. **Arreglado:**
  `useToast().success(msg, { announce: false })` renderiza el toast solo visual (`aria-hidden`) y se usa en la puja y en ceder (la nota
  `yielded-note` ya es `role="status"`). Los errores siguen anunciándose.
- Tarjeta de puja: añadido `aria-atomic="true"` para que cada cambio se lea entero («Puja actual 12 Ohros · Va ganando Ana») y no
  en fragmentos.
- «Te han superado» (`role="alert"`, solo aparece al perder el liderato; el cartel dura 8 s). Se mantiene `alert` por ser urgente; lo sigue la
  actualización de la tarjeta. Es el único aviso asertivo de la pantalla. La mascota y su bocadillo son `aria-hidden` (decorativos).
- **Reacciones:** el botón se ponía `disabled` 1,6 s tras cada toque y el foco se perdía. **Arreglado:** `aria-disabled` (sigue
  enfocable; los clics se ignoran durante el enfriamiento) y una línea `sr-only role=status` («Reacción 👍 enviada»), que antes no tenía
  ningún acuse para lector de pantalla.
- **Foco al ceder:** el botón desaparece y el foco caía en `<body>`. **Arreglado:** pasa a la nota «Has cedido…» (solo si se cedió en
  esta sesión, no al recargar).
- Etiquetas: todos los botones solo-icono ya tenían nombre (`aria-label` en pujas, reacciones, volumen; iconos Lucide `aria-hidden`).
  Arreglado: icono de error del toast sin `aria-hidden`. `Ohros` es `role="img"` con «12 Ohros».
- Diálogos: `<dialog>` modal nativo; Escape cierra y el foco vuelve al disparador (ya cubierto por el e2e del anfitrión; en el
  jugador es el mismo componente). `aria-labelledby` ya añadido por otro cambio.
- **Pendiente (limitación):** tras una puja que te hace líder, los botones de puja pasan a `disabled` y, si tenían el foco, éste se pierde
  hasta el siguiente Tab. No se ha movido el foco porque anunciaría de más; si se prueba con TalkBack y molesta, enfocar la tarjeta de puja.

### 4. Movimiento
`globals.css` ya desactiva con `prefers-reduced-motion: reduce` la mascota (`ss-mascot-*`), la moneda que gira (`ss-coin-spin`),
el brillo, la corona, el bocadillo y fuerza duración ~0 en el resto. El confeti existe solo en la TV (`screen/award-overlay.tsx`). El e2e
emula `reducedMotion` y comprueba que ningún `.ss-mascot`/`[data-mascot]` conserva animación.

### 5. Zoom y texto al 200 %
- El viewport (`layout.tsx`) es `width=device-width, initial-scale=1`, sin `maximum-scale` ni `user-scalable=no`: el zoom no está bloqueado (el e2e lo vigila).
- A 360 px con el tamaño de letra del usuario al 200 % (`html{font-size:200%}`) había desbordamiento horizontal (56 px). **Arreglado:**
  - tarjeta del objeto: `flex-wrap` + `basis-40` + `break-words` (la imagen de 5 rem dejaba 38 px al texto);
  - cabecera: la fila nombre/«Salir» y la fila saldo/mascota/conexión pasan a `flex-wrap`; el botón «No soy yo / Salir» ya no es `shrink-0` y puede partir el texto;
  - línea del líder: `flex-wrap`;
  - botones rápidos de puja: `grid-cols-[repeat(auto-fit,minmax(4.5rem,1fr))]` (en rem, no en px): 4 columnas normalmente, 2×2 con texto grande.
- Cabecera y pad de pujas son `sticky`; con el texto grande taparían casi toda la pantalla. **Arreglado:** `useFixedBars()` en
  `player-screen.tsx` las deja de fijar cuando el alto de ventana es < 32 rem reales (texto grande o móvil apaisado bajo). Se mide en JS
  porque en una media query `rem` no sigue el tamaño de letra del usuario (se comprobó: no funcionaba).
- El e2e comprueba `scrollWidth - clientWidth ≤ 1` a 360 px × 200 % y que la cabecera deja de ser sticky.

## Tests
- `tests/contrast.test.ts` (Vitest): contraste de los tokens reales.
- `e2e/a11y.spec.ts` (ampliado): zoom permitido, sin desbordamiento a 360 px/200 %, barras no fijas con texto grande, cuenta atrás no viva, `reduced-motion`.
  Ejecución: `flock /tmp/ss-e2e.lock env PW_CHROMIUM_PATH=… npx playwright test e2e/a11y.spec.ts --workers=1`.

## Sin probar / límites honestos
- **Ningún lector de pantalla real** (TalkBack, VoiceOver, NVDA). Los anuncios, su orden y su volumen son los esperables según ARIA, no verificados.
- Zoom de página (pellizco) y «tamaño de fuente» del sistema se han emulado en Chromium de escritorio; no en iOS Safari ni Android reales.
- Los toasts (`bottom: 5.25rem`) pueden quedar sobre el pad de pujas cuando éste es alto (texto grande); duran 3,5 s (7 s los errores) y no
  bloquean el pad si se espera, pero no se ha medido en dispositivo.
- Foco oculto por barras fijas (WCAG 2.4.11): el campo de importe se desplaza al centro al enfocarlo (`scrollIntoView`); el resto de controles
  no tiene `scroll-padding`. No se ha comprobado con teclado físico en móvil.
- Contraste calculado sobre colores planos; las superficies con degradado/`backdrop-blur` (cabecera `night-900/95`) y las imágenes de los jugadores no se han medido.
- Los avisos de la TV (`/screen`) y del anfitrión quedan fuera de esta auditoría (la TV es pantalla pública, sin lector).
