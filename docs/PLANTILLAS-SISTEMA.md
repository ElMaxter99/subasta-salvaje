# Partidas del sistema (plantillas del superadmin)

Plantillas creadas por el superadmin que cualquier anfitrión ve en **Nueva partida → «Partidas del sistema»**. «Usar» rellena el asistente y salta al Resumen (como «Mis plantillas»); se puede retocar y la plantilla del sistema **no se modifica**. Los **borradores solo los ve el superadmin**.

## Qué lleva una plantilla
El mismo formato `subasta-salvaje/plantilla@1` (ver `PLANTILLAS.md`: reglas, jugadores, catálogo) más dos campos opcionales:
- `portada`: URL https de la imagen de la tarjeta (1200×630).
- `casa_inicial`: URL https de la **imagen inicial de la casa**; al crear la partida se aplica **por enlace** (sin copiarla) a los jugadores actuales y a los que se unan después.
- `creditos`: autoría o fuente de las imágenes (≤ 200 caracteres; se muestra, en pequeño, en la tarjeta de «Partidas del sistema»).
Cada elemento del catálogo puede llevar `foto` (URL https) y un `credito` opcional (≤ 120 caracteres; solo lo ves en el editor). En plantillas del sistema no se admiten rutas de ZIP.

## Superadmin: `/admin/plantillas`
- **Nueva plantilla / Editar** abren `/admin/plantillas/editor`: el **mismo asistente que usa un anfitrión en «Nueva partida»** (Quién puja → Las casas → Partida → Reglas → Jugadores) con un paso más, **Ficha** (título de la tarjeta, identificador, descripción, orden, créditos, portada, casa inicial y arrastrar y soltar de fotos), y un Resumen que acaba en **Guardar borrador** en lugar de «Crear partida». Así el superadmin sigue siempre el flujo que seguirá el usuario. En el paso 1, «¿Tienes una plantilla?» permite importar un JSON, ZIP o CSV. El catálogo se edita como en el asistente, con «Subir» foto y crédito por elemento. Las plantillas del sistema llevan siempre catálogo propio (se parte del de la temática).
- **Comprobar imágenes**: descarga cada foto (con las defensas SSRF de `safe-fetch`) y muestra formato, tamaño, peso y si está en el *formato interno* (ver `IMAGEN-INTERNA.md`). Una foto fuera del formato interno se acepta y se reduce al copiarla, pero conviene prepararla con `npm run assets:normalize`.
- **Publicar**: solo si **todas** las imágenes se descargan y se leen; si alguna falla no se publica y el informe dice cuál. **Retirar** la vuelve a dejar en borrador. **Borrar** no afecta a las partidas ya creadas.
- Todo queda en **Auditoría** (creada, modificada, publicada, retirada, borrada).

## Imágenes de una plantilla: se eligen en la vista y se publican al guardar
En el paso **Ficha** (y en el catálogo) las imágenes se **suben, se arrastran o se eligen de la biblioteca**; **nunca se escribe una URL**.
**Subir/arrastrar no sube nada todavía**: la imagen se queda en la vista (vista previa local) y se asigna por el **nombre del archivo**
(`portada.jpg` → portada, `casa.jpg`/`casa-inicial.jpg` → casa inicial, y el título de un elemento: `sombrilla-roja.jpg` → «Sombrilla roja»; sin
tildes ni mayúsculas); las que no encajan quedan con un desplegable «Asignar a…». Las de la biblioteca ya están alojadas y no se vuelven a subir.

Al pulsar **«Guardar borrador»** ocurre, en este orden:
1. cada imagen nueva se reduce al **formato interno** (WebP, ver `IMAGEN-INTERNA.md`) y se deja *preparada* en GitHub (sin commit);
2. **UN solo commit** publica las nuevas (`plantillas/<slug>/<tipo>-<nombre>-<hash>.webp`, nada va a Supabase) **y borra** de esa carpeta las
   que la plantilla ya no usa (sobrescribir = añadir la nueva y quitar la vieja, porque el nombre lleva el hash del contenido). Solo se borra lo que
   existe de verdad en la rama y **nunca** se tocan la biblioteca ni las carpetas de otras plantillas;
3. se guarda el borrador con los enlaces de **jsDelivr fijados al commit** (`…/gh/usuario/repo@<commit>/…`).
Si no hay cambios de imágenes no se crea ningún commit. Si se cancela la edición no se sube ni se borra nada. Si fallara el paso 3 después del 2,
las imágenes nuevas quedan en el repositorio y las antiguas siguen accesibles por sus enlaces fijados a commits anteriores. Borrar una plantilla entera
**no** borra sus fotos del repositorio.

### Configuración (una vez)
1. Crea un repositorio **público** solo para las fotos (p. ej. `subasta-salvaje-fotos`) con un primer commit (un README basta).
2. En GitHub → *Settings → Developer settings → Fine-grained personal access tokens* crea un token **solo para ese repositorio** con el permiso **Contents: Read and write** (nada más) y una caducidad razonable. No lo pegues en el chat ni en el repositorio.
3. En Vercel (solo servidor): `GITHUB_ASSETS_REPO=tu-usuario/subasta-salvaje-fotos`, `GITHUB_ASSETS_TOKEN=…` (*Sensitive*) y, si la rama no es `main`, `GITHUB_ASSETS_BRANCH`.
   **Repositorio real del proyecto:** `ElMaxter99/subasta-salvaje-public` (ya inicializado con su README, `plantillas/` y `.gitattributes`). Su rama por defecto es **`master`**, así que hay que definir `GITHUB_ASSETS_BRANCH=master`. Redespliega. `cdn.jsdelivr.net` se admite automáticamente en la lista de servidores si defines también `ASSET_CDN_HOSTS`.
4. Si no defines esas variables, la Ficha lo indica y sigue pudiendo elegir imágenes de la biblioteca (nunca se escriben URLs).

### Alternativa manual
`npm run assets:normalize -- ./mis-fotos --kind=item` deja `.webp` listos para subirlos tú a cualquier alojamiento público (GitHub+jsDelivr) y pegar los enlaces. **No uses R2** (pide método de pago) ni Dropbox/Drive (enlaces que cambian, sin CDN).

## Derechos de las fotos (léelo)
El repositorio de fotos (`ElMaxter99/subasta-salvaje-public`) se plantea como **almacén sin ánimo de lucro** que solo alimenta las partidas predefinidas; su README lo dice y explica cómo retirar una imagen a petición de su titular. Si las imágenes salen de buscadores o webs, **siguen siendo de sus titulares**: esa declaración no concede ningún derecho ni evita por sí sola una reclamación, aunque no haya ánimo de lucro. Para reducir el riesgo:
- Prefiere imágenes con licencia libre (Wikimedia Commons, Unsplash, Pexels, Pixabay: lee su licencia concreta) o **generadas con IA**; evita fotos de personas.
- Anota el origen en `FUENTES.md` del repositorio de fotos (permite atribuir y retirar con rapidez).
- Atiende pronto las peticiones de retirada (issue en el repositorio o contacto por GitHub): es lo que promete el README.
La página de Créditos de la app incluye una nota equivalente.

## Cómo se usan las fotos
Las imágenes que **ya están alojadas en nuestro repositorio de fotos** (enlaces de jsDelivr de `GITHUB_ASSETS_REPO`: las de plantillas del sistema y las de la biblioteca) **no se descargan ni se copian** al crear la partida: la foto del elemento y la casa inicial se guardan como **referencia (enlace)** y TV y móviles las cargan directamente desde el CDN. **Lo único que se guarda en el almacenamiento (Supabase) son las imágenes que genera la IA** al fusionarlas (la casa editada con cada compra). Cuando hay que editar con IA, el servidor lee la casa base y la foto del elemento **por enlace en ese momento** (solo de nuestro repositorio, con las defensas de `safe-fetch`).
Las fotos de **otros servidores** (p. ej. una plantilla JSON de un anfitrión con enlaces cualesquiera) sí se descargan, se normalizan (`normalizeImage`) y se guardan con la partida, como antes. Si una foto falla se avisa sin bloquear nada. Se borran con la partida solo las copias propias: **nunca se borra nada del repositorio de fotos**.

**Límites a tener en cuenta:** (1) si el CDN o el archivo dejan de estar disponibles, la partida pierde esa imagen (los enlaces van fijados a un commit, así que solo fallaría si se borra el repositorio o el CDN cae); (2) cada visitante (TV y móviles) hace peticiones a jsDelivr: está declarado en la política de privacidad; (3) la edición con IA añade una lectura por enlace por trabajo.

## Datos y seguridad
Tabla `system_templates` (migraciones `…4200`/`…4300`, RLS cerrada); funciones `ss_system_template_*` y `ss_admin_system_template_*`; los anfitriones solo leen publicadas (`/api/system-templates`); las rutas de administración responden **404** a quien no sea superadmin. La validación fuerte es la misma de las plantillas de usuario (Zod).

## Límites / pendiente
- No se probó contra un CDN real desde este entorno (sin red): la descarga y el informe se prueban con transporte simulado.
- Los créditos son informativos: anotarlos **no** sustituye a tener derecho a usar la imagen (ver «Derechos de las fotos»).
- Pendiente de decisión: filtros por idioma/etiquetas en la galería.

## Crear una plantilla desde una colección de la biblioteca
En `/admin/plantillas`, «Crear desde una colección de la biblioteca» llama a `from_collection`: `ss_admin_collection_template` arma el contenido (título = colección, slug libre, catálogo de hasta 100 productos con foto por enlace, portada = foto de un producto, casa inicial opcional de la biblioteca) y se guarda como **borrador**; después se abre en el editor. No se copia ni se sube ninguna imagen.
Las partidas creadas desde una plantilla publicada anotan `games.template_slug`, que alimenta `/admin/estadisticas`.
