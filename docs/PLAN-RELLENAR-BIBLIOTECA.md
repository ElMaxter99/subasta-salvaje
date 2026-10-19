# Plan operativo: rellenar la biblioteca de medios

Guía **paso a paso y repetible** para llenar *Superadmin → Biblioteca* con imágenes que sirvan para todo, etiquetadas por **rol** (`start` = foto de inicio de partida,
`product` = producto de catálogo), **categoría** y etiquetas, de modo que un anfitrión las encuentre y las use con «Elegir de la biblioteca».
Complementa a [BIBLIOTECA.md](BIBLIOTECA.md) (qué es y cómo funciona) y [BIBLIOTECA-ETIQUETAS.md](BIBLIOTECA-ETIQUETAS.md) (modelo de etiquetas y selector).

> **Estado y honestidad.** Las herramientas (script de descarga, subida por carpeta, etiquetado, cobertura, detección de parecidas) están hechas y probadas con servicios
> **simulados**. **No se ha probado nada contra Wikimedia, GitHub ni jsDelivr reales** desde el entorno de desarrollo (sin red hacia ellos). Las condiciones de las fuentes
> externas cambian: **confírmalas en su web oficial antes de depender de ellas**. Las descargas las lanzas tú en tu ordenador; la IA solo se usa para huecos concretos y cuenta en las cuotas.

## 0. Reglas que no cambian
1. **Solo fuentes que permitan redistribuir:** dominio público / CC0, fotos propias, o imágenes generadas con IA por el propietario. Las fotos acaban en un **repositorio público de GitHub** (`GITHUB_ASSETS_REPO`, servido por jsDelivr): publicar ahí es *redistribuir*.
2. **Nada de pago automático** y proveedores de IA solo gratuitos (regla del proyecto). Pexels/Pixabay/Unsplash: **evitar para volcado masivo** (sus licencias y APIs limitan reunir y redistribuir su biblioteca); solo para huecos puntuales y con aprobación expresa tras leer sus términos.
3. **Cada imagen lleva su origen** en *Crédito* (autor · licencia · enlace). Sin crédito, no se publica (ver §6).
4. Retirada a petición: si un titular lo pide, borra el registro (la imagen sigue en el historial de Git; para sacarla del todo habría que reescribir el repositorio de fotos, algo que la app no hace).

## 1. Objetivo de volumen y reparto
Primera tanda: **≈ 700 imágenes publicadas**. Los objetivos viven en `LIBRARY_CATEGORIES` (`src/lib/library/taxonomy.ts`) y el panel de cobertura los compara con lo publicado.

| Rol | Categorías (objetivo) | Total |
|---|---|---|
| `start` — foto de inicio de partida (escena 1536×1024, buena como imagen base (una casa, una nave, un salón…)) | Paisajes 60 · Playa y verano 20 · Halloween 15 · Navidad 15 | ≈ 110 |
| `product` — producto de catálogo (objeto 768 px, fondo limpio) | 12 categorías × 40 (Halloween, Navidad, Objetos del hogar, Comida y bebida, Dulces y chocolates, Animales, Deportes, Instrumentos musicales, Transportes, Disfraces y sombreros, Herramientas, Juguetes, Plantas y flores) + Playa y verano 30 · Frutas y verduras 30 · Mascotas disfrazadas 30 | ≈ 600 |

- Una imagen puede tener ambos roles (p. ej. una isla): se cuenta en los dos.
- Ritmo sugerido: **una categoría por sesión** (30–60 imágenes), publicar y medir antes de pasar a la siguiente.
- Hay 16 packs de texto (`docs/catalogo-semilla/*.txt`, ≈ 500 productos), incluidos *Mascotas disfrazadas*, *Juguetes* y *Plantas y flores*. **Faltan** más escenas para *Playa y verano*, *Halloween* y *Navidad* (`# Tipo: escena`).

## 2. Fuentes (de menos a más riesgo)
| Prioridad | Fuente | Licencia | Cómo |
|---|---|---|---|
| 1 | **Wikimedia Commons** (API sin clave) | Mezcla; el script **solo acepta CC0 / dominio público** (con `--allow-by`, también CC BY / CC BY-SA y entonces la atribución es obligatoria) | `npm run library` (§3) |
| 2 | **Museos con acceso abierto** (Met Museum y Art Institute of Chicago con script; Rijksmuseum, Smithsonian… manual) | CC0 en lo marcado como tal | `npm run library:openverse -- --source met\|artic` (§3b); el resto, a mano (§4). Objetos curiosos: cerámica, sombreros, juguetes antiguos |
| 3 | **Openverse** (agrega Commons, Flickr, museos; clave gratuita opcional) | El script **solo** acepta `cc0` y `pdm` | `npm run library:openverse` (§3b) |
| 4 | **Fotos propias** del propietario | Propiedad del titular | La vía más limpia para productos «de hogar». Anota «Foto propia · <año>» como crédito |
| 5 | **Generadas con IA** (botón «Generar imagen» del catálogo, cadena gratuita) | Del propietario (revisa los términos del proveedor) | Solo para productos sin foto; cuenta en el tope diario; crédito automático «Generada con IA (proveedor · modelo)» |

No se han verificado hoy las condiciones vigentes de Commons, Openverse ni de los museos: **léelas antes de la primera tanda grande**.

## 3. Descarga a una carpeta local (repetible)
Requisitos: Node ≥ 20 y `npm install`. Nada se sube desde el script.
```bash
npm run library -- --contact tu@correo                                  # todos los packs + galería index.html (~20-30 min por las pausas de cortesía)
npm run library:fetch -- --pack docs/catalogo-semilla/halloween.txt --contact tu@correo     # una sola categoría
npm run library:fetch -- --pack docs/catalogo-semilla/paisajes.txt --roles start --category "Paisajes" --tags paisaje --contact tu@correo
npm run library:fetch -- --index-only                                    # tras borrar a mano las malas: regenera manifest.csv, FUENTES.md e index.html
```
- `--contact` (o `LIBRARY_CONTACT`) va en el *User-Agent*, como pide Wikimedia. `--delay 1500` (ms entre peticiones), `--min-width 800`, `--allow-by`, `--per-product 2` (varias opciones por producto para elegir la mejor).
- **Etiquetado:** por defecto `roles` sale del tipo del pack (escena → `start`, objeto → `product`) y `categoria` es la colección. Un pack puede declarar `# Rol: inicio, producto` y `# Categoría: …`; en línea de órdenes mandan `--roles`, `--category`, `--tags`.
- Es **repetible**: salta lo ya descargado. Si Commons devuelve pocos resultados, cambia la búsqueda (4.ª columna del pack).
- Salida: `biblioteca-pendiente/<Colección>/<Producto>.jpg`, `manifest.csv`, `FUENTES.md`, `index.html` (galería local con autor, licencia y origen) y `<Colección>/productos.txt`. La carpeta está en `.gitignore`.

## 3b. Openverse y museos (CC0 / dominio público)
```bash
npm run library:openverse -- --pack docs/catalogo-semilla/juguetes.txt --contact tu@correo               # Openverse
npm run library:openverse -- --pack docs/catalogo-semilla/juguetes.txt --source met --contact tu@correo  # Met Museum (también: artic, o all)
npm run library:openverse -- --pack docs/catalogo-semilla/juguetes.txt --dry-run --contact tu@correo     # solo lista candidatos
```
- **Licencias aceptadas: solo CC0 y Public Domain Mark** (los museos, solo lo que ellos marcan como dominio público/CC0). Nada con atribución ni «no comercial».
- Misma carpeta, mismo `manifest.csv` y mismo estado que `npm run library`: se pueden combinar. Cada imagen se **normaliza** (WebP interno) y se descartan las casi idénticas por **huella perceptual**.
- Cabecera de contacto con `--contact`; pausas (`--delay`), reintentos con espera ante 429/5xx. Clave opcional y gratuita de Openverse por variables de entorno `OPENVERSE_CLIENT_ID` / `OPENVERSE_CLIENT_SECRET` (nunca se guardan).
- Los packs admiten búsquedas alternativas `inglés || español` en la 4.ª columna.
- **No probado contra los servicios reales** (solo con respuestas simuladas). Detalle, límites y qué esperar de cada fuente: [FUENTES-OPENVERSE-MUSEOS.md](FUENTES-OPENVERSE-MUSEOS.md).

## 4. Preparar una carpeta propia (fotos propias, museos, Openverse)
Estructura: `mi-carpeta/<Colección>/<archivo>.jpg|png|webp` + `mi-carpeta/manifest.csv`.
```csv
coleccion,archivo,titulo,autor,licencia,fuente,tipo,roles,categoria,etiquetas
Objetos del hogar,tetera_azul.jpg,Tetera azul,Ana B.,Foto propia,,item,product,Objetos del hogar,cocina|porcelana
Paisajes,playa_atardecer.jpg,Playa al atardecer,Luis C.,CC0,https://…,scene,start,Paisajes,mar|atardecer
```
- Obligatorias: `coleccion`, `archivo`. El resto es opcional (el título sale del nombre del archivo; sin `roles`, se deduce del `tipo`; sin `categoria`, la colección). Las columnas se leen **por nombre de cabecera**; un manifiesto antiguo de 7 columnas sigue valiendo. `roles` y `etiquetas` admiten `|` o `;` como separador.
- **Naming:** archivos y títulos **en español, cortos y reconocibles** (`Tetera azul`, no `IMG_4032`); un objeto por foto; el título de un producto debe coincidir con el nombre del producto del pack para que **se enlace solo** al importar el texto. Sin marcas ni personajes con derechos (evita «Pikachu», «Mickey»…). Formatos: JPG, PNG o WebP (no GIF ni SVG); resolución útil ≥ 800 px de ancho.
- Colecciones: nombres cortos, con mayúscula inicial, sin repetirlos con variantes (`Halloween`, no `halloween 2`): la colección es la **carpeta física** en GitHub y no se cambia sin mover archivos; para reagrupar usa la **categoría** (que sí se edita sin tocar GitHub).

## 5. Control de calidad antes de subir (checklist)
Marca todo antes de pasar a §6. Para fotos de museos o propias, esto es lo que decide si una imagen entra:

- [ ] **Licencia permitida y anotada** (CC0 / dominio público / propia / generada). Autor y enlace en la fila del manifiesto.
- [ ] **Sin marcas de agua**, logos ni texto llamativo; sin marcas comerciales reconocibles ni personajes con derechos.
- [ ] **Sin personas reconocibles ni menores**; sin contenido sensible.
- [ ] **Un objeto por foto**, centrado, fondo limpio (mezcla mejor con la imagen del jugador) — para `product`. Para `start`: escena amplia, sin objeto dominante, buena luz.
- [ ] Nítida, no pixelada ni muy comprimida; horizontal para `start`.
- [ ] Título comprensible en español; sin duplicados evidentes en la carpeta (usa `index.html` para verlo de un vistazo).
- [ ] Revisa a ojo en la galería local `index.html` y **borra del disco** lo que no cumpla; luego `npm run library:fetch -- --index-only`.

## 6. Subir, revisar y publicar
1. **Subir:** *Superadmin → Biblioteca → Imágenes → «Elegir una carpeta»* y elige la carpeta (la que tiene `manifest.csv`). Verás miniaturas; quita con ✕ las que sobren.
   Si no usas manifiesto, arrastra archivos y rellena **Colección, Rol(es), Categoría, Etiquetas y Crédito** del lote (aplica a todo el lote; sube por lotes homogéneos).
   Pulsa **«Subir N imágenes»**: cada foto se normaliza al formato interno (WebP) y **todo el lote entra en un solo commit**.
2. **Duplicados:** la identidad exacta es el hash del contenido (la misma foto no entra dos veces). Además, las filas con **«⚠ Parecida»** coinciden por huella perceptual con una imagen ya registrada o con otra del lote: quita la peor con ✕ **antes** de publicar o revísalas después en *Parecidas por contenido*. (Para las imágenes anteriores a la versión de etiquetas: «Calcular huellas que faltan».)
3. **Revisar:** filtra por **«Sin revisar»** y abre cada imagen: confirma rol, categoría y etiquetas, completa **crédito** (filtro «Sin crédito» debe quedar a 0) y marca **«Revisada»**. En bloque: selecciona → *Añadir/Quitar rol*, *Fijar categoría*, *Añadir etiqueta* → **«Marcar como revisadas»**. **Solo las revisadas aparecen** en «Elegir de la biblioteca».
4. **Productos:** *Productos del catálogo → Añadir varios (texto)*: pega el `productos.txt` de la colección; los productos se crean con su foto (mismo título). Los sin foto: «Generar imagen» o súbela.
5. **Probar en una partida real:** crea una partida y, en *Jugadores → Imagen de partida para todos* y en *Catálogo → De la biblioteca*, elige imágenes de las categorías nuevas.

## 7. Métricas de cobertura y calidad
En *Superadmin → Biblioteca → «Cobertura y calidad»* (siempre sobre lo **publicado**):
- Imágenes publicadas por **rol** y por **categoría** frente al objetivo, con barra y huecos («faltan N»). Rojo < 50 %, dorado 50–99 %, verde ≥ 100 %.
- Lista de control: sin crédito, por revisar, sin rol, sin categoría, sin huella. **Meta de cierre de cada tanda: todas a 0.**
- Seguimiento por tanda: anota en `docs/` o en el seguimiento del propietario la fecha, la categoría, cuántas se descargaron, cuántas pasaron la revisión y el commit resultante.

## 8. Fases
| Fase | Qué | Quién | Salida |
|---|---|---|---|
| A | Decidir fuentes y reparto (§1–2); registrar claves gratuitas solo si se usa Openverse | Propietario | Lista aprobada |
| B | Packs de texto: *Mascotas disfrazadas*, *Juguetes* y *Plantas y flores* (hechos); faltan más escenas | Claude / propietario | `docs/catalogo-semilla/*.txt` |
| C | **Piloto:** 3 categorías × ~40 (p. ej. Halloween, Paisajes, Objetos del hogar): descargar → checklist → subir → revisar → publicar → probar en partida | Propietario | Primeras ~120 publicadas |
| D | Ajustar packs/búsquedas según el piloto y escalar categoría a categoría vigilando la cobertura | Ambos | ≈ 700 publicadas |
| E | Huecos: productos sin foto con IA (tandas pequeñas, cuota diaria) y fotos propias | Propietario | Sin huecos en el panel |

## 9. Decisiones del propietario pendientes
1. ¿Solo CC0 / dominio público (recomendado) o también CC BY (con atribución visible) o Pexels/Pixabay tras revisar sus términos?
2. ¿Ajustas los objetivos de `LIBRARY_CATEGORIES` (categorías y cifras)?
3. ¿Quién revisa (marca «Revisada») y con qué criterio mínimo (§5)?
4. ¿Registras una clave gratuita de Openverse para tener más cupo? (opcional; el script funciona sin ella con un tope bajo).

## 10. Mejoras de herramientas posibles (no hechas)
- Más museos con API abierta (Rijksmuseum, Cleveland, Smithsonian) en `src/lib/library/free-sources.ts`.
- Exportar/importar un «pack de colección» (JSON con productos + referencias) para repetir el relleno en otro entorno.
- Marcar como duplicado en bloque desde *Parecidas por contenido* (hoy se borra el registro de uno en uno).
- Descripción de productos generada con IA al crear productos desde imágenes.

## Qué fotos faltan para las plantillas del sistema
`npm run templates:match` (ensayo) escribe `.match-report/huecos.csv` con las palabras de los elementos de plantilla que ninguna foto de producto revisada cubre, de más a menos pedidas. Úsalo para priorizar la subida. Detalle en [CASAR-FOTOS-PLANTILLAS.md](CASAR-FOTOS-PLANTILLAS.md).
