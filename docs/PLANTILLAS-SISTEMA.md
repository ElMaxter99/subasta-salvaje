# Partidas del sistema (plantillas del superadmin)

Plantillas creadas por el superadmin que cualquier anfitrión ve en **Nueva partida → «Partidas del sistema»**. «Usar» rellena el asistente y salta al Resumen (como «Mis plantillas»); se puede retocar y la plantilla del sistema **no se modifica**. Los **borradores solo los ve el superadmin**.

## Qué lleva una plantilla
El mismo formato `subasta-salvaje/plantilla@1` (ver `PLANTILLAS.md`: reglas, jugadores, catálogo) más dos campos opcionales:
- `portada`: URL https de la imagen de la tarjeta (1200×630).
- `casa_inicial`: URL https de la **imagen inicial de la casa**; al crear la partida se copia y se aplica a los jugadores actuales y a los que se unan después.
Cada elemento del catálogo puede llevar `foto` (URL https). En plantillas del sistema no se admiten rutas de ZIP.

## Superadmin: `/admin/plantillas`
- **Nueva plantilla / Importar JSON / Editar**: editor con validación en vivo (los mismos errores que ve cualquier anfitrión). Se guarda siempre como **borrador**.
- **Comprobar imágenes**: descarga cada foto (con las defensas SSRF de `safe-fetch`) y muestra formato, tamaño, peso y si está en el *formato interno* (ver `IMAGEN-INTERNA.md`). Una foto fuera del formato interno se acepta y se reduce al copiarla, pero conviene prepararla con `npm run assets:normalize`.
- **Publicar**: solo si **todas** las imágenes se descargan y se leen; si alguna falla no se publica y el informe dice cuál. **Retirar** la vuelve a dejar en borrador. **Borrar** no afecta a las partidas ya creadas.
- Todo queda en **Auditoría** (creada, modificada, publicada, retirada, borrada).

## Dónde guardar las fotos (tu CDN)
La aplicación **no sube** nada a ningún servicio: dejas las fotos ya preparadas en el proveedor que elijas y pegas los enlaces.
1. Prepara las fotos: `npm run assets:normalize -- ./mis-fotos --kind=item` (y `--kind=scene` para casas, `--kind=cover` para portadas). Salen en `./mis-fotos/normalizadas/*.webp`.
2. Súbelas a tu proveedor y copia los enlaces públicos (https). Opciones:
   - **Cloudflare R2** (bucket público con dominio propio): sin coste de salida; ya usas Cloudflare. *(límites sin verificar: mira su página oficial)*
   - **GitHub + jsDelivr** (carpeta de un repositorio público): gratis, con CDN y versionado por commits.
   - Evita Dropbox/Drive como «CDN»: los enlaces directos cambian y tienen límites de tráfico.
3. En Vercel define `ASSET_CDN_HOSTS=cdn.tudominio.com` (lista separada por comas): solo se aceptarán fotos de esos servidores. Sin definirla se acepta cualquier https (el panel te lo avisa).

## Cómo se usan las fotos
Al crear la partida se **copian** a su almacenamiento (Supabase) pasando por `normalizeImage` y se borran con la partida. El juego no depende de que el CDN esté disponible durante la partida, y si una foto falla se avisa sin bloquear nada. La portada de la tarjeta sí se carga directamente desde el CDN (solo es decorativa; si falla se oculta).

## Datos y seguridad
Tabla `system_templates` (migraciones `…4200`/`…4300`, RLS cerrada); funciones `ss_system_template_*` y `ss_admin_system_template_*`; los anfitriones solo leen publicadas (`/api/system-templates`); las rutas de administración responden **404** a quien no sea superadmin. La validación fuerte es la misma de las plantillas de usuario (Zod).

## Límites / pendiente
- No se probó contra un CDN real desde este entorno (sin red): la descarga y el informe se prueban con transporte simulado.
- Editor: JSON con validación en vivo. Un editor visual (catálogo con vista previa) queda como mejora.
- Pendiente de decisión: filtros por idioma/etiquetas en la galería.
