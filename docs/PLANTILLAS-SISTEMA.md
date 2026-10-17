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

## Subir las imágenes: arrastrar y soltar (GitHub + jsDelivr, no Supabase)
En el editor de `/admin/plantillas` hay una **zona para arrastrar imágenes** (o elegirlas). Cada una:
1. se reduce en el navegador (si pesa mucho), y el servidor la lleva al **formato interno** (WebP, ver `IMAGEN-INTERNA.md`);
2. se sube a **tu repositorio público de fotos en GitHub** con la API de contenidos (`plantillas/<slug>/<tipo>-<nombre>-<hash>.webp`); **nada va a Supabase**;
3. el JSON de la plantilla se rellena solo con el enlace de **jsDelivr fijado al commit** (`…/gh/usuario/repo@<commit>/…`: se sirve al instante y nunca cambia).
Las imágenes se asignan por el **nombre del archivo**: `portada.jpg` → portada, `casa.jpg`/`casa-inicial.jpg` → casa inicial, y el título de un elemento (`sombrilla-roja.jpg` → «Sombrilla roja»; sin tildes ni mayúsculas). Las que no encajan quedan en la lista con un desplegable «Asignar a…». Se suben **de una en una** (GitHub no admite commits simultáneos en la misma rama) y la misma foto no se duplica (el nombre lleva el hash del contenido). Cada subida queda en la **auditoría**.

### Configuración (una vez)
1. Crea un repositorio **público** solo para las fotos (p. ej. `subasta-salvaje-fotos`) con un primer commit (un README basta).
2. En GitHub → *Settings → Developer settings → Fine-grained personal access tokens* crea un token **solo para ese repositorio** con el permiso **Contents: Read and write** (nada más) y una caducidad razonable. No lo pegues en el chat ni en el repositorio.
3. En Vercel (solo servidor): `GITHUB_ASSETS_REPO=tu-usuario/subasta-salvaje-fotos`, `GITHUB_ASSETS_TOKEN=…` (*Sensitive*) y, si la rama no es `main`, `GITHUB_ASSETS_BRANCH`. Redespliega. `cdn.jsdelivr.net` se admite automáticamente en la lista de servidores si defines también `ASSET_CDN_HOSTS`.
4. Si no defines esas variables, el editor lo indica y puedes seguir pegando enlaces https a mano en el JSON.

### Alternativa manual
`npm run assets:normalize -- ./mis-fotos --kind=item` deja `.webp` listos para subirlos tú a cualquier alojamiento público (GitHub+jsDelivr) y pegar los enlaces. **No uses R2** (pide método de pago) ni Dropbox/Drive (enlaces que cambian, sin CDN).

## Cómo se usan las fotos
Al crear la partida se **copian** a su almacenamiento (Supabase) pasando por `normalizeImage` y se borran con la partida. El juego no depende de que el CDN esté disponible durante la partida, y si una foto falla se avisa sin bloquear nada. La portada de la tarjeta sí se carga directamente desde el CDN (solo es decorativa; si falla se oculta).

## Datos y seguridad
Tabla `system_templates` (migraciones `…4200`/`…4300`, RLS cerrada); funciones `ss_system_template_*` y `ss_admin_system_template_*`; los anfitriones solo leen publicadas (`/api/system-templates`); las rutas de administración responden **404** a quien no sea superadmin. La validación fuerte es la misma de las plantillas de usuario (Zod).

## Límites / pendiente
- No se probó contra un CDN real desde este entorno (sin red): la descarga y el informe se prueban con transporte simulado.
- Editor: JSON con validación en vivo. Un editor visual (catálogo con vista previa) queda como mejora.
- Pendiente de decisión: filtros por idioma/etiquetas en la galería.
