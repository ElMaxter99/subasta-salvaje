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

## Límites / pendiente (fases siguientes)
- **Fase 1 hecha:** JSON + importar al asistente + exportar + plantilla vacía + fotos por URL.
- **Pendiente:** CSV y ZIP con fotos incrustadas (fase 3), plantillas guardadas en la cuenta del anfitrión (fase 4), editar el catálogo importado dentro del asistente (hoy se edita después en el panel → Catálogo).
- Las fotos por URL no se han probado contra Internet real desde este entorno (sin salida de red para ello): el flujo se prueba con transporte simulado y con un rechazo real de IP interna en el e2e.
- La importación en la nube (Vercel) hace la descarga desde el servidor: respeta `maxDuration = 60` de la ruta.
