# Prompts de edición con IA (mezcla de imágenes)

Objetivo del juego: partir de **una imagen base cualquiera** (una casa, un batido de leche, una mascota…) y que, con cada compra, la IA **una la imagen nueva con la última del jugador de la forma más natural y divertida**. La partida no da contexto: la IA debe deducirlo de lo que ve. Código: `src/lib/ai/prompts.ts` (`buildEditPrompt`, `buildBlendPrompt`).

## Principios del prompt
1. **La base es cualquier cosa** («Image 0 is the BASE picture…: a house, a room, a drink, a food, an object, an animal, a person, a landscape») y se le pide decidir cómo integrar el elemento según lo que sea:
   lugar o escena → objeto real del sitio (misma escala, perspectiva, luz y sombras); comida, bebida u objeto → algo que se *añade* (ingrediente, topping, decoración, accesorio); ser vivo → accesorio, compañero o *prop*.
2. **Una sola imagen coherente, no un collage**: sin aspecto de pegatina, sin bordes recortados ni halos blancos u oscuros, sin objetos flotantes, mismo encuadre, proporción, colores y estilo que la base.
3. **Lo ya añadido sigue visible**: se nombra («Image 0 ALREADY contains …: Pikachu») y se prohíbe sustituirlo, taparlo o esconderlo.
4. **Con foto del elemento** (imagen 1): se reproduce fielmente (forma, colores, marcas) **sin su fondo original**.
5. **Zona sugerida solo si la base es un lugar con espacio libre** («preferably in the foreground center part»); si no, el modelo decide. Esa zona (`regionFor` / `slotFor`) es la misma que usa la guardia de zona.
6. Solo un elemento por ronda y sin texto, letras, logotipos ni marcas de agua.

## Guardia de zona (`src/lib/ai/region-guard.ts`)
Los modelos de edición económicos a veces «pierden» lo anterior (la barca sustituyó al Pikachu). Con compras previas, la imagen final conserva la anterior **píxel a píxel fuera de la zona del objeto nuevo** (borde suave). **No se aplica** si: el objeto no está en su zona, el modelo devolvió otra proporción, o cambió más del 40 % de la imagen (una **mezcla**, como salsa en un batido: ahí cambiar «todo» es lo correcto). Queda anotado en el prompt de la versión («guardia de zona»).

## Probar y pulir con el modelo real: `npm run ai:lab`
```bash
npm run ai:lab -- --base casa.jpg --items pikachu.jpg,barca.jpg --names "Pikachu,Barca" --out lab-salida
npm run ai:lab -- --base batido.jpg --items fresa.jpg,galleta.jpg --theme "batido de leche"   # --no-guard para ver el resultado crudo
```
Encadena cada resultado como base del siguiente (como en la partida), con el mismo prompt, tamaño y guardia, y escribe `paso-N.png` y `prompts.txt` (con el prompt exacto de cada paso). Usa el proveedor configurado en `.env.local` y **gasta cuota gratuita**; no toca la base de datos ni el almacenamiento.

## Qué NO está verificado
- **El texto del prompt no se ha probado contra el modelo real** desde este entorno (sin claves ni red): se ha redactado según el comportamiento observado en tus historiales (el modelo pierde objetos y a veces deja halos) y se cubre con tests de *contenido* del prompt y de la guardia con imágenes sintéticas. Usa `ai:lab` con tus fotos (casa, batido, mascota…) para comparar variantes y dime qué falla.
- Un modelo mayor (de pago) cumpliría mejor las instrucciones; no se activa por regla del proyecto (solo proveedores gratuitos).
