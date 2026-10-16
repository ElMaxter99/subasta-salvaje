# Operaciones

## Variables de entorno (resumen; detalle y comentarios en `.env.example`)
| Variable | Uso |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | públicas; activan el modo Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | **secreta**, solo servidor (con el formato nuevo `sb_secret_…` hubo «Invalid API key»: usar las claves *legacy* JWT si ocurre) |
| `SUPABASE_STORAGE_BUCKET` | bucket (por defecto `game-images`) |
| `ALLOWED_HOST_EMAILS` | lista de anfitriones permitidos |
| `CRON_SECRET` | protege `/api/jobs/*` |
| `IMAGE_PROVIDER` (`cloudflare`\|`openai`), `IMAGE_AI_DISABLED` | proveedor de IA real e interruptor |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_IMAGE_MODEL`, `CLOUDFLARE_IMAGE_STEPS`, `CLOUDFLARE_EDIT_MODEL` (`off` desactiva), `CLOUDFLARE_EDIT_WIDTH/HEIGHT` | Cloudflare Workers AI |
| `IMAGE_EDIT_COMPOSE` (`false` desactiva el plan B) | edición por composición |
| `OPENAI_API_KEY`, `OPENAI_IMAGE_*`, `OPENAI_BASE_URL` | OpenAI (de pago, opcional) |
| `IMAGE_QUOTA_PER_GAME` (10), `IMAGE_QUOTA_PER_DAY` (50) | cuotas propias |
| `GAME_TTL_HOURS` (168) | borrado por inactividad (respaldo; el superadmin lo cambia en caliente) |
| `SUPERADMIN_EMAILS` | superadmin (`/admin`) |
| `SUPABASE_PLAN_DB_MB`, `SUPABASE_PLAN_STORAGE_MB` | topes informativos del panel |
| `DEMO_DATA_DIR`, `WORKER_INTERVAL_MS` | demo local / worker |

## Despliegue en Vercel
Importar el repo, definir las variables (Production y Preview), redesplegar y comprobar `/api/health` (`ok: true`) y `/setup`. `vercel.json` programa dos crons diarios
(plan Hobby): `/api/jobs/process` 04:00 UTC y `/api/jobs/purge` 04:30 UTC; para más frecuencia, un cron externo (GitHub Actions/cron-job.org) con `Authorization: Bearer <CRON_SECRET>`.
`maxDuration = 300` en rutas de imágenes: bájalo si el plan no lo admite. **No se despliega sin autorización del propietario.**

## Migraciones en Supabase
En la copia local del propietario (PowerShell): `git pull` → `npx supabase db push` → en el SQL Editor `notify pgrst, 'reload schema';`. Si una migración se aplicó a mano:
`npx supabase migration repair --status applied <versión>`. Tras migrar, prueba a mano: crear partida, pujar, adjudicar (saldo baja una vez), deshacer, borrar.
El orden está en `ARQUITECTURA.md`. Errores vistos: `42P07 relation "games" already exists` y `policy … already exists` ⇒ el esquema ya estaba aplicado a mano (usar `migration repair`).

## Diagnóstico
`/api/health` (estado de BD/Storage/proveedor) · `/setup` (guía de configuración) · `/api/runtime` · panel → pestañas *Imágenes* (jobs, cuota) y *Resumen* (actividad `game_events`).
Problemas típicos en el README (§Solución de problemas): «Invalid API key», 500 en `POST /api/games` por migración sin aplicar, «Cuota … alcanzada», cola de imágenes parada (sin cron).
