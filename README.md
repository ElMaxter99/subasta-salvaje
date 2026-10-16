# 🎪 Subasta Salvaje

Subasta creativa multijugador para noches de juegos. Cada jugador parte de una casa (o isla, nave, castillo…) **vacía** y un presupuesto. El anfitrión dirige la subasta desde el móvil, la **televisión** muestra el espectáculo y, cada vez que alguien gana un elemento, la **IA edita la imagen de su casa** para añadirlo, de forma acumulativa.

- **Dos interfaces sincronizadas** por partida:
  - `/game/[código]/screen` — pantalla pública 16:9 para la tele (solo lectura, sin controles).
  - `/game/[código]/host` — panel privado del anfitrión (móvil / tablet / portátil), protegido con login.
- Más: `/` (landing), `/new-game`, `/login`, `/game/[código]/history` (versiones de imagen y restauración, protegido), `/game/[código]/results` (resultados), `/setup` (diagnóstico de configuración).
- **Dos modalidades** (se eligen al crear la partida y se pueden cambiar en Ajustes):
  - **Pujas del anfitrión:** los jugadores pujan en voz alta y el anfitrión las registra. No necesitan cuenta ni móvil.
  - **Cada jugador desde su móvil:** los jugadores entran con el código de sala (o escaneando el QR que muestran la TV y el panel) en `/join` o `/game/[código]/play`, eligen su nombre y pujan ellos mismos. El anfitrión sigue anunciando, cerrando y adjudicando (y puede seguir pujando por voz).

## Índice

1. [Arquitectura](#arquitectura)
2. [Qué funciona sin credenciales (modo demo)](#modo-demo)
3. [Ejecutar en local](#ejecutar-en-local)
4. [Configurar Supabase (modo real)](#configurar-supabase)
5. [Configurar el proveedor de IA](#configurar-la-ia)
6. [Trabajos de generación de imágenes (cola / worker)](#trabajos-de-ia)
7. [Desplegar en Vercel](#desplegar-en-vercel)
8. [Comprobar la sincronización TV ↔ anfitrión](#comprobar-la-sincronizacion)
9. [Variables de entorno](#variables-de-entorno)
10. [Pruebas y calidad](#pruebas-y-calidad)
11. [Seguridad](#seguridad)
12. [Costes y servicios externos](#costes)
13. [Solución de problemas](#solucion-de-problemas)

---

## Arquitectura

```
Navegador (TV)  ──GET /api/public/games/CODE──┐
Navegador (host) ─POST /api/games/CODE/actions─┤        Next.js (Vercel)
                                               ▼   ┌───────────────────────────┐
                              Servicios TS (zod) ──►│ funciones SQL ss_* (RPC)  │──► PostgreSQL (Supabase)
                                               │   │  dinero · pujas · cola    │
                       after() / cron / worker │   └───────────────────────────┘
                                               ▼
                       Proveedor de imágenes (OpenAI) ──► Supabase Storage (bucket game-images)

Realtime: tras cada cambio el servidor envía un Broadcast "changed" {version} por Supabase Realtime.
          Los clientes releen el estado de la BD (fuente de verdad) y sólo aplican versiones MAYORES.
```

Decisiones clave:

- **Una única implementación de la lógica de juego: SQL.** Toda la lógica de dinero, pujas, adjudicación y cola de imágenes vive en funciones PL/pgSQL (`supabase/migrations/20260101000000_core.sql`, funciones `ss_*`). En producción se invocan con `supabase.rpc`; en el modo demo y en los tests se ejecuta **el mismo SQL** sobre [PGlite](https://pglite.dev) (PostgreSQL real compilado a WASM). No hay dos implementaciones divergentes.
- **Atomicidad e idempotencia.** Cada función mutante bloquea la fila de la partida (`SELECT … FOR UPDATE`), de modo que las operaciones de una partida se serializan. `ss_award` verifica estado, saldo y datos esperados (`expected_winner_id`, `expected_price_cents`), cierra la subasta, descuenta el saldo, crea la compra (`UNIQUE(auction_id)`) y el trabajo de imagen (`UNIQUE(purchase_id)`) en **una sola transacción**. Un doble clic, una recarga o un reintento HTTP no pueden cobrar dos veces. Importes siempre en **céntimos enteros**.
- **Seguridad por servidor.** El navegador nunca habla con las tablas: RLS está activado sin permisos para `anon`/`authenticated`, y todo pasa por rutas de Next.js que verifican la sesión de Supabase Auth y la propiedad de la partida (`games.host_id`), con la `service_role` solo en el servidor.
- **Realtime compatible con Vercel.** Sin servidor WebSocket propio: Supabase Realtime *Broadcast* (publicado por REST desde el servidor) + *polling* de seguridad. La BD es la fuente de verdad; un evento duplicado o atrasado se ignora comparando `version`.
- **Imágenes.** `ImageGenerationProvider` (`src/lib/ai/types.ts`) con `generateInitialScene`, `editScene` y `generateItemImage`. Proveedor real: OpenAI `gpt-image-1` (edición con imagen de referencia, `input_fidelity=high`). Proveedor `demo`: SVG locales marcados «DEMO» (no es IA).

<a id="modo-demo"></a>
## Qué funciona sin credenciales (modo demo)

Si **no** defines las variables de Supabase y `NODE_ENV !== 'production'`, la app arranca en **modo demo**:

- Base de datos local PGlite (`./.demo-data/pgdata`), imágenes en disco (`./.demo-data/images`).
- Acceso de anfitrión con un botón (sin cuenta).
- El modo de imágenes **pegatinas** (escenas SVG y emojis de los elementos) es local y no usa IA; en el modo demo la interfaz muestra además un banner amarillo permanente de «datos locales».
- Con `IMAGE_PROVIDER=cloudflare` (u `openai`) y sus credenciales en modo demo se usa la IA real (la BD y el almacenamiento siguen siendo locales). Solo `IMAGE_PROVIDER` activa un proveedor real: tener credenciales en el entorno no basta.
- En producción sin credenciales la app **no** cae a modo demo: muestra `/setup` con lo que falta (salvo que fuerces `ALLOW_DEMO_MODE=true`, no recomendado).
- El botón «Cargar partida de ejemplo (demo)» de la landing crea una partida con jugadores, compras e imágenes para probar la interfaz.

<a id="ejecutar-en-local"></a>
## Ejecutar en local

Requisitos: Node.js ≥ 20 y npm.

```bash
npm install
npm run dev            # http://localhost:3000  → modo demo si no hay .env.local
```

1. Abre `http://localhost:3000`, pulsa **Crear partida** → **Entrar como anfitrión (demo)**.
2. Crea la partida con 4 o más jugadores. En el panel, genera la imagen inicial de cada casa y pulsa **Empezar partida**.
3. Abre la **pantalla de TV** (botón «Abrir en pestaña nueva») en otra pestaña/ventana o dispositivo de la misma red (`http://IP-DE-TU-PC:3000/game/CÓDIGO/screen`).

Para usar Supabase en local ve a [Configurar Supabase](#configurar-supabase) y copia `.env.example` a `.env.local`.

### Supabase en local (opcional, con Docker)

```bash
npx supabase init            # una sola vez (crea supabase/config.toml)
npx supabase start           # levanta Postgres, Auth, Storage y Realtime en Docker
npx supabase db reset        # aplica supabase/migrations/*.sql
npx supabase status          # muestra API URL, anon key y service_role key → .env.local
```

<a id="configurar-supabase"></a>
## Configurar Supabase

1. Crea un proyecto en <https://supabase.com> (el plan gratuito basta para jugar).
2. **Aplicar migraciones.** En *SQL Editor*, ejecuta **en orden** el contenido de:
   1. `supabase/migrations/20260101000000_core.sql` (tablas, índices, restricciones y funciones `ss_*`).
   2. `supabase/migrations/20260101000100_security.sql` (RLS, revocación de permisos para `anon`/`authenticated`, bucket de Storage `game-images`).
   3. `supabase/migrations/20260101000200_initial_all.sql` (imagen inicial común para todos).
   4. `supabase/migrations/20260101000300_security_initial_all.sql` (permisos de esa función y bucket con SVG).
   5. `supabase/migrations/20260101000400_mobile_players.sql` y `20260101000500_security_mobile_players.sql` (modo móviles).
   6. `supabase/migrations/20260101000600_mobile_hardening.sql` y `20260101000700_security_mobile_hardening.sql` (endurecimiento).
   7. `supabase/migrations/20260101000800_join_policy_quota.sql` y `20260101000900_security_join_policy_quota.sql` (política de altas de los móviles y cuota de generaciones).
   8. `supabase/migrations/20260101001000_auto_award.sql` y `20260101001100_security_auto_award.sql` (adjudicación automática).
   9. `supabase/migrations/20260101001200_image_mode.sql` y `20260101001300_security_image_mode.sql` (modo de imágenes: pegatinas o IA).
   10. `supabase/migrations/20260101001400_delete_games.sql` y `20260101001500_security_delete_games.sql` (borrado de partidas).

   Con la CLI: `npx supabase link --project-ref TU_REF` y `npx supabase db push`. Si ya aplicaste archivos a mano en el SQL Editor, antes marca esas versiones: `npx supabase migration repair --status applied 20260101000000 20260101000100 …`.

   O con la CLI: `npx supabase link --project-ref TU_REF && npx supabase db push`.
3. **Claves.** *Project Settings → API*: copia `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`, `anon public` → `NEXT_PUBLIC_SUPABASE_ANON_KEY` y `service_role` → `SUPABASE_SERVICE_ROLE_KEY` (**secreta**, solo servidor).
4. **Auth.** *Authentication → Providers → Email* activado. Para jugar rápido puedes desactivar *Confirm email*; si lo dejas activo, el anfitrión debe confirmar su correo tras registrarse. En *Authentication → URL Configuration* pon tu dominio de Vercel como *Site URL*.
5. **Storage.** La migración de seguridad crea el bucket `game-images` (público de **lectura**, máx. 10 MB, solo PNG/JPEG/WebP). Nadie salvo el servidor (`service_role`) puede subir, modificar ni listar objetos. Comprueba en *Storage* que el bucket existe.
6. **Realtime.** No hay que activar replicación de tablas: se usa *Broadcast* (activo por defecto). Si lo tienes desactivado, en *Project Settings → Realtime* permite *Broadcast*.
7. **RLS.** Verifica en *Database → Tables* que todas las tablas muestran RLS activado y que *Database → Functions* no es ejecutable por `anon` (la migración ya revoca `EXECUTE`).

<a id="configurar-la-ia"></a>
## Configurar el proveedor de imágenes

Cada **partida** elige su modo de imágenes al crearla (y puede cambiarlo en *Ajustes* mientras esté en la sala de espera):
- **🎨 Pegatinas con emojis** (por defecto): cada compra añade el emoji del elemento a la casa. Son ilustraciones SVG locales: **sin IA, gratis e instantáneo**, y siempre están disponibles. Cada imagen lleva la marca «Modo pegatinas · sin IA» y se guarda con `provider = 'demo'` (la interfaz la etiqueta como «Pegatinas»).
- **✨ Con IA**: usa el proveedor de IA real configurado (`IMAGE_PROVIDER=cloudflare` u `openai`), con cuotas por partida y por día. Esta opción solo aparece disponible si el despliegue tiene IA configurada.

**Ninguna credencial activa la IA por sí sola**: hay que pedirla con `IMAGE_PROVIDER`. Si la pides y faltan credenciales, la IA aparece como «no disponible» (las partidas en modo IA dejan sus trabajos en cola) y **nunca se cambia automáticamente a otro proveedor ni se activa un plan de pago**. Si el proveedor falla, la compra, el saldo y la imagen anterior se conservan y se puede seguir jugando; el trabajo se puede reintentar sin volver a cobrar.

### Cloudflare Workers AI (primera opción real)

Verificado en la documentación oficial de Cloudflare (consulta de las páginas de modelos y precios; en el entorno de desarrollo no pude abrir las páginas completas, solo sus extractos, así que **contrasta los detalles críticos con la doc vigente y prueba con una llamada real antes de confiar en ellos**):

| Modelo | Uso | Entrada | Salida |
|---|---|---|---|
| `@cf/black-forest-labs/flux-1-schnell` (**por defecto**, el más económico) | Generación texto→imagen: imagen inicial de la casa e imágenes de elementos | JSON `prompt` (1–2048 caracteres), `steps` (1–8, por defecto 4) | `image`: base64 (JPEG) |
| `@cf/black-forest-labs/flux-2-klein-4b` (opcional) | **Edición** multi-referencia | `multipart/form-data`: `prompt`, `width`, `height`, `input_image_0..3` (cada una < 512×512); 4 pasos fijos | `image`: base64 |

Endpoint REST: `POST https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/ai/run/{modelo}` con `Authorization: Bearer {CLOUDFLARE_API_TOKEN}`. La respuesta se interpreta como `{ result: { image } }` (también se admite `{ image }` o una imagen binaria).

**Limitación importante:** `flux-1-schnell` **no admite imagen de referencia, así que no puede editar la casa existente**. Con él, la imagen inicial y las imágenes de elementos se generan, pero las ediciones por compra salen como *fallidas* con un mensaje claro (la compra, el saldo y la imagen anterior se conservan; el panel avisa y no gasta cuota). Opciones:
- Definir `CLOUDFLARE_EDIT_MODEL=@cf/black-forest-labs/flux-2-klein-4b`: la app redimensiona la casa actual a < 512 px (con `sharp`) y la envía como `input_image_0`. **Esta ruta está implementada según la documentación y probada solo con respuestas simuladas, no contra la API real**; la calidad de conservación de detalles con referencias tan pequeñas puede ser limitada y el coste por imagen es mayor que el de schnell.
- Usar otro proveedor con edición real (`IMAGE_PROVIDER=openai`) o integrar uno nuevo implementando `ImageGenerationProvider` (`src/lib/ai/types.ts`, ver `capabilities.edit`) y registrándolo en `src/lib/services/context.ts`.

Cuota y coste (según la documentación en el momento de escribir esto, sujeta a cambios): Workers AI incluye **10 000 *neurons* al día gratis**; más allá solo se factura en el plan *Workers Paid* (desde 5 USD/mes), que **no se activa solo**. Algunos modelos exigen el plan de pago (las peticiones del plan gratuito devuelven 403). flux-1-schnell se factura por *tile* de 512×512 (4,80 neurons) y por paso (9,60 neurons); una imagen de 1024×1024 con 4 pasos serían ≈ 58 neurons, es decir, del orden de 170 imágenes/día gratis (estimación mía a partir de esas cifras). Comprueba los precios vigentes en la página oficial de precios de Workers AI.

**Cómo obtener y configurar las credenciales (sin exponerlas en el frontend):**
1. Crea una cuenta en <https://dash.cloudflare.com> (el plan gratuito basta para empezar; **no añadas método de pago** si no quieres cobros).
2. **Account ID:** en el panel, *Workers & Pages* (barra lateral derecha, «Account ID») o en la URL `dash.cloudflare.com/<ACCOUNT_ID>/…`.
3. **API token:** *My Profile → API Tokens → Create Token* → plantilla **«Workers AI»** (o un token personalizado con el permiso *Account · Workers AI*). Cópialo una sola vez.
4. En `.env.local` (local) o *Settings → Environment Variables* de Vercel (Production y Preview) define `IMAGE_PROVIDER=cloudflare`, `CLOUDFLARE_ACCOUNT_ID` y `CLOUDFLARE_API_TOKEN`. Son variables **solo de servidor** (sin prefijo `NEXT_PUBLIC_`): las llamadas a Cloudflare se hacen únicamente en el backend (`/api/…`, worker y `after()`); el navegador nunca ve el token. Los mensajes de error guardados no incluyen el token.
5. Redespliega y comprueba en el panel (pestaña *Imágenes*) el proveedor y el contador de cuota.

### Límites de generaciones reales
`IMAGE_QUOTA_PER_GAME` (por defecto **10**) e `IMAGE_QUOTA_PER_DAY` (por defecto **50**, global a todas las partidas del despliegue, día UTC; es un límite **propio de la app**, independiente del de Cloudflare) limitan las llamadas a proveedores **reales** (`demo` no cuenta). La reserva es atómica en la base de datos (`ss_reserve_image_quota`) y cuenta cada llamada al proveedor, incluidas las que fallan. El panel del anfitrión muestra el contador en una etiqueta siempre visible de la cabecera («IA 3/10 · hoy 12/50», en ámbar al 80 % y en rojo al llegar al límite) y con detalle en la pestaña *Imágenes*. **Interruptor de seguridad:** `IMAGE_AI_DISABLED=true` apaga toda la IA real al instante (las partidas en modo pegatinas siguen funcionando; las de modo IA dejan sus trabajos en cola). Al alcanzar el límite, el trabajo falla con un mensaje claro («Cuota diaria de generaciones alcanzada (100/100)…»), la imagen anterior se conserva, la partida sigue y el trabajo se puede reintentar al día siguiente o tras subir el límite (el reintento no cobra ni vuelve a adjudicar nada). Si el contador diario está por debajo del límite de Cloudflare (10 000 neurons), no deberías llegar a un cobro; si pones un límite mayor del que cubre tu cuota gratuita, Cloudflare devolverá un error de cuota agotada y el trabajo fallará sin reintentos.

### OpenAI (alternativa de pago)
1. Crea una API key en <https://platform.openai.com/api-keys> (puede requerir verificación de organización para `gpt-image-1`).
2. `IMAGE_PROVIDER=openai` y `OPENAI_API_KEY` (opcionales: `OPENAI_IMAGE_MODEL`, `OPENAI_IMAGE_SIZE`, `OPENAI_IMAGE_QUALITY`, `OPENAI_IMAGE_INPUT_FIDELITY`, ver `.env.example`). Admite edición con imagen de referencia (`input_fidelity=high`).

### Cómo se edita una casa
La imagen actual del jugador + un prompt (`src/lib/ai/prompts.ts`) que exige conservar composición, perspectiva y objetos previos, añadir **solo** el nuevo elemento e integrar luz/escala/sombras, sin texto ni marcas de agua. Los modelos no garantizan una conservación perfecta: por eso cada edición crea una **versión nueva** (la anterior se conserva), puedes **reintentar** y **restaurar** versiones desde el historial. Control de costes adicional: máximo 150 trabajos de imagen por partida y 5 reintentos manuales por trabajo. Como el registro de Supabase Auth es abierto, define `ALLOWED_HOST_EMAILS` para que solo esas cuentas sean anfitrión.

<a id="trabajos-de-ia"></a>
## Trabajos de generación de imágenes (cola / worker)

Las generaciones pueden tardar decenas de segundos, así que **no** se hacen dentro de la petición de adjudicar. Al adjudicar, la misma transacción crea un `image_job` (único por compra). Los trabajos viven en PostgreSQL (`image_jobs`) y se procesan con **reclamación atómica** (`ss_claim_image_job`: un trabajo en curso por jugador, ediciones en orden de compra, *lease* de 5 min recuperable si un worker muere, hasta 3 intentos con espera creciente, reintento manual ilimitado). Un fallo **nunca** toca el saldo ni la compra.

Quién procesa la cola (cualquiera de ellos, son compatibles entre sí):

| Mecanismo | Cuándo | Notas |
|---|---|---|
| `after()` tras adjudicar / pedir imagen / reintentar | Inmediato | Corre tras responder, dentro del límite `maxDuration` (300 s) de la función de Vercel. |
| Botón «Procesar cola ahora» + auto-empuje del panel cada ~25 s | Mientras el panel está abierto | Ruta autenticada `POST /api/games/CODE/jobs`. |
| **Vercel Cron** → `GET /api/jobs/process` | `vercel.json` programa 1 vez al día | El plan *Hobby* solo admite crones diarios. Sirve de red de seguridad. |
| Cron externo (GitHub Actions, cron-job.org, UptimeRobot…) | Cada minuto | `curl -H "Authorization: Bearer $CRON_SECRET" https://TU-APP.vercel.app/api/jobs/process` |
| `npm run worker` | Proceso continuo en un VPS/portátil | Requiere `.env.local` con Supabase + OpenAI. `-- --once` para una sola pasada. |

> Vercel **no** ofrece un worker de larga duración: no confíes en hilos en segundo plano. La persistencia en `image_jobs` garantiza que, si una ejecución se corta, otra recoge el trabajo.

Define `CRON_SECRET` (cadena larga aleatoria): Vercel la envía automáticamente en el cron como `Authorization: Bearer …`.

<a id="desplegar-en-vercel"></a>
## Desplegar en Vercel

1. Sube el repositorio a GitHub.
2. En <https://vercel.com/new> importa el repositorio (framework: Next.js, se detecta solo).
3. En *Settings → Environment Variables* define (Production y Preview): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `CRON_SECRET` (y opcionales de `.env.example`).
4. Despliega. Abre `https://TU-APP.vercel.app/setup` para comprobar qué variables detecta la app (no muestra valores).
5. Crea tu usuario en `/login` → *Crear cuenta* y empieza una partida.

Notas: las rutas que generan imágenes declaran `maxDuration = 300`. Si tu proyecto/plan de Vercel no admite ese valor el despliegue o la función pueden fallar: bájalo en `api/games/[code]/actions`, `api/games/[code]/jobs` y `api/jobs/process` (no lo he podido comprobar sin desplegar). La cola persistente cubre las ejecuciones cortadas. El modo demo está desactivado en producción.

<a id="comprobar-la-sincronizacion"></a>
## Comprobar que TV y panel se sincronizan

1. Crea una partida y abre `/game/CÓDIGO/screen` en una pestaña (o la tele) y `/game/CÓDIGO/host` en otra.
2. Empieza la partida, anuncia un elemento: la TV debe cambiar sin recargar. Registra pujas: el precio y el líder se actualizan al instante.
3. Adjudica (con confirmación): salta la animación «¡ADJUDICADO!», baja el saldo una sola vez y aparece «Construyendo …» sobre la casa; al terminar el trabajo, la imagen se sustituye con una transición.
4. Indicadores: el panel muestra «En directo» (Realtime conectado), «Sincronizando» (polling) o «Sin conexión · reintentando». Apaga el wifi unos segundos y vuélvelo a encender: el estado se recupera solo.
5. Diagnóstico rápido: `GET /api/runtime` devuelve modo y variables que faltan; `GET /api/public/games/CÓDIGO` devuelve el estado público.

<a id="variables-de-entorno"></a>
## Variables de entorno

| Variable | Obligatoria | Dónde | Descripción |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Sí (modo real) | cliente+servidor | URL del proyecto Supabase. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Sí (modo real) | cliente+servidor | Clave pública (sin permisos sobre tablas por RLS). |
| `SUPABASE_SERVICE_ROLE_KEY` | Sí (modo real) | **solo servidor** | Clave de servicio. Nunca en el navegador. |
| `SUPABASE_STORAGE_BUCKET` | No | servidor | Bucket de imágenes (por defecto `game-images`). |
| `IMAGE_PROVIDER` | No (vacío = sin IA) | servidor | `cloudflare` \| `openai`. Activa el modo «Con IA». Ninguna credencial lo activa sin esto. |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` | Con `cloudflare` | **solo servidor** | Credenciales de Workers AI. |
| `CLOUDFLARE_IMAGE_MODEL`, `_IMAGE_STEPS`, `CLOUDFLARE_EDIT_MODEL`, `_EDIT_WIDTH`, `_EDIT_HEIGHT` | No | servidor | Modelos y parámetros (ver arriba). |
| `IMAGE_QUOTA_PER_GAME`, `IMAGE_QUOTA_PER_DAY` | No (10 / 50) | servidor | Límite de generaciones reales por partida y por día. |
| `IMAGE_AI_DISABLED` | No | servidor | `true` = interruptor de seguridad: apaga toda la IA real. |
| `OPENAI_API_KEY` | Con `openai` | **solo servidor** | Alternativa de pago. |
| `OPENAI_IMAGE_MODEL` / `_SIZE` / `_QUALITY` / `_INPUT_FIDELITY` / `OPENAI_BASE_URL` | No | servidor | Ajustes del proveedor. |
| `ALLOWED_HOST_EMAILS` | Recomendada | servidor | Correos autorizados como anfitrión (evita gasto de IA por terceros). |
| `GAME_TTL_HOURS` | No (12) | servidor | Horas de inactividad tras las que una partida se borra sola. |
| `CRON_SECRET` | Recomendada | servidor | Protege `/api/jobs/process`. |
| `FORCE_DEMO_MODE`, `ALLOW_DEMO_MODE`, `DEMO_DATA_DIR`, `WORKER_INTERVAL_MS` | No | servidor | Desarrollo / worker. |

<a id="pruebas-y-calidad"></a>
## Pruebas y calidad

```bash
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit
npm test             # Vitest: lógica real de SQL sobre PGlite + proveedor + validación
npx playwright test  # E2E (Chromium) del flujo completo en modo demo
npm run build        # build de producción
```

Las pruebas de Vitest ejecutan las **mismas funciones SQL** que producción (PGlite = PostgreSQL real). Cubren: crear partida y jugadores con presupuesto; pujas válidas; rechazo por saldo, por importe y tras el cierre; adjudicación, cobro único y adjudicaciones concurrentes/duplicadas; creación del trabajo de IA, compra intacta tras fallos, reintento sin recobro; versiones y restauración; autorización de anfitrión; estado público tras cambios; final de partida y clasificación.

**Pruebas contra PostgreSQL real (opcionales, recomendadas antes de producción).** PGlite es de una sola conexión, así que además hay `tests/postgres-real.test.ts`, que se omite salvo que definas `PG_TEST_URL` (superusuario; crea y borra una base temporal propia):

```bash
PG_TEST_URL=postgres://postgres@localhost:5432/postgres npx vitest run tests/postgres-real.test.ts
```

Con varias conexiones simultáneas comprueba: 16 adjudicaciones a la vez → una compra y un cobro; pujas y reintentos en paralelo; varios workers sobre varias partidas sin deadlocks ni trabajos duplicados. Además aplica **ambas migraciones con los roles `anon`/`authenticated`/`service_role`** (esquemas `auth`/`storage` simulados) y verifica que `anon` no puede leer tablas ni ejecutar funciones `ss_*` (tampoco las futuras) y que el bucket tiene los límites esperados. Lo que NO se ha podido probar sin un proyecto real: el comportamiento exacto de PostgREST/Realtime/Storage de Supabase y la API real de OpenAI.

<a id="seguridad"></a>
## Finalizar y borrar partidas

- **Finalizar:** desde *Resumen*, al **pausar** la partida aparece «Finalizar partida» junto a «Reanudar» (también está en *Ajustes → Zona de peligro*). Pide escribir `FINALIZAR`, cancela cualquier subasta en curso sin cobrar y la TV muestra los resultados.
- **Borrar:** *Ajustes → Borrar partida* (solo el anfitrión propietario, en cualquier estado). Pide escribir `BORRAR` y elimina **para siempre** la partida con jugadores, pujas, compras, historial, trabajos y **todas sus imágenes de Storage**. La TV y los móviles pasan a mostrar «Esta partida ya no existe».
- **Borrado automático:** una partida se borra sola tras **12 h sin actividad** (cambia el plazo con `GAME_TTL_HOURS`, de 1 a 720). «Actividad» es cualquier acción en la partida (pujar, adjudicar, ajustes…), no el tiempo desde que se creó; mirar la TV no cuenta. El panel de Ajustes muestra cuándo caducará. Se ejecuta de dos formas: limpieza oportunista al crear o listar partidas (no necesita cron) y `GET /api/jobs/purge` (protegido con `CRON_SECRET`; `vercel.json` lo programa una vez al día a las 04:30 UTC). Si pasa más tiempo sin que nadie use la app, las partidas caducadas se borran en cuanto alguien cree o liste partidas o se ejecute el cron. Las migraciones borran en orden de dependencias (`ss_wipe_game`); si falla la limpieza de archivos de Storage, la partida ya está borrada y solo quedan archivos huérfanos (se registra en los logs).

## Adjudicación automática

Para que el anfitrión pueda jugar sin pulsar «Adjudicar» en cada ronda, en el panel (*Subasta → Adjudicación automática*) se puede activar y configurar:
- **Por tiempo:** la subasta abierta se adjudica sola N segundos (3–300, por defecto 20) después de la **última puja**. Cada puja nueva, deshacer una puja o reabrir la subasta reinician la cuenta atrás.
- **Instantánea:** en cuanto nadie más puede superar la puja actual (todos los demás tienen un saldo igual o inferior), se adjudica al momento, incluso si la puja viene de un móvil.
- La TV, el móvil de los jugadores y el panel muestran la cuenta atrás (calculada con la hora del servidor). No se adjudica sola con la subasta cerrada, la partida en pausa o la función desactivada (por defecto está **desactivada**).
- Usa el mismo núcleo SQL (`ss_award_core`) que la adjudicación manual: se cobra una sola vez, se crea la compra y el trabajo de imagen; un «Adjudicar» manual posterior no vuelve a cobrar.

Cómo se ejecuta sin un proceso en segundo plano (Vercel): cualquier lectura del estado (la TV, los móviles o el panel, que sondean cada pocos segundos) comprueba si la cuenta atrás venció y, en ese caso, adjudica (`ss_auto_award`, idempotente y con bloqueo de la partida). Cada cliente además relee el estado justo al llegar a cero. **Limitación:** si no hay ningún dispositivo con la partida abierta, no se adjudica hasta que alguien la abra; el anfitrión siempre puede adjudicar a mano.

## Modo móviles: identidad de los jugadores

Los jugadores **no tienen cuenta**. Al unirse (reclamar un nombre libre o entrar con uno nuevo en la sala de espera) el servidor genera un token aleatorio que va en una cookie `httpOnly` del móvil; en la base de datos solo se guarda su hash SHA-256 y la vista pública solo expone si la casilla está ocupada (`claimed`). Las pujas del móvil pasan por `POST /api/play/[código]/bid`, que identifica al jugador por esa cookie y aplica **las mismas reglas SQL** que las del anfitrión (saldo, mínimo, subasta abierta, idempotencia) más una: no puedes pujar contra ti mismo. Quien llega primero reclama la casilla; si alguien se equivoca o cambia de móvil, el anfitrión pulsa «Liberar móvil». El código de sala da acceso de juego: compártelo solo con quien quieras que participe.

## Bucket con SVG (opcional)
El bucket `game-images` admite `image/svg+xml` solo para el modo pegatinas y la galería de imágenes iniciales (los escribe únicamente el servidor, con texto escapado). Si usas solo un proveedor real y subes tus propias imágenes, puedes quitarlo: `update storage.buckets set allowed_mime_types = array['image/png','image/jpeg','image/webp'] where id = 'game-images';`

## Cómo se evita filtrar credenciales al desplegar

- **Solo en variables de entorno.** `.env`, `.env.local` y similares están en `.gitignore` (y en `.vercelignore` para despliegues con la CLI); solo se versiona `.env.example`, sin valores. Las credenciales reales (Supabase, Cloudflare, OpenAI, `CRON_SECRET`) se definen en *Vercel → Settings → Environment Variables*.
- **Nunca en el navegador.** Solo las variables `NEXT_PUBLIC_…` (URL y clave *publishable/anon* de Supabase, públicas por diseño) llegan al cliente. `CLOUDFLARE_API_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY` y `CRON_SECRET` se leen únicamente en el servidor; ningún componente cliente importa los módulos que los usan (lo comprueba un test).
- **Redacción en errores y logs.** Los mensajes de error de los proveedores, de la base de datos y de los trabajos de imagen pasan por `redactSecrets` (por formato `cfut_…`, `sb_secret_…`, `sk-…`, JWT, `Bearer …` y por el valor exacto de las variables secretas) antes de guardarse o registrarse.
- **Escáner antes de desplegar:** `npm run build && npm run scan:secrets` busca credenciales en los archivos versionados, en todo el historial de git y en el bundle del navegador (`.next/static`), incluidos los valores exactos de tu `.env.local`. Falla con código 1 si encuentra algo. `npm test` incluye comprobaciones equivalentes sobre los archivos versionados.
- **Si un secreto se publicó** (en un commit, un chat o un log), **rótalo** en su proveedor: borrarlo del historial no basta.

## Seguridad

- Sin secretos en el cliente; `service_role` y `OPENAI_API_KEY` solo en servidor.
- RLS activado en todas las tablas sin permisos para `anon`/`authenticated`; `EXECUTE` de las funciones revocado a `PUBLIC/anon/authenticated`.
- Cada acción del anfitrión: sesión de Supabase Auth → propiedad de la partida (`host_id`, comprobada **otra vez en SQL**) → validación Zod → reglas en SQL.
- La vista pública (`ss_get_state` con `view=public`) no incluye `host_id`, prompts, errores técnicos ni eventos.
- Comprobación de origen en POST, límite de peticiones (en memoria por instancia: protección básica, no global), subidas validadas por **bytes reales** (PNG/JPEG/WebP, ≤ 8 MB) y salida del proveedor validada igual.
- No se usan URLs con tokens de acceso al panel; la autenticación va en cookies de sesión.
- El código de sala **no** protege el panel de control: solo da acceso de lectura a la pantalla pública.

<a id="costes"></a>
## Costes y servicios externos

- **Supabase**: plan gratuito suficiente para uso casual (Postgres, Auth, Storage, Realtime). Revisa límites de almacenamiento y de proyectos pausados por inactividad.
- **Vercel**: el plan *Hobby* sirve para empezar (crones diarios, límite de duración de funciones menor que 300 s).
- **OpenAI Images**: de pago por imagen (varía según modelo, calidad y tamaño; consulta la tabla de precios vigente). Una partida de 6 jugadores y ~12 compras ≈ 20-30 imágenes. Puedes bajar el coste con `OPENAI_IMAGE_QUALITY=low`.

<a id="solucion-de-problemas"></a>
## Solución de problemas

| Síntoma | Causa probable / solución |
|---|---|
| `/setup` en producción | Faltan variables de Supabase en Vercel; define las tres y vuelve a desplegar. |
| «No tienes permisos para controlar esta partida» | Has entrado con otra cuenta. Inicia sesión con la que creó la partida. |
| «function ss_xxx does not exist» / errores `internal` | No se aplicó `…_core.sql`, o se aplicó parcialmente. Revisa los logs de Vercel y ejecuta las migraciones en orden. |
| `permission denied` al llamar a `ss_*` | La `service_role` no tiene `EXECUTE`: ejecuta `…_security.sql` (incluye los `GRANT`). |
| Las imágenes no se generan («en cola») | Falta `OPENAI_API_KEY`, la cuenta no tiene acceso a `gpt-image-1`, o no hay worker: pulsa «Procesar cola ahora» o configura el cron. Mira el error en la sección *Imágenes* del panel. |
| Error 400 de OpenAI sobre `input_fidelity` | Tu modelo no lo admite: `OPENAI_IMAGE_INPUT_FIDELITY=off`. |
| «El modelo configurado solo genera imágenes nuevas…» | `flux-1-schnell` no edita. Define `CLOUDFLARE_EDIT_MODEL` o usa otro proveedor con edición (ver *Configurar el proveedor de imágenes*). |
| «Cuota … alcanzada» | Se llegó a `IMAGE_QUOTA_PER_GAME`/`PER_DAY` (o a la cuota gratuita de Cloudflare). La partida sigue; reintenta más tarde o sube el límite. |
| La imagen cambia demasiado la casa | Normal en modelos generativos: usa **Restaurar** en el historial y reintenta; sube `OPENAI_IMAGE_QUALITY` a `high`. |
| La TV no se actualiza al instante | Realtime no conectado → la TV sigue por *polling* (≤ 8 s). Comprueba que Broadcast está permitido en Supabase. |
| La TV se ve cortada | Pulsa el botón de pantalla completa (aparece al mover el ratón) y usa una ventana 16:9. |
| Modo demo en producción | No existe: sin credenciales verás `/setup`. |
| `npm run worker` dice «sólo funciona con Supabase» | El worker externo no sirve para el modo demo (BD local abierta por el servidor de desarrollo). |
| Build falla por `maxDuration` | Tu plan de Vercel limita la duración; reduce el valor en las rutas `api/games/[code]/actions`, `…/jobs` y `api/jobs/process`. |

---

Licencia: uso personal. Generado con la ayuda de Claude Code.
