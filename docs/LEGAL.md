# Páginas legales, footer y créditos

> Los textos son una **plantilla informativa, no asesoramiento jurídico**. Debe revisarlos un profesional antes de darlos por válidos.

## Qué hay
| Ruta | Contenido | Archivo |
|---|---|---|
| `/legal` | Aviso legal y datos del titular | `src/app/legal/page.tsx` |
| `/privacidad` | Política de privacidad (solo lo que la app hace de verdad) | `src/app/privacidad/page.tsx` |
| `/cookies` | Inventario real de cookies y almacenamiento local (tabla) | `src/app/cookies/page.tsx` |
| `/creditos` | Dependencias npm, tipografías, iconos, recursos gráficos y servicios de terceros | `src/app/creditos/page.tsx` |
| `/licencia` | Estado de la licencia del código | `src/app/licencia/page.tsx` |

- **Footer** (`src/components/landing/site-footer.tsx`): nombre, versión (de `package.json`), los 5 enlaces anteriores y el repositorio. Solo aparece en `/` y en las páginas legales; **nunca** en `/game/*` (TV, panel, móvil) ni en `/new-game`, `/login`…
- Estructura común: `src/components/legal/legal-page.tsx`. Datos y listas centralizados en `src/lib/legal/site.ts`.

## Configuración (variables opcionales, en `.env.example`)
`NEXT_PUBLIC_LEGAL_NAME`, `NEXT_PUBLIC_LEGAL_EMAIL`, `NEXT_PUBLIC_LEGAL_ADDRESS`, `NEXT_PUBLIC_LEGAL_NIF`. Se incrustan al compilar (hay que volver a desplegar tras cambiarlas). Si faltan nombre o correo, las páginas muestran «Titular pendiente de completar por el propietario»; nunca se inventan datos.

## Regenerar créditos
`node scripts/legal/build-credits.mjs` lee `package.json` y `node_modules/<pkg>/package.json` y escribe `src/lib/legal/credits.generated.json` (dependencias directas, de ejecución y de desarrollo). Requiere `npm install` previo. `tests/legal.test.ts` falla si falta alguna dependencia directa o alguna no tiene versión/licencia.
Los créditos que no son npm (Baloo 2, Nunito, recursos gráficos) están a mano en `src/lib/legal/site.ts`. Las TTF estáticas de Baloo 2 y Nunito para las imágenes del podio/OG (`src/assets/fonts/`, derivadas de google/fonts, SIL OFL 1.1; licencias `OFL-*.txt` al lado) están descritas en `docs/FUENTE-PODIO.md`.

## Qué NO está resuelto (decisiones del propietario)
1. **Titular**: nombre, contacto, domicilio y NIF (variables de entorno).
2. ~~**Licencia del código**~~ **Decidida: MIT** (17-10-2026, el propietario delegó la elección: «el proyecto es todo gratis»). Están `LICENSE`, `"license": "MIT"` en `package.json` y `LICENSE_NAME` (lee package.json). Aclaración posterior del propietario: el repo es público, **no hay marca registrada** y logo y mascota están **hechos con IA para la app**, así que se publican también bajo MIT (sin reservas de marca). Autor/copyright: **ElMaxter99**. El repositorio de GitHub y el autor se enlazan en el footer, en `/legal`, `/licencia`, README y `package.json`.
3. **Revisión jurídica** de aviso legal, privacidad y cookies (incluida la conclusión de que no hace falta banner).
4. Origen de los recursos gráficos: generados con IA para la app (herramienta concreta no registrada). El estatus de derechos de las obras generadas con IA varía por jurisdicción; el texto lo dice y no afirma titularidad exclusiva.

## Biblioteca de imágenes y fotos de terceros
- La biblioteca del superadmin (`docs/BIBLIOTECA.md`) puede reunir fotos libres de **Wikimedia Commons** (por defecto solo CC0 / dominio público; con `--allow-by`, también CC BY y CC BY-SA, que **exigen atribución**). Cada foto conserva autor, licencia y enlace de origen en su campo «crédito» y en `FUENTES.md` del repositorio de fotos. Está anotado en `PROJECT_ASSET_NOTES` (créditos).
- Además de Commons, las herramientas del propietario (`npm run library:openverse`, `docs/FUENTES-OPENVERSE-MUSEOS.md`) pueden reunir fotos de **Openverse** (solo CC0 y Public Domain Mark), del **Metropolitan Museum of Art** (Open Access, CC0) y del **Art Institute of Chicago** (dominio público, CC0). Son descargas locales que hace el propietario; la app no llama a esos servicios al jugar. No exigen atribución, pero cada imagen conserva autor, licencia y enlace de origen en su crédito. Las condiciones de cada servicio se confirman en su web antes de cada tanda grande (no verificadas desde el entorno de desarrollo).
- Esas fotos se sirven desde el repositorio público de fotos por **jsDelivr** (ya declarado como proveedor en la política de privacidad). Política: sin ánimo de lucro, sin licencia concedida por la app y **retirada a petición** del titular.
- La pantalla de TV pide el bloqueo de pantalla del navegador (Screen Wake Lock) y reproduce un vídeo mudo propio de unos KB para evitar el salvapantallas: no usa cookies, almacenamiento ni servidores de terceros.

## Regla de mantenimiento
Al añadir **una dependencia** → `node scripts/legal/build-credits.mjs`. Una **cookie o clave de localStorage/sessionStorage** → `STORAGE_INVENTORY` en `site.ts` (el test lo comprueba) y, si no es técnica, banner de consentimiento. Un **proveedor o dato nuevo** (analítica, IA, correo…) → `SERVICE_PROVIDERS` y `/privacidad`. Actualiza `LEGAL_UPDATED` al cambiar los textos.

## Derecho de acceso y portabilidad de los datos de una partida
- El anfitrión propietario puede descargar **una copia completa de su partida** en un ZIP desde *Ajustes → Exportar partida (ZIP)* (ruta `GET /api/games/[code]/export`, autenticada y limitada en tasa). Contiene `partida.json` (ajustes, jugadores con nombre, color y saldo final, catálogo, subastas, pujas, compras con precio en céntimos y en Ohros, eventos y resultados), una carpeta por jugador con las imágenes de su historial guardadas en nuestro almacenamiento y un `LEEME.txt`.
- Las imágenes alojadas en el repositorio público de fotos (enlaces https) no se copian: se listan en el JSON. No se incluyen identificadores de sesión de los jugadores ni datos de la cuenta del anfitrión.
- Es formato abierto (ZIP + JSON), por lo que sirve también para la **portabilidad**. Los jugadores no tienen cuenta: sus datos son el nombre que elige el anfitrión o ellos mismos y el saldo/compras de la partida, y quedan dentro de esta exportación.
- La exportación **no sustituye** a la política de privacidad ni a la revisión jurídica pendiente (ver «Qué NO está resuelto»). No añade cookies, almacenamiento local ni proveedores externos.

## Observabilidad propia (errores y métricas de uso)
- Desde la rama de observabilidad la app guarda **errores técnicos** (`app_errors`) y **contadores diarios agregados** (`usage_metrics`) en su propia base de datos, sin proveedor externo. Detalle, retención y límites en `OBSERVABILIDAD.md`.
- **Dato nuevo tratado:** mensaje y traza de errores, ruta normalizada (sin consulta ni identificadores) y, si procede, el código de sala. Antes de guardarlos se eliminan credenciales, correos, IPv4, cookies/tokens `nombre=valor` y consultas de URL. **No** se guardan IP (ni hash), cookies, tokens, cuerpos de petición ni nombres de jugador. El reporter del navegador limita la tasa con la IP **solo en memoria** (hash, no persistente).
- **Sin cookies ni almacenamiento local nuevos** (`STORAGE_INVENTORY` no cambia): el reporter del navegador solo usa memoria de la pestaña. Se actualizaron `/privacidad` y `LEGAL_UPDATED`.
- Retención por defecto 30 días (ajustable 1–365), tope duro de 500 grupos de error, métricas diarias 400 días.
