# Imagen interna única

Toda imagen que se guarda en el sistema pasa por `normalizeImage` (`src/lib/images/normalize.ts`) y acaba en **WebP**, con tamaño y peso acotados y **sin metadatos** (EXIF/GPS/ICC eliminados, orientación aplicada).

| Tipo | Caja máxima (no se amplía) | Peso objetivo |
|---|---|---|
| `scene` — casa / escena (inicial, base compartida, ediciones de IA) | 1536 × 1024 | 300 KB |
| `item` — foto de un elemento del catálogo | 768 × 768 | 150 KB |
| `cover` — portada de plantilla del sistema | 1200 × 630 | 150 KB |

Reglas: solo PNG, JPEG o WebP (el tipo se decide por el **contenido**; SVG y GIF se rechazan, y no hay animaciones); límite de **40 megapíxeles** de entrada (contra bombas de descompresión); para llegar al peso se baja la calidad (80 → 40) y luego la escala (100 % → 70 %); si aun así pesa más del **doble** del objetivo (ruido puro) se rechaza con un mensaje claro. Se conserva la transparencia.

## Dónde se aplica
- Subida de imagen inicial (una o para todos) y de foto de elemento: `game-service.ts` (`toInternalImage`).
- Fotos importadas por URL o por ZIP: llegan a la misma subida de elemento.
- Salida de **cualquier proveedor de IA**: `jobs-service.ts`, antes de guardarla (también ahorra espacio en Supabase). Las pegatinas SVG del modo demo no se tocan.
- Un test (`tests/image-entrypoints.test.ts`) falla si aparece otro punto de escritura en Storage que no use `normalizeImage`.
- **Solo imágenes nuevas**: las ya guardadas no se reescriben.

## En el navegador
`src/lib/client/image-shrink.ts` reduce la foto (lado mayor 2048 px, WebP) **antes de subirla**: ahorra datos móviles y evita el límite de 4,5 MB de cuerpo de las funciones de Vercel. El original puede llegar a 25 MB; el servidor admite hasta 7 MB **ya reducidos** y vuelve a normalizar (no se fía del cliente).

## Preparar fotos para tu CDN (plantillas del sistema)
```bash
npm run assets:normalize -- ./mis-fotos                   # elementos  -> ./mis-fotos/normalizadas
npm run assets:normalize -- ./mis-fotos --kind=scene      # casas
npm run assets:normalize -- ./mis-fotos --kind=cover --out=./salida
```
Usa el mismo módulo que el servidor: lo que sale pasa la validación sin cambios. No toca los originales y muestra el peso antes y después.

## Despliegue
`sharp` solo está en las rutas que lo necesitan (`outputFileTracingIncludes` en `next.config.ts`): trabajos de imágenes, `initial-image`, `item-image` e `import-photos`. Mídelo con `npm run size:functions`.
