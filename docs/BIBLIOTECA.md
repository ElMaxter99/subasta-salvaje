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

## Superadmin → Biblioteca
Dos vistas, con pestañas arriba: **Imágenes** (`/admin/biblioteca`, solo fotos) y **Productos del catálogo** (`/admin/catalogo`).

### Imágenes (solo fotos)
- *Subida masiva*: arrastra archivos o una **carpeta entera** (o elige). Lo elegido **no se sube al momento**: queda en una **cuadrícula de miniaturas** para revisarlo; quita las que sobren con la ✕ (o «Quitar las pendientes») y pulsa **«Subir N imágenes»**. Colección, etiquetas y crédito se aplican a todo el lote; el título sale
  del nombre del archivo (`sombrilla_roja-01.jpg` → «Sombrilla roja 01»). La subida es en **dos fases y todo el lote entra en UN solo commit**:
  (1) cada foto se envía de una en una: el servidor la normaliza, mira si ya está registrada y, si es nueva, la deja *preparada* en GitHub como
  objeto de Git (blob), sin crear commit; (2) al acabar, **todas las preparadas se publican juntas** (árbol + un commit + mover la rama con la
  API de datos de Git). Barra de progreso, contadores (nuevas / repetidas / con error), **Parar** (lo ya preparado se publica con «Publicar N
  preparadas») y reintento si GitHub pide ir más despacio (429: espera 20 s, hasta 3 veces). Si falla la publicación **no se registra nada** y se
  reintenta con la misma lista. Las copias dentro del mismo lote se detectan por contenido. Lo que no es JPG, PNG o WebP se descarta y se avisa.
- *Galería*: búsqueda (título, etiquetas, colección), filtro por colección, «Cargar más» y selección múltiple → **mover de colección**, **borrar** o
  **crear productos**.
- **Pulsar una imagen abre una ventana** para inspeccionarla (grande, con medidas, peso y fecha; enlace para abrirla aparte) con estas opciones:
  **Crear producto del catálogo** (nombre, emoji y descripción editables), **Asociar a un producto** (buscador del catálogo; la imagen pasa a ser
  la foto de ese producto), editar título/colección/etiquetas/crédito y **Borrar**.
- Borrar una imagen quita el registro; **el archivo sigue en el repositorio de fotos** (no se borra de GitHub) y los productos que la usaban quedan sin foto.

### Productos del catálogo
Misma presentación que el catálogo del anfitrión. Arriba del todo: el título con el total y los botones **«Añadir producto»** (abre una ventana con el formulario) y **«Añadir varios (texto)»**. Debajo: buscador (nombre, descripción, colección), filtro por colección y tamaño de página (12/24/48), la lista con foto **paginada** (Anterior / Siguiente, «Página x de y»). En cada producto:
- **Generar imagen** con IA (cadena de proveedores gratuitos y ajustes del superadmin; cuenta en el tope diario global; migración `…6400`/`…6500`).
  La imagen generada es la única que se guarda: se publica en la biblioteca (un commit, colección del producto, etiqueta `ia`, crédito con proveedor y
  modelo) y se asocia al producto. Si la IA no está configurada o está apagada, el botón está desactivado: nunca se simula.
- **Subir foto / Cambiar foto** (se reduce y publica en la biblioteca), **De la biblioteca** (modal con las imágenes) y **Quitar foto**.
- **Editar** (nombre, emoji, colección, descripción) y **Eliminar**. El alta por texto acepta
  una línea por producto, `Nombre; Descripción; Emoji`, y enlaza sola la imagen con el mismo título. Los repetidos (misma colección y nombre) se omiten.

## Rellenar la biblioteca en bloque desde tu ordenador (fotos libres de Wikimedia Commons)
Primero se descarga todo a una **carpeta local** para revisarlo; después se sube a producción desde el panel. Nada se sube desde el script.
```bash
npm run library          # TODO en uno: descarga los 4 packs, genera la galería y la abre (LIBRARY_CONTACT=tu@correo opcional)
# o por partes:
npm run library:fetch -- --pack docs/catalogo-semilla/halloween.txt --contact tu@correo   # un pack
npm run library:fetch -- --all --contact tu@correo                                         # los 4 packs piloto (~125 productos)
open biblioteca-pendiente/index.html        # galería local con autor, licencia y origen; borra a mano las fotos que no sirvan
npm run library:fetch -- --index-only       # regenera manifest.csv, FUENTES.md e index.html con lo que quede
```
- Los **packs** (`docs/catalogo-semilla/*.txt`) listan los productos como `Nombre; Descripción; Emoji; búsqueda en inglés` con cabeceras
  `# Colección:` y `# Tipo: item|scene`. Piloto: Halloween, Dulces y chocolates, Playa y verano, Objetos del hogar. Se pueden añadir más.
- **Solo CC0 / dominio público** por defecto (`--allow-by` añade CC BY / CC BY-SA, con atribución en el crédito). Se descarta lo pequeño
  (`--min-width 800`), lo que no es JPG/PNG/WebP y lo marcado con restricciones de marca o personalidad. Pausas entre peticiones (`--delay 1500`)
  y el `User-Agent` lleva tu correo (`--contact`), como pide Wikimedia. Se puede repetir: salta lo ya descargado.
- Sale `biblioteca-pendiente/<Colección>/<Nombre del producto>.jpg` (el título coincide con el producto, así que **se enlaza sola** al importar el texto),
  `manifest.csv` (colección, título, autor, licencia, fuente, tipo), `FUENTES.md`, `index.html` y `<Colección>/productos.txt`. La carpeta está en `.gitignore`.
- **Subir a producción:** Superadmin → Biblioteca → Imágenes → **«Elegir una carpeta»** y elige `biblioteca-pendiente`. La pantalla lee el
  `manifest.csv`: cada foto entra con su colección, título, tipo y crédito (autor · licencia · origen), con miniaturas para quitar las que sobren y **un solo commit**.
  Luego, en **Productos del catálogo → Añadir varios (texto)**, pega el contenido de `<Colección>/productos.txt` con la colección elegida:
  los productos se crean con su foto. Los que no tengan foto, con «Generar imagen» (IA) o subiéndola.
- **Sin probar contra Wikimedia real** (el entorno de desarrollo no tiene red hacia esos servidores): la búsqueda y el manifiesto se prueban con respuestas
  simuladas y la subida con un GitHub simulado. Si Commons devuelve pocos resultados para una búsqueda, cámbiala en el pack (cuarta columna).
  Respeta las condiciones de uso de Wikimedia (no lances descargas masivas seguidas).

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
