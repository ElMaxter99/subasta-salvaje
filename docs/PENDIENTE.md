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
→ `…2800`/`…2900` (puerta de alta: `ss_signup_allowed`; el formulario de la app ya no permite crear cuenta con el registro cerrado) → `…3000`/`…3100` (sonido: interruptores de efectos y música de la TV) → `…3200`/`…3300` (cierre automático de la votación de la galería) → `…3400`/`…3500` (plantillas guardadas del anfitrión: tabla `host_templates`) → `…3600`/`…3700` (devolución de cuota de IA cuando el proveedor no gastó nada) Si alguna se aplicó a mano en el SQL Editor, marca antes
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

## 6. Cron externo (opcional pero recomendado en producción)
- [ ] El cron de `vercel.json` es diario (límite del plan *Hobby*). Para que los trabajos de imagen y el borrado se procesen con más frecuencia, programa en GitHub Actions o cron-job.org una llamada cada minuto a `/api/jobs/process` con la cabecera `Authorization: Bearer <CRON_SECRET>`.

## 7. Lo que NO está verificado (probar tú)
- Supabase real: Realtime (Broadcast), Storage (subida/borrado, incluido SVG), claves `sb_publishable_/sb_secret_`.
- Cloudflare Workers AI real (generación y, sobre todo, edición con referencias < 512 px).
- Plan de Vercel: `maxDuration = 300` en las rutas que procesan imágenes; si el plan no lo admite, bájalo (ver README).

## 8. Pendiente para más adelante (decidido por el propietario)
- [ ] **Medir el coste real de Cloudflare** con `npm run ai:measure -- --yes --edit` (gasta cuota gratuita real; compara el uso en el panel de Cloudflare antes y después) y ajustar `IMAGE_QUOTA_PER_DAY`. Después, decidir sobre más proveedores según `docs/PLAN-PROVEEDORES-IA.md` (GPU propia, Pollinations, opcionales de pago con tope).
- [ ] **Afinar el sonido escuchándolo** (melodías, volúmenes, tic-tac): ver `docs/SONIDO.md`. Fases pendientes del plan: ajuste de música por partida en el asistente y pulir con uso real.
- [ ] **MFA/TOTP obligatorio para el superadmin** (Supabase Auth MFA). Hasta entonces: contraseña larga y única. Al implementarlo, `requireSuperadmin()` debe exigir `aal2`.
- [ ] Ideas del plan de superadmin no incluidas por ahora: alertas (descartadas: solo dashboard), conversión de imágenes a WebP y retención por versiones, detección de archivos huérfanos en el bucket, cuotas de IA por usuario (hoy: global + permiso por usuario), exportación CSV de la auditoría.
- [ ] **Mascota:** para una colección completa de poses independientes con transparencia real hacen falta renders por pose (≥ 1024 px, fondo transparente o liso): primero mascota principal, celebrando, sorprendida y triste (`docs/MASCOTA.md`). Los recortes actuales de la lámina son de ≈150 px (bustos/poses).
- [ ] **Mezcla de la foto del elemento con la casa** (Cloudflare `input_image_1`, OpenAI `image[]`): implementado según la documentación, **sin probar contra las APIs reales**. Prueba con un elemento con foto (p. ej. un conejo rosa con lazo azul) y comprueba que el objeto conserva su aspecto.
