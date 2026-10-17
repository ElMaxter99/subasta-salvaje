# Plan: partidas del sistema (plantillas del superadmin) e imágenes en formato interno

> Estado: **propuesta para decidir** (17-10-2026). Nada de esto está implementado. Las cifras de las capas gratuitas de terceros
> **no se han verificado**: releer su página oficial antes de elegir (como en `PLAN-PROVEEDORES-IA.md`).

## 1. Qué se quiere
1. Una vista en **Nueva partida** con **«Partidas del sistema»**: partidas ya configuradas (reglas, catálogo, fotos) creadas por el superadmin, que el anfitrión carga y puede retocar antes de crearlas.
2. En **/admin**, una sección para **crear y publicar** esas plantillas.
3. Que **todas las imágenes del sistema** (subidas por jugadores, anfitriones o superadmin, importadas por URL o ZIP, y salidas de la IA) acaben en **un tamaño y formato internos**, para que nadie pueda meter fotos pesadas.
4. Que las fotos de las plantillas del sistema vivan **fuera de Supabase** (algo con enlaces y CDN), para tenerlo separado y no gastar su almacenamiento.

## 2. Qué hay ya (y se reutiliza)
- Formato de plantilla `subasta-salvaje/plantilla@1` con validación Zod (`src/lib/domain/template.ts`), CSV y ZIP, editor de catálogo, «Mis plantillas» (`host_templates`).
- Importación de fotos por URL con defensas SSRF (`safe-fetch.ts`, `/api/games/[code]/import-photos`): descarga, comprueba el tipo real y guarda en Storage.
- `ss_audit` para registrar acciones del superadmin; `requireSuperadmin()` (con MFA opcional).
- **Lo que falta para el punto 3:** hoy las subidas solo se *validan* (tipo real, ≤ 7 MB, `image-validation.ts`) pero **se guardan tal cual**; las salidas de IA (JPEG de Cloudflare, PNG de Pollinations) también. No hay reducción ni conversión.

## 0. Decisiones tomadas (17-10-2026)
Tamaños y formato de §3: **aprobados**. Imágenes de partidas en **Supabase** (lo más barato y sencillo; tienen 10 GB). Las **plantillas del sistema** guardan sus fotos en un **proveedor externo**: **R2 descartado** (exige método de pago, riesgo de cobro); se usa **GitHub + jsDelivr** (gratis, sin tarjeta) y **se copian a la partida al crearla**. Las plantillas pueden llevar **catálogo, reglas e imagen inicial de la casa**. Los **borradores solo los ve el superadmin**. Se normalizan **solo las imágenes nuevas**.
**Estado:** fases 1 (imagen interna), 2 (SQL/servicio/API), 3 (panel `/admin/plantillas`), 4 (lista blanca `ASSET_CDN_HOSTS`, copia al crear, `assets:normalize`) y 5 (galería en Nueva partida, con casa inicial) implementadas — ver `IMAGEN-INTERNA.md` y `PLANTILLAS-SISTEMA.md`. Pendiente: capturas del README y validación con un CDN real.

## 3. Imagen interna única (fase 1, la base de todo)
**Especificación propuesta** (a confirmar):

| Tipo | Máximo | Formato | Objetivo de peso |
|---|---|---|---|
| Casa / escena (inicial, edición, base compartida) | 1536 × 1024 (3:2), `fit: inside` | WebP calidad ≈ 80 | ≤ 300 KB |
| Foto de elemento del catálogo | 768 × 768, `fit: inside` | WebP (conserva transparencia) | ≤ 150 KB |
| Portada de plantilla del sistema | 1200 × 630 | WebP | ≤ 150 KB |

**Un solo módulo** `src/lib/images/normalize.ts` (sharp): `normalizeImage(bytes, kind)` →
`{ bytes, mime: 'image/webp', width, height }`. Reglas: tipo real por bytes (ya existe), `limitInputPixels` (≈ 40 MP, contra bombas de descompresión), **sin animación** (solo el primer fotograma), **se quitan metadatos EXIF/GPS**, orientación aplicada, y si tras la calidad por defecto pesa más que el objetivo se baja la calidad por pasos (mínimo fijo); si aun así no cabe, error claro.

**Dónde se aplica** (un único punto de entrada para que nada se escape): subida de imagen inicial (`initial-image`), foto de elemento (`item-image`), importación por URL (`import-photos`), fotos de un ZIP, salida de cualquier proveedor de IA (en `jobs-service` antes de guardar), imágenes de plantillas del sistema. Un test «todas las rutas de escritura pasan por `normalizeImage`» (análisis del código, como el test de `service_role` en cliente).

**Cliente:** reducir **antes de subir** con `<canvas>` (límite de ≈ 2 MB tras reducir) para no malgastar datos móviles; el servidor **no se fía** y vuelve a normalizar.

**Costes/efectos a vigilar:**
- `sharp` hoy solo va en 3 rutas (`outputFileTracingIncludes` en `next.config.ts`); habría que añadirlo a las rutas de subida/importación (+≈ 20 MB cada una en el despliegue). Alternativa: concentrar las subidas en 1–2 rutas.
- Normalizar la salida de IA **ahorra almacenamiento** en Supabase (hoy JPEG/PNG sin recomprimir).
- Las imágenes ya guardadas no se tocan; opcional: script de migración «reencode» con ensayo en seco (no urgente).
- Los SVG de pegatinas/galería del modo demo no pasan por aquí (son vectoriales locales).

## 4. Plantillas del sistema (fases 2 y 3)
**Datos** (migración nueva + `_security`, RLS cerrada): tabla `system_templates` (`id`, `slug`, `title`, `description`, `cover_url`, `data jsonb` en formato `@1`, `status` `draft|published`, `sort_order`, `created_by`, marcas de tiempo). Funciones `ss_*`:
- `ss_system_template_list` (solo publicadas; para anfitriones), `ss_system_template_get`.
- Admin: `ss_admin_system_template_upsert`, `…_set_status`, `…_delete`, `…_reorder`, todas con `ss_audit`. La validación fuerte sigue en TypeScript con Zod (mismo `templateSchema`) y se **revalida al publicar**.

**Superadmin `/admin/plantillas`:** lista (borrador/publicada, orden), editor con las mismas piezas del asistente (reglas, catálogo con `catalog-editor`, temática), **importar** JSON/CSV/ZIP, **«guardar una partida existente como plantilla del sistema»**, vista previa tal como la verá el anfitrión, y un **comprobador de imágenes** (informe por foto: URL, tipo, dimensiones, peso, ✔/✖ según la especificación de §3). Publicar exige que pasen todas las comprobaciones.

**Anfitrión, Nueva partida:** nueva pestaña **«Partidas del sistema»** (tarjetas con portada, título, nº de elementos y resumen de reglas) → «Usar» rellena el asistente y salta al Resumen, igual que «Mis plantillas»; se puede retocar y la plantilla del sistema **no se modifica**. El modo de imágenes por defecto es pegatinas (sin IA). Solo se muestran publicadas.

## 5. Fotos fuera de Supabase (fase 4)
**Evaluación de opciones** (límites sin verificar):

| Opción | Pros | Contras |
|---|---|---|
| **Cloudflare R2** (bucket público + dominio propio/CDN) | Ya usas Cloudflare; sin coste de salida; API tipo S3; separado de Supabase | Hay que crear bucket, claves y dominio |
| **GitHub + jsDelivr** (carpeta/repositorio de assets público) | Gratis, CDN, versionado y revisión por commits; cero cuentas nuevas | Público; subir = hacer commit (sin UI en la app) |
| **Cloudinary / ImageKit** | Transforman al vuelo (tamaño/formato) | Cuentas y límites propios; dependencia mayor |
| **Dropbox / Google Drive** | Ya lo conoces | **No recomendado**: los «enlaces directos» cambian, tienen límites de tráfico y no son un CDN |

**Recomendación:** R2 (o jsDelivr si prefieres versionar en Git). La app **no sube a ese servicio**: el superadmin deja ahí las fotos ya en formato interno y **pega los enlaces** (así no hay claves de escritura en el servidor y se evita código de subida). Para preparar las fotos: `npm run assets:normalize -- ./mis-fotos` (script local con el mismo `normalizeImage`) que deja `*.webp` listos para subir.

**Cómo se usan las URL:**
- **Lista blanca de servidores** (`ASSET_CDN_HOSTS`, ej. `cdn.midominio.com`): solo https y solo esos dominios para plantillas del sistema (más estricto que el SSRF genérico actual).
- **Copia al crear la partida** (recomendado para empezar): se reutiliza `import-photos` + `normalizeImage` y la foto queda en el Storage de **esa partida** (se borra con ella a los 7 días). Así el juego no depende de que el CDN esté arriba, la IA puede leer la foto como referencia, y el gasto en Supabase es temporal.
- *Alternativa más adelante (hotlink):* mostrar la URL del CDN sin copiarla. Ahorra más Storage pero exige columna `image_url` en `auction_items` y que la IA descargue la referencia; solo si el uso lo justifica.
- La validación al publicar descarga cada foto una vez (con los límites de `safe-fetch`) y comprueba la especificación; si el CDN cambia una foto después, la copia por partida vuelve a normalizar.

## 6. Fases, esfuerzo y criterios de aceptación
| Fase | Contenido | Esfuerzo | Aceptación |
|---|---|---|---|
| 0 | Decidir las preguntas de §8 | — | Respuestas registradas |
| 1 | `normalizeImage`, aplicarlo en todas las entradas, reducción en el cliente, `sharp` en las rutas necesarias, tests (límites, EXIF, animación, bomba de píxeles, cobertura de rutas) | 2–3 días | Ninguna imagen guardada supera la especificación; foto de 7 MB sale ≤ objetivo; sin regresión en e2e |
| 2 | Tabla + funciones SQL + servicio + API de plantillas del sistema (+ tests SQL/servicio, auditoría) | 2 días | CRUD solo superadmin; publicadas visibles a anfitriones; Postgres real verde |
| 3 | `/admin/plantillas` (editor, importar, comprobador de imágenes, vista previa) | 3–4 días | Crear, publicar y retirar sin tocar SQL; e2e del flujo |
| 4 | Lista blanca de CDN, copia al crear, `assets:normalize`, guía de alojamiento (R2/jsDelivr) | 1–2 días | Plantilla con fotos del CDN crea la partida; host no permitido se rechaza; sin salida de red real: prueba con transporte simulado |
| 5 | Pestaña «Partidas del sistema» en Nueva partida | 1–2 días | Cargar, retocar y crear; no modifica la plantilla |
| 6 | README + capturas, `LEGAL.md` (nuevo tercero: el CDN), créditos, `PENDIENTE.md`, `DECISIONES.md` | 0,5–1 día | Tests de README/legal verdes |

Total aproximado: **10–14 días** de trabajo. Las fases 1 y 2 son independientes y pueden ir en paralelo (archivos distintos).

## 7. Riesgos
- **SSRF/abuso de URL:** lista blanca + `safe-fetch` + límites de tamaño/tiempo; solo el superadmin edita plantillas.
- **Derechos de las fotos:** las fotos de plantillas las aporta el superadmin; que sean propias, con licencia o generadas; no fotos de personas (política de privacidad).
- **CDN caído o cambiado:** al copiar al crear la partida solo afecta a quien cree una partida en ese momento; el fallo de una foto no bloquea (ya ocurre hoy).
- **Peso del despliegue:** más rutas con `sharp` (§3); medirlo con `npm run size:functions`.
- **Calidad visual:** WebP a 80 puede notarse en ilustraciones planas; la especificación es configurable en un solo sitio.
- **Plan gratuito de terceros:** límites sin verificar; elegir con la página oficial delante.

## 8. Decisiones que necesito de ti
1. **Especificación de imagen** (§3): ¿valen 1536×1024 y 768×768 en WebP, o prefieres otros tamaños/formato?
2. **Dónde alojar las fotos:** ¿R2, jsDelivr (Git) u otro? ¿Tienes ya un dominio para el CDN?
3. **Copiar al crear la partida** (recomendado) **o mostrar desde el CDN** sin copiar.
4. ¿Las plantillas del sistema pueden llevar **imagen inicial/base de la casa** ya hecha (también por URL), o solo catálogo y reglas?
5. ¿Quién ve las **borradores**? (propuesta: solo el superadmin). ¿Hace falta **idioma/etiquetas** para filtrar la galería?
6. ¿Normalizamos también las **imágenes ya guardadas** (script de migración con ensayo en seco) o solo las nuevas?
