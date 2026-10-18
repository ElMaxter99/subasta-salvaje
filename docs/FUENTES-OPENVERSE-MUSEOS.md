# Fuentes abiertas para la biblioteca: Openverse y museos

Complementa a [PLAN-RELLENAR-BIBLIOTECA.md](PLAN-RELLENAR-BIBLIOTECA.md) y [BIBLIOTECA.md](BIBLIOTECA.md). Describe `npm run library:openverse`
(`scripts/library/fetch-openverse.ts`, lógica en `src/lib/library/free-sources.ts` y `src/lib/library/ingest.ts`).

> **Honestidad.** Todo se probó **solo con respuestas simuladas** (`tests/library-free-sources.test.ts` y una ejecución del script con `fetch` sustituido).
> **No se ha probado contra Openverse, el Met ni el Art Institute of Chicago reales**: el contenedor de desarrollo no tiene garantía de red. Los campos y
> parámetros salen de la documentación pública de cada API tal como se conocía al escribirlo; **confirma en su web oficial** los límites, las condiciones y los campos
> antes de la primera tanda grande y, si algo cambió, ajusta `free-sources.ts`.

## Licencias aceptadas (y nada más)
| Fuente | Se acepta | Cómo se garantiza |
|---|---|---|
| Openverse | `cc0` (CC0 1.0) y `pdm` (Public Domain Mark 1.0) | Filtro `license=cc0,pdm` en la petición **y** segunda comprobación en el código (si la API devolviera otra, se descarta). También se descartan `mature`, formatos que no sean JPG/PNG/WebP, imágenes de menos de `--min-width` y URL que no sean https |
| Metropolitan Museum of Art (`met`) | Objetos con `isPublicDomain: true` (Open Access, CC0) | Petición con `isPublicDomain=true&hasImages=true` y comprobación del campo en cada objeto |
| Art Institute of Chicago (`artic`) | Obras con `is_public_domain: true` (CC0) | Petición con `query[term][is_public_domain]=true` y comprobación del campo |

**Nunca** se descarga CC BY, CC BY-SA, «no comercial», «sin derivadas» ni «todos los derechos reservados». (El script de Commons sí tiene `--allow-by`; este **no**.)
El resultado lleva `licencia = CC0 1.0` o `Public Domain Mark 1.0`; CC0 y PDM no exigen atribución, pero el crédito (autor · licencia · enlace) se guarda igualmente.

## Claves, registro y coste
- **Openverse:** funciona **sin clave** (acceso anónimo con un tope diario y por hora muy bajo). Registrar una aplicación es **gratuito**
  (formulario de la propia API → `client_id` y `client_secret` para un token OAuth2 con más cupo). El script las lee de las variables de entorno
  `OPENVERSE_CLIENT_ID` y `OPENVERSE_CLIENT_SECRET`; **no se imprimen, no se guardan en ningún archivo ni se suben**. Ponlas solo en tu terminal
  (`export …`) o en un `.env.local` que ya está ignorado por Git. Si pegas una clave en un chat, rótala.
- **Met Museum** y **Art Institute of Chicago:** API pública **sin clave y sin registro**. Piden un User-Agent identificable (el script lo pone con tu `--contact`).
- No se usa ninguna fuente de pago ni se activa nada de pago. Otros museos con API abierta (Rijksmuseum, Cleveland, Smithsonian) se descartaron en esta tanda:
  algunos exigen clave (gratuita) y no aportan más que estos dos; se pueden añadir como una función más en `free-sources.ts`.

## Cortesía y límites
- User-Agent `SubastaSalvajeLibrary/1.0 (<tu contacto>; …)`: usa **`--contact tu@correo`** (o `LIBRARY_CONTACT`). Sin él el script avisa.
- Pausa de `--delay` ms (2000 por defecto) entre peticiones; el Met además se consulta a ≤ 10 objetos por segundo (su tope publicado es muy superior).
- Ante `429` o `5xx` reintenta hasta 4 veces con espera creciente (respeta la cabecera `Retry-After`, máx. 2 min). Si se agotan por 429, **para limpiamente**
  y se puede repetir más tarde (salta lo ya descargado).
- Las descargas se limitan a `--max-bytes` (25 MB por defecto), solo por https.

## Qué hace con cada imagen (la misma tubería que `npm run library`)
1. Busca con cada alternativa de la 4.ª columna del pack (`inglés || español`) hasta que una devuelva candidatos libres que no se hayan usado ya (por URL de origen).
2. Descarga y **normaliza** con `normalizeImage` (`src/lib/images/normalize.ts`: WebP, 768 px para objetos / 1536×1024 para escenas, sin metadatos EXIF/GPS, peso acotado).
3. Calcula la **huella perceptual** (`src/lib/library/phash.ts`) y descarta la imagen si está a ≤ `--dedupe-distance` bits (6 por defecto, `NEAR_DUPLICATE_DISTANCE`) de otra ya reunida en la carpeta (`huellas.json`).
4. Guarda `<carpeta>/<Colección>/<Producto>.webp` y escribe `manifest.csv` con **roles, categoría, etiquetas, autor, licencia y fuente**, además de `FUENTES.md`, `index.html` y `fuentes.json` (el mismo estado que usa `library:fetch`: ambos scripts se pueden mezclar en la misma carpeta; las imágenes de Commons no entran en `huellas.json`, así que la deduplicación cruzada solo la hace la subida del panel).
Las de museos llevan la etiqueta `museo` para distinguirlas al revisar.

## Uso
```bash
npm run library:openverse -- --pack docs/catalogo-semilla/juguetes.txt --contact tu@correo                 # Openverse (por defecto)
npm run library:openverse -- --pack docs/catalogo-semilla/juguetes.txt --source met --contact tu@correo    # museo
npm run library:openverse -- --all --source all --contact tu@correo                                         # todos los packs en las tres fuentes (en ese orden de preferencia: openverse, met, artic)
npm run library:openverse -- --pack docs/catalogo-semilla/plantas-y-flores.txt --dry-run --contact tu@correo # solo lista candidatos, no descarga ni escribe
npm run library:openverse -- --index-only                                                                   # tras borrar a mano las malas
```
Luego se sigue igual que siempre: revisar `index.html`, borrar lo que no sirva, `--index-only`, subir la carpeta en *Superadmin → Biblioteca → «Elegir una carpeta»*.

## Qué esperar (y qué no)
- **Openverse** agrega muchas fuentes (Flickr, Wikimedia, museos…). Con solo CC0/PDM el volumen es menor que con todas las licencias y la calidad es irregular: revisa a ojo (marcas de agua, personas, texto).
- **Museos:** son obras de arte y objetos de colección, no «fotos de producto». Encajan en *Juguetes* (antiguos), *Disfraces y sombreros*, *Instrumentos musicales*, *Objetos del hogar* (cerámica, jarras, relojes), *Plantas y flores* (bodegones, grabados) y para escenas de *Paisajes* (pinturas). Para *Mascotas disfrazadas* casi no hay material libre: usa fotos propias.
- El Met no declara el ancho de la imagen en la API: se comprueba tras descargarla (`--min-width`).
- La búsqueda por texto de cada servicio es semántica o por palabras clave según el caso; afina la búsqueda de la 4.ª columna del pack cuando salga algo fuera de lugar.

## Packs nuevos (`docs/catalogo-semilla/`)
| Pack | Productos | Objetivo (`LIBRARY_CATEGORIES`) |
|---|---|---|
| `mascotas-disfrazadas.txt` | 36 | 30 |
| `juguetes.txt` | 44 | 40 |
| `plantas-y-flores.txt` | 44 | 40 |
Cada línea es `Nombre; Descripción; Emoji; búsqueda en inglés || búsqueda en español`. Se piden unos productos más que el objetivo porque algunos no tendrán foto libre. Las categorías ya existían en `src/lib/library/taxonomy.ts`; no hizo falta ampliarla. `library:fetch` (Commons) entiende también las alternativas `||`.

## Lo no probado
- Contra los servicios reales (ver arriba): parámetros, campos y límites sin verificar en vivo; el flujo de token de Openverse solo con respuesta simulada.
- La subida del resultado al panel con imágenes ya en WebP: el panel las normaliza otra vez (debe ser inocuo), pero no se ejecutó en esta tarea.
