# Reenfoque de textos: de «subasta de casas» a «partidas con imagen base»

La app no va de «actualizar una casa»: cada partida **parte de una imagen base** (una casa, una nave espacial, el salón de un
castillo, una oficina, un jardín…, lo que se elija o se suba) y, subasta a subasta, los jugadores consiguen **elementos** que la
transforman, para dejarla lo más divertida —o lo más útil— posible, como la entienda cada grupo. Hay partidas temáticas
(plantillas del sistema), pero todo es personalizable. Este documento recoge el vocabulario aplicado al código (solo textos,
ninguna lógica, regla, identificador ni migración).

## Glosario aplicado

| Antes | Ahora |
| --- | --- |
| casa inicial, foto inicial de la casa, «Casa vacía» (dibujo de pegatinas) | imagen inicial / imagen base («Imagen base · {temática}» en la galería incluida) |
| la casa de X, tu casa (aria-labels, alt) | la imagen de X, tu imagen («Imagen de X») |
| «Las casas» / «¿Cómo cambian las casas?» (asistente) | «Las imágenes» / «¿Cómo cambian las imágenes?» |
| ¡Casa actualizada! | ¡Imagen actualizada! |
| Construyendo {elemento}… (`tu mejora`/`mejora`) | Aplicando {elemento}… (`tu elemento`/`elemento`) |
| Mejorando la casa… (espectador) | Transformando la imagen… |
| Mejor casa / Vota la mejor casa | Mejor imagen / Vota la mejor imagen |
| Casas finales, casa final, «Sin casa» | Imágenes finales, imagen final, «Sin imagen» |
| Puja. Construye. Alucina. | Puja. Transforma. Alucina. |
| metadatos: «puja, construye tu casa y mira cómo la IA la transforma» | «parte de una imagen base, puja por elementos y transfórmala a tu manera» |

La temática **«Casa»** (`THEME_PRESETS`, id `house`) sigue existiendo como un ejemplo entre muchos (junto a isla desierta, etc.).

## Archivos tocados por área

- **Asistente y landing**: `src/components/landing/new-game-form.tsx`, `template-import.tsx`, `src/app/page.tsx` (titular y párrafo con ejemplos variados).
- **TV y resultados**: `src/components/screen/{player-card,results-view,podium,award-overlay,mascot-cue}.tsx`.
- **Móvil y espectador**: `src/components/play/{house,gallery-vote}.tsx`, `src/components/spectator/watch-view.tsx`.
- **Anfitrión**: `src/components/host/{replay-view,initial-image-card,pending-images,gallery-card,overview-panel,settings-panel,jobs-panel,catalog-panel,players-panel}.tsx`.
- **Superadmin**: `src/components/admin/{system-template-step,system-template-from-collection,system-templates-panel,library-items,library-image-picker}.tsx`.
- **Imagen del podio y SEO**: `src/lib/seo/{podium-image.tsx,site.ts,og-image.tsx}`, `src/app/{layout,manifest}.ts(x)`.
- **Dominio y errores**: `src/lib/domain/{errors,template,template-assets,initial-catalog,types,replay,system-template-pack}.ts` (mensajes y comentarios; las claves JSON `casa_inicial` NO cambian).
- **IA** (solo mensajes y comentarios, no prompts ni lógica): `src/lib/ai/{demo,types,compose,cloudflare,aihorde,huggingface,pollinations}.ts`. `demo.ts`: la etiqueta del SVG de pegatinas y el prompt registrado dicen «Imagen base».
- **Servicios/config/cliente**: `src/lib/services/*`, `src/lib/config/env.ts`, `src/lib/client/*`, `src/lib/library/taxonomy.ts` (solo la etiqueta/pista visible de `start`; slugs intactos), `src/lib/images/normalize.ts` (comentario).
- **Legal** (solo vocabulario, `LEGAL_UPDATED` sin cambiar): `src/app/legal/page.tsx` (objeto del servicio), `src/app/privacidad/page.tsx`, `src/lib/legal/site.ts`.
- **Scripts**: `scripts/assets/normalize-photos.mjs`, `scripts/docs/screenshots.mjs` (sin textos antiguos de UI; los nombres de archivo `asistente-paso2-casas` se conservan porque el README los enlaza).
- **Tests y e2e**: aria-labels/alt y textos afirmados («Imagen de X», «Imagen final de X», «Imagen inicial: …», «Cómo cambian las imágenes», comentarios de pasos del asistente) en `tests/` y `e2e/`.

## Lo que se ha dejado a propósito

- Identificadores técnicos: `casa_inicial` (formato de plantilla), `HouseImage`, `house.tsx`, `catalog_id: 'house'`, `data-testid` (`replay-houses`, `wizard-house-chosen`…), id de paso `casas`, nombres de archivo `scene-casa-inicial-*` y nombres de archivo reconocidos (`casa…`, `inicial…`).
- «Casa» como temática de ejemplo (`themes.ts`, `template.ts` por defecto, fixtures de tests), «Cine en casa», «desde casa» (espectador), emoji-list y léxico (`casa=house`), «casamiento/casar» (emparejar fotos, otra palabra).
- Categoría de biblioteca «Objetos del hogar» (nombre de colección, no un mensaje de producto).
- Prompts de IA (`prompts.ts`): ya hablan de «imagen base» genérica; `themes.ts` conserva la descripción en inglés de la escena vacía de cada temática.
- Migraciones y datos sembrados: no se editan. Si alguna plantilla del sistema ya guardada en BD lleva texto con «casa» (títulos/descripciones), se cambia desde el panel `/admin`, no desde código.
- `docs/LEGAL.md` y README: los reescribe otra rama.
