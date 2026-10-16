# Recuperar contraseña y correos de la app

## Quién envía los correos
La app **no envía correos propios**: todos los correos de autenticación los envía **Supabase Auth**. Las invitaciones del superadmin (`/admin`) son registros en base de datos (una lista de correos permitidos), **no mandan ningún correo**: avisa tú a la persona. Por eso la «maqueta» son las **plantillas de Supabase** con la imagen de la app.

## Plantillas (`supabase/templates/`, generadas con `npm run emails:build`)
| Plantilla (Supabase → Authentication → Email Templates) | Archivo | Asunto sugerido |
|---|---|---|
| Confirm sign up | `confirmation.html` | Confirma tu correo en Subasta Salvaje |
| Invite user | `invite.html` | Te han invitado a Subasta Salvaje |
| Magic Link | `magic_link.html` | Tu enlace para entrar en Subasta Salvaje |
| **Reset password** | `recovery.html` | Recupera tu contraseña de Subasta Salvaje |
| Change email address | `email_change.html` | Confirma tu nuevo correo en Subasta Salvaje |
| Reauthentication | `reauthentication.html` | Tu código de confirmación de Subasta Salvaje |

Los asuntos están en `supabase/templates/subjects.json`. Diseño: HTML con tablas y estilos en línea (compatible con clientes de correo), fondo azul marino, tarjeta, botón dorado, logo (`email-logo.png`) y cabeza de la mascota (`email-head.png`), cargados desde `{{ .SiteURL }}/assets/brand/…` (por eso **Site URL** debe ser tu dominio público). **Vista previa:** `npm run emails:build -- --preview` y abre `.email-preview/*.html` en el navegador.

### Cómo aplicarlas (manual, una vez)
1. Supabase → *Authentication → Email Templates*: para cada plantilla, pega el contenido del `.html` y el asunto.
2. *Authentication → URL Configuration*: **Site URL** = tu dominio de Vercel; en *Redirect URLs* añade `https://TU-DOMINIO/auth/callback` (y `http://localhost:3000/auth/callback` en local).
3. Prueba: «He olvidado mi contraseña» con tu correo y abre el enlace.
(Alternativa con la CLI: `supabase/config.toml` con `[auth.email.template.recovery] subject=… content_path="./supabase/templates/recovery.html"` y `supabase config push`; no está activado en el repo.)

## Flujo «He olvidado mi contraseña»
1. `/login` → «¿Has olvidado tu contraseña?» → correo → `POST /api/auth/forgot` (mismo origen, límite por IP y por correo; **responde siempre igual** exista o no la cuenta).
2. Supabase envía `recovery.html` con el enlace `…/auth/callback?token_hash=…&type=recovery&next=/reset-password`.
3. `GET /auth/callback` hace `verifyOtp` (o `exchangeCodeForSession` si llega `code`), crea la sesión y redirige a `next` (solo rutas internas). Enlace inválido/caducado → `/login?link=invalid` con aviso.
4. `/reset-password` pide la contraseña nueva dos veces → `POST /api/auth/reset` (`updateUser`) → inicio.
En **modo demo** no hay contraseñas: la ruta responde con un aviso y `/reset-password` redirige al login.

## Qué NO está verificado
- **El envío real:** no se ha probado contra un Supabase real (ni la entrega, ni los límites de envío del plan gratuito, que son pocos correos por hora; para producción conviene configurar SMTP propio en Supabase).
- La maqueta se ha revisado en un navegador de escritorio, no en clientes de correo reales (Gmail, Outlook, Apple Mail, modo oscuro forzado).
- La invitación de Supabase (`invite`) solo aplica si invitas desde el panel de Supabase; el sistema de invitaciones de `/admin` no envía correo.
