# Plan: rellenar la biblioteca con muchas fotos y productos de catálogo completos

Objetivo: llenar **Superadmin → Biblioteca** con cientos de fotos útiles para el juego (objetos divertidos, comida, animales, paisajes…) y con
**productos de catálogo completos** (nombre, descripción, emoji, colección y foto) listos para importar en cualquier partida o plantilla.
Estado: **plan** (nada de esto está ejecutado). Las cifras de límites de terceros salen de la documentación pública consultada de pasada y
**hay que confirmarlas en la web oficial antes de depender de ellas**.

## 0. Lo que condiciona el plan (honesto)
1. **Desde el entorno donde trabaja Claude no se puede llegar a Pexels ni a Pixabay** (la red lo bloquea, comprobado). Claude no puede «ir a Pexels
   y traer fotos»: lo que sí puede es **escribir y probar el script de importación** y las listas de productos; **las descargas las ejecuta el
   propietario en su ordenador** con su propia clave de API. Tampoco se ha probado nada contra los servicios reales.
2. **Las fotos acabarán en un repositorio público de GitHub** (`subasta-salvaje-public`, servido por jsDelivr). Eso es *redistribuir*. Las licencias
   «gratis» de los bancos de imágenes permiten usar las fotos en un proyecto, pero muchas **prohíben reunirlas para redistribuirlas** o copiar la
   biblioteca del servicio (Pexels, por ejemplo, limita la API a 200 peticiones/hora y 20.000/mes y exige atribuir al fotógrafo con enlace;
   Pixabay pide cachear y no hacer descargas masivas sistemáticas). **Antes de importar a lo grande hay que leer la licencia y los términos de la
   API de cada fuente** y decidir. Por eso el plan prioriza fuentes de **dominio público / CC0**, donde el problema no existe.
3. **Atribución y retirada:** cada imagen debe llevar su origen en el campo *Crédito* (la biblioteca ya lo guarda) y el repositorio de fotos ya
   declara «sin ánimo de lucro, retirada a petición». Hay que mantener un `FUENTES.md` con el listado.
4. **Solo proveedores gratuitos y nada de pago automático** (regla del proyecto): la IA solo se usa para productos sin foto y cuenta en las cuotas.

## 1. Fuentes de fotos (de menos a más riesgo)
| Prioridad | Fuente | Licencia | Notas |
|---|---|---|---|
| 1 | **Wikimedia Commons** (API MediaWiki, sin clave) | Mezcla: filtrar **CC0 / dominio público** | Muchísimo material de objetos, comida, animales, lugares. Cada archivo trae autor y licencia en la API: se guarda en *Crédito*. |
| 2 | **Openverse** (API, clave gratuita; agrega Commons, Flickr, museos…) | Filtrar `license=cc0,pdm` (sin obligación de atribuir) | El anónimo está muy limitado (decenas de peticiones al día, según lo consultado): registrar la aplicación para la clave gratuita. |
| 3 | **Museos con acceso abierto** (Met Museum, Rijksmuseum, Smithsonian: APIs con CC0) | CC0 | Objetos curiosos y divertidos (cerámica, juguetes antiguos, sombreros…). |
| 4 | **Pexels** (clave gratuita) | Licencia Pexels: uso libre, **no** redistribuir/vender sin modificar ni copiar su biblioteca | Buena calidad. Solo si, tras leer licencia y términos, se decide que alojarlas en el repositorio público es aceptable; si no, **no alojarlas**: enlazar es otra historia (el juego exige copias nuestras). Límite 200/h. Recomendación: **evitar** para volcado masivo. |
| 5 | **Pixabay** (clave gratuita) | Licencia Pixabay | Mismas dudas de redistribución. Recomendación: **evitar** para volcado masivo. |
| — | Fotos propias o generadas con IA | Propiedad del titular | La vía más limpia legalmente para productos «de fantasía» (ya existe «Generar imagen» en el catálogo del superadmin). |

Recomendación: empezar por **1–3 (CC0/dominio público)**; dejar Pexels/Pixabay solo para huecos concretos y con aprobación explícita del propietario tras
revisar términos.

## 2. Qué colecciones (primera tanda de ~12 × 40–60 = 500–700 imágenes)
Elegidas para que las mezclas del juego sean graciosas (la IA integra el objeto en la casa/imagen base del jugador):
Objetos del hogar · Comida y bebida · Dulces y chocolates · Animales · Mascotas disfrazadas · Halloween · Navidad · Playa y verano ·
Deportes · Instrumentos · Transportes (barcas, globos, coches…) · Disfraces y sombreros · Herramientas · Juguetes · Plantas y flores · Paisajes (como bases/escenas).
Tipo de imagen: «objeto» (768 px) para productos y «escena» (1536×1024) para paisajes/casas iniciales.

## 3. Cadena de trabajo (todo en local salvo el último paso)
```
buscar por colección  →  descargar a una carpeta + manifest.csv  →  revisar a ojo  →  subir en bloque (1 commit)  →  crear productos
 (script, clave propia)     (título, autor, licencia, URL origen)   (miniaturas)       (UI de Biblioteca)         (lista de texto / desde imágenes)
```
1. **Script de descarga** `scripts/library/fetch-<fuente>.ts` (a escribir): recibe colección + consulta + cantidad, usa la API de la fuente con
   la clave en una variable de entorno (**nunca en el repo**), **filtra por licencia permitida**, descarta tamaños pequeños, respeta el límite
   de peticiones (pausas) y guarda en `./biblioteca-pendiente/<colección>/<titulo>.jpg` más un `manifest.csv` con autor, licencia y enlace.
2. **Revisión humana:** abrir la carpeta (o subirla y revisar en la nueva cuadrícula de miniaturas, quitando con ✕ lo que no sirva): sin marcas
   de agua, sin personas reconocibles ni menores, sin logos/marcas comerciales llamativas, sin contenido sensible. Un objeto por foto y fondo limpio
   se mezcla mucho mejor.
3. **Subida:** arrastrar la carpeta a *Biblioteca → Imágenes* (colección + crédito del lote; un commit por lote). Para créditos distintos por foto,
   subir por lotes del mismo autor o extender la subida para leer el `manifest.csv` (paso opcional, ver §6).
4. **FUENTES.md** del repositorio de fotos: generado a partir del `manifest.csv` y subido en el mismo lote de trabajo.

## 4. Productos de catálogo completos
Un producto = **nombre + descripción + emoji + colección + foto**.
- **Textos (sin red, lo puede hacer Claude ahora):** listas de 40–60 productos por colección en formato `Nombre; Descripción; Emoji`
  en español, con descripciones pensadas para el juego (qué es y cómo se ve), guardadas en `docs/catalogo-semilla/<coleccion>.txt`. Se pegan en
  *Catálogo → Añadir muchos productos a la vez*, y **enlazan solas con la foto de título igual** (por eso conviene que las fotos se llamen igual
  que el producto). Los emojis se pueden ajustar con el selector nuevo.
- **Fotos de los productos:** (a) la de la biblioteca con el mismo título; (b) para los que no tengan, **Generar imagen con IA** en su tarjeta
  (cadena gratuita, cuenta en el tope diario; solo cuando Cloudflare/Pollinations tengan cuota); (c) o subida manual.
- **Calidad:** nombres cortos y reconocibles, sin marcas registradas ni personajes con derechos (evitar «Pikachu», «Mickey»… en el catálogo general),
  sin duplicados (la biblioteca omite repetidos por colección+nombre).

## 5. Fases y orden
| Fase | Qué | Quién | Salida |
|---|---|---|---|
| A | Decidir fuentes y colecciones (§1–2); registrar claves gratuitas (Openverse; las demás solo si se aprueban) | Propietario | Lista aprobada |
| B | Escribir las listas de productos (`docs/catalogo-semilla/`) para 3 colecciones piloto | Claude | Archivos de texto + tests de formato |
| C | Escribir y probar el script de descarga con una fuente CC0 (Wikimedia Commons u Openverse) con respuestas simuladas; **probar de verdad en el ordenador del propietario** | Claude + propietario | `scripts/library/…` + manifest |
| D | Piloto: 3 colecciones × ~40 fotos → revisar → subir (1 commit por colección) → importar productos → probar en una partida real | Propietario | Biblioteca piloto |
| E | Ajustar según el piloto y escalar al resto de colecciones | Ambos | 500–700 imágenes |
| F | Productos sin foto: generar con IA por tandas pequeñas | Propietario | Catálogo completo |

## 6. Mejoras de la app que ayudan (opcionales, a pedir)
- Subida que lea un `manifest.csv` (título, autor, licencia, enlace) para rellenar *Título* y *Crédito* por foto.
- Exportar/importar un «pack de colección» (JSON con productos + referencias a imágenes) para repetir el relleno en otro entorno.
- Un botón «Crear producto para cada imagen de esta colección» con descripción generada con IA (hoy el nombre sale del título y la descripción se escribe).
- Aviso en la ventana de una imagen cuando no tiene crédito.

## 7. Documentación y legal que se tocarán al ejecutar
`docs/BIBLIOTECA.md` (fuentes y proceso), `docs/LEGAL.md` y créditos (nuevas fuentes de terceros, licencias y política de retirada), README del
repositorio de fotos y `FUENTES.md`. Si se usa un proveedor o API nuevo, declararlo en créditos/privacidad.

## 8. Decisiones que necesito del propietario
1. ¿Solo CC0 / dominio público (recomendado) o también Pexels/Pixabay tras revisar sus términos?
2. ¿Qué colecciones y cuántas fotos por colección en la primera tanda?
3. ¿Quieres que Claude empiece ya por la **Fase B** (listas de productos en español) y el script de la **Fase C**?
