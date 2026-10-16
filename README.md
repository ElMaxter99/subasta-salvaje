# 🎪 Subasta Salvaje

Subasta creativa multijugador para noches de juegos. Cada jugador parte de una casa (o isla, nave, castillo…) **vacía** y un presupuesto. El anfitrión dirige la subasta desde el móvil, la **televisión** muestra el espectáculo y, cada vez que alguien gana un elemento, la **IA edita la imagen de su casa** para añadirlo, de forma acumulativa.

- **Dos interfaces sincronizadas** por partida:
  - `/game/[código]/screen` — pantalla pública 16:9 para la tele (solo lectura, sin controles).
  - `/game/[código]/host` — panel privado del anfitrión (móvil / tablet / portátil), protegido con login.
- Más: `/` (landing), `/new-game`, `/login`, `/game/[código]/history` (versiones de imagen y restauración, protegido), `/game/[código]/results` (resultados), `/setup` (diagnóstico de configuración).
- Las pujas las registra el anfitrión (los jugadores no necesitan cuenta ni móvil).

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
- Si no hay `OPENAI_API_KEY`: proveedor de **muestra** (escenas SVG y «pegatinas» de los elementos). Toda imagen lleva la marca visible **«DEMO · imagen de muestra, no generada por IA»**, se guarda con `provider = 'demo'` y la interfaz muestra un banner amarillo permanente. **No es IA**.
- Con `OPENAI_API_KEY` en modo demo se usa la IA real (la BD y el almacenamiento siguen siendo locales).
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

   O con la CLI: `npx supabase link --project-ref TU_REF && npx supabase db push`.
3. **Claves.** *Project Settings → API*: copia `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`, `anon public` → `NEXT_PUBLIC_SUPABASE_ANON_KEY` y `service_role` → `SUPABASE_SERVICE_ROLE_KEY` (**secreta**, solo servidor).
4. **Auth.** *Authentication → Providers → Email* activado. Para jugar rápido puedes desactivar *Confirm email*; si lo dejas activo, el anfitrión debe confirmar su correo tras registrarse. En *Authentication → URL Configuration* pon tu dominio de Vercel como *Site URL*.
5. **Storage.** La migración de seguridad crea el bucket `game-images` (público de **lectura**, máx. 10 MB, solo PNG/JPEG/WebP). Nadie salvo el servidor (`service_role`) puede subir, modificar ni listar objetos. Comprueba en *Storage* que el bucket existe.
6. **Realtime.** No hay que activar replicación de tablas: se usa *Broadcast* (activo por defecto). Si lo tienes desactivado, en *Project Settings → Realtime* permite *Broadcast*.
7. **RLS.** Verifica en *Database → Tables* que todas las tablas muestran RLS activado y que *Database → Functions* no es ejecutable por `anon` (la migración ya revoca `EXECUTE`).

<a id="configurar-la-ia"></a>
## Configurar el proveedor de IA

El proveedor real incluido es **OpenAI Images** (`gpt-image-1`), que admite *edición con imagen de referencia*:

1. Crea una API key en <https://platform.openai.com/api-keys> (la organización puede requerir verificación para usar `gpt-image-1`).
2. Define `OPENAI_API_KEY` (y opcionalmente `OPENAI_IMAGE_MODEL`, `OPENAI_IMAGE_SIZE`, `OPENAI_IMAGE_QUALITY`, `OPENAI_IMAGE_INPUT_FIDELITY`, ver `.env.example`).
3. Para probar el flujo completo sin gastar IA, define `IMAGE_PROVIDER=demo` (con Supabase real): usa el proveedor de **muestra** (SVG marcados «DEMO», no es IA) y la interfaz lo avisa con un banner. Requiere que el bucket admita `image/svg+xml` (ya incluido en la migración de seguridad).
4. La clave solo se usa en el servidor. Sin ella los trabajos quedan **en cola** (nunca se simulan) y la interfaz del anfitrión lo indica.

Control de costes: máximo 150 trabajos de imagen por partida y 5 reintentos manuales por trabajo. Como el registro de Supabase Auth es abierto, define `ALLOWED_HOST_EMAILS` (lista de correos separados por comas) para que solo esas cuentas puedan ser anfitrión.

Cómo se edita una casa: la imagen actual del jugador + un prompt (`src/lib/ai/prompts.ts`) que exige conservar composición, perspectiva y objetos previos, añadir **solo** el nuevo elemento e integrar luz/escala/sombras, sin texto ni marcas de agua. Los modelos no garantizan una conservación perfecta: por eso cada edición crea una **versión nueva** (la anterior se conserva), puedes **reintentar** y **restaurar** versiones desde el historial.

Para usar otro proveedor implementa `ImageGenerationProvider` (`src/lib/ai/types.ts`) y regístralo en `src/lib/services/context.ts`.

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
| `OPENAI_API_KEY` | Para IA real | **solo servidor** | Sin ella: trabajos en cola (o imágenes DEMO en modo demo). |
| `OPENAI_IMAGE_MODEL` / `_SIZE` / `_QUALITY` / `_INPUT_FIDELITY` / `OPENAI_BASE_URL` | No | servidor | Ajustes del proveedor. |
| `ALLOWED_HOST_EMAILS` | Recomendada | servidor | Correos autorizados como anfitrión (evita gasto de IA por terceros). |
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
| La imagen cambia demasiado la casa | Normal en modelos generativos: usa **Restaurar** en el historial y reintenta; sube `OPENAI_IMAGE_QUALITY` a `high`. |
| La TV no se actualiza al instante | Realtime no conectado → la TV sigue por *polling* (≤ 8 s). Comprueba que Broadcast está permitido en Supabase. |
| La TV se ve cortada | Pulsa el botón de pantalla completa (aparece al mover el ratón) y usa una ventana 16:9. |
| Modo demo en producción | No existe: sin credenciales verás `/setup`. |
| `npm run worker` dice «sólo funciona con Supabase» | El worker externo no sirve para el modo demo (BD local abierta por el servidor de desarrollo). |
| Build falla por `maxDuration` | Tu plan de Vercel limita la duración; reduce el valor en las rutas `api/games/[code]/actions`, `…/jobs` y `api/jobs/process`. |

---

Licencia: uso personal. Generado con la ayuda de Claude Code.
