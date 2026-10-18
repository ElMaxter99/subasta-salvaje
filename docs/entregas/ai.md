# Entrega «ai» · comparador de modelos

## Viñetas para el README
- **Comparador de modelos** (`/admin/ia/comparar`, superadmin): elige una imagen base y uno o dos elementos (subida de archivo o biblioteca; nunca una URL), marca hasta 4 proveedores de la cadena y compara los resultados lado a lado (proveedor, modelo, semilla/notas, tiempo, prompt enviado y errores explicados), con «Repetir con otra semilla» y «Descargar».
- Misma tubería que una compra real (prompt, tamaños, guardia de zona `IMAGE_EDIT_GUARD`); respeta los ajustes del superadmin (IA apagada, proveedor apagado, tope por proveedor y tope diario global). No guarda nada en Supabase ni GitHub. Sin proveedor real configurado lo dice y no simula resultados (el modo pegatinas no es comparable).
- Cada comparación queda en el historial de auditoría (`ai_compare`: quién y qué proveedores, sin imágenes). Ruta: `POST /api/admin/ia/compare` (multipart, 10 comparaciones/10 min por superadmin, `maxDuration` 60). Migración nueva: `20260101008300_library_image_get.sql` (+ `_security_`).

## Texto para DECISIONES
Comparador de modelos del superadmin. Decisión: reutilizar la tubería real extrayendo `editWithGuard` y `finalizeProviderImage` a `src/lib/ai/edit-pipeline.ts` (usados por `jobs-service` y `compare-service`) para no duplicar reglas. Cada llamada reserva `ss_reserve_admin_image_quota` y la devuelve (`ss_release_admin_image_quota`) si falla, salvo en tiempo agotado (no se sabe si el proveedor la gastó). Los proveedores se lanzan en paralelo, con 55 s máximo cada uno y un fallo no tumba al resto. Solo son comparables cloudflare, pollinations, aihorde y huggingface (ni `demo` ni `openai`). Las imágenes de la biblioteca se piden por id (`ss_admin_library_image_get`) y solo se descargan si son del repositorio de fotos propio. Las semillas las elige cada adaptador en cada llamada; «otra semilla» = relanzar.

## Pendientes
- No probado contra proveedores reales (sin credenciales aquí): solo con proveedores falsos y el e2e del aviso «sin proveedor». Probarlo con Cloudflare/Pollinations reales y comprobar tiempos frente a los 60 s de Vercel con dos elementos (2 llamadas seguidas por proveedor).
- Una semilla fija elegida por el usuario no es posible hasta que los adaptadores acepten una semilla de entrada.
- Sin sección separada de «consejos de prompt»: el prompt exacto se ve en cada resultado.

## Cómo probarlo
`npx vitest run tests/ai-compare.test.ts tests/image-jobs.test.ts`; e2e: `flock /tmp/ss-e2e.lock env PW_CHROMIUM_PATH=… npx playwright test e2e/ai-compare.spec.ts`. A mano: con `IMAGE_PROVIDERS` y credenciales en `.env.local`, `npm run dev`, entrar en `/admin/ia/comparar`.
