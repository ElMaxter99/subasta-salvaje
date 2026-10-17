# Prompts de edición con IA (mezcla de imágenes)

Objetivo del juego: partir de **una imagen base cualquiera** (una casa, un batido de leche, una mascota…) y que, con cada compra, la IA **una la imagen nueva con la última del jugador de la forma más natural y divertida**. La partida no da contexto: la IA debe deducirlo de lo que ve. Código: `src/lib/ai/prompts.ts` (`buildEditPrompt`, `buildBlendPrompt`).

> **Edición, no «añadir».** El juego no es pegar un objeto encima: la IA debe **editar** la imagen base para que la combinación tenga sentido y gracia (un barco pide agua y la persona de la foto puede subirse; un sombrero lo lleva la persona o el animal; un ingrediente se vierte en el batido y lo cambia). Puede cambiar el entorno y hacer que el sujeto interactúe con el elemento; lo único intocable es lo añadido antes y la identidad de la base (mismo sujeto, encuadre, proporción y estilo).
> **Límite de longitud:** los proveedores cortan el prompt en ~2000 caracteres (Pollinations 2000, Cloudflare 2048): el prompt es corto a propósito y se comprime (nombres y descripciones) para que **nunca se pierda el final** (comprobación final y «sin texto»); hay un test.

## Principios del prompt
1. **La base es cualquier cosa** («Image 0 is the BASE picture…: a house, a room, a drink, a food, an object, an animal, a person, a landscape») y se le pide decidir cómo integrar el elemento según lo que sea:
   lugar o escena → objeto real del sitio (misma escala, perspectiva, luz y sombras); comida, bebida u objeto → algo que se *añade* (ingrediente, topping, decoración, accesorio); ser vivo → accesorio, compañero o *prop*.
2. **Una sola imagen coherente, no un collage**: sin aspecto de pegatina, sin bordes recortados ni halos blancos u oscuros, sin objetos flotantes, mismo encuadre, proporción, colores y estilo que la base.
3. **Lo ya añadido sigue visible**: se nombra («Image 0 ALREADY contains …: Pikachu») y se prohíbe sustituirlo, taparlo o esconderlo.
4. **Con foto del elemento** (imagen 1): se reproduce fielmente (forma, colores, marcas) **sin su fondo original**.
5. **Zona sugerida solo si la base es un lugar con espacio libre** («preferably in the foreground center part»); si no, el modelo decide. Esa zona (`regionFor` / `slotFor`) es la misma que usa la guardia de zona.
6. **Físicamente creíble**: el elemento descansa o se acopla a la escena (suelo, mesa, en la mano, puesto, mezclado) con sombras de contacto, nunca flotando ni pegado a una pared salvo que sea natural.
7. **Solo el objeto de la foto de referencia**, sin su fondo ni las personas o el paisaje ajenos, salvo que sean claramente parte del elemento.
8. **Comprobación final** (los modelos pesan más lo último): lo anterior sigue visible donde estaba, nada existente se ha cambiado por otra cosa y la única diferencia con la base es el elemento nuevo.
9. Solo un elemento por ronda y sin texto, letras, logotipos ni marcas de agua.

## Guardia de las ediciones (`src/lib/ai/region-guard.ts`, `IMAGE_EDIT_GUARD`)
Los modelos de edición económicos a veces «pierden» lo anterior (la barca sustituyó al Pikachu; en otra prueba lo cambió por una ensalada).
- **`cores` (por defecto, edición creativa):** no limita lo que puede cambiar la IA. Cada compra tiene una zona (`slotFor`, la misma que se sugiere en el prompt) y un **núcleo** estrecho. Si el núcleo de una compra anterior cambia mucho (el objeto se perdió) se **restaura ese trozo** de la imagen anterior con borde suave. No actúa si el modelo rehízo más del 70 % de la imagen, devolvió otra proporción o el objeto sigue ahí.
- **`zone` (estricta):** conserva la imagen anterior píxel a píxel fuera de la zona del objeto nuevo y en el núcleo de los anteriores. Garantiza más, pero **impide ediciones creativas** (agua alrededor, la persona sentada en la barca) y no se aplica si cambia más del 40 % (mezclas).
- **`off`:** sin guardia.
La diferencia se mide por canal RGB (el gris no distingue p. ej. un rojo de un gris). Queda anotado en el prompt de la versión («guardia de zona…»). Detalle: también se corrigió que el prompt de una compra incluyera como «ya presentes» las compras **posteriores** cuando los trabajos van atrasados.

## ¿Hay un modelo gratuito mejor? (análisis, octubre 2026)
Fuentes: búsquedas web (sin acceso directo a las webs de los proveedores desde este entorno); **cifras y condiciones sin verificar, compruébalas en cada proveedor**.
1. **Cloudflare Workers AI — FLUX.2 klein 9B / FLUX.2 [dev]** (la mejor opción realista): la documentación (changelogs de Cloudflare) dice que admiten **edición multi-referencia (hasta 4 imágenes, `input_image_0..3`, cada una < 512×512)**; nuestro adaptador ya lo usa. Hoy usamos klein **4B**; el 9B sigue mejor las instrucciones. Entra en los 10 000 neurons gratuitos/día (flux-2-dev cuesta unos 18,75 neurons por tile de 512² de entrada y 37,5 de salida **por paso**: unas pocas imágenes al día; mide el coste real con `npm run ai:measure`). Cambio: `CLOUDFLARE_EDIT_MODEL=@cf/black-forest-labs/flux-2-klein-9b` (o `flux-2-dev`) y `IMAGE_PROVIDERS=cloudflare,pollinations`. Limitación: referencias < 512 px → imágenes de salida de baja resolución.
2. **Pollinations:** gratis ilimitado solo para FLUX de texto→imagen; los modelos de edición mejores (**Kontext**, GPT Image, Nano Banana) consumen *pollen*, que se agota (ya viste el 402). Merece probar `POLLINATIONS_EDIT_MODEL` con Kontext mientras haya saldo.
3. **Gemini (Nano Banana):** sería de lo mejor en integrar imágenes, pero la capa gratuita de la API para imagen **no es fiable ni está confirmada** (informes de límite 0 / 429). No se recomienda basarse en ella.
4. **Hugging Face:** la cuenta gratuita incluye ~0,10 $/mes de crédito; poco para un juego. **Qwen-Image-Edit** (pesos abiertos, multi-imagen, muy bueno en consistencia) no tiene API gratuita fiable: solo autoalojado (necesita GPU).
5. **AI Horde:** comunitario y gratis, pero hace img2img clásico, no edición por instrucciones: no mejora esto.
Conclusión: **probar primero FLUX.2 klein 9B / dev en Cloudflare** (misma integración, solo variable de entorno) y comparar con `npm run ai:lab`.

## Probar y pulir con el modelo real: `npm run ai:lab`
```bash
npm run ai:lab -- --base casa.jpg --items pikachu.jpg,barca.jpg --names "Pikachu,Barca" --out lab-salida
npm run ai:lab -- --base batido.jpg --items fresa.jpg,galleta.jpg --theme "batido de leche"   # --no-guard para ver el resultado crudo
```
Encadena cada resultado como base del siguiente (como en la partida), con el mismo prompt, tamaño y guardia, y escribe `paso-N.png` y `prompts.txt` (con el prompt exacto de cada paso). Usa el proveedor configurado en `.env.local` y **gasta cuota gratuita**; no toca la base de datos ni el almacenamiento.

## Qué NO está verificado
- **El texto del prompt no se ha probado contra el modelo real** desde este entorno (sin claves ni red): se ha redactado según el comportamiento observado en tus historiales (el modelo pierde objetos y a veces deja halos) y se cubre con tests de *contenido* del prompt y de la guardia con imágenes sintéticas. Usa `ai:lab` con tus fotos (casa, batido, mascota…) para comparar variantes y dime qué falla.
- Un modelo mayor (de pago) cumpliría mejor las instrucciones; no se activa por regla del proyecto (solo proveedores gratuitos).
