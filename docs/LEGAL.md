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
Los créditos que no son npm (Baloo 2, Nunito, recursos gráficos) están a mano en `src/lib/legal/site.ts`.

## Qué NO está resuelto (decisiones del propietario)
1. **Titular**: nombre, contacto, domicilio y NIF (variables de entorno).
2. ~~**Licencia del código**~~ **Decidida: MIT** (17-10-2026, el propietario delegó la elección: «el proyecto es todo gratis»). Están `LICENSE`, `"license": "MIT"` en `package.json` y `LICENSE_NAME` (lee package.json). Aclaración posterior del propietario: el repo es público, **no hay marca registrada** y logo y mascota están **hechos con IA para la app**, así que se publican también bajo MIT (sin reservas de marca). Autor/copyright: **ElMaxter99**. El repositorio de GitHub y el autor se enlazan en el footer, en `/legal`, `/licencia`, README y `package.json`.
3. **Revisión jurídica** de aviso legal, privacidad y cookies (incluida la conclusión de que no hace falta banner).
4. Origen de los recursos gráficos: generados con IA para la app (herramienta concreta no registrada). El estatus de derechos de las obras generadas con IA varía por jurisdicción; el texto lo dice y no afirma titularidad exclusiva.

## Biblioteca de imágenes y fotos de terceros
- La biblioteca del superadmin (`docs/BIBLIOTECA.md`) puede reunir fotos libres de **Wikimedia Commons** (por defecto solo CC0 / dominio público; con `--allow-by`, también CC BY y CC BY-SA, que **exigen atribución**). Cada foto conserva autor, licencia y enlace de origen en su campo «crédito» y en `FUENTES.md` del repositorio de fotos. Está anotado en `PROJECT_ASSET_NOTES` (créditos).
- Esas fotos se sirven desde el repositorio público de fotos por **jsDelivr** (ya declarado como proveedor en la política de privacidad). Política: sin ánimo de lucro, sin licencia concedida por la app y **retirada a petición** del titular.
- La pantalla de TV pide el bloqueo de pantalla del navegador (Screen Wake Lock) y reproduce un vídeo mudo propio de unos KB para evitar el salvapantallas: no usa cookies, almacenamiento ni servidores de terceros.

## Regla de mantenimiento
Al añadir **una dependencia** → `node scripts/legal/build-credits.mjs`. Una **cookie o clave de localStorage/sessionStorage** → `STORAGE_INVENTORY` en `site.ts` (el test lo comprueba) y, si no es técnica, banner de consentimiento. Un **proveedor o dato nuevo** (analítica, IA, correo…) → `SERVICE_PROVIDERS` y `/privacidad`. Actualiza `LEGAL_UPDATED` al cambiar los textos.
