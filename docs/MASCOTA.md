> Nota: la mascota del logo nuevo se usa solo en el inicio y el Loader (ver [`MARCA.md`](MARCA.md)); todo lo de este documento sigue vigente.

# Mascota de marca (recursos, componentes y límites)

Fuente: la lámina de referencia `public/assets/mascot/reference-sheet.webp` (1254×1254, **imagen plana con fondo oscuro**, sin transparencia).
Los recortes se generan con `npm run mascot:extract` (`scripts/mascot/{boxes,extract}.mjs`), que escribe `public/assets/mascot/*.webp` y
`inventory.json`. Todo es local: sin APIs de generación, sin dependencias nuevas ni imágenes de terceros. Peso total de los 22 recortes ≈ 140 KB (WebP).

## Qué se ha podido extraer de verdad
| Tipo | Recursos | Transparencia | Notas |
|---|---|---|---|
| **Objetos aislados** | `item-corona`, `item-martillo`, `item-megafono`, `item-temporizador`, `item-logo`, `item-moneda`, `item-brillo` | **Real** (fondo quitado por relleno desde el borde, recortados al contenido) | Tamaño ≈ 100×100 px: sirven para iconos pequeños/medios. Puede quedar un halo oscuro muy fino sobre fondos claros (pensados para la UI oscura) |
| `item-bocadillo` | bocadillo «¡Subasta activa!» | **Difuminada** | Su interior es casi igual que el fondo: el recorte «vaciaría» el bocadillo, así que conserva su fondo |
| **Mascota principal** | `mascot-main` (555×665) | **Difuminada** | Se quitaron el logotipo, el lema, la marca de agua y los vecinos de la lámina rellenando con el degradado del fondo |
| **Expresiones** (8) | `expr-feliz`, `-sorprendido`, `-guino`, `-pensativo`, `-triste`, `-enfadado`, `-celebrando`, `-hype` (≈ 130–170 px) | **Difuminada** | Busto con su confeti/destellos (forman parte de la expresión) |
| **Poses** (5) | `pose-presenta`, `-anuncia`, `-cuenta-atras`, `-adjudica`, `-celebra` (≈ 130–160 px) | **Difuminada** | Baja resolución. La pose «cuenta atrás» incluye su temporizador y «anuncia» su megáfono: son parte de la pose, **no** assets independientes |

**«Difuminada» = NO es un PNG con transparencia.** El cuerpo de la mascota (sudadera/pantalón azul marino) es casi del mismo color que el fondo de la lámina, así que una máscara
automática se comía la ropa (se probó y se descartó). Esos recortes conservan el fondo azul oscuro (`#0a0f2e`) y sus bordes se desvanecen a transparente. El componente `Mascot` con
`tile` pone detrás ese mismo color con esquinas redondeadas, de modo que el recuadro se ve como una «tarjeta» coherente sobre la UI oscura. Sobre fondos claros o de otro color se vería el recuadro.

**No se han extraído** (se descartaron a propósito): los rótulos de texto de la lámina, el logotipo con lema «Subasta Salvaje» (su lema se solapa con el martillo y el logotipo textual de la app ya existe), y los «elementos visuales»
sueltos (flecha, barras, puntos, trazos, lema manuscrito): son formas simples que se reproducen mejor en CSS/SVG (ya existen en `subasta-salvaje-assets/` y en la UI).

## Componentes (`src/components/mascot/`)
- `assets.ts`: `MASCOT_IDS`, `MASCOT_ASSETS` (ruta, dimensiones y tipo de transparencia a partir de `inventory.json`).
- `mascot.tsx`:
  - `<Mascot variant="mascot-main" size="xs|sm|md|lg|xl" tile motion="none|bob|pop" alt? />`. Decorativa por defecto (`alt=""`, `aria-hidden`); pasa `alt` si informa. La altura es la variable CSS `--mh`, sustituible por breakpoint: `className="[--mh:17rem] md:[--mh:28rem]"`. Usa `next/image` con `unoptimized` (los WebP ya están optimizados).
  - `<EmptyState variant title action>` para estados vacíos/errores.
- `screen/mascot-cue.tsx`: mascota de la **cabecera de la TV** que cambia de gesto: sala de espera (feliz), anuncio (pose «anuncia», 4,5 s), puja nueva (sorprendido, 2,5 s), cuenta atrás ≤ 10 s (pose «cuenta atrás»), puja cerrada (pose «adjudica»), adjudicado (celebrando), pausa (triste) y reposo (pensativo).
- Animaciones en `globals.css` (`ss-mascot-bob`, `ss-mascot-pop`), desactivadas con `prefers-reduced-motion` (hay test e2e).

## Animaciones y apariciones en títulos (segunda pasada)
- `MascotTitle` (mascota + título + bocadillo CSS opcional) en: nueva partida, unirme, acceso del anfitrión, configuración y panel de superadmin (cabecera); `Bubble` = bocadillo de CSS puro (sin imagen).
- `ItemIcon` usa los recursos con **transparencia real** como icono dentro de títulos: megáfono (soy jugador), temporizador (abrir TV), corona (recuperar partidas y ganador de los resultados, con caída), brillo (historial y avisos de éxito), moneda (saldo del móvil, gira al cambiar).
- `Sparkles` (destellos que parpadean) alrededor de la mascota del inicio y de la cabecera de resultados.
- **Móvil:** `PlayerMascot` reacciona: ¡Vas ganando!, ¡Te han superado!, ¡Tuyo! (al llevarte el objeto), sala de espera, pausa y fin. **Panel del anfitrión:** la mascota de la cabecera cambia con el estado de la partida.
- Animaciones CSS (`globals.css`): `bob`, `pop`, `wiggle` (también al pasar el ratón), `coin-spin`, `twinkle`, `crown-drop`, `bubble-in`. Todas se anulan con `prefers-reduced-motion`.

## Dónde aparece
Inicio (hero con la mascota principal y estado vacío «aún no has creado ninguna partida»), 404 (`not-found.tsx`), «partida ya no existe» (triste), «partida no es tuya» (enfadado),
sala de espera de la TV (feliz), cabecera de la TV (cue contextual), overlay «¡Adjudicado!» (pose «adjudica» a un lado de la tarjeta), pantalla final «¡Fin de la subasta!» (hype), móvil al terminar (celebrando) y panel → Imágenes vacío (pensativo).
**Legibilidad en TV:** la mascota nunca está sobre el escenario ni las casas: vive en la cabecera (4,4 rem) y, en el overlay, junto a la tarjeta (que ya tapa la pantalla durante ~5 s).

## Límites y pendiente para una colección completa
- Resolución: la mascota principal es 555×665 y el resto ≈ 150 px. A tamaños grandes (TV 4K) se ve pixelada; por eso en la TV solo se usan tamaños `xs`/`md`.
- **Para tener poses independientes con transparencia real** hacen falta renders originales por pose sobre fondo transparente (o fondo liso de croma) a ≥ 1024 px: mascota principal, celebrando, sorprendida y triste primero
  (recomendación del propietario), luego las poses. Basta con sustituir los `.webp` conservando nombres e `inventory.json` (`transparency: "real"`) y quitar `tile`.
- Los recortes de la lámina no se pueden «reposar» (cambiar de pose) ni rehacer con otra expresión: cada variante es una imagen distinta.
- El generador vectorial de `subasta-salvaje-assets/` (ver `ASSETS.md`) es una colección **distinta** (aproximación en SVG), no se ha mezclado con estos recortes.
