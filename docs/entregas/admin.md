# Entrega «admin» (administración y contenido)

## Viñetas para el README
- **Plantilla del sistema desde una colección** (`/admin/plantillas`): «Crear desde una colección de la biblioteca» genera un borrador con los productos de la colección (fotos por enlace, sin copiar nada), portada de un producto y casa inicial opcional elegida de la biblioteca (objetos o escenas); se abre en el editor para ajustarla.
- **Edición en bloque de productos** (`/admin/catalogo`): casillas + barra para mover de colección, fijar/quitar emoji, quitar la foto y eliminar (hasta 200 por vez, una transacción y una entrada de auditoría).
- **Moderación de la biblioteca** (`/admin/biblioteca`): campo «revisada», filtros «Sin crédito» y «Sin revisar», «Marcar como revisadas» en bloque y lista de posibles duplicados (mismo título dentro de una colección) con borrado del registro.
- **Estadísticas** (`/admin/estadisticas`): partidas por día (30 d) y por estado, plantillas del sistema más jugadas, éxito/fallo de la IA por proveedor y día, cuota de hoy. Gráficos SVG sin librería con tablas equivalentes.

## Texto para DECISIONES
- La plantilla desde colección la arma SQL (`ss_admin_collection_template`, solo lectura); TS la valida con las reglas normales de plantillas del sistema y la guarda como borrador. No se copia ninguna imagen: se enlazan las URL del CDN. La casa inicial es opcional.
- La edición en bloque admite un único cambio por llamada (`collection` | `emoji` | `image_id: null` | `delete`); al mover, los productos que chocan con otro del mismo nombre en el destino se omiten y se cuentan (no abortan).
- Duplicados = mismo título normalizado en la misma colección; no hay hash perceptual (el contenido idéntico ya lo evita el hash al subir).
- Vínculo partida-plantilla: `games.template_slug`, rellenado tras crear la partida solo si la plantilla existe y está publicada; es informativo y un fallo nunca impide crear la partida. Las partidas anteriores no cuentan; las caducadas se purgan y tampoco.
- Estadísticas de IA sobre `image_versions` (origen distinto de «uploaded»), por día UTC, últimos 14 días; incluye el modo pegatinas/demo como un proveedor más.

## Pendientes
- Probado solo en PGlite (vitest + e2e); las migraciones 8200/8201 no se han ejecutado contra Postgres real ni Supabase (`tests/postgres-real.test.ts` no lo cubre).
- La partida solo se vincula a la plantilla si se carga desde «Partidas del sistema» en el asistente; si el anfitrión cambia luego el catálogo sigue contando.
- Sin gráficos interactivos ni exportación de estadísticas.

## Migraciones
- `20260101008200_admin_extra.sql`: `library_images.reviewed`; reemplaza `ss_library_image_json`, `ss_admin_library_image_list`, `ss_admin_library_image_update`; nuevas `ss_admin_library_duplicates`, `ss_admin_library_item_update_many`, `ss_slugify`, `ss_admin_collection_template`, `games.template_slug`, `ss_set_game_template`, `ss_admin_stats_games|templates|ai`.
- `20260101008201_security_admin_extra.sql`: permisos (solo `service_role`).

## Cómo probarlo
- `npx vitest run tests/admin-extra.test.ts`
- `rm -rf .next-e2e .demo-data-e2e; flock /tmp/ss-e2e.lock env PW_CHROMIUM_PATH=… npx playwright test e2e/admin-extra.spec.ts`
- A mano (modo demo): `/admin/catalogo` (seleccionar y mover), `/admin/plantillas` (crear desde colección), `/admin/biblioteca` (filtros y duplicados), `/admin/estadisticas`.
