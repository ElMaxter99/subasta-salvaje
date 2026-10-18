# Fuente propia con negrita real para el podio y las imágenes OG

Antes, `podium-image.tsx` y `og-image.tsx` (satori vía `next/og`) solo tenían Geist Regular y la «negrita» era un contorno (`WebkitTextStroke`). Ahora usan las mismas familias que la web.

## Qué se usa
| Familia | Pesos | Uso | Archivo |
|---|---|---|---|
| Baloo 2 | 700, 800 | títulos, nombres, números de puesto, «1.º», nombre de la marca | `Baloo2-Bold.ttf`, `Baloo2-ExtraBold.ttf` |
| Nunito | 400, 700 | texto, puntuaciones (700), estadísticas (700), fecha | `Nunito-Regular.ttf`, `Nunito-Bold.ttf` |

- Ubicación: `src/assets/fonts/*.ttf` (≈145 KB en total, subconjunto latino: ASCII, Latin-1, Latin Extended-A básico, puntuación y símbolos comunes) junto con `OFL-Baloo2.txt` y `OFL-Nunito.txt` (SIL Open Font License 1.1).
- Origen: fuentes variables oficiales de <https://github.com/google/fonts> (`ofl/baloo2`, `ofl/nunito`), convertidas a **instancias estáticas** (wght 700/800 y 400/700) y subconjunto con `fontTools` (`instancer` + `subset`). Hay que usar estáticas: satori (opentype.js) no lee woff2 ni interpreta bien las variables. Las fuentes no se han modificado más allá de eso (sin renombrar; las licencias OFL no declaran «Reserved Font Name»).
- Código: `src/lib/seo/fonts.ts` (`loadBrandFonts()`: `fs.readFile` desde `process.cwd()/src/assets/fonts`, Buffer en caché en memoria; devuelve `null` si algo falla). Se pasa a `ImageResponse` como `fonts: [{ name, data, weight, style }]`.
- Fallback: si no se pueden leer, el podio vuelve a Geist con negrita simulada por contorno (`realBold = false`) y las OG a `sans-serif`; la imagen nunca falla por la fuente.
- Despliegue: `next.config.ts` añade `src/assets/fonts/*.ttf` a `outputFileTracingIncludes` de `/api/public/games/*/podium` y `/game/*/*/opengraph-image`. `.vercelignore` no excluye `src/`.
- Los emojis siguen quitándose (`plainText`): satori no los dibuja con fuente. `lineHeight: 1.2` en la raíz del podio, porque Baloo 2/Nunito traen un interlineado «normal» mayor que Geist y desplazaban la composición.

## Regenerar las TTF
```bash
python3 -m venv /tmp/v && /tmp/v/bin/pip install fonttools
# descargar Baloo2[wght].ttf y Nunito[wght].ttf de github.com/google/fonts (ofl/baloo2, ofl/nunito) y:
# instantiateVariableFont(font, {"wght": 700|800|400}) + fontTools.subset con los rangos Unicode latinos → src/assets/fonts/
```

## Pruebas
- `tests/brand-fonts.test.ts`: archivos presentes, cabecera sfnt (TTF, no woff2), <300 KB, licencias OFL junto a ellos, `loadBrandFonts()` con los 4 pesos y caché.
- `tests/podium-image.test.ts` ya renderiza los tres formatos (2, 5, 10 jugadores, nombres largos, empates). `PODIUM_DUMP=/ruta npx vitest run tests/podium-image.test.ts` guarda los PNG para revisarlos a ojo.

## Limitaciones
- Solo cobertura latina: otros alfabetos (cirílico, CJK…) salen como casilla vacía (antes con Geist ocurría algo similar).
- No probado en Vercel real (la traza se ha comprobado en `npm run build`).
