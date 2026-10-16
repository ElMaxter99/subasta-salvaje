# Plan: panel de superadmin (`/admin`)

Estado: **implementado en lo acordado** (fases 0–4: acceso, peso/resumen, partidas, usuarios e invitaciones, ajustes de IA, auditoría). Decisiones del propietario: único superadmin; registro abierto con interruptor e invitaciones; borrar usuario = borrar todo; solo dashboard (sin alertas); partidas se borran a los 7 días (configurable); **MFA pendiente**. No implementado: WebP/retención por versiones, huérfanos, cuotas por usuario, CSV (ver `PENDIENTE.md` §8). Objetivo: que el propietario controle usuarios (anfitriones), partidas, acceso/gasto de IA y el **peso** de lo guardado
(Supabase free tier), sin entrar al dashboard de Supabase ni tocar variables de entorno.

## 1. Qué hay hoy (punto de partida)
- Anfitriones = usuarios de Supabase Auth; `host_id` en `games`. Acceso restringido solo por la variable `ALLOWED_HOST_EMAILS` (requiere redeploy para cambiar).
- IA: `IMAGE_PROVIDER`, `IMAGE_AI_DISABLED` y cuotas `IMAGE_QUOTA_PER_GAME/DAY` son **variables de entorno** (global, redeploy para cambiar). Uso real en `image_usage` (por partida/día).
- Peso: no hay ninguna vista. Hay `image_versions.bytes` (a veces nulo), `game_events`, el bucket `game-images`, borrado por partida (`ss_delete_game` + `storage.deletePrefix`) y purga a las 12 h.
- Cada partida tiene `created_at`, `updated_at`, estado y jugadores; `ss_game_activity`/`ss_expired_games` ya calculan inactividad.

## 2. Alcance (módulos)
| # | Módulo | Qué permite |
|---|---|---|
| A | **Resumen / salud** | Tarjetas: usuarios, partidas activas/total, jugadores, imágenes, generaciones de IA hoy/mes, **peso BD y Storage vs límites del plan** con barras y alertas al 70/90 %, estado de cron/purga y de la cola de imágenes |
| B | **Usuarios (anfitriones)** | Lista (email, alta, último acceso, nº partidas, uso de IA, peso en Storage); **bloquear/desbloquear**, permitir/denegar IA, cuotas propias, invitar/permitir correos (sustituye `ALLOWED_HOST_EMAILS`), borrar usuario y sus partidas |
| C | **Partidas** | Todas las partidas con dueño, estado, jugadores, antigüedad, peso, uso de IA; filtros; acciones: ver (solo lectura), finalizar a la fuerza, borrar, ampliar/acortar su caducidad, «purgar caducadas ahora» |
| D | **IA y cuotas** | Interruptor global (reemplaza `IMAGE_AI_DISABLED` en caliente), proveedor activo, cuotas globales y **por usuario** editables, gráficas de uso por día/usuario/partida, coste estimado (neuronas de Cloudflare) y avisos al acercarse al límite diario |
| E | **Almacenamiento** | Peso por tabla y por partida, bucket (nº objetos, bytes), top 10 partidas/usuarios por peso, **huérfanos** (objetos sin `image_versions`), limpieza guiada (borrar versiones antiguas, partidas finalizadas, reconvertir a WebP) |
| F | **Auditoría** | Registro inmutable de todas las acciones de superadmin (quién, qué, a quién, cuándo) y exportación CSV |

## 3. Modelo de acceso (seguridad)
- **Superadmin ≠ anfitrión.** Lista `SUPERADMIN_EMAILS` (env, solo servidor) como raíz de confianza; opcionalmente tabla `app_admins` gestionable desde el propio panel (solo el raíz puede añadir). Sin entrada en la lista ⇒ `/admin` responde 404.
- Autenticación con Supabase Auth + **MFA/TOTP obligatorio** para superadmin (Supabase lo soporta) y sesión corta; reautenticación para acciones destructivas (borrar usuario/partidas).
- Todo el backend del panel usa funciones SQL nuevas `ss_admin_*` con `EXECUTE` solo para `service_role` (mismo patrón que hoy) y rutas `/api/admin/*` con `assertSameOrigin`, límite de tasa y comprobación de superadmin **en el servidor** en cada petición (nunca solo en la UI).
- Nunca se muestran tokens de jugadores, claves ni contenido de `idempotency_keys`; los correos solo al superadmin.
- Cada acción mutante escribe en `admin_audit` dentro de la misma transacción.
- En modo demo el superadmin es el anfitrión de demo (para poder desarrollar y probar sin Supabase).

## 4. Diseño de datos (migraciones nuevas, una portable + una `_security_` por bloque)
1. **`app_settings`** (clave/valor `jsonb`, una fila): `ai_enabled`, `ai_provider_override`, `quota_per_game`, `quota_per_day`, `game_ttl_hours`, `signups_open`. Lectura con caché corta; **la configuración en BD tiene prioridad sobre el env** (el env queda como valor por defecto/arranque).
2. **`host_profiles`** (`user_id` PK, `email`, `status` active|blocked, `ai_enabled`, `quota_per_game`, `quota_per_day`, `notes`, `invited_by`, timestamps). Se crea al primer acceso (upsert) y se consulta en `getHostIdentity`/`ss_*` de IA.
3. **`admin_audit`** (id, `admin_id`, `action`, `target_type`, `target_id`, `payload`, `created_at`; sin UPDATE/DELETE).
4. **Cuotas por usuario**: `ss_reserve_image_quota` pasa a leer los límites efectivos (usuario → global → env) y la columna `host_id` de `image_usage` (nueva) para agregar por usuario.
5. **Funciones de lectura** `ss_admin_overview`, `ss_admin_users`, `ss_admin_games`, `ss_admin_ai_usage(range)`, `ss_admin_storage_usage`:
   - Tamaños de BD: `pg_database_size`, `pg_total_relation_size` por tabla; por partida = suma de `image_versions.bytes` + estimación de filas (`pg_column_size`) — ver §5.
   - Bucket: función `security definer` que suma `storage.objects.metadata->>'size'` agrupando por el prefijo `games/<id>/` (el esquema `storage` no está expuesto por PostgREST, por eso va en una función propia). En PGlite/demo se sustituye por `image_versions.bytes` y el tamaño del directorio local.
   - Usuarios: `auth.users` solo es accesible vía la API de administración (`supabase.auth.admin.listUsers`, paginada) o una función `security definer` de solo lectura; se prefiere la API oficial para bloquear (`updateUserById({ ban_duration })`).
6. Ajuste a `ss_delete_game`/purga para registrar bytes liberados (útil para el panel y la auditoría).

## 5. Medir el peso con honestidad
- **Límites del plan gratuito de Supabase** (a confirmar en la página de precios vigente, cambian): ~500 MB de base de datos, ~1 GB de Storage, ~5 GB de tráfico/mes, 50 000 usuarios activos/mes, 200 conexiones Realtime simultáneas y ~2 M de mensajes Realtime/mes; el proyecto se **pausa tras ~1 semana sin actividad**. El panel mostrará estos topes como **valores configurables** (no codificados) para no quedarse obsoleto.
- Lo que **sí** podemos medir con exactitud: tamaño de la BD y de cada tabla (`pg_*_size`), objetos y bytes del bucket, nº de usuarios, filas por tabla.
- Lo que solo se **estima**: tráfico de salida (egress) y mensajes Realtime — no hay API sencilla; se muestra una estimación (peticiones × tamaño medio) marcada como tal y un enlace al panel de Supabase para el dato real.
- Orden de magnitud actual: las imágenes dominan. Una partida de 6 jugadores × 10 compras ≈ 60 versiones × 100–300 KB ≈ 6–18 MB; la BD (texto) pesa poco. Con la purga a las 12 h el Storage se mantiene bajo **si la purga corre** (en Vercel Hobby el cron es diario).

## 6. Medidas de ahorro que el panel hará visibles (y que conviene implementar)
1. Convertir salidas de IA a **WebP** (sharp, ~60–70 % menos) y limitar a 1536 px de lado largo.
2. No duplicar archivos: las imágenes comunes (base compartida, galería) ya se guardan una vez; las pegatinas (SVG) pesan ~KB.
3. Retención configurable: conservar solo la versión actual + la inicial de partidas finalizadas tras N horas (borrar versiones intermedias del bucket).
4. Purga más frecuente (cron externo) y botón «purgar ahora» con vista previa de lo que se borrará.
5. Alertas al 70/90 % de BD o Storage.

## 7. UI (`/admin`, solo escritorio-first, claro/oscuro como el resto)
Navegación lateral: Resumen · Usuarios · Partidas · IA y cuotas · Almacenamiento · Auditoría · Ajustes. Tablas con búsqueda, orden y paginación en servidor; confirmaciones con texto escrito
para borrados; badges de estado; gráficas simples (SVG propias, sin librerías pesadas); exportar CSV. Reutiliza `Card`, `Pill`, `ConfirmDialog`, `Button` del panel actual.

## 8. Fases y orden de entrega
| Fase | Contenido | Resultado visible | Esfuerzo |
|---|---|---|---|
| 0 | Decisiones abiertas (§10), `SUPERADMIN_EMAILS`, guardia `requireSuperadmin()`, ruta `/admin` vacía, `admin_audit` | Acceso protegido + auditoría | S |
| 1 | **Peso y resumen** (módulos A y E de solo lectura): `ss_admin_overview`, `ss_admin_storage_usage`, barras vs límites | **Ver ya cuánto ocupa todo** (lo más urgente) | M |
| 2 | **Partidas** (C): lista, filtros, borrar/finalizar/purgar ahora | Limpiar espacio a mano | M |
| 3 | **Usuarios** (B): `host_profiles`, bloquear, allowlist en BD | Control de accesos sin redeploy | M |
| 4 | **IA y cuotas** (D): `app_settings`, interruptor en caliente, cuotas por usuario, gráficas | Control del gasto | M–L |
| 5 | **Ahorro** (§6 puntos 1, 3, 4) + huérfanos + retención | Menos peso real | M |
| 6 | MFA obligatorio, exportaciones, alertas por correo/aviso en el panel | Endurecimiento | S–M |

Cada fase incluye: migraciones (+`_security_`), funciones `ss_admin_*`, rutas `/api/admin/*`, UI, tests (PGlite para SQL; Postgres real para permisos: `anon`/`authenticated` **no** pueden ejecutar `ss_admin_*`; e2e del flujo del panel) y documentación (`docs/`).

## 9. Tests clave
- Un anfitrión normal recibe 404/403 en `/admin` y `/api/admin/*`; un correo no listado no puede escalar privilegios (ni vía cookies ni vía cabeceras).
- Bloquear a un usuario le impide crear partidas/pujar-gestionar y no borra sus datos; desbloquear lo restaura.
- La cuota efectiva respeta el orden usuario → global → env, y apagar la IA en caliente detiene nuevos trabajos sin perder los encolados.
- Borrar partida/usuario libera Storage (comprobable con `storage_usage`) y deja entrada de auditoría.
- Las vistas de peso no cuentan dos veces archivos compartidos (imagen base) y no fallan en modo demo.

## 10. Decisiones que necesito de ti antes de empezar
1. ¿Superadmin solo tú (env) o varios administradores gestionables desde el panel?
2. ¿Los anfitriones nuevos se **aprueban** manualmente (lista de invitación) o el registro sigue abierto con bloqueo a posteriori?
3. Al borrar un usuario: ¿se borran también sus partidas e imágenes (recomendado) o se anonimizan?
4. ¿Quieres **avisos** (correo/Telegram/aviso en el panel) al llegar al 80 % de Supabase o de cuota de IA? Solo el aviso en el panel no requiere servicios nuevos.
5. ¿Política de retención por defecto de imágenes de partidas finalizadas (propuesta: conservar actual + inicial 7 días y borrar el resto a las 12 h)?
6. ¿Aceptas MFA obligatorio para el superadmin (recomendado)?

## 11. Riesgos
- Superficie de ataque nueva y muy privilegiada ⇒ mínimo privilegio, MFA, auditoría y 404 para no administradores.
- Contabilidad de bytes inexacta si `image_versions.bytes` es nulo en datos antiguos ⇒ usar `storage.objects` en producción como fuente de verdad.
- Los límites del plan gratuito cambian ⇒ configurables y con enlace a la fuente.
- Cambiar la configuración de IA de env a BD no debe abrir la puerta a activar un proveedor de pago por accidente ⇒ el panel **no** puede elegir un proveedor sin credenciales en env, y cambiar a uno de pago exige confirmación explícita.
