# Biblioteca: roles, categorías, etiquetas y selector en la partida

Resumen técnico y de uso de lo añadido a la [biblioteca de medios](BIBLIOTECA.md) para poder **rellenarla bien** y **usarla desde una partida**.
El proceso paso a paso para llenarla está en [PLAN-RELLENAR-BIBLIOTECA.md](PLAN-RELLENAR-BIBLIOTECA.md).

## 1. Modelo de etiquetado

Cada imagen (`library_images`) tiene, además de título, colección, etiquetas libres y crédito:

| Campo | Qué es | Notas |
|---|---|---|
| `roles` (`text[]`) | Para qué sirve en una partida | Conjunto. Hoy: `start` = **foto de inicio de partida** (la casa/escena inicial de los jugadores) y `product` = **producto de catálogo** (foto de un elemento que se subasta). Una imagen puede tener **los dos** o **ninguno** (sin rol: no se ofrece a los anfitriones). |
| `category` | Temática (Halloween, Paisajes…) | Texto libre con sugerencias (`LIBRARY_CATEGORIES`). Sirve para buscar y para medir la cobertura. |
| `tags` | Etiquetas libres de búsqueda | Ya existían (máx. 20, minúsculas). |
| `collection` | Carpeta física en el repositorio de fotos | Ya existía. **No** es lo mismo que la categoría (la colección cambia la ruta del archivo; la categoría solo es metadato y se edita sin tocar GitHub). |
| `reviewed` | Revisada por el superadmin | Ya existía. **Ahora es también «publicada»**: solo las revisadas se ofrecen a los anfitriones en el selector. |
| `phash` | Huella perceptual (dHash de 64 bits) | Para avisar de imágenes parecidas. Nula en las anteriores a esta versión (ver §5). |

**Por qué `roles` como conjunto y no un único `kind`:** un paisaje sirve de casa inicial pero también puede ser un producto («Isla desierta»);
con un campo único habría que duplicar la imagen (y el hash de contenido lo impide). Es extensible: para añadir un rol hay que ampliar
`LIBRARY_ROLES` en `src/lib/library/taxonomy.ts` y el `check` de la tabla en una **migración nueva** (el resto —filtros, parches, selector— ya trabaja con la lista).

**Por qué separar «revisada» de «tiene rol»:** el rol dice *para qué*, la revisión dice *si es apta* (sin marcas de agua, sin personas reconocibles, con crédito…).
Ofrecer a los anfitriones solo lo revisado evita que una foto dudosa llegue a una partida pública en la TV.

### Valores por defecto
- **Subida nueva:** sin roles indicados, escena (1536×1024) → `start`, objeto (768 px) → `product`. La categoría por defecto es la colección.
- **Imágenes ya existentes (migración `20260101009600`):** `category = collection`; `roles = {start}` si miden más de 768 px de ancho, `{product}` si miden ≤ 768 px, y `product` además si ya las usa un producto del catálogo.
  Siguen **sin revisar** (la migración no inventa una revisión): hasta que las marques como revisadas, **el selector de las partidas no las muestra**.
  Hazlo en bloque: Superadmin → Biblioteca → «Sin revisar» → «Seleccionar todo lo visible» → «Marcar como revisadas».

## 2. Panel del superadmin (`/admin/biblioteca`)
- **Subida masiva:** casillas de **rol**, **categoría** y etiquetas para el lote (cambiar el tipo objeto/escena ajusta el rol por defecto). Aviso por fila «⚠ Parecida» si la huella coincide con una imagen ya registrada o con otra del mismo lote (no bloquea: decides tú).
- **Galería:** filtros por **rol** (inicio / producto / sin rol), **categoría**, colección, texto (título, categoría, etiquetas, colección), «Sin crédito», «Sin revisar»; cada tarjeta muestra categoría y rol.
- **Edición individual:** ventana de la imagen (rol, categoría, etiquetas, crédito, «Revisada»). **En bloque** (selección múltiple): añadir/quitar rol, fijar categoría, añadir/quitar etiqueta, mover de colección, marcar como revisadas, borrar. Los ajustes «añadir/quitar» no pisan lo demás.
- **Cobertura y calidad:** tabla por categoría con las imágenes **publicadas** por rol frente al objetivo (barras), huecos totales y una lista de control (sin crédito, sin revisar, sin rol, sin categoría, sin huella). Los objetivos viven en `LIBRARY_CATEGORIES` (`src/lib/library/taxonomy.ts`); «Ver» filtra la galería por esa categoría.
- **Parecidas por contenido:** parejas con huella a ≤ 6 bits de distancia, con «Calcular huellas que faltan» para las anteriores (§5).

## 3. Subida por carpeta y script
- `manifest.csv`: columnas nuevas **opcionales** `roles` (`start|product`), `categoria` y `etiquetas` (`a|b|c`). La cabecera manda (el orden no importa) y un manifiesto antiguo de 7 columnas sigue valiendo. Sin `roles`, se deduce del `tipo` del manifiesto.
  ```csv
  coleccion,archivo,titulo,autor,licencia,fuente,tipo,roles,categoria,etiquetas
  Playa y verano,isla.jpg,Isla desierta,Ana B.,CC0,https://commons.wikimedia.org/wiki/File:Isla.jpg,scene,start|product,Playa y verano,mar|palmera
  ```
- `npm run library` / `library:fetch`: rellenan solos `roles` (según el tipo del pack), `categoria` (la colección) y `etiquetas` vacías. Opciones nuevas: `--roles start,product`, `--category "Halloween"`, `--tags terror,otoño`. Los packs (`docs/catalogo-semilla/*.txt`) pueden declarar `# Rol: inicio, producto` y `# Categoría: …`.

## 4. Selector en la partida («Elegir de la biblioteca»)
- **Dónde:**
  - *Panel del anfitrión → Jugadores → «Imagen de partida para todos»* (sala de espera): botón «Elegir de la biblioteca (foto de inicio de partida)»; pide confirmación y respeta el «¿A quién se aplica?» (actuales / nuevos).
  - *Panel del anfitrión → Catálogo*: botón «De la biblioteca» en cada elemento (aplica al elegir).
  - *Asistente «Nueva partida» → Las casas*: «Casa inicial (opcional)»; se aplica al crear la partida por la ruta que ya usan las plantillas.
- **API de solo lectura:** `GET /api/library/images?role=start|product&q=&category=&limit=&offset=` (anfitrión con sesión, 120 peticiones/min, `limit` ≤ 60). El rol es obligatorio. Devuelve solo imágenes **con ese rol y revisadas**, y por imagen únicamente `id, url, title, collection, category, tags, roles, credit, width, height` (sin ruta interna, hash, huella ni autor del alta) más el recuento por categoría. La lógica está en `ss_library_pick_list`.
- **Aplicar:** `POST /api/games/[code]/library-image` con `{ target: 'initial', image_id, scope_current, scope_new }` o `{ target: 'item', image_id, item_id }`. El servicio (`src/lib/services/library-pick-service.ts`) vuelve a comprobar en SQL (`ss_library_pick_get`) que la imagen existe, está revisada y tiene el rol que corresponde al destino, y delega en **las funciones ya existentes** `setInitialFromHosted` / `setItemImageFromHosted` (→ `ss_apply_initial_image` / `ss_set_item_image`) que comprueban propietario y estado de la partida. No hay lógica nueva de escritura de imágenes.
- **Imagen interna única:** la imagen ya se normalizó a WebP/tamaño interno (`src/lib/images/normalize.ts`) **al entrar** en la biblioteca, así que al aplicarla **se usa por enlace, sin descargarla ni copiarla** a Storage (igual que las fotos de las plantillas del sistema; requiere `GITHUB_ASSETS_REPO` y que el enlace sea de ese repositorio, `isHostedImage`). Nada se genera: **no es IA**, no consume cuotas ni toca saldos.
- **Honestidad:** en el diálogo se indica que son fotos de la biblioteca, no generadas por IA.

## 5. Detección de parecidas (huella perceptual simple)
`src/lib/library/phash.ts` calcula un **dHash de 64 bits** con `sharp` (sin dependencias nuevas): reduce a 72×64 en grises, desenfoque leve y 9×8; cada bit compara un píxel con su vecino. Se guarda como 16 caracteres hexadecimales.
- Al preparar cada imagen (`stageLibraryImage`) se busca en SQL (`ss_admin_library_image_near`, `bit_count` del XOR) lo registrado a ≤ **6 bits** (`NEAR_DUPLICATE_DISTANCE`) y se devuelve como aviso. **No bloquea**; el hash de contenido exacto sigue evitando los duplicados idénticos.
- Detecta la misma foto con otro tamaño, compresión o un recorte muy leve. **No** detecta el mismo motivo con otro encuadre, giros ni espejos, y dos imágenes casi lisas pueden parecerse entre sí sin ser repetidas: es una ayuda para revisar, no un veredicto.
- Las imágenes anteriores no tienen huella: «Calcular huellas que faltan» (20 por pulsación; descarga cada una desde su enlace con las defensas SSRF habituales y repite hasta que quede 0).

## 6. Archivos y pruebas
| Qué | Dónde |
|---|---|
| Migración / permisos | `supabase/migrations/20260101009600_library_tags.sql` / `…009601_security_library_tags.sql` |
| Taxonomía, cobertura, huella | `src/lib/library/{taxonomy,coverage,phash}.ts` |
| Servicios | `src/lib/services/library-service.ts` (etiquetas, cobertura, parecidas), `library-pick-service.ts` (selector y aplicar) |
| API | `/api/admin/library` (ops `images.list`+filtros, `images.update`+`*_add/_remove`, `images.similar`, `images.backfill_hashes`, `coverage`), `/api/library/images`, `/api/games/[code]/library-image` |
| UI | `src/components/admin/{library-panel,library-upload,library-image-dialog,library-coverage,library-role-fields}.tsx`, `src/components/host/{library-image-picker,initial-image-card,catalog-panel}.tsx`, `src/components/landing/new-game-form.tsx` |
| Pruebas | `tests/library-tags.test.ts`, `tests/library-commons.test.ts` (manifiesto/packs), `e2e/library-picker.spec.ts` |

## 7. Qué NO se ha probado contra servicios reales
- GitHub y jsDelivr: la subida se prueba con un servidor simulado; las miniaturas del selector apuntan a jsDelivr y en el entorno de pruebas no hay red hacia él (los e2e comprueban el flujo, no que se vean).
- El umbral de 6 bits está calibrado con imágenes sintéticas y fotos de prueba, no con un corpus real: ajústalo (`NEAR_DUPLICATE_DISTANCE`) si ves demasiados avisos o ninguno.
- Los objetivos de volumen de `LIBRARY_CATEGORIES` son una propuesta de partida.
