# Rendimiento con 10–20 móviles sondeando

Medición reproducible de lo que cuesta leer el estado de la partida (`ss_get_state`, 17 funciones apiladas por envoltorios `alter function … rename to …_pre_*`) y de las escrituras que toman el bloqueo `FOR UPDATE` de la partida (`ss_player_bid`, `ss_yield_bid`) cuando hay 10 o 20 móviles, una TV y un anfitrión.

> **Honestidad sobre lo medido.** Cada cifra indica su motor. **PGlite** (WASM, monohilo, en memoria) es el motor de los tests y del desarrollo local: **no representa** a Postgres de Supabase. Las cifras de **Postgres 16 real** son de una instalación local (`localhost`, 4 núcleos, sin red, el generador de carga en la misma máquina): tampoco son las de Supabase (red, pooler, CPU compartida, plan). **Nada de esto se ha medido contra Supabase real**; sirve para detectar crecimientos no lineales y órdenes de magnitud, no para prometer latencias.

## Cómo reproducir

```bash
npm run loadtest                                  # PGlite, N = 10 y 20 (≈ 1 min)
npm run loadtest -- --quick                       # humo, menos repeticiones
npm run loadtest -- --players=5,10,20,40 --json   # otros tamaños y salida JSON
pg_ctlcluster 16 main start                       # contenedor remoto, si el Postgres está parado
PG_TEST_URL=postgres://postgres:postgres@localhost:5432/postgres npm run loadtest -- --engine=pg      # Postgres real
PG_TEST_URL=… npm run loadtest -- --engine=both   # los dos motores
```

El script es `scripts/loadtest/snapshots.ts` (tsx). **No es un test de vitest** y no se ejecuta con `npm test`. En modo `pg` crea y borra una base temporal propia (todas las migraciones, incluidas las `_security_`, con roles simulados, igual que `tests/postgres-real.test.ts`).

## Metodología

- **Escenario:** partida en modo móviles con N jugadores (cada uno reclamado con su token), 14 elementos, saldo alto, subasta abierta con 10 pujas hechas desde móviles reales (`playerBid`). Se usan los servicios reales (`getPublicState`, `getHostState`, `playerBid`, `yieldBid`), no SQL a mano, salvo la columna «SQL pura».
- **Tope de jugadores:** el producto limita a 10 (`MAX_PLAYERS`, `ss_max_players_cap()` y un `check` en `games`). Para N = 20 el script, **solo en su base temporal**, elimina ese `check` y redefine `ss_max_players_cap()` a 100. No se toca ninguna migración. N = 20 es por tanto una prueba de estrés por encima del producto actual.
- **Intervalo de sondeo real** (`src/lib/client/use-live-game.ts`): sin Supabase (desarrollo local) 1500 ms; con Supabase, 8000 ms como red de seguridad si Realtime está conectado (3000 ms si no). La TV y los móviles leen `/api/public/games/[code]` (= `getPublicState`, 1 RPC); el anfitrión `/api/games/[code]` (= `getHostState`, 4 RPC: estado, uso de IA, ajustes y actividad).
- **Lecturas secuenciales:** 400 lecturas tras 30 de calentamiento; percentiles p50/p95/p99 (método del rango superior).
- **Ráfaga concurrente (peor caso):** N móviles + 1 TV + 1 anfitrión lanzan su lectura exactamente a la vez, 40 veces. Es el caso de sondeos sincronizados (p. ej. todos reconectan tras un aviso).
- **Sostenido (caso real):** los N + 2 clientes sondean cada 1500 ms con fase aleatoria durante 12 s.
- **Pujas:** puja aislada; contienda (los N − 1 no líderes pujan a la vez con importes distintos, 15 rondas); y mezcla (esas pujas más N + 2 lecturas simultáneas). Todas las pujas de una ronda toman el mismo bloqueo `FOR UPDATE` de la partida y se serializan.
- **Ceder la puja:** 5 partidas nuevas; uno cede aislado y los otros N − 2 ceden a la vez (el último puede adjudicar al instante).
- **Perfil de capas:** 200 llamadas en un bucle SQL a cada una de las funciones `ss_get_state*` (sin red ni JSON de cliente).
- **Latencia** = tiempo desde que el cliente emite la petición hasta que vuelve la respuesta, medido en el mismo proceso Node. En la ráfaga incluye la **cola**: PGlite ejecuta una consulta cada vez; en Postgres real el pool del script es de 16 conexiones.

## Resultados (ms; ejecución completa, una sola máquina de 4 núcleos)

### Tamaño del snapshot (bytes de JSON, 14 elementos, subasta con 10 pujas)

| Jugadores | Público (SQL) | Público servido (con URLs) | Anfitrión |
|---:|---:|---:|---:|
| 5 | 9 797 | 10 877 | 17 071 |
| 10 | 13 610 | 15 770 | 24 334 |
| **20** | **21 393** | **25 712** | **39 362** |
| 40 | 37 229 | 45 869 | 67 064 |

Crece **linealmente** (≈ 0,8 KB por jugador sobre una base ≈ 5,5 KB). A 20 jugadores la TV y cada móvil descargan ≈ 25 KB por sondeo (sin comprimir); con gzip/brotli en Vercel baja mucho, pero no se ha medido.

### (a) Lecturas

| Motor | N | Secuencial `ss_get_state` p50 / p95 / p99 | Ráfaga (N + TV + host a la vez) p50 / p95 / p99 | Sostenido 1,5 s p50 / p95 / p99 |
|---|---:|---|---|---|
| PGlite | 10 | 4,5 / 6,8 / 8,4 | 24,3 / 44,8 / 51,4 | 5,6 / 11,2 / 14,5 |
| PGlite | 20 | 5,1 / 8,0 / 10,9 | 60,9 / 116,3 / 132,3 | 8,5 / 16,1 / 18,1 |
| Postgres 16 | 10 | 2,8 / 3,9 / 6,0 | 11,2 / 20,1 / 69,0 | 4,6 / 8,7 / 13,8 |
| Postgres 16 | 20 | 3,4 / 5,2 / 7,5 | 22,2 / 40,5 / 133,7 | 5,6 / 9,2 / 12,8 |

El anfitrión (4 RPC) cuesta ≈ 2× una lectura pública: secuencial p95 9,5 ms (N = 10) y 14,5 ms (N = 20) en PGlite; 8,7 y 10,1 ms en Postgres real.

Coste en servidor de la función completa (bucle SQL, sin red): PGlite 3,9 ms (N = 10) y 4,9 ms (N = 20); Postgres real 2,0 → 3,4 ms (N = 10 → 20) y 1,8 / 2,0 / 3,4 / 6,0 ms para N = 5 / 10 / 20 / 40 en una ejecución rápida aparte: ≈ lineal.

### (b) Escrituras con la partida bloqueada

| Motor | N | Puja aislada p50 / p95 | Contienda: latencia por puja p50 / p95 | Ronda completa de N − 1 pujas | Ceder aislado p50 | Cesión concurrente p50 / p95 |
|---|---:|---|---|---:|---:|---|
| PGlite | 10 | 7,3 / 13,7 | 49,7 / 110,1 | 70 ms | 5,1 | 27,7 / 45,1 |
| PGlite | 20 | 7,2 / 11,5 | 92,2 / 147,9 | 141 ms | 6,3 | 72,0 / 121,0 |
| Postgres 16 | 10 | 5,4 / 7,1 | 20,9 / 56,0 | 49 ms | 7,7 | 17,8 / 26,4 |
| Postgres 16 | 20 | 6,4 / 12,1 | 62,7 / 100,1 | 101 ms | 8,2 | 42,6 / 104,3 |

(En Postgres real solo se aceptan unas pocas pujas por ronda: las demás llegan después de otra mayor y se rechazan con «puja demasiado baja», que es el comportamiento correcto. En PGlite el orden de llegada coincide con el de importes y se aceptan todas, por eso el trabajo no es idéntico entre motores.)

Con lecturas concurrentes durante las pujas, N = 20: las lecturas suben a p50 54–68 ms / p95 125–133 ms en ambos motores, y las pujas a p50 108–212 ms. En PGlite es esperable (una sola cola). En Postgres real las lecturas no esperan al bloqueo (MVCC, `ss_get_state` no toma `FOR UPDATE`); lo que se ve ahí es **saturación de CPU/Node de la máquina de pruebas** (41 consultas simultáneas, generador y servidor en 4 núcleos), no contención de bloqueos.

### (c) Pila de 17–18 envoltorios

Cada envoltorio añade una llamada plpgsql y vuelve a consultar sus propios datos; la función final completa cuesta ≈ 3,0 ms en Postgres real y ≈ 4,9 ms en PGlite con 20 jugadores (el «base» antiguo, 0,9 / 1,7 ms, devuelve muchos menos campos). El coste es **plano y proporcional al contenido**, no hay una capa que domine (las capas internas intermedias van de 1,1 a 3,6 ms en Postgres real).

## Conclusiones

1. **No hay un cuello de botella medible según el criterio fijado** (> ~20 ms p95 con 20 jugadores en lectura secuencial): p95 de 8,0 ms en PGlite y 5,2 ms en Postgres real, y sostenido (sondeo real cada 1,5 s) p95 ≤ 16 ms en ambos. Tampoco hay crecimiento no lineal: tamaño y coste crecen ≈ linealmente de 5 a 40 jugadores.
2. **Por eso no se ha optimizado nada:** no hay índice ni consulta con un beneficio demostrable, y no se ha añadido ninguna migración. Optimizar los 17 envoltorios (consolidarlos en una sola función) sería arriesgado y su ganancia máxima estimada es de 1–2 ms por lectura.
3. **Lo que sí escala mal es la cola, no la consulta:** con 20 móviles + TV + anfitrión sondeando a la vez (ráfaga sincronizada), la última petición espera ≈ 22 × coste de una lectura (≈ 125 ms en PGlite, ≈ 35–60 ms en Postgres real). Con fases aleatorias (caso real) desaparece. Las pujas simultáneas se serializan por diseño (`FOR UPDATE` de la partida): una ronda de 19 pujas a la vez tarda ≈ 100–140 ms, ≈ 5–8 ms por puja; es el comportamiento correcto (el dinero se cobra una sola vez) y no es un problema con pujas humanas.
4. **Ceder la puja** cuesta lo mismo que una puja (≈ 5–8 ms aislado); una tanda de 18 cesiones simultáneas tarda ≈ 120 ms en PGlite y ≈ 67 ms en Postgres real.
5. **Palancas si algún día hiciera falta** (no implementadas, sin necesidad medida): (a) con Supabase el sondeo es de 8 s con Realtime, es decir ≈ 3 lecturas/s con 22 clientes, muy por debajo de lo probado aquí (13 req/s); (b) devolver `304`/`ETag` por `version` de la partida para no reenviar los ≈ 25 KB cuando nada cambia; (c) caché en memoria de la instantánea pública por `(sala, version)` en la función serverless; (d) subir el intervalo de sondeo del anfitrión o pausarlo en segundo plano (ya se pausa si la pestaña está oculta).

## Limitaciones

- Ni PGlite ni el Postgres local son Supabase: faltan red, pooler (pgbouncer en modo transacción), límites de conexión por plan, arranques en frío de Vercel y la latencia HTTP/JSON de las rutas `/api/*`. Las cifras son de la capa de base de datos más el servicio TypeScript, **sin HTTP**.
- Generador y servidor comparten máquina y CPU (4 núcleos): las colas de la ráfaga y de la mezcla lectura + escritura de Postgres real están infladas por eso.
- El tope de producto es 10 jugadores; N = 20 es estrés con el tope relajado solo en la base temporal.
- Las muestras de p99 en las pruebas de pujas y cesiones (15 y 5 rondas) son pocas; no sacar conclusiones finas de p99/máx. Las cifras varían ± 20–30 % entre ejecuciones.
- No se mide Realtime (Broadcast), ni la generación de imágenes, ni la lectura de Storage.
