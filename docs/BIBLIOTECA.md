# Biblioteca de medios (superadmin)

Un sitio único donde el superadmin sube **decenas o cientos de imágenes generales** (paisajes, objetos divertidos…) y construye un
**catálogo general de productos** (50 de Halloween, 50 chocolates…) que luego se reutiliza en cualquier partida o plantilla sin
duplicar nada.

## Cómo funciona
- **Los archivos viven en GitHub** (repositorio público de fotos, servido por jsDelivr), en `biblioteca/<colección>/<título>-<hash>.webp`.
  **Supabase solo guarda metadatos y enlaces** (tablas `library_images` y `library_items`, cerradas con RLS; todo pasa por funciones `ss_*`).
- Los enlaces van **fijados al commit** (`…/gh/usuario/repo@<commit>/…`), así que son estables y persistentes: una partida o plantilla que
  apunta a una imagen de la biblioteca no necesita una copia.
- Cada imagen se **normaliza** al formato interno (WebP ligero, ver `IMAGEN-INTERNA.md`): «objeto» 768 px (~150 KB) o «escena» 1536×1024 (~300 KB).
- **Sin duplicados:** la identidad de una imagen es el hash de su contenido ya normalizado. Subir otra vez la misma foto (aunque tenga otro
  nombre) no llega a GitHub y devuelve la existente.

## `/admin/biblioteca`
**Pestaña Imágenes**
- *Subida masiva*: arrastra archivos o una **carpeta entera** (o elige). Colección, etiquetas y crédito se aplican a todo el lote; el título sale
  del nombre del archivo (`sombrilla_roja-01.jpg` → «Sombrilla roja 01»). La subida es en **dos fases y todo el lote entra en UN solo commit**:
  (1) cada foto se envía de una en una: el servidor la normaliza, mira si ya está registrada y, si es nueva, la deja *preparada* en GitHub como
  objeto de Git (blob), sin crear commit; (2) al acabar, **todas las preparadas se publican juntas** (árbol + un commit + mover la rama con la
  API de datos de Git). Barra de progreso, contadores (nuevas / repetidas / con error), **Parar** (lo ya preparado se publica con «Publicar N
  preparadas») y reintento si GitHub pide ir más despacio (429: espera 20 s, hasta 3 veces). Si falla la publicación **no se registra nada** y se
  reintenta con la misma lista. Las copias dentro del mismo lote se detectan por contenido. Lo que no es JPG, PNG o WebP se descarta y se avisa.
- *Galería*: búsqueda (título, etiquetas, colección), filtro por colección, «Cargar más», selección múltiple → **mover de colección**, **borrar** o
  **crear productos**.
- Borrar una imagen quita el registro; **el archivo sigue en el repositorio de fotos** (no se borra de GitHub) y los productos que la usaban quedan sin foto.

**Pestaña Productos del catálogo**
- *Desde imágenes*: selecciona imágenes y «Crear productos…»: el nombre sale del título (editable), con emoji y descripción opcionales.
- *En bloque por texto*: una línea por producto, `Nombre; Descripción; Emoji`. Si hay una imagen de la biblioteca (en esa colección) con el mismo
  título, se **enlaza sola**. Los repetidos (misma colección y nombre) se omiten.
- Lista filtrable y borrado múltiple.

## Usarlo al configurar una partida
En el asistente de «Nueva partida» (y en el editor del superadmin), en el **Resumen → catálogo**: **«De la biblioteca»** abre un modal flotante
(móvil y escritorio) con colecciones y buscador; marcas productos o «Marcar todos» y se **añaden al catálogo** de esa partida (los nombres que ya
están se omiten; máximo 100 elementos). Las fotos se usan **por enlace, sin descargarlas ni copiarlas** (solo se guardan las imágenes que genere la IA); necesitan `ASSET_CDN_HOSTS` con
`cdn.jsdelivr.net` si la defines. La portada, la casa inicial y la foto de cada elemento de una plantilla del sistema también se eligen de la biblioteca («De la biblioteca» en la Ficha y en el editor de catálogo) o se suben. Cualquier anfitrión con sesión puede **leer** el catálogo general (`GET /api/library/items`); solo el superadmin
lo gestiona.

## Configuración
Misma que las fotos de plantillas: `GITHUB_ASSETS_REPO`, `GITHUB_ASSETS_TOKEN` (*Contents: Read and write* solo sobre ese repositorio) y
`GITHUB_ASSETS_BRANCH` (`master` en `ElMaxter99/subasta-salvaje-public`). Migraciones `…5000` y `…5100`. Cada subida/edición queda en **Auditoría**.

## Honestidad y límites
- La subida a GitHub **solo se ha probado con un servidor simulado**, no contra GitHub ni jsDelivr reales. Si en una subida de 200 fotos GitHub aplica
  límites secundarios más estrictos que los reintentos previstos, la cola se puede **Continuar** sin perder lo ya subido.
- Un lote = un commit (y en las plantillas del sistema las imágenes se publican, también en un commit, solo al guardar). Una foto suelta es su propio commit. Los blobs
  preparados que no llegan a publicarse (p. ej. una copia dentro del lote) los limpia GitHub solo.
- Si entre la preparación y la publicación alguien mueve la rama, la publicación se rehace sobre la cabeza nueva (hasta 3 intentos).
- El lote pasa por el token de GitHub: necesita *Contents: Read and write* (la API de datos de Git usa el mismo permiso). No se borra nada de GitHub desde la app. Las imágenes pueden proceder de terceros: respeta la política del repositorio (README de
  `subasta-salvaje-public`: sin ánimo de lucro, sin licencia concedida, retirada a petición) y anota el origen en el crédito.

## Regla de producto: nunca se escribe una URL
En la interfaz **no hay campos para pegar o escribir `https://…`**: las imágenes se **suben** o se **eligen de la biblioteca**. Lo vigila `tests/no-url-inputs.test.ts`. (Los archivos JSON/ZIP/CSV importados pueden contener enlaces: se validan, pero no se teclean.)
