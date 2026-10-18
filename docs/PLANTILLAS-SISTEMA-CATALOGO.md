# Catálogo de partidas del sistema

Conjunto de **36 plantillas originales** (587 elementos, cada una con 12–25 elementos con título, descripción y emoji) para cargarlas como *partidas del sistema* (ver `PLANTILLAS-SISTEMA.md`). Todo el texto es original, en español, sin marcas, datos personales ni contenido ofensivo; los tonos son `familiar`, `adultos` (fiestas y celebraciones, sin contenido explícito), `humor`, `humor negro suave` y `educativo`.

## Archivos (`docs/plantillas-sistema/`)
| Archivo | Qué es |
|---|---|
| `fuente/<slug>.txt` | **Fuente editable**: cabecera `# clave: valor`, línea `---` y un elemento por línea `emoji \| Título \| descripción \| etiquetas`. |
| `<slug>.json` | Plantilla en el formato `subasta-salvaje/plantilla@1`; sirve tal cual en «Nueva partida → ¿Tienes una plantilla?». Generado. |
| `lote.json` | Todas juntas en el formato `subasta-salvaje/lote-plantillas@1` (con slug, título de tarjeta, descripción, orden y **etiquetas**). Es lo que importan el script y el panel. Generado. |
| `indice.json` | Índice mínimo (slug, título, tono, nº de elementos). Generado. |

Tras editar una fuente: `npm run templates:build` (regenera todo y la tabla de abajo, y se niega si algo no valida).

## Comandos
```bash
npm run templates:validate                       # valida TODO el catálogo contra el esquema Zod real y las reglas (código 1 si falla)
npm run templates:import                         # ENSAYO en PGlite en memoria: no toca nada real
npm run templates:import -- --apply              # importa en la base que use la app, como BORRADOR (Supabase si hay credenciales; si no, modo demo)
npm run templates:import -- --apply --publish    # además las publica
npm run templates:import -- --only=cena-de-empresa --file=otro-lote.json
```
Idempotente por slug: repetir actualiza lo que cambió y no duplica; nunca borra ni retira. **Publicar es manual** por el superadmin (Publicar en `/admin/plantillas`); no hay fotos, así que la comprobación de imágenes de la publicación no tiene nada que descargar.

## Importar varias desde el panel
`/admin/plantillas → «Importar varias (.json)»` acepta un `lote.json` (o una lista de entradas). Cada plantilla se valida con el esquema real y se guarda como **borrador** (nueva o actualizada por slug); el mensaje resume creadas, actualizadas, sin cambios y errores. Máx. 100 plantillas y 2 MB por lote. Usa `POST /api/admin/system-templates` con `op: "import_many"` (solo superadmin, mismo origen).

## Reglas que comprueba el validador (`src/lib/domain/system-template-pack.ts`)
Esquema real de plantilla (`parseTemplate`); 12–25 elementos; título ≤ 50 y descripción de 10–140 caracteres; emoji obligatorio y válido; sin foto, crédito, portada, casa inicial ni jugadores; sin enlaces, correos ni teléfonos; sin una lista de marcas conocidas; identificadores y nombres únicos; **ningún título de elemento repetido en todo el catálogo**; ninguna pareja de plantillas con más de un 25 % de elementos iguales; rondas ≤ elementos; una lista de etiquetas por elemento. La ortografía y el tono no se pueden automatizar: se revisaron a mano al escribirlas.

## Fotos y casamiento con la biblioteca de medios (propuesta, no implementado)
El formato de plantilla **no admite precios por elemento ni etiquetas** (los precios de salida/mínimo son reglas de toda la partida: `presupuesto`, `puja_minima`), así que las etiquetas viajan en `lote.json` (`etiquetas[i]` = palabras clave **en inglés**, 1–4 por elemento, en el orden del catálogo; no se guardan en la base). Todos los elementos llevan `foto: null` y se ven con su emoji. Para añadir fotos después:
1. Para cada elemento, buscar en la biblioteca por **título normalizado** (sin tildes ni mayúsculas) y, si no hay coincidencia, por las **etiquetas** contra los términos en inglés de la biblioteca (el catálogo semilla `docs/catalogo-semilla/*.txt` usa la misma convención: `Título; descripción; emoji; keywords`).
2. Si hay coincidencia clara, asignar la URL de jsDelivr de la biblioteca a `foto` desde el editor (`/admin/plantillas/editor`, «elegir de la biblioteca»).
3. Los elementos sin foto siguen funcionando con emoji.
No se ha automatizado para no tocar la biblioteca ni inventar URL.

## Catálogo
<!-- inicio-tabla (generada por npm run templates:build) -->
| Slug | Título | Tono | Elementos | Presupuesto (Ohros) | Rondas |
|---|---|---|---|---|---|
| `antiguo-egipto` | Tesoros del antiguo Egipto | educativo | 16 | 30 | 10 |
| `apocalipsis-zombi-light` | Apocalipsis zombi (muy light) | humor negro suave | 16 | 30 | 10 |
| `bar-de-tapas` | Bar de tapas | adultos | 16 | 25 | 10 |
| `bazar-de-trastos` | Bazar de trastos | humor | 16 | 20 | 10 |
| `boda-por-todo-lo-alto` | Boda por todo lo alto | adultos | 16 | 30 | 10 |
| `camping-aventura` | Camping y aventura | familiar | 16 | 20 | 10 |
| `cena-de-empresa` | Cena de empresa legendaria | humor | 16 | 30 | 10 |
| `cocina-del-mundo` | Cocina del mundo | familiar | 17 | 25 | 10 |
| `cole-y-mochila` | Vuelta al cole | familiar | 16 | 20 | 10 |
| `cumpleanos-epico` | Cumpleaños épico | familiar | 16 | 20 | 10 |
| `despedida-de-soltero` | Despedida por todo lo alto | adultos | 16 | 30 | 10 |
| `espacio-exterior` | Misión al espacio | educativo | 16 | 25 | 10 |
| `festival-de-musica` | Festival de música | familiar | 16 | 25 | 10 |
| `fiesta-de-disfraces` | Fiesta de disfraces | adultos | 17 | 30 | 10 |
| `fondo-del-mar` | Fondo del mar | educativo | 17 | 25 | 10 |
| `granja-feliz` | Granja feliz | familiar | 16 | 20 | 10 |
| `jardin-botanico` | Jardín botánico | educativo | 17 | 20 | 10 |
| `laboratorio-loco` | Laboratorio loco | educativo | 17 | 25 | 10 |
| `mansion-encantada` | Mansión encantada | humor negro suave | 16 | 25 | 10 |
| `mascotas-locas` | Mascotas locas | familiar | 16 | 20 | 10 |
| `mercado-medieval` | Mercado medieval | educativo | 16 | 25 | 10 |
| `mudanza-imposible` | Mudanza imposible | humor | 16 | 25 | 10 |
| `navidad-desastre` | Navidad desastre | familiar | 17 | 25 | 10 |
| `noche-de-cine` | Noche de cine en casa | familiar | 16 | 20 | 10 |
| `noche-de-juegos-de-mesa` | Noche de juegos de mesa | familiar | 16 | 20 | 10 |
| `oficina-caotica` | Oficina caótica | humor | 17 | 25 | 10 |
| `olimpiadas-del-sofa` | Olimpiadas del sofá | humor | 16 | 20 | 10 |
| `reunion-familiar` | Reunión familiar | familiar | 16 | 20 | 10 |
| `salvaje-oeste` | Salvaje Oeste | familiar | 16 | 25 | 10 |
| `spa-y-bienestar` | Spa y bienestar | adultos | 16 | 25 | 10 |
| `superheroes-de-barrio` | Superhéroes de barrio | familiar | 17 | 25 | 10 |
| `verano-eterno` | Verano eterno | familiar | 16 | 20 | 10 |
| `viaje-en-el-tiempo` | Viaje en el tiempo | educativo | 18 | 25 | 10 |
| `viaje-por-europa` | Gran viaje por Europa | familiar | 17 | 25 | 10 |
| `vida-universitaria` | Vida universitaria | humor | 16 | 25 | 10 |
| `videojuegos-retro` | Salón recreativo retro | familiar | 16 | 25 | 10 |
<!-- fin-tabla -->

## Lo no probado
- Importación contra **Supabase real**: solo se probó con PGlite (las mismas funciones SQL); `--apply` en Supabase usa el mismo servicio, pero no se ha ejecutado contra un proyecto real.
- La subida desde el panel (`import_many`) se prueba por servicio (Vitest); no hay prueba e2e del botón.
- Las plantillas no se han jugado con grupos reales; las rondas (10) y los presupuestos (20–30 Ohros, puja mínima 1) son un punto de partida.
