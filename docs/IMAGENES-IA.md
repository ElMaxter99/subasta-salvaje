# Imágenes e IA

## Modos por partida (`games.image_mode`)
- **`stickers` (por defecto):** el proveedor `demo` (`ai/demo.ts`) dibuja escenas SVG y añade el emoji del elemento comprado como pegatina.
  Gratis, instantáneo, sin red; rotulado «Modo pegatinas · sin IA». Siempre disponible (`ctx.stickers`).
- **`ai`:** usa el proveedor real configurado (`ctx.provider`). Solo se puede elegir si `IMAGE_PROVIDER` está bien configurado
  (`ai_not_available` si no). Sin proveedor, los trabajos de partidas `ai` quedan en cola: **nunca se simula**.
Los proveedores implementan `ImageGenerationProvider` (`ai/types.ts`): `generateInitialScene`, `editScene`, `generateItemImage`, `capabilities.edit`.
`ProviderError.retryable` decide si se reintenta (red/429/5xx) o falla ya (moderación, 400, cuota).

## Proveedores
| id | Archivo | Generar | Editar con foto | Notas |
|---|---|---|---|---|
| `cloudflare` | `ai/cloudflare.ts` | `@cf/black-forest-labs/flux-1-schnell` (JSON `prompt`,`steps`; respuesta base64 `image`, JPEG) | `@cf/black-forest-labs/flux-2-klein-4b` por defecto (multipart `prompt`,`width`,`height`,`input_image_0`; referencia < 512 px con sharp) | Primera opción real. Cuota gratuita ≈ 10 000 neuronas/día; edición 1024×768 ≈ 85 neuronas (tarifa publicada, **contrastar**). Edición **sin probar contra la API real**. |
| `openai` | `ai/openai.ts` | `/images/generations` (gpt-image-1) | `/images/edits` | De pago; solo si se pide con `IMAGE_PROVIDER=openai`. No edita SVG. |
| `demo` | `ai/demo.ts` | SVG local | SVG local (pegatinas) | No es IA; no cuenta en cuotas. |

`getImageProviderId` (`config/env.ts`): ninguna credencial activa la IA sola; hay que pedirla con `IMAGE_PROVIDER`. Si faltan credenciales ⇒ `null`
(nunca cambia a otro proveedor). `IMAGE_AI_DISABLED=true` apaga la IA real al instante.

## Edición: real y plan B
`context.ts` envuelve el proveedor Cloudflare con `withEditFallback` (`ai/compose.ts`):
1. **Edición real** con el modelo de edición (la imagen actual del jugador como referencia; prompt de `buildEditPrompt`: añadir SOLO un elemento y conservar todo lo demás).
2. **Plan B por composición** si Cloudflare rechaza la entrada (400/404/422) o no hay modelo de edición (`CLOUDFLARE_EDIT_MODEL=off`):
   genera solo el objeto sobre fondo blanco liso (`isolated`), recorta el fondo (`cutOutBackground`, inundación desde el borde) y lo pega con sombra en uno de 8 huecos
   (`COMPOSE_SLOTS`) sobre la imagen actual (`compositeOnto`). **Es un collage, no una edición real** (sin adaptar luz/perspectiva). Cuota, red, credenciales o moderación NO activan el plan B.
   `IMAGE_EDIT_COMPOSE=false` lo desactiva. El proveedor conserva su `id` (no cambia de proveedor ni de cuota).

## Tema, foto del elemento y mezcla al ganar
- **El tema fija el prompt base** de la imagen inicial: las plantillas usan su `emptyScene` (`domain/themes.ts`) y un tema libre se describe como un lugar reconocible (`emptySceneFor`); el prompt incluye siempre «Theme of the game».
- **Imagen de un elemento del catálogo:** «Generar imagen» (job `item`) usa nombre + descripción (+ tema). El anfitrión también puede **subir su propia foto** (`/api/games/[code]/item-image`, `ss_set_item_image`, migración 2400) y quitarla (`item.clear_image`). Ambas se guardan en `auction_items.image_path`.
- **Mezcla al ganar:** si el elemento tiene foto, el job de edición la carga (`jobContext → itemImagePath`) y la pasa como `EditSceneInput.itemImage`. `buildBlendPrompt`: imagen 0 = imagen del jugador, imagen 1 = elemento; el objeto debe reproducirse fielmente (un conejo rosa con lazo azul sigue siendo rosa con lazo azul) y la casa se conserva. Cloudflare envía `input_image_1` (≤ 480 px) además de `input_image_0`; OpenAI envía `image[]` con dos imágenes (PNG normalizado con sharp, `reference.ts`). **Sin probar contra las APIs reales.**
- **Plan B por composición:** con foto del elemento se pega ESA foto (recortada si tiene fondo liso o enmarcada con esquinas redondeadas si no) y no se genera nada nuevo. Sin foto sigue generándose el objeto aislado.
- Sin foto el comportamiento es el de siempre (solo texto). En modo pegatinas se añade el emoji (la foto no interviene).

## Flujo de la imagen de cada jugador
**Imagen base compartida:** «generar para todos» encola UN job `base` (migración 2000: kind `base`, `image_jobs.scope`, índice único de uno activo por partida); al completarse se crea una `image_version` por jugador apuntando al MISMO archivo y, si `scope.new`, `games.new_player_image` pasa a `file`. Una sola cuota. Solo aplica en `lobby`.
Imagen inicial (subida / galería / generada, para actuales y/o nuevos) → cada compra crea un job `edit` con `base_image_version_id` = imagen actual → al completarse se
crea una `image_version` aprobada y pasa a ser la actual del jugador; **la siguiente edición parte de ella** (cadena por jugador, verificado en `tests/base-photo-evolution.test.ts`).
Si falla tras los reintentos se conserva la última imagen válida, la subasta sigue y el job se puede reintentar (`image.retry`) sin volver a cobrar.

## Cola y worker (`jobs-service.ts`)
`processImageJobs`: reclama jobs (`ss_claim_image_job`, filtra por `image_modes` disponibles), reserva cuota (`ss_reserve_image_quota`, advisory lock) **antes** de llamar al proveedor,
valida la salida por bytes (`image-validation.ts`: PNG/JPEG/WebP; SVG solo del proveedor demo), guarda en Storage y completa (`ss_complete_image_job`) o falla con espera
exponencial. Un worker caído se recupera al caducar el lease. Disparo: `after()` tras acciones, `/api/jobs/process` (cron/HTTP), `npm run worker`.

## Cuotas (`image_usage`)
`IMAGE_QUOTA_PER_GAME` (10) y `IMAGE_QUOTA_PER_DAY` (50, global, día UTC). Cuentan llamadas **reales** (también las fallidas); `demo` no cuenta. El panel muestra
el contador (`ai-usage-chip.tsx`, pestaña Imágenes). Al agotarse: error claro, imagen anterior conservada, partida continúa.

## Prompts (`ai/prompts.ts`)
Inicial: escena VACÍA con cámara fija. Edición: añadir exactamente UN elemento conservando composición, cámara y objetos previos (se listan). Objeto: aislado
(`isolated` ⇒ fondo blanco liso). Siempre «sin texto, letras ni marcas de agua».

## Cuota local: devolución cuando no se gastó nada (fase 0 del plan de proveedores)
Cada trabajo reserva UNA unidad en `image_usage` antes de llamar al proveedor. Si la llamada falla y se sabe que **no gastó** cuota del proveedor
(`ProviderError.consumed === false`: sin conexión, credenciales rechazadas, 4xx/429 o cuota diaria agotada de Cloudflare, 401/403/429 de OpenAI, o la
entrada se preparó mal antes de llamar), el servicio llama a `ss_release_image_quota` y la unidad se **devuelve** (borra una fila del trabajo; idempotente).
Los fallos dudosos (5xx, moderación, respuesta sin imagen) se siguen contando. Los reintentos reservan otra unidad como siempre. **No se ha probado contra Cloudflare/OpenAI reales.**
