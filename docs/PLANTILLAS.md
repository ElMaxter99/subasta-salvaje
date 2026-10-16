# Plantillas de partida (importar y exportar)

Una plantilla es un archivo **JSON** que el anfitrión rellena fuera de la app (o exporta de una partida) y sube en **Nueva partida → «¿Tienes una plantilla?»**. Rellena el asistente, salta al **Resumen** para revisar y la partida no se crea hasta pulsar «Crear partida».

## Formato `subasta-salvaje/plantilla@1`
```json
{
  "formato": "subasta-salvaje/plantilla@1",
  "nombre": "Noche de Subasta Salvaje",
  "tematica": "Casa",
  "reglas": {
    "presupuesto": 20, "puja_minima": 1, "rondas_maximas": 3, "pujas_enteras": true,
    "clasificacion": "ninguna", "modo_juego": "movil", "modo_imagenes": "pegatinas"
  },
  "jugadores": ["Ana", "Beto"],
  "catalogo": [
    { "titulo": "Piscina infinita", "descripcion": "Con agua turquesa.", "emoji": "🏊", "foto": null },
    { "titulo": "Sofá gigante", "descripcion": "Enorme y mullido.", "emoji": "🛋️", "foto": "https://ejemplo.com/fotos/sofa.jpg" }
  ]
}
```
| Campo | Obligatorio | Valores |
|---|---|---|
| `formato` | sí | exactamente `subasta-salvaje/plantilla@1` |
| `nombre` | sí | 1–80 caracteres |
| `tematica` | sí | id o nombre de una temática (`Casa`, `Isla desierta`…) o texto libre (→ «Otra») |
| `reglas.presupuesto` / `puja_minima` | no | euros (admite decimales); por defecto 20 y 1 |
| `reglas.rondas_maximas` | no | 1–500; por defecto = elementos del catálogo |
| `reglas.pujas_enteras` | no | `true` (por defecto) / `false`; con `true` la puja mínima debe ser un euro entero |
| `reglas.clasificacion` | no | `ninguna`, `saldo`, `elementos`, `votos` |
| `reglas.modo_juego` | no | `anfitrion` (por defecto) o `movil` |
| `reglas.modo_imagenes` | no | `pegatinas` (por defecto) o `ia` (sin IA configurada se cambia a pegatinas) |
| `jugadores` | no | hasta 12 nombres (1–40 caracteres, sin repetir) |
| `catalogo` | no | hasta 100 elementos; si falta se usa el de la temática |
| `catalogo[].titulo` | sí | 1–80 caracteres |
| `catalogo[].descripcion` / `emoji` / `foto` | no | ≤ 500 · ≤ 8 · URL **https** ≤ 500 |

## Cómo funciona
- **Validación** con Zod (`src/lib/domain/template.ts`): errores legibles por campo y elemento («Elemento 2 del catálogo: falta el título»); campos desconocidos y otros problemas leves salen como **avisos** sin bloquear. Límite de 512 KB. Se valida en el navegador al cargar y el servidor revalida al crear la partida (`createGameSchema`).
- **Exportar:** Ajustes → «Plantilla de esta partida» (`templateFromSnapshot`). **Las fotos no se exportan** (sus URLs son temporales): añade las URL a mano en `foto`.
- **Plantilla vacía:** botón «Descargar plantilla vacía» (`blankTemplate`).
- **Reglas de negocio:** la importación solo usa `createGame` y las funciones `ss_*` existentes; no hay lógica nueva de dinero.

## Fotos por URL (`POST /api/games/[code]/import-photos`)
Tras crear la partida, el servidor descarga cada `foto` y la guarda como foto del elemento (la misma que la subida manual: se usa de referencia cuando alguien gana el elemento). Un fallo de una foto **nunca bloquea la partida**: el panel avisa de cuáles fallaron y puedes subirlas a mano en Catálogo.
Defensas (`src/lib/security/safe-fetch.ts`, con tests): solo `https`, sin credenciales ni puertos raros, sin IP literales ni nombres internos (`localhost`, `.local`, `.internal`); conexión **anclada a la IP ya comprobada** (anti DNS rebinding); se rechazan IP privadas, de bucle, enlace local, CGNAT y metadatos de nube (IPv4 e IPv6); máx. 3 redirecciones, cada una revalidada; 8 s por descarga, 7 MB y comprobación del tipo real de imagen; 3 descargas a la vez, 45 s en total y 6 importaciones cada 10 min por anfitrión; solo el anfitrión propietario.

## CSV y ZIP (fase 3)
- **CSV de catálogo** (`.csv`): cabecera `titulo;descripcion;emoji;foto` (acepta también `,` o tabulador y alias como `nombre`, `imagen`). Excel en español lo abre y guarda con `;`. Solo trae el catálogo: el resto del asistente no cambia. Errores por fila de la hoja («Fila 3: falta el título»). Ajustes → «Catálogo en CSV» exporta el de una partida (`src/lib/domain/template-csv.ts`).
- **ZIP** (`.zip`): `plantilla.json` en la raíz + carpeta `fotos/` con PNG/JPG/WebP. En el JSON/CSV, `foto` puede ser una URL https **o una ruta del ZIP** (`fotos/sofa.jpg`, o solo `sofa.jpg`). Las fotos incrustadas se suben desde el navegador con la misma ruta que la subida manual (`/api/games/[code]/item-image`), con reintento si hay límite de ritmo; las que falten o fallen se avisan sin bloquear la partida.
- **Seguridad del ZIP** (`template-zip.ts`, lector propio sin dependencias; entrada no confiable): sin contraseña ni ZIP64, solo «stored» y «deflate», máx. 300 entradas, 7 MB por foto y 40 MB en total, y el tamaño se controla sobre lo **realmente descomprimido** (contra «zip bombs»); se ignoran carpetas, `__MACOSX` y ocultos; rutas con `..`, absolutas o con esquema se descartan; nada se escribe en disco.

## Mis plantillas (fase 4)
- **Guardar:** en el Resumen del asistente («Guardar como plantilla») o en Ajustes de una partida («Guardar en mis plantillas»). Guardar con un nombre ya existente (sin distinguir mayúsculas) **la sustituye**.
- **Usar:** en «Nueva partida», la tarjeta de plantillas muestra «Mis plantillas» con Cargar y Borrar (con confirmación). Cargar rellena el asistente y salta al Resumen, igual que importar un archivo.
- **Dónde y límites:** tabla `host_templates` (migraciones `3400`/`3500`, RLS cerrada: solo se accede por el servidor con `service_role`); guarda el mismo JSON del formato `@1`. Máx. **20 por anfitrión** y 256 KB cada una; el servidor revalida la plantilla entera al guardar (`template-store.ts`). Cada anfitrión solo ve y toca las suyas (probado). Rutas: `GET/POST /api/templates`, `GET/DELETE /api/templates/[id]`.
- **Fotos:** solo se guardan las **URL**; las fotos incrustadas de un ZIP no (se avisa).
- **Privacidad:** al borrar a un usuario desde el superadmin se borran también sus plantillas (`ss_admin_delete_user` envuelta).

## Editor del catálogo en el asistente
En el **Resumen**, el bloque del catálogo ofrece «Personalizar catálogo» (copia el de la temática) o «Editar catálogo» (si viene de una plantilla). El editor permite cambiar título, descripción, emoji y foto (URL https), **reordenar** (el orden es el de las rondas), quitar y añadir elementos (1–100). Valida con las mismas reglas que el servidor (`validateCatalog`) y no deja pulsar «Listo» ni crear la partida con errores; las rondas por defecto siguen al tamaño del catálogo. Las fotos incrustadas de un ZIP se pueden quitar desde aquí.

## Límites / pendiente
- **Hecho:** fases 1 (JSON, importar, exportar, plantilla vacía, fotos por URL), 3 (CSV y ZIP) y 4 (plantillas guardadas).
- **Pendiente:** compartir plantillas entre anfitriones (no se ha hecho a propósito: exigiría moderación) y exportar un ZIP con las fotos (las URL de las fotos no se conservan al exportar).
- Las fotos por URL no se han probado contra Internet real desde este entorno (sin salida de red para ello): el flujo se prueba con transporte simulado y con un rechazo real de IP interna en el e2e.
- La importación en la nube (Vercel) hace la descarga desde el servidor: respeta `maxDuration = 60` de la ruta.
