# Pendiente del propietario (para hacer más adelante)

Lista de tareas manuales que NO puede hacer el código por ti. No contiene ningún secreto: **nunca escribas aquí
tokens ni claves**.

## 1. Seguridad: rotar credenciales que se pegaron en el chat
Se compartieron en conversaciones y deben darse por comprometidas:
- [ ] **Cloudflare API token** (`CLOUDFLARE_API_TOKEN`): *dash.cloudflare.com → My Profile → API Tokens → ⋯ → Roll*. Actualiza el valor en Vercel y redespliega.
- [ ] **Supabase secret key** (`SUPABASE_SERVICE_ROLE_KEY`, formato `sb_secret_…`): *Project Settings → API Keys* → genera una nueva y actualiza Vercel y tu `.env.local`.
- [ ] Comprueba después con `npm run build && npm run scan:secrets` que no hay secretos en el repositorio (ya pasa hoy).

## 2. Base de datos (Supabase): aplicar las migraciones nuevas
Desde tu copia local, en PowerShell:
```powershell
git pull
npx supabase db push
```
Después, en el *SQL Editor* de Supabase, una vez: `notify pgrst, 'reload schema';`.
Orden de las migraciones (carpeta `supabase/migrations`): `…0000_core` → `…0100_security` → `…0200`/`…0300` (imagen inicial común)
→ `…0400`/`…0500` (modo móviles) → `…0600`/`…0700` (endurecimiento) → `…0800`/`…0900` (política de altas y cuota)
→ `…1000`/`…1100` (adjudicación automática) → `…1200`/`…1300` (modo de imágenes) → `…1400`/`…1500` (borrado de partidas)
→ `…1600`/`…1700` (imagen inicial para jugadores actuales y nuevos)
→ `…1800`/`…1900` (eventos sorpresa, deshacer adjudicación y galería con votación; renombra `ss_get_state` a `ss_get_state_base` y crea la tabla `gallery_votes`)
→ `…2000`/`…2100` (imagen base única y compartida generada con IA/pegatinas)
→ `…2200`/`…2300` (panel de superadmin: ajustes, perfiles, invitaciones, auditoría; `image_usage` deja de borrarse con la partida)
→ `…2400`/`…2500` (foto propia de los elementos del catálogo)
→ `…2600`/`…2700` (rondas máximas, pujas enteras, imagen inicial obligatoria y subasta automática)
→ `…2800`/`…2900` (puerta de alta: `ss_signup_allowed`; el formulario de la app ya no permite crear cuenta con el registro cerrado) → `…3000`/`…3100` (sonido: interruptores de efectos y música de la TV) → `…3200`/`…3300` (cierre automático de la votación de la galería) → `…3400`/`…3500` (plantillas guardadas del anfitrión: tabla `host_templates`) → `…3600`/`…3700` (devolución de cuota de IA cuando el proveedor no gastó nada) → `…3800`/`…3900` (proveedores de IA: apagado y tope diario por proveedor, uso de hoy) → `…4200`/`…4300` (partidas del sistema: tabla `system_templates` y sus funciones) → `…4400`/`…4500` (`ss_admin_audit_event`) → `…4600`/`…4700` (créditos en el resumen de la plantilla) → `…4000`/`…4100` (máximo de jugadores por partida: columna `games.max_players`, `ss_max_players_cap()` = 10; renombra `ss_get_state` otra vez) Si alguna se aplicó a mano en el SQL Editor, marca antes
esas versiones con `npx supabase migration repair --status applied <versión>`.
Después de cada migración nueva, vuelve a probar a mano: crear partida, pujar, adjudicar (el saldo baja una sola vez) y borrar.

## 3. Vercel: variables de entorno (Production y Preview) y redespliegue
- [ ] `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (públicas) y `SUPABASE_SERVICE_ROLE_KEY` (**solo servidor**).
- [ ] `NEXT_PUBLIC_SITE_URL=https://tu-dominio` (URL pública para Open Graph; ver `docs/OPEN-GRAPH.md`).
- [ ] `ALLOWED_HOST_EMAILS=tu@correo.com` (recomendado: el registro de Supabase Auth es abierto).
- [ ] `CRON_SECRET` (cadena larga aleatoria) para `/api/jobs/process` y `/api/jobs/purge`.
- [ ] IA (opcional): `IMAGE_PROVIDER=cloudflare`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`. Sin ellas solo existe el modo pegatinas.
- [ ] Límites de IA (opcionales): `IMAGE_QUOTA_PER_GAME` (10), `IMAGE_QUOTA_PER_DAY` (50), interruptor `IMAGE_AI_DISABLED=true`.
- [ ] `GAME_TTL_HOURS` (opcional, 168 = 7 días) para el borrado automático por inactividad; el superadmin lo cambia luego en `/admin → Ajustes`.
- [ ] `SUPERADMIN_EMAILS=tu@correo.com` (necesaria para usar `/admin`; la cuenta debe tener el correo confirmado en Supabase Auth).
- [ ] Tras cambiar variables: *Deployments → Redeploy*. Comprueba `/api/health` (debe dar `ok: true`) y `/setup`.

## 4. Supabase Auth y Storage
- [ ] **Plantillas de correo y «He olvidado mi contraseña»:** pega las plantillas de `supabase/templates/` en *Authentication → Email Templates*, pon la *Site URL* y añade `https://TU-DOMINIO/auth/callback` a *Redirect URLs* (ver `docs/EMAILS-Y-CONTRASENA.md`). Sin probar contra Supabase real; para producción, SMTP propio.
- [ ] **Cerrar el registro de verdad:** el cierre del superadmin bloquea el alta desde la app (`/api/auth/signup`) y el acceso de cuentas nuevas, pero la API pública de Supabase Auth sigue aceptando `signUp` directo con la clave anon (esas cuentas no entran en la app). Para cerrarlo del todo desactiva *Authentication → Sign In / Providers → Allow new users to sign up* (y crea tus cuentas desde el panel de Supabase o con invitación). Sin probar contra Supabase real.
- [ ] *Authentication → Providers → Email* activado (opcional: desactivar *Confirm email* para entrar sin confirmar el correo).
- [ ] *Authentication → URL Configuration*: pon tu dominio de Vercel como *Site URL*.
- [ ] Si no usas pegatinas ni la galería, puedes quitar `image/svg+xml` del bucket (ver README, «Bucket con SVG»).

## 5. IA real (cuando quieras probarla)
- [ ] La edición real usa FLUX.2 klein por defecto (sin probar contra la API real: confirma el nombre de los campos multipart y el coste). Con `flux-1-schnell` solo se **genera**; el plan B de «edición» usa por defecto una composición gratuita (collage del objeto sobre la casa; ver README). Prueba una vez con la API real que el recorte del fondo blanco funciona. Solo se **genera** (imagen inicial y de elementos); **no edita** la casa existente. Para editar define `CLOUDFLARE_EDIT_MODEL=@cf/black-forest-labs/flux-2-klein-4b` (implementado según la documentación, **sin probar** contra la API real) u otro proveedor con edición.
- [ ] Contrasta con la documentación vigente de Cloudflare los parámetros del modelo y los precios, y haz una primera generación de prueba con límites bajos.

## 5b. Correos propios con Resend (opcional)
- [ ] Verificar tu dominio en Resend (SPF/DKIM) y crear una API key. En Vercel: `RESEND_API_KEY` (*Sensitive*), `MAIL_FROM`, opcional `MAIL_REPLY_TO`; confirmar `NEXT_PUBLIC_SITE_URL`; redesplegar. Probar: recuperar contraseña, registro con confirmación y «Enviar correo» en `/admin/usuarios`. **Sin probar contra Resend real.**
- [ ] En Supabase → Authentication → Sign In / Providers, desactivar «Allow new users to sign up» (el registro de la app ya no lo usa). Para borrar usuarios ya creados: Authentication → Users, o desde `/admin/usuarios`.

## 5c. Pollinations (segundo eslabón gratuito de la cadena)
- [ ] Crear una clave en Pollinations, **leer sus términos y límites** (no verificados) y definir `POLLINATIONS_API_KEY` (+ `IMAGE_PROVIDERS=cloudflare,pollinations`). Opcional `POLLINATIONS_EDIT_MODEL=black-forest-labs/flux.2-klein-4b` para edición real.
- [x] Primera prueba real (17-10-2026): la clave y el endpoint funcionan (Pollinations respondió 402 «API key budget too low: ~0.0020 pollen por imagen, la clave tiene 0»). El presupuesto se sube **en la clave** (enter.pollinations.ai → editar clave); recargar la cartera no lo aumenta. No metas dinero: solo usa el saldo gratuito que dé tu cuenta, si lo hay.
- [ ] Confirmar que una edición real con imagen también funciona (la generación ya la has visto funcionar tras dar presupuesto a la clave): el adaptador (`src/lib/ai/pollinations.ts`) asume la respuesta OpenAI `data[0].b64_json` (la documentación consultada estaba recortada) y solo lo cubren tests con `fetch` simulado. Si el formato difiere, ajustar y avisar.

## 5c-bis. AI Horde y Hugging Face (más eslabones gratuitos)
- [ ] Aplica las migraciones `…4800`/`…4900` (los ajustes por proveedor admiten los nuevos).
- [ ] **AI Horde:** añade `aihorde` a `IMAGE_PROVIDERS` (sin credenciales; opcional `AI_HORDE_API_KEY` de una cuenta gratuita). Léete sus términos. **Sin probar contra el servicio real**: genera una casa y un objeto y, si falla, copia el error (los nombres de campo pueden diferir).
- [ ] **Hugging Face:** crea un token en tu cuenta gratuita (permiso para Inference Providers), `HF_TOKEN` en Vercel (*Sensitive*) y `huggingface` en `IMAGE_PROVIDERS`. Comprueba que el modelo por defecto (`black-forest-labs/FLUX.1-schnell`) está servido por `hf-inference` y cuánto crédito gratuito tienes.

## 5c-ter. Poses 3D de la mascota (opcional)
La colección con alfa real (`public/assets/mascot-vector/`) es vectorial. Para poses en el estilo 3D de la mascota principal hay que generarlas con un modelo de imagen sobre fondo verde `#00ff00`, pasarlas por `npm run mascot:chroma` y revisarlas a mano (la herramienta no se ha probado con renders reales). Detalle en `docs/MASCOTA.md`.

## 5d. Panel de auditoría de IA (`/admin/ia`)
- [ ] Para ver las neuronas de Cloudflare, el token (`CLOUDFLARE_API_TOKEN`) necesita además el permiso **Account → Account Analytics → Read** (créalo con *Edit* o añade el permiso al token y rota si procede). Abre `/admin/ia`: si Cloudflare rechaza la consulta (nombres de campo sin verificar), el panel muestra el error; cópiamelo y lo ajusto.
- [ ] Contrasta con el panel de Cloudflare que las neuronas coinciden y usa «Neuronas / llamada» para fijar `IMAGE_QUOTA_PER_DAY` o el tope diario de Cloudflare en Ajustes.

## 5e. Vercel Web Analytics
- [ ] Actívalo en Vercel → tu proyecto → *Analytics → Enable* (sin eso el script devuelve 404 y no se mide nada) y redespliega. Solo mide en producción. Apágalo cuando quieras con `NEXT_PUBLIC_DISABLE_ANALYTICS=true`.
- [ ] **Revisión legal tuya:** los textos de `/privacidad` y `/cookies` dicen que es una analítica sin cookies, según la documentación de Vercel (no verificado aquí). Si tu criterio o el de tu asesor exige consentimiento previo para cualquier analítica, desactívala con la variable o añade el banner antes de activarla.

## 5f. Almacenamiento de Vercel (despliegues)
- [ ] Borra los despliegues antiguos que ya no uses (Vercel → proyecto → *Deployments*) y, en *Settings → Build & Deployment → Deployment Retention*, reduce cuánto se conservan. El espacio ya usado no baja solo.
- [ ] Tras el siguiente despliegue, prueba a generar una imagen con IA (la única función que usa `sharp`) y abre `/admin/ia`. Si algo falla por falta de `sharp` o `@electric-sql/pglite`, avísame con el error.
- [ ] Cada push a la rama de producción genera un despliegue: agrupa los cambios en menos commits/pushes y, si usas ramas de prueba, desactiva sus previews en *Settings → Git → Ignored Build Step* o en `vercel.json` (`git.deploymentEnabled`; no lo toqué porque no sé cuál es tu rama de producción).

## 5g. Partidas del sistema
- [ ] Aplica las migraciones `…4200`/`…4300` (tabla `system_templates`), `…4400`/`…4500` (evento de auditoría) y `…4600`/`…4700` (créditos en la tarjeta).
- [ ] **Repositorio de fotos: `ElMaxter99/subasta-salvaje-public`** (ya creado e inicializado; rama por defecto `master` → `GITHUB_ASSETS_BRANCH=master`). Las imágenes pueden venir de terceros: el README del repositorio lo declara (sin ánimo de lucro, sin licencia concedida, retirada a petición) y hay un `FUENTES.md` opcional. Cumple la política de retirada y, si puedes, prefiere fuentes con licencia libre (ver `docs/PLANTILLAS-SISTEMA.md`, «Derechos de las fotos»).
- [ ] **Subida con arrastrar y soltar** (GitHub + jsDelivr; R2 descartado: pide tarjeta): crea un repositorio público de fotos con un primer commit, un token fino de GitHub solo para ese repositorio con *Contents: Read and write*, y define `GITHUB_ASSETS_REPO` y `GITHUB_ASSETS_TOKEN` (*Sensitive*) en Vercel (pasos en `docs/PLANTILLAS-SISTEMA.md`). **Sin probar contra GitHub real**: prueba arrastrando una imagen y comprueba que aparece el commit en el repositorio y que el enlace de jsDelivr abre. Opcional: `ASSET_CDN_HOSTS=cdn.jsdelivr.net`.
- [ ] En `/admin/plantillas` crea una plantilla con fotos reales, pulsa «Comprobar imágenes» y publícala. **Sin probar contra un CDN real.**
- [ ] Añadir a la política de privacidad/créditos el proveedor de fotos que elijas (nuevo tercero que sirve imágenes a los visitantes).

## 5h. Biblioteca de medios
- [ ] Aplica las migraciones `…5000`/`…5100` (tablas `library_images` y `library_items`) y `notify pgrst, 'reload schema';`.
- [ ] Usa las mismas variables `GITHUB_ASSETS_*` que las plantillas (token con *Contents: Read and write*). La subida por lotes usa la API de datos de Git (blobs, árbol, commit, mover la rama): **sin probar contra GitHub real**; si rechaza la rama (protegida, por ejemplo) copia el mensaje.
- [ ] **Sin probar contra GitHub/jsDelivr reales.** Prueba primero con 5-10 fotos y luego con un lote grande: si GitHub aplica límites secundarios (429/403) más estrictos que los reintentos previstos, copia el mensaje. La cola se puede parar y continuar.
- [ ] Decide la política del repositorio de fotos (licencias/retirada) antes de subir cientos de imágenes de terceros.

## 5i. Edición de imágenes con IA (Pollinations)
- [ ] Aplica las migraciones `…5200`/`…5300` (modelo de cada versión en el historial) y `…5400`/`…5500` (jugadores activos y `joined`) y `…5600`–`…7300` (regenerar la versión actual, regenerar forzando un proveedor, nota «por qué este proveedor» reiniciar la partida generar con IA la imagen de un producto del catálogo general, y elementos perdidos/anuncio al azar/rondas ≤ catálogo).
- [ ] Vuelve a probar dos compras seguidas en una partida con IA: el historial (Detalles) muestra ahora IA, modelo y tipo, y el prompt pide que la compra anterior siga visible y la nueva vaya a otra zona. **No verificado contra Pollinations real**: si la 2.ª compra sigue tapando la 1.ª, copia las dos imágenes y los prompts; la alternativa fiable es la composición (collage), que conserva la imagen anterior píxel a píxel.
- [ ] Con la guardia de zona (`region-guard.ts`) lo anterior se conserva fuera de la zona del objeto nuevo; **sin probar con el modelo real**. Haz dos o tres compras seguidas y revisa en el historial (Detalles → «guardia de zona» en el prompt) que se conservan y que los objetos nuevos no salen recortados; si recorta, dímelo y ajusto el tamaño de las zonas.
- [ ] Si Pollinations rechaza el tamaño con la proporción de la casa (p. ej. `1024x576`), fija `POLLINATIONS_IMAGE_SIZE=1024x768` y avisa.

## 5j. Imágenes por enlace
- [ ] Las partidas creadas con una plantilla del sistema ya no copian sus fotos: TV y móviles las cargan de jsDelivr y la IA las lee por enlace. Requiere `GITHUB_ASSETS_REPO` definida en Vercel (sin ella se descargan como antes). **Sin probar contra jsDelivr real.** Revisa en una partida real que la casa y las fotos se ven y que una edición con IA lee la base.
- [ ] Revisa el texto de `/privacidad` (jsDelivr recibe ahora también las peticiones de TV y móviles).

## 5k. Pulir los prompts con el modelo real
- [ ] Con `npm run ai:lab` (ver `docs/PROMPTS-IA.md`) prueba 2-3 bases distintas (una casa, un batido de leche, una mascota) con 2-3 elementos cada una y revisa `paso-N.png` y `prompts.txt`. Qué mirar: ¿se integra de forma natural y divertida?, ¿hay bordes/halos de collage?, ¿se conservan los elementos anteriores? Dime qué falla y ajusto el texto (`src/lib/ai/prompts.ts`).

## 5l. Probar un modelo de edición mejor (gratis)
- [ ] En Vercel: `CLOUDFLARE_EDIT_MODEL=@cf/black-forest-labs/flux-2-klein-9b` y `IMAGE_PROVIDERS=cloudflare,pollinations`; compara con `npm run ai:lab` la misma batería (persona en una puerta + Pikachu + barca). Mide neurons/imagen con `npm run ai:measure -- --yes --edit` y ajusta `IMAGE_QUOTA_PER_DAY`. Si queda corto, prueba `flux-2-dev`.
- [ ] Si la guardia `cores` restaura un trozo que queda feo, prueba `IMAGE_EDIT_GUARD=off`.

## 6. Cron externo (opcional pero recomendado en producción)
- [ ] El cron de `vercel.json` es diario (límite del plan *Hobby*). Para que los trabajos de imagen y el borrado se procesen con más frecuencia, programa en GitHub Actions o cron-job.org una llamada cada minuto a `/api/jobs/process` con la cabecera `Authorization: Bearer <CRON_SECRET>`.

## 7. Lo que NO está verificado (probar tú)
- Supabase real: Realtime (Broadcast), Storage (subida/borrado, incluido SVG), claves `sb_publishable_/sb_secret_`.
- Cloudflare Workers AI real (generación y, sobre todo, edición con referencias < 512 px).
- Plan de Vercel: `maxDuration = 300` en las rutas que procesan imágenes; si el plan no lo admite, bájalo (ver README).

## 8. Pendiente para más adelante (decidido por el propietario)
- [ ] **Medir el coste real de Cloudflare** con `npm run ai:measure -- --yes --edit` (gasta cuota gratuita real; compara el uso en el panel de Cloudflare antes y después) y ajustar `IMAGE_QUOTA_PER_DAY`. Después, decidir sobre más proveedores según `docs/PLAN-PROVEEDORES-IA.md` (GPU propia, Pollinations, opcionales de pago con tope).
- [ ] **Afinar el sonido escuchándolo** (melodías, volúmenes, tic-tac): ver `docs/SONIDO.md`. Fases pendientes del plan: ajuste de música por partida en el asistente y pulir con uso real.
- [x] **MFA/TOTP del superadmin**: implementado como opt-in (`SUPERADMIN_REQUIRE_MFA=true`, página `/seguridad-admin`, `requireSuperadmin()` exige `aal2`). **Sin probar contra Supabase real.** Para activarlo: 1) en Supabase → Authentication → Sign In / Providers → Multi-Factor, activa TOTP; 2) pon la variable en Vercel y redespliega; 3) entra en `/admin`: te llevará a configurar el QR. Si algo falla, quita la variable para recuperar el acceso.
- [ ] Ideas del plan de superadmin no incluidas por ahora: alertas (descartadas: solo dashboard), conversión de imágenes a WebP y retención por versiones, detección de archivos huérfanos en el bucket, cuotas de IA por usuario (hoy: global + permiso por usuario), exportación CSV de la auditoría.
- [ ] **Mascota:** para una colección completa de poses independientes con transparencia real hacen falta renders por pose (≥ 1024 px, fondo transparente o liso): primero mascota principal, celebrando, sorprendida y triste (`docs/MASCOTA.md`). Los recortes actuales de la lámina son de ≈150 px (bustos/poses).
- [ ] **Mezcla de la foto del elemento con la casa** (Cloudflare `input_image_1`, OpenAI `image[]`): implementado según la documentación, **sin probar contra las APIs reales**. Prueba con un elemento con foto (p. ej. un conejo rosa con lazo azul) y comprueba que el objeto conserva su aspecto.
