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
  del nombre del archivo (`sombrilla_roja-01.jpg` → «Sombrilla roja 01»). Se envían **de una en una** (GitHub no admite commits simultáneos en la
  misma rama) con barra de progreso, contadores (nuevas / repetidas / con error), botón **Parar** y **Continuar**. Si GitHub pide ir más despacio
  (429) se espera 20 s y se reintenta hasta 3 veces. Lo que no es JPG, PNG o WebP se descarta y se avisa.
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
están se omiten; máximo 100 elementos). Las fotos son enlaces https que se copian a la partida al crearla (necesitan `ASSET_CDN_HOSTS` con
`cdn.jsdelivr.net` si la defines). Cualquier anfitrión con sesión puede **leer** el catálogo general (`GET /api/library/items`); solo el superadmin
lo gestiona.

## Configuración
Misma que las fotos de plantillas: `GITHUB_ASSETS_REPO`, `GITHUB_ASSETS_TOKEN` (*Contents: Read and write* solo sobre ese repositorio) y
`GITHUB_ASSETS_BRANCH` (`master` en `ElMaxter99/subasta-salvaje-public`). Migraciones `…5000` y `…5100`. Cada subida/edición queda en **Auditoría**.

## Honestidad y límites
- La subida a GitHub **solo se ha probado con un servidor simulado**, no contra GitHub ni jsDelivr reales. Si en una subida de 200 fotos GitHub aplica
  límites secundarios más estrictos que los reintentos previstos, la cola se puede **Continuar** sin perder lo ya subido.
- Cada foto es un commit en el repositorio de fotos: 200 fotos = 200 commits. Es normal para un repositorio de medios, pero el historial crece.
- No se borra nada de GitHub desde la app. Las imágenes pueden proceder de terceros: respeta la política del repositorio (README de
  `subasta-salvaje-public`: sin ánimo de lucro, sin licencia concedida, retirada a petición) y anota el origen en el crédito.
