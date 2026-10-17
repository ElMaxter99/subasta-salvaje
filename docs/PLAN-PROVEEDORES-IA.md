# Plan: más proveedores de imágenes IA sin pagar

> Estado: **propuesta** (octubre de 2026). No hay código implementado. Documento de análisis para decidir con el propietario.
> Reglas que se respetan: `CLAUDE.md` (lógica de dinero/cuotas en SQL `ss_*`, nada de pago automático, honestidad, secretos fuera del repo).

## 0. Cómo se investigó (léelo antes de fiarte de las cifras)

La investigación web se hizo con la herramienta de **búsqueda** (resúmenes y fragmentos). El acceso directo a las páginas oficiales
(`developers.cloudflare.com`, `ai.google.dev`, `huggingface.co`, `docs.pollinations.ai`…) **falló** desde el entorno (sin resolución DNS / proxy 403),
así que **ninguna cifra de este documento se ha leído en la página oficial en vivo**. Cada dato lleva una marca:

- **[F]** fuente oficial citada por el buscador (fragmento de la página del proveedor o de su blog/documentación), aún no releída completa.
- **[T]** solo terceros (blogs, agregadores, foros): orientativo, a veces contradictorio.
- **[?]** no se pudo verificar.

Antes de implementar cada fase hay que **releer la página oficial** (enlaces en §8) y registrar la fecha. Las capas gratuitas cambian cada pocos meses
(p. ej. la de Gemini se recortó a finales de 2025 según [T]).

## 1. Resumen ejecutivo y recomendación

**Hallazgo principal:** la capa gratuita *real y recurrente* para imagen vía API es escasa. Lo que se puede afirmar con razonable confianza:

1. **Cloudflare Workers AI** sigue siendo la mejor opción gratuita: 10 000 neuronas/día sin pagar, reinicio 00:00 UTC [F]. Ya está integrada.
2. **Gemini API (imagen)**: las fuentes más recientes indican que **ya no hay capa gratuita para los modelos de imagen** (precio ≈ 0,039 $/imagen en 2.5 Flash Image) [F+T conflictivo]. Descartada como «gratis»; solo sería un proveedor de pago opt-in con tope.
3. **Hugging Face Inference Providers**: crédito gratuito mensual **mínimo** (≈ 0,10 $ para cuentas gratis, 2 $ PRO) [F]; sin pago por uso para cuentas gratis. Insuficiente para producción; útil solo como respaldo marginal.
4. **Together AI, fal.ai, Replicate, Fireworks, Stability, BFL, Leonardo**: créditos **de bienvenida únicos**, no recurrentes, y en varios casos con tarjeta [T]. No cumplen «más uso gratis sostenido».
5. **Pollinations.ai**: afirma un uso gratuito con clave (sistema «pollen») y modelos de imagen incluidos Kontext (edición) [F parcial]; los límites exactos y los términos comerciales **no se pudieron verificar** [?]. Candidato interesante pero **hay que comprobarlo con una clave real** antes de depender de él.
6. **Autoalojado (ComfyUI + FLUX.2 [klein] 4B, Apache 2.0)**: la única vía con uso **ilimitado y sin cuota** (coste = hardware/electricidad del propietario). Soporta texto→imagen y edición multi-referencia [F: BFL]. Requiere una GPU de consumidor (≈ 13 GB de VRAM según BFL; hay cifras menores en [T]) y un túnel seguro.

**Recomendación (orden de la cadena):**

| Orden | Proveedor | Papel | Coste |
|---|---|---|---|
| 1 | **Cloudflare** (ya existe) | genera + edita (klein-4B) | gratis hasta 10 000 neuronas/día |
| 2 | **Autoalojado ComfyUI/FLUX.2 klein 4B** (si el propietario tiene GPU) | genera + edita, sin cuota | 0 € de API |
| 3 | **Pollinations** (tras verificar) | genera (+ edición si se confirma) | gratis con clave, sujeto a límites [?] |
| 4 | **Composición** (`compose.ts`) | «edición» sin IA, siempre disponible | 0 |
| opt-in | Gemini / fal / BFL / OpenAI | **solo** con clave explícita + tope de gasto | de pago |

Si el propietario **no** tiene GPU, la ganancia realista es modesta: Cloudflare + Pollinations (si se confirma) + composición. La mayor mejora
barata sin proveedor nuevo es **ahorrar neuronas** (ver §4.9). No se recomienda crear varias cuentas de un mismo proveedor para multiplicar la capa gratis (suele violar sus términos).

## 2. Estado actual

| Pieza | Archivo | Qué hace hoy |
|---|---|---|
| Interfaz | `src/lib/ai/types.ts` | `ImageGenerationProvider { id: 'openai'\|'cloudflare'\|'demo'; capabilities.edit; generateInitialScene; editScene(base, itemImage?, previousItems…); generateItemImage }`. `ProviderError.retryable` decide reintento. |
| Cloudflare | `cloudflare.ts` | Genera con `flux-1-schnell` (JSON, base64 JPEG). Edita con `flux-2-klein-4b` (multipart `input_image_0..1`, ≤ 480 px, 1024×768). Detecta «cuota diaria agotada» ⇒ error **no reintentable**. |
| OpenAI | `openai.ts` | `gpt-image-1`: `/images/generations` y `/images/edits` (`image[]` con casa + elemento). De pago, solo con `IMAGE_PROVIDER=openai`. |
| Demo | `demo.ts` | Pegatinas SVG, sin IA, no cuenta cuota. |
| Plan B | `compose.ts` | `withEditFallback`: si klein rechaza la entrada (400/404/422) o no hay modelo de edición, genera el objeto aislado (o usa la foto del elemento), recorta el fondo (`cutOutBackground`) o enmarca (`frameImage`) y lo pega (`compositeOnto`). **Collage honesto, no edición real.** Cuota, red, credenciales o moderación **no** lo activan. |
| Selección | `config/env.ts` `getImageProviderId` | **Un solo** proveedor (`IMAGE_PROVIDER`), sin fallback entre proveedores. `IMAGE_AI_DISABLED` lo apaga. |
| Ensamblado | `services/context.ts` `buildProvider` | Devuelve un proveedor único; `ctx.stickers` para el modo pegatinas. |
| Cola | `services/jobs-service.ts` | `runJob`: `reserveQuota` **antes** de llamar (RPC `ss_reserve_image_quota`, bloqueo asesor, cuenta por partida y por día UTC **de todos los proveedores sumados**), `generate`, valida bytes, sube a Storage, `ss_complete_image_job` con `provider`. Si falla: `ss_fail_image_job` con backoff. Cada reintento reserva otra unidad. |
| Cuotas | migraciones `…0800_join_policy_quota`, `…2200_superadmin` | `image_usage(game_id sin FK desde la 2200, job_id, provider, created_at, host_id)`. Sobrevive al borrado de partidas (DECISIONES nº 32). `app_settings` tiene `ai_enabled`, `quota_per_game`, `quota_per_day`; `ai_provider_override` figura en `PLAN-SUPERADMIN.md` pero **no está implementado** (no existe en `settings.ts`). |

Limitaciones que impone el diseño actual a la integración de más proveedores:
- La cuota se reserva con `provider.id` **antes** de elegir; no hay noción de «probar el siguiente».
- Los límites son **globales en número de llamadas**, no por proveedor ni por coste (Cloudflare mide en neuronas; una edición cuesta mucho más que una generación schnell).
- `getJobStatus` (asíncrono) está en la interfaz pero nadie lo usa.

## 3. Matriz comparativa

Leyenda: **T2I** texto→imagen · **EDIT** imagen+prompt→imagen · **MULTI** varias referencias (casa + objeto). «Gratis» = sin tarjeta ni pago.

| Candidato | Cuota gratuita real y periodo | Tarjeta | Uso comercial de lo generado | T2I | EDIT | MULTI | Riesgo de retirada | Estado de verificación |
|---|---|---|---|---|---|---|---|---|
| **Cloudflare Workers AI** | 10 000 neuronas/día, reinicio 00:00 UTC; sobre eso solo con plan Workers Paid (0,011 $/1000 neuronas) [F]. klein-4B: ≈ 5,4 neuronas/tile 512² de entrada y ≈ 26/tile de salida, 4 pasos fijos [T, repo comunitario]; klein-9B ≈ 1364 neuronas por 1 MP [F, página en preview] | No para la capa gratuita (en la cuenta gratis, al agotarla da error; no cobra) [F parcial] | Licencia del modelo: klein-4B Apache 2.0; **klein-9B y dev son no comerciales** (FLUX NCL) [F: BFL]. Revisar términos de Cloudflare para modelos de terceros [?] | Sí (schnell, klein) | Sí (klein-4B) | Sí, hasta 4 refs < 512 px [F: código actual + doc] | Medio-bajo (es parte de su oferta de plataforma) | Parcial; **neuronas de schnell [?]**, edición real sin probar contra la API |
| **Gemini API** (2.5 Flash Image «Nano Banana», 3 Pro Image) | **Sin capa gratuita para imagen** según las fuentes más recientes; hubo 500 RPD gratis hasta ≈ dic. 2025/feb. 2026 [T]; pago ≈ 0,039 $/imagen [F] | Sí para facturar | Salidas con marca SynthID; términos de Google AI (revisar) [?] | Sí | Sí | Sí (varias imágenes) | Alto (ya cambió) | **Contradictorio**; no usar como «gratis» |
| **Hugging Face Inference Providers** | ≈ 0,10 $/mes (gratis), 2 $/mes PRO; sin pago por uso en cuentas gratis [F] | No | Depende del modelo y del proveedor subyacente | Sí | Algunos (según proveedor) | Depende | Alto (cifra ya cambió «sujeto a cambios») | Parcial |
| **HF Spaces (ZeroGPU) vía `gradio_client`** | 2 min/día sin autenticar, 5 min cuenta gratis, 40 min PRO de GPU [F]; fallos conocidos con tokens en `gradio_client` [T] | No | Depende del Space | Sí | Sí (según Space) | Según Space | Alto (Spaces ajenos pueden caerse o cambiar la API) | Parcial; **no apto para producción** |
| **Together AI** | Antes: endpoint «FLUX.1 schnell Free»; sigue listado en una ayuda de oct. 2025 [F]; en 2026 los agregadores discrepan (créditos de 5/25 $ o solo pago) [T] | Posible | schnell Apache 2.0 | Sí | Algunos modelos (Kontext) de pago | Algunos | Alto | **No confirmado en oct. 2026 [?]** |
| **Pollinations.ai** | Uso gratuito con clave (saldo «pollen», niveles en beta); anónimo con límite por IP [F parcial]; cuotas exactas [?] | No (según [T]) | **[?]** términos no verificados | Sí | Sí (Kontext listado) [F parcial] | [?] | Alto (proyecto comunitario, API ya cambió a `gen.pollinations.ai`) | Parcial; **verificar con clave real** |
| **OpenRouter** | Modelos `:free` solo texto en lo encontrado; el router gratuito devuelve texto [F+T]. Sin modelo de imagen gratuito confirmado | No (créditos) | Según modelo | — | — | — | Alto | **No hay candidato gratuito verificado** |
| **fal.ai** | Créditos de bienvenida únicos (≈ 20 $ con correo corporativo) [T]; Kontext ≈ 0,04 $/img [T, inconsistente] | Probable | Según modelo | Sí | Sí | Sí | Retirada de créditos: media | Solo terceros |
| **Replicate** | Prueba limitada, sin importe fiable [T]; Kontext pro ≈ 0,04 $/img [T] | Sí para continuar | Según modelo | Sí | Sí | Sí | Media | Solo terceros |
| **Fireworks** | ≈ 1 $ de bienvenida único [T] | Posible | Según modelo | Sí | Limitado | ? | Media | Solo terceros |
| **Stability AI** | 25 créditos únicos (≈ 0,25 $) [T]; Core 3 cr., Ultra 8 cr. [T] | No para los 25 | Community License < 1 M$ de ingresos [T] | Sí | Sí (endpoints de edición) | Limitado | Media | Solo terceros |
| **Black Forest Labs (API)** | **Sin capa gratuita** hallada; FLUX.2 pro 0,03 $/MP, edición 0,045 $/MP; Kontext pro 0,04 $/img [F: ayuda BFL] | Sí | Pro API comercial; pesos 4B Apache 2.0, 9B/dev no comerciales [F: BFL] | Sí | Sí | Sí (entradas facturadas por MP) | Media | Parcial |
| **Mistral** | Le Chat generó imágenes con FLUX gratis en 2024 [T]; API de imágenes vía agentes: límites [?] | [?] | [?] | Sí (vía agente) | [?] | [?] | — | **No verificado** |
| **Leonardo.ai** | App: 150 tokens/día, salidas no comerciales [T]; la API es de pago aparte (≈ 5 $ de inicio) [T] | Sí | Gratis: no comercial | Sí | Sí | Limitado | — | Solo terceros; **descartado** |
| **OpenAI** (ya integrado) | Ninguna | Sí | Sí | Sí | Sí | Sí | — | Ya en código |
| **Autoalojado ComfyUI + FLUX.2 klein 4B** | **Ilimitado** (tu GPU). Apache 2.0 [F: BFL] | No | Sí (Apache 2.0) | Sí | Sí | Sí, multi-referencia [F: BFL; una plantilla de ComfyUI recomienda Dev para casos complejos: probar] | Nulo (es tuyo) | Licencia/capacidad verificadas; **latencia y calidad por probar en tu máquina** |
| **Autoalojado Stable Diffusion/SDXL + IP-Adapter/inpainting** | Ilimitado | No | Según checkpoint | Sí | Inpainting sí; mezcla casa+objeto peor que FLUX.2 | Limitado | Nulo | No verificado, no recomendado frente a klein |
| **Ollama** | — | — | — | **No genera imágenes** (confirmado por el enunciado) | — | — | — | Descartado |

Calidad/latencia/fiabilidad orientativas (sin medir): Cloudflare ~ segundos (schnell 4 pasos), edición klein pocos segundos; FLUX.2 klein 4B local ≈ 1–5 s en una RTX 4070-3090 según BFL («sub-second» en hardware alto de gama) [F, afirmación del fabricante]; Gemini/OpenAI 5–30 s; Pollinations variable (cola) [?]. **Nada de esto está medido en este proyecto.**

## 4. Arquitectura propuesta

### 4.1 Principios (de CLAUDE.md)
1. Dinero/cuota/estado en SQL `ss_*`; TypeScript valida y orquesta.
2. Ningún proveedor «de pago» se activa solo: exige clave puesta por el propietario **y** tope de gasto.
3. La subasta nunca se bloquea: la cadena termina siempre en composición o en «conservar la última imagen».
4. Los reintentos/restauraciones no tocan saldos (sin cambios).

### 4.2 Metadatos del proveedor (`ai/types.ts`)
Ampliar el tipo, sin romper los existentes:
```ts
type ProviderId = 'cloudflare' | 'openai' | 'demo' | 'selfhosted' | 'pollinations' | 'gemini' | 'fal' | ...;
interface ProviderMeta {
  id: ProviderId;
  tier: 'free' | 'self' | 'paid';          // 'paid' exige tope y confirmación (ver 4.6)
  capabilities: { generate: true; edit: boolean; multiRef: number /* 0,1,2 */ };
  unitCost(kind: 'generate'|'edit'|'item'): number; // unidades propias (neuronas, céntimos…), para contabilidad
}
```
`ImageGenerationProvider` conserva `generateInitialScene / editScene / generateItemImage` y añade `meta`. `capabilities.edit` se mantiene por compatibilidad.

### 4.3 Cadena con fallback (`ai/chain.ts`, nuevo)
`createProviderChain(entries: ProviderEntry[], opts)` devuelve un `ImageChain` con `candidates(kind)`: la lista ordenada de proveedores aptos
(filtrados por capacidad: para `edit` solo los que `edit=true`; al final la composición). **La reserva de cuota y la llamada se hacen en `jobs-service`**,
no dentro del proveedor, para que la contabilidad siga en SQL:

```
for (cand of chain.candidates(job.kind)):
   r = reserveQuota(cand)            // ss_reserve_image_quota con provider_limit y coste
   if !r.ok  -> registrar «saltado por cuota de <id>» y continuar con el siguiente
   try  generate(cand) -> éxito (completar job con provider = cand.id)
   catch ProviderError e:
        si e.kind in {quota, rate_limit(429 con Retry-After largo), auth, unavailable}: marcar «cooldown» al proveedor y continuar
        si e.retryable (red/5xx): reintentar 1 vez con backoff corto en el MISMO proveedor, luego continuar
        si moderación/400: NO probar otros con el mismo contenido sensible salvo configuración; falla el job (se conserva la imagen)
si ninguno -> composición (solo edit/item con foto) -> si falla, ss_fail_image_job
```
`ProviderError` gana un campo `kind: 'quota'|'rate_limit'|'auth'|'moderation'|'input'|'network'|'server'|'invalid_output'` (compatible: `retryable` se deriva). El
mapeo actual del texto «daily free allocation/neurons» pasa a `kind:'quota'`.

**Cooldown en memoria con TTL** (p. ej. hasta las 00:00 UTC para cuotas diarias; `Retry-After` para 429) para no gastar peticiones en un proveedor agotado; es
una optimización, la verdad está en SQL.

Atención a la **consistencia visual**: si la cadena cambia de proveedor entre la edición *n* y la *n+1* de una misma casa, el estilo puede variar. Mitigación: la
edición siempre parte de la imagen actual (ya ocurre) y el prompt fuerza «conservar todo lo existente»; registrar `provider` en `image_versions`. Opción `IMAGE_CHAIN_STICKY=true`:
preferir el proveedor que produjo la versión anterior de ese jugador si está disponible.

### 4.4 Interfaz común y normalización
- Entrada de referencias: `toReferencePng(img, maxSide)` (ya existe) con `maxSide` configurable **por proveedor** (Cloudflare 480; OpenAI 1024; local 1024).
- Salida: cada adaptador devuelve `{bytes, mime}`; `validateProviderOutput` valida por bytes (sin cambios). Normalizador nuevo `normalizeOutput(bytes, {w:1536,h:1024})` con `sharp` para que todos los proveedores entreguen el mismo aspecto 3:2 y un máximo de 10 MB, evitando saltos de tamaño entre proveedores.
- Formatos de API a soportar: JSON+base64 (Cloudflare schnell, OpenAI, Gemini `inlineData`), multipart (Cloudflare klein, OpenAI edits), JSON con URL de resultado (fal/Replicate/Pollinations: descargar con tope de tamaño y de host permitido) y workflow JSON de ComfyUI (`POST /prompt`, `GET /history/{id}`, `GET /view`; subida en `POST /upload/image`) — este último es **asíncrono con polling**, el motivo de usar `getJobStatus` o un bucle interno con timeout.
- Cada adaptador: `timeout` propio (`AbortSignal.timeout`), `User-Agent`, `redactSecrets` en todos los mensajes, y descarga de URLs externas **solo** a hosts de una lista blanca (evita SSRF).

### 4.5 Reintentos, timeouts y 429
- 429/5xx/408/red: `retryable=true`, respetar `Retry-After`; máximo 1 reintento inmediato por proveedor y por intento del job; después se pasa al siguiente candidato (el backoff exponencial de `ss_fail_image_job` queda para cuando falla **toda** la cadena).
- Timeouts: Cloudflare 120 s (actual), local 180 s (cold start de modelo), Pollinations 90 s, Gemini 120 s.
- Un 401/403 marca el proveedor como `unhealthy` hasta el siguiente reinicio/cambio de configuración, y se avisa en el panel.

### 4.6 Cuota y contabilidad por proveedor (SQL)
Migración nueva (nunca editar las aplicadas). Contenido:
- `image_usage`: añadir `units numeric not null default 1` (neuronas, céntimos o 1 llamada), `cost_cents numeric not null default 0`, `kind text`, `outcome text` (`ok|error|skipped`).
- `provider_budgets` (clave `provider`, `day_limit_units`, `month_limit_units`, `cost_cap_cents_day`, `enabled`, `paid_confirmed_at`): tabla con RLS deny-all; se edita desde el superadmin.
- `ss_reserve_image_quota` **nueva versión** (`create or replace` copiando la de `…2200_superadmin`): además de partida/día globales, comprueba el tope **del proveedor** (unidades por día UTC, y coste si `tier='paid'`) y devuelve `reason: 'game'|'day'|'provider_day'|'provider_cost'` con `provider`. Si el proveedor es de pago y `paid_confirmed_at is null` o no hay `cost_cap_cents_day`, devuelve `ok:false, reason:'paid_not_confirmed'` (**cinturón y tirantes** además del control en TS).
- `ss_image_usage`/informes del superadmin: desglose por proveedor y día. Los intentos «saltados» **no** consumen cuota (solo `outcome='skipped'` si se quiere trazabilidad; mejor no insertar).
- Cuota global: la semántica pasa a «llamadas reales a cualquier proveedor» (igual que hoy). Los topes por proveedor son adicionales.
- Neuronas: tabla de costes configurable `CLOUDFLARE_NEURONS_PER_EDIT` / `…_PER_GENERATE` (valores iniciales estimados; **calibrar con el panel de uso de Cloudflare**). Como la cuenta de Cloudflare es la verdad, la app solo estima y deja margen (p. ej. tope 9 000 de 10 000).

### 4.7 Configuración (env y superadmin)
Variables nuevas (todas opcionales; sin ellas, comportamiento actual):
```
IMAGE_PROVIDERS=cloudflare,selfhosted,pollinations     # orden de la cadena; sustituye a IMAGE_PROVIDER (que sigue valiendo para uno solo)
IMAGE_CHAIN_COMPOSE=true                               # composición como último recurso (≈ IMAGE_EDIT_COMPOSE)
SELFHOSTED_COMFY_URL=https://…  SELFHOSTED_TOKEN=…     # ComfyUI detrás de túnel con autenticación
POLLINATIONS_API_KEY=…
GEMINI_API_KEY=…  GEMINI_PAID_ACK=yes  GEMINI_MAX_COST_CENTS_DAY=200   # de pago: sin ACK y sin tope no entra en la cadena
```
Reglas: (a) un proveedor `tier:'paid'` solo se carga si existen clave **y** `*_PAID_ACK=yes` **y** tope > 0; (b) `IMAGE_AI_DISABLED` sigue apagándolo todo; (c) la cadena nunca *añade* proveedores
por tener credenciales: solo los listados en `IMAGE_PROVIDERS`.
Superadmin (cumple el aviso de `PLAN-SUPERADMIN.md`: «el panel no puede elegir proveedor sin credenciales en env, y cambiar a uno de pago exige confirmación explícita»):
`app_settings.ai_chain` (orden y activo/inactivo por proveedor, solo entre los configurados en env), topes por proveedor, interruptor por proveedor, estado de salud/cooldown y uso del día por proveedor. Confirmación explícita (escribir el nombre) para pasar un proveedor de pago a activo.

### 4.8 Proveedor autoalojado (`ai/selfhosted.ts`)
- Cliente HTTP de ComfyUI con **workflows plantilla** JSON versionados en el repo (`src/lib/ai/workflows/*.json`): T2I FLUX.2 klein 4B y edición con 2 imágenes de referencia (casa + objeto). Se sube cada referencia con `/upload/image`, se parametriza el prompt, se encola, se hace polling con timeout y se descarga el resultado.
- Seguridad: el servidor del propietario **no se expone en abierto**: túnel (Cloudflare Tunnel/Tailscale Funnel) con token en cabecera y límite de tamaño. La app solo lo usa si responde a un `GET /system_stats` previo (comprobación de salud con cooldown) porque el PC puede estar apagado.
- Aviso: Vercel (serverless) necesita acceso entrante al PC; documentar la latencia y que si el PC está apagado la cadena pasa a Cloudflare.
- Alternativa más simple: un pequeño servicio propio (FastAPI/diffusers) con dos endpoints; más código fuera de este repo, por lo que se descarta para la primera fase.

### 4.9 Ahorro de cuota gratuita sin proveedor nuevo (fase 0)
> **Estado (17-10-2026): hecho lo implementable sin servicio real.** (1) **Devolución de cuota local** cuando el proveedor no gastó nada
> (`ProviderError.consumed`, migración `…3600`/`…3700` con `ss_release_image_quota`): sin conexión, 401/403, 4xx/429 y «cuota diaria agotada» de Cloudflare
> (y 401/403/429 de OpenAI) ya no agotan el contador local de 50/día; ante la duda (5xx, moderación, respuesta rota) se sigue contando.
> (2) **`npm run ai:measure`** para medir con tus credenciales (el propietario lo ejecuta; **no probado contra el servicio real**).
> (3) El tamaño de salida de la edición ya es configurable (`CLOUDFLARE_EDIT_WIDTH/HEIGHT`; probar 768×512 con `ai:measure --edit --size=768x512`).
> **Pendiente:** medir neuronas reales y fijar `IMAGE_QUOTA_PER_DAY`; caché de resultados idénticos (mismo base+elemento, p. ej. deshacer y rehacer) — no implementada
> porque ahorra poco frente a su complejidad (columna de clave de caché en `image_versions`); el resto de las fases (cadena de proveedores, autoalojado, Pollinations) sigue pendiente de las decisiones del propietario.
- Reutilizar la **imagen base compartida** (ya existe) y la foto del elemento (subida o generada una vez): una generación por elemento, no por compra.
- Elegir la salida de menor tamaño (klein: 1024×768 es lo adecuado; probar 768×512 si la calidad lo permite) para reducir neuronas por tile.
- Cachear resultados idénticos (mismo base+elemento) por hash dentro de la misma partida (p. ej. «deshacer y rehacer»).
- Medir el coste real por llamada leyendo el panel de Cloudflare y ajustar `IMAGE_QUOTA_PER_DAY` (hoy 50, sin base medida).

> **Estado fase 1 (17-10-2026): implementada la parte sin decisiones del propietario.** `ProviderError.kind`, `src/lib/ai/chain.ts` (proveedor compuesto con
> fallback por cuota/429/auth/red/5xx, enfriamiento en memoria, composición como último recurso, moderación/entrada inválida NO saltan), `IMAGE_PROVIDERS`
> y registro del proveedor que respondió (`GeneratedImage.provider`). **Simplificaciones respecto al diseño de arriba:** la cuota local se reserva una vez por
> trabajo (no por candidato) y no hay topes por proveedor ni de coste, porque los proveedores de pago quedan fuera de la cadena (fase 5). Pendiente: topes
> por proveedor (SQL), panel de superadmin (fase 2) y los adaptadores nuevos (fases 3–4). Probado solo con proveedores simulados.

> **Fase 4 (17-10-2026): adaptador de Pollinations escrito** según `APIDOCS.md` oficial (`/v1/images/generations` y `/v1/images/edits`, Bearer `sk_…`, 402 = presupuesto agotado). Solo tests simulados; sin probar contra el servicio real.

> **Fase 2 (17-10-2026): panel de superadmin implementado (versión reducida).** `/admin/ajustes → Proveedores de IA (cadena)`: apagar/activar cada proveedor y tope diario aproximado por proveedor, con el uso de hoy. Migraciones `…3800`/`…3900` (`ai_providers_off`, `ai_provider_limits`, `ss_provider_usage`, `ss_set_usage_provider`). El orden de la cadena sigue fijándose con `IMAGE_PROVIDERS` en el servidor; no hay tabla `provider_budgets` ni topes de coste (no hay proveedores de pago en la cadena). El tope por proveedor es blando (caché de uso de 15 s); el duro es el global.

## 5. Cambios concretos por archivo

| Archivo | Cambio |
|---|---|
| `src/lib/ai/types.ts` | `ProviderId` ampliado, `ProviderMeta`, `ProviderError.kind`; mantener `retryable` derivado. |
| `src/lib/ai/errors.ts` (nuevo) | Clasificación común HTTP→`kind` (429, 401/403, 402 «sin crédito», moderación, 5xx). |
| `src/lib/ai/chain.ts` (nuevo) | Construcción de candidatos, filtro por capacidad, cooldown, `sticky`. |
| `src/lib/ai/normalize.ts` (nuevo) | `normalizeOutput` (tamaño/formato con sharp). |
| `src/lib/ai/cloudflare.ts` | Usar clasificación común; exponer `meta` y costes en neuronas; sin cambios funcionales. |
| `src/lib/ai/openai.ts` | Idem; `tier:'paid'`. |
| `src/lib/ai/selfhosted.ts` + `workflows/` (nuevos) | Adaptador ComfyUI (§4.8). |
| `src/lib/ai/pollinations.ts` (nuevo, **tras verificar**) | Adaptador GET/POST con clave; descarga de URL con lista blanca. |
| `src/lib/ai/gemini.ts` (nuevo, opcional) | `generateContent` con `inlineData` (varias imágenes) para edición; `tier:'paid'`. |
| `src/lib/ai/compose.ts` | Exponer la composición como candidato final de la cadena (hoy envuelve a un proveedor concreto); la generación del objeto aislado debe usar el siguiente proveedor *disponible*, no solo el interno. |
| `src/lib/config/env.ts` | `imageProviderIds()` (lista), configs nuevos, reglas de «de pago» (§4.7). Mantener `getImageProviderId` para compatibilidad. |
| `src/lib/services/context.ts` | `buildProvider()` → `buildChain()`; `RuntimeInfo.aiProvider` pasa a mostrar la cadena activa. |
| `src/lib/services/jobs-service.ts` | Bucle de candidatos con reserva por proveedor (§4.3); `provider` real del que respondió en `ss_complete_image_job`; `reserveQuota` recibe proveedor. |
| `src/lib/services/settings.ts`, `admin-service.ts`, `src/components/admin/*` | Ajustes de cadena/topes/interruptores y panel de uso por proveedor. |
| `src/lib/domain/types.ts`, `errors.ts` | Estado de IA con lista de proveedores; errores `paid_not_confirmed`, `provider_quota`. |
| `supabase/migrations/2026…_ai_chain.sql` + `…_security_ai_chain.sql` | §4.6 (tablas, columnas, `ss_reserve_image_quota` nueva versión, informe por proveedor); permisos `revoke … from public, anon, authenticated; grant … to service_role`; RLS deny-all en `provider_budgets`. |
| `.env.example`, `README.md`, `docs/IMAGENES-IA.md`, `docs/PENDIENTE.md`, `docs/DECISIONES.md`, `docs/SEGURIDAD.md` | Variables, honestidad («sin probar contra el servicio real»), decisiones y riesgos de privacidad. |

## 6. Pruebas (sin gastar cuota)

- **Unitarias con proveedor simulado** (`tests/ai-chain.test.ts`): proveedores falsos configurables (éxito, 429, cuota, 401, moderación, imagen inválida, timeout). Casos: orden y fallback; cuota agotada salta al siguiente; moderación **no** salta; todos fallan ⇒ composición; todos y composición fallan ⇒ job fallido y última imagen conservada; cooldown; `sticky`.
- **Contrato** (`tests/provider-contract.test.ts`): una batería común que cada adaptador debe pasar con `fetchImpl` simulado y respuestas grabadas (fixtures JSON/multipart sintéticas, **sin claves**): peticiones bien formadas (cabeceras, campos multipart, tamaño de referencias), parseo de respuesta (base64, URL, multipart), mapeo de errores a `kind`, redacción de secretos, salida validada por bytes.
- **SQL** (PGlite con `makeCtx()` + el test de Postgres real): reserva por proveedor, tope de coste, `paid_not_confirmed`, concurrencia (dos workers no superan el tope), `image_usage` sobrevive al borrado de partida, informe por proveedor.
- **Servicio** (`tests/image-jobs.test.ts` ampliado): flujo completo con cadena simulada; los reintentos/restauraciones **no tocan saldos**.
- **Seguridad**: ningún componente cliente importa los adaptadores (test de `service_role`/`getContext` existente); `npm run scan:secrets`.
- **Pruebas reales mínimas y controladas** (manuales, fase aparte): 1 generación + 1 edición por proveedor con clave de prueba y tope bajo; registrar fecha y resultado en `PENDIENTE.md`.
- **e2e** (`e2e/*.spec.ts`): con proveedor simulado, que el panel muestre qué proveedor respondió y el aviso «sin IA» en pegatinas.

## 7. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| **Retirada o recorte de capa gratuita** (ya ocurrió con Gemini [T]) | Cadena configurable en caliente; composición siempre disponible; reverificar cuotas cada trimestre (fecha en este doc). |
| **Cobro accidental** | Proveedores de pago exigen clave + `*_PAID_ACK` + tope; reserva SQL con tope de coste; no hay autodetección por credencial; `IMAGE_AI_DISABLED`. |
| **Términos de servicio / abuso de cuentas** | No crear múltiples cuentas para multiplicar cuotas; respetar límites; usar claves a nombre del propietario. |
| **Privacidad**: las imágenes de las casas y la foto del elemento (subida por el anfitrión; puede contener personas) se envían a terceros | Aviso al anfitrión al activar el modo `ai`; solo se envía la casa del jugador y la foto del elemento, nunca nombres ni correos; revisar si el proveedor entrena con los datos (Cloudflare, Google, Pollinations: **no verificado**); el modo pegatinas no envía nada; el autoalojado no envía nada fuera. |
| **Licencias del modelo** | Preferir pesos Apache 2.0 (klein-4B, schnell); evitar klein-9B / dev / Kontext-dev en uso comercial (licencia no comercial) [F: BFL]; documentar el modelo exacto de cada proveedor. |
| **Marca de agua / metadatos** (SynthID en Gemini, posibles marcas en gratuitos) | Registrar `model` y `provider` en `image_versions`; informar al usuario. |
| **Inconsistencia visual entre proveedores** | Edición siempre sobre la imagen actual; `sticky`; prompts de conservación. |
| **SSRF / descargas externas** | Lista blanca de hosts, tope de tamaño, validación por bytes. |
| **PC del propietario apagado/lento** | Comprobación de salud + cooldown; fallback a Cloudflare/composición. |
| **Estimación de neuronas inexacta** | Margen del 10 %; contraste con el panel de Cloudflare; el 429/«allocation» real sigue marcando cooldown. |
| **Datos de este documento sin verificar en fuente viva** | Marcas [F]/[T]/[?]; relectura obligatoria antes de cada fase. |

Documentación que debe actualizarse al implementar (honestidad): `README` y `IMAGENES-IA.md` (tabla de proveedores, cadena, qué es gratis hoy y desde qué fecha),
`PENDIENTE.md` (claves por crear, pruebas reales por hacer, relectura de cuotas, «edición multi-referencia **sin probar contra la API real**» de cada proveedor), `DECISIONES.md`
(cadena, paid-ack, autoalojado), `SEGURIDAD.md` (tokens del túnel, datos enviados a terceros).

## 8. Fuentes consultadas (vía buscador; páginas no releídas)

- Cloudflare Workers AI, precios: https://developers.cloudflare.com/workers-ai/platform/pricing/ (10 000 neuronas/día; 0,011 $/1000 neuronas; reinicio 00:00 UTC; filas FLUX.2). Fila klein-4B: https://github.com/nolte/claude-shared/issues/638 [T]. schnell: https://community.cloudflare.com/t/flux-1-schnell-cost-and-limits/801029 [T/?].
- Gemini API, precios: https://ai.google.dev/gemini-api/docs/pricing ; foro: https://discuss.ai.google.dev/t/does-gemini-2-5-flash-image-preview-have-free-tier/100509 ; terceros: https://www.aifreeapi.com/en/posts/gemini-image-free-tier-2026 , https://blog.laozhang.ai/en/posts/gemini-image-generation-free-limit-2026 [T].
- Hugging Face Inference Providers: https://huggingface.co/docs/inference-providers/pricing ; ZeroGPU/Spaces: https://huggingface.co/docs/hub/spaces-api-endpoints ; foro: https://discuss.huggingface.co/t/limits-on-gradio-api-hf-spaces/147812 .
- Together AI: https://together.ai/blog/flux-api-is-now-available-on-together-ai-new-pro-free-access-to-flux-schnell ; https://support.together.ai/articles/2644979080-what-models-does-together-ai-support ; https://yangmao.ai/en/providers/together/free-api/ [T].
- Pollinations: https://github.com/pollinations ; https://agentdeals.dev/vendor/pollinations-ai [T]; clave y panel: enter.pollinations.ai (indicado en el README oficial).
- OpenRouter: https://openrouter.ai/blog/tutorials/image-generation-models/ ; https://openrouter.ai/models/openrouter/free ; https://buldrr.com/openrouter-free-api-keys-free-models-simple-guide/ [T].
- fal.ai / Replicate / Fireworks (todos [T]): https://www.costbench.com/software/ai-media-apis/fal-ai/ , https://costbench.com/software/ai-productivity/replicate/free-plan/ , https://yangmao.ai/en/providers/fireworks/no-credit-card/ .
- Stability AI [T]: https://developer.puter.com/tutorials/stability-ai-api-pricing/ , https://fast.io/resources/stability-ai-review-2026/ .
- Black Forest Labs: https://help.bfl.ai/articles/7424166364-wip-welcome-to-the-forest ; https://bfl.ai/models/flux-2-klein ; https://bfl.ai/blog/flux2-klein-towards-interactive-visual-intelligence ; https://comfy.org/templates/image_flux2_klein_image_edit_4b_base .
- Leonardo [T]: https://costbench.com/software/ai-media-apis/leonardo-ai-api/ . Mistral [T/?]: https://onlinemarketing.de/technologie/mistral-ai-le-chat-bildgenerierung-search-coding-for-free .

## 9. Plan por fases

| Fase | Contenido | Esfuerzo | Criterios de aceptación |
|---|---|---|---|
| **0. Verificación** | Releer páginas oficiales (§8), medir neuronas reales de schnell y klein con 2–3 llamadas en la cuenta gratuita, probar Pollinations con una clave gratuita (1 generación + 1 edición), registrar fechas. | 0,5 día | Tabla §3 con todo en [F] o marcado descartado; coste real por llamada documentado. |
| **1. Cadena y contabilidad** | Tipos, `chain.ts`, `errors.ts`, migración SQL por proveedor y topes, `jobs-service` con candidatos, composición como candidato final, tests unitarios/SQL/contrato con simulados. | 3–4 días | Con 2 proveedores simulados: fallback por cuota/429/fallo; moderación no salta; coste de pago jamás supera el tope; `image_usage` por proveedor; lint+typecheck+tests+Postgres real verdes; sin cambio de comportamiento con un solo proveedor. |
| **2. Superadmin y configuración** | `IMAGE_PROVIDERS`, reglas de «de pago», panel (orden, interruptores, topes, uso por proveedor, salud). | 2 días | Un proveedor de pago no puede activarse sin clave + ACK + tope; cambios en caliente; e2e básico. |
| **3. Autoalojado** (si hay GPU) | Adaptador ComfyUI + workflows + health check + guía de túnel. | 3–4 días + pruebas en la máquina del propietario | Una casa evoluciona 5 compras con edición multi-referencia manteniendo consistencia razonable (revisión manual); latencia p95 medida; PC apagado ⇒ fallback sin errores visibles. |
| **4. Pollinations** (si Fase 0 lo confirma) | Adaptador y fixtures de contrato. | 1–2 días | Superado el contrato; prueba real controlada documentada; límites y términos anotados. |
| **5. Opcionales de pago** (Gemini u otro) | Adaptador con tope, solo si el propietario lo decide. | 1–2 días cada uno | Reserva SQL con coste, `paid_not_confirmed`, prueba real con tope de céntimos. |
| **6. Cierre** | Documentación, `PENDIENTE.md`, `npm run build && npm run scan:secrets`. | 0,5 día | Documentación honesta («sin probar contra el servicio real» donde proceda). |

Total aproximado: 9–13 días de trabajo según se incluyan fases 3–5.

### Decisiones que necesita del propietario
1. ¿Hay una máquina con **GPU** (≥ 12–16 GB de VRAM recomendados) que pueda estar encendida durante las partidas, y se acepta un túnel con token? Define si vale la pena la Fase 3.
2. ¿Se permite crear una **clave gratuita de Pollinations** (y revisar sus términos) para la Fase 0/4?
3. ¿Se admite algún proveedor **de pago como opt-in** con tope diario (p. ej. 1–2 €)? Si sí, ¿cuál y qué tope? Por defecto: ninguno.
4. Prioridad entre **coste cero** y **consistencia visual** (¿se tolera que dos proveedores distintos retoquen la misma casa? ¿activar `sticky`?).
5. Aceptación del **aviso de privacidad** sobre imágenes enviadas a terceros en el modo `ai` (y si los anfitriones pueden subir fotos de personas).
6. Cuotas objetivo: ¿cuántas imágenes/día se quieren cubrir gratis? Determina si basta Cloudflare con ahorro (Fase 0) o hace falta el autoalojado.
7. Cuándo lanzar las migraciones (DECISIONES nº 23: «todo de golpe»).

## 10. Nota del 17-10-2026: OpenAI descartado y búsqueda de capas gratuitas
El propietario descarta OpenAI (100 % de pago); su adaptador se conserva sin uso. Búsqueda rápida (solo blogs/directorios de terceros, **ninguna página oficial verificada**):
- **Cloudflare Workers AI:** la única opción gratuita recurrente confirmada por todas las fuentes (ya integrada).
- **Pollinations:** gratis sin clave o con clave gratuita, ~1 petición/15 s anónima; límites oficiales y términos comerciales **sin confirmar**; hay que leer su documentación y probar con una clave real.
- **Hugging Face Inference Providers:** crédito gratuito mensual mínimo (~0,10 $); solo respaldo marginal.
- **Google (Gemini/Imagen):** fuentes contradictorias sobre si hay capa gratuita de imagen (una habla de 500 imágenes/día; otra de ninguna). Verificar en la página oficial antes de nada.
- Créditos de bienvenida de otros servicios (fal, Together, Replicate…): únicos, no recurrentes. No sirven para una cadena sostenida.
