# Casar fotos de la biblioteca con las plantillas del sistema

Propone (y, si el superadmin lo decide, aplica) una foto de la [biblioteca de medios](BIBLIOTECA.md) a cada elemento de las
[plantillas del sistema](PLANTILLAS-SISTEMA.md), por **título y etiquetas**. Sin IA, sin red, determinista. Las plantillas del catálogo
([PLANTILLAS-SISTEMA-CATALOGO.md](PLANTILLAS-SISTEMA-CATALOGO.md)) llevan `foto: null` y etiquetas en inglés por elemento (solo en el lote, no se guardan en la base).

## Piezas
| Pieza | Archivo | Qué hace |
|---|---|---|
| Motor puro | `src/lib/library/match.ts` (+ `match-lexicon.ts`) | Puntúa pares elemento↔foto, reparte sin repetir y calcula cobertura/huecos. No toca base ni red. |
| Informe | `src/lib/library/match-report.ts` | Resumen de consola, CSV de propuestas, CSV de huecos. |
| Servicio | `src/lib/services/library-match-service.ts` | Carga las fotos (lectura, `ss_library_pick_list`) y aplica lo elegido con `saveSystemTemplate` (→ `ss_admin_system_template_upsert`). **Sin migraciones nuevas ni SQL nuevo.** |
| Script | `scripts/templates/match.ts` → `npm run templates:match` | Ensayo por defecto; `--apply` guarda fotos en borradores. |
| Panel | `src/components/admin/system-template-match.tsx` | Botón «Sugerir fotos de la biblioteca» por plantilla en `/admin/plantillas`. |
| API | `POST /api/admin/system-templates` ops `match_propose` y `match_apply` | Solo superadmin, mismo origen, límite de tasa (15 y 20/min). |

## Qué fotos se consideran
Solo las del selector de los anfitriones: **rol `product`, revisadas** (`reviewed`) y con enlace https. Las `start`, las sin revisar y las sin rol nunca se proponen.

## Cómo puntúa (0–1, todo explicable en `reasons`)
Cada texto se reduce a *conceptos*: minúsculas, sin tildes ni signos, sin palabras vacías, **sin plural ni género simples** (`lámparas`/`lámpara`, `relojes`/`reloj`, `gata`/`gato`)
y con **sinónimos ES↔EN** del léxico `match-lexicon.ts` (`camello` = `camel`, `taza` = `cup`…). Lo que no está en el léxico se compara por raíz.

| Componente | Peso (con etiquetas / sin) | Qué mide |
|---|---|---|
| A título↔título | 0,15 / 0,30 | Dice entre conceptos del título del elemento y del título de la foto |
| B título en la foto | 0,15 / 0,25 | Conceptos del título del elemento presentes en título o etiquetas de la foto |
| C etiquetas | 0,55 / 0,30 | Etiquetas del elemento presentes en título/etiquetas de la foto (sin etiquetas se usa B; el emoji orienta solo si no hay etiquetas) |
| D categoría | 0,10 | La categoría de la foto coincide con el elemento o con la temática de la plantilla |
| E descripción | 0,05 | Etiquetas de la foto presentes en la descripción |

Título idéntico = mínimo 0,85. **Confianza:** alta ≥ 0,70 · media ≥ 0,50 · baja < 0,50; **umbral** para proponer: 0,40 (`--threshold`).
**No repetir:** el reparto es voraz por puntuación (empates: índice del elemento, luego `id` de la foto); una foto asignada a un elemento sale **penalizada (−0,5)** para los demás de la misma plantilla
(se muestra «penalizada: ya es la foto de…»), así que la siguiente mejor pasa a ser la elegida. Los elementos que ya tienen foto no se tocan ni les quitan fotos a otros.

## Script
```bash
npm run templates:match                                  # ENSAYO: lee la biblioteca de la base de la app y propone; no escribe en ninguna base
npm run templates:match -- --apply                       # guarda las de confianza ALTA en las plantillas ya importadas y en BORRADOR
npm run templates:match -- --apply --min=media           # incluye las de confianza media
npm run templates:match -- --only=antiguo-egipto --file=otro-lote.json --threshold=0.45 --out=informe
```
Funciona con cualquier lote (`--file`) o con `docs/plantillas-sistema/lote.json`. Lee la biblioteca de la base que use la app (Supabase con credenciales; si no, la base local de desarrollo) **solo en lectura**.
Con `--apply` omite las plantillas no importadas (`npm run templates:import -- --apply`) y las publicadas. Informe en consola y en `.match-report/` (ignorado por git):
`casamiento.json` (cobertura por plantilla, propuestas, huecos), `casamiento.csv` (una fila por elemento) y `huecos.csv` (palabras de elementos sin foto, de más a menos pedidas).

**Cobertura** = % de elementos con foto candidata por plantilla (y cuántas de confianza alta). **Huecos** = para cada elemento sin candidata, las palabras (etiquetas del lote, o del título) que ninguna foto cubre;
`huecos.csv` suma cuántos elementos piden cada palabra: es la lista que alimenta el [plan de relleno de la biblioteca](PLAN-RELLENAR-BIBLIOTECA.md) (qué fotos subir primero).

## Panel de administración
`/admin/plantillas` → fila de la plantilla → **Sugerir fotos de la biblioteca**: lista de elementos con miniatura, título de la foto, confianza, puntuación y motivos; alternativas en miniatura;
**Aceptar** una a una o **Aceptar las de confianza alta**. Solo con plantillas en borrador. Las etiquetas se leen del lote del repositorio (`docs/plantillas-sistema/lote.json`) por título de elemento;
el archivo viaja en el despliegue (`outputFileTracingIncludes` en `next.config.ts`; sin él, el análisis de Next trazaría todo el proyecto); si aun así no se encontrara, se casa solo por título, descripción y emoji (menos precisión). Aplicar guarda el **enlace** de la biblioteca (y su crédito) en la plantilla;
**no copia ni sube imágenes, no publica, no usa IA**. Antes de publicar, el superadmin sigue usando «Comprobar imágenes» y «Publicar» como siempre.

## Garantías (las comprueba `tests/library-match-service.test.ts`)
Rechaza fotos sin revisar o de otro rol, índices fuera de rango, la misma foto en dos elementos, pisar una foto existente y plantillas publicadas; la plantilla queda en borrador; se registra auditoría (`system_template_photos_matched`).

## Pruebas y límites (honestidad)
- Probado con **datos sintéticos**: tests del motor (tildes, plurales, sinónimos, empates, no repetir, umbral, sin candidatas), del servicio sobre PGlite con una biblioteca de prueba y un e2e corto del botón (`e2e/system-templates-match.spec.ts`).
  Además, con las 36 plantillas reales y una biblioteca sintética (una foto por elemento titulada con sus etiquetas) se recupera la foto correcta en > 95 % de los elementos.
- **No probado con fotos reales:** la biblioteca real aún está vacía. La calidad dependerá de cómo se titulen y etiqueten las fotos; el léxico ES↔EN es pequeño (~370 conceptos) y se amplía en `match-lexicon.ts`.
  Es una ayuda para el superadmin, no un veredicto: **mira siempre las miniaturas** antes de publicar. No mira el contenido de la imagen (solo título, categoría y etiquetas).
- Limitaciones conocidas: homónimos ES/EN (`pan` ES = pan de comer, EN = sartén) se resuelven a favor del español; las expresiones de varias palabras se comparan palabra a palabra; la raíz simple puede unir palabras próximas (`casa`/`caso` se distinguen solo por longitud ≥ 4).
- Aplicar con `--apply` sobre Supabase **no se ha ejecutado contra el servicio real** (sí contra PGlite).
