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
2. ~~**Licencia del código**~~ **Decidida: MIT** (17-10-2026, el propietario delegó la elección: «el proyecto es todo gratis»). Están `LICENSE`, `"license": "MIT"` en `package.json` y `LICENSE_NAME` (lee package.json). La **marca** (nombre, logotipo, mascota) queda **fuera** de la licencia, con derechos reservados; el titular del copyright figura como «ElMaxter99 y colaboradores» (cuenta del repositorio): el propietario puede poner su nombre real en `LICENSE`.
3. **Revisión jurídica** de aviso legal, privacidad y cookies (incluida la conclusión de que no hace falta banner).
4. Licencia/origen exacto de los recursos gráficos de marca (hoy: entregados por el propietario; **fuera de la MIT**, derechos reservados). Si el propietario quiere liberarlos (p. ej. CC BY 4.0), habría que declararlo en `LICENSE`, `/licencia` y el README.

## Regla de mantenimiento
Al añadir **una dependencia** → `node scripts/legal/build-credits.mjs`. Una **cookie o clave de localStorage/sessionStorage** → `STORAGE_INVENTORY` en `site.ts` (el test lo comprueba) y, si no es técnica, banner de consentimiento. Un **proveedor o dato nuevo** (analítica, IA, correo…) → `SERVICE_PROVIDERS` y `/privacidad`. Actualiza `LEGAL_UPDATED` al cambiar los textos.
