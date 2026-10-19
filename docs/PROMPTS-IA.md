# Prompts de edición con IA (mezcla de imágenes)

Objetivo del juego: partir de **una imagen base cualquiera** (una casa, una nave espacial, un batido de leche, una mascota…) y que, con cada compra, la IA **una la imagen nueva con la última del jugador de la forma más natural y divertida**. La partida no da contexto: la IA debe deducirlo de lo que ve. Código: `src/lib/ai/prompts.ts` (`buildEditPrompt`, `buildBlendPrompt`).

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

## Tareas por proveedor

La cadena asigna a cada proveedor las tareas para las que sirve (`realEdit` en `ImageGenerationProvider`):

| Tarea | Orden de prueba |
|---|---|
| Generar desde cero (imagen inicial, imagen de un elemento, «Generar imagen») | primero los que **solo generan** (AI Horde, Hugging Face), después los que sirven para todo (Cloudflare, Pollinations con modelo de edición) |
| Editar la imagen del jugador (compras, regenerar) | solo los que **editan de verdad**; si ninguno responde, composición (collage) |

Dentro de cada grupo manda el orden de `IMAGE_PROVIDERS`. Si un proveedor «solo generar» falla por cuota o red, se pasa al siguiente hasta llegar a los editores. **Sin probar** contra los servicios reales.

## ¿Por qué se usó este proveedor? (historial → Detalles → «Por qué este proveedor»)
Cada imagen generada con IA (también las normales, no solo las regeneradas) guarda una **nota del proveedor** (`image_versions.provider_note`):
- **Cadena:** `cadena: cloudflare → pollinations; cloudflare falló (quota: …); respondió pollinations (2.º de 2)`. Explica el orden (el de `IMAGE_PROVIDERS`), qué proveedores se saltaron y por qué: **falló** (cuota, límite de ritmo, credenciales, red, servidor o sin capacidad), **en enfriamiento** (falló hace poco; hasta las 00:00 UTC si fue cuota diaria, 10 min si credenciales, 1 min si ritmo, 30 s en otros casos; el enfriamiento vive en la memoria de cada instancia), **apagado o con el tope diario alcanzado** (ajustes del superadmin) o **no edita** (sin modelo de edición). Si ningún proveedor puede editar de verdad se anota que se usó la composición (collage).
- **Regenerar con…:** `Regenerado forzando cloudflare (se ignora la cadena)`. En «Regenerar» puedes elegir *Solo Cloudflare / Pollinations / AI Horde / Hugging Face* para comparar modelos sobre la misma compra; si ese proveedor no está en `IMAGE_PROVIDERS` o le faltan credenciales el trabajo falla con un mensaje claro y se conserva la imagen.
- **Un solo proveedor** o **pegatinas**: «Único proveedor configurado: X» / «Pegatinas (sin IA)».
- Si fallan todos, el error del trabajo incluye la misma explicación de la cadena.
**Si solo ves Pollinations:** mira el orden en `IMAGE_PROVIDERS` (el primero manda), los ajustes del superadmin (`/admin/ia`: apagado o tope diario de Cloudflare) y el motivo de fallo de Cloudflare en la nota (cuota de neurons, `Cloudflare 400/404/422` por el modelo o el tamaño de las referencias, credenciales).

## Prueba A/B en una partida real (Pikachu + barca a pedales)
1. **Prepara**: aplica las migraciones hasta `…5700` (+ `notify pgrst, 'reload schema';`) y despliega. En Vercel: `IMAGE_PROVIDERS` (p. ej. `cloudflare,pollinations`), `CLOUDFLARE_EDIT_MODEL`, `IMAGE_EDIT_GUARD`, claves. En `/admin/ajustes` sube temporalmente la cuota por partida y por día (cada generación y cada «regenerar» cuenta; por defecto 10/partida y 50/día).
2. **Crea la partida** con «Cómo cambian las imágenes → Con IA», 1 jugador, la foto de la persona en la puerta como imagen inicial (subida) y un catálogo con *Pikachu* y *Una barca a pedales* con su foto (de la biblioteca o subida).
3. **Compra** el Pikachu y luego la barca con ese jugador. En el panel → Historial mira cada versión (IA, modelo, prompt, «guardia de zona…»).
4. **Repite el último paso con otro modelo o prompt sin volver a comprar**: cambia la variable en Vercel (`CLOUDFLARE_EDIT_MODEL`, `IMAGE_EDIT_GUARD`…), redespliega y en el Historial pulsa **«Regenerar»** en la versión actual: vuelve a generar partiendo de la versión anterior (la actual se conserva) y no cobra nada (máx. 10 por compra). Compara con «A»/«B».
5. Para probar un prompt nuevo sin desplegar, usa `npm run ai:lab` (más abajo).

## Probar y pulir con el modelo real: `npm run ai:lab`
```bash
npm run ai:lab -- --base casa.jpg --items pikachu.jpg,barca.jpg --names "Pikachu,Barca" --out lab-salida
npm run ai:lab -- --base batido.jpg --items fresa.jpg,galleta.jpg --theme "batido de leche"   # --no-guard para ver el resultado crudo
```
Encadena cada resultado como base del siguiente (como en la partida), con el mismo prompt, tamaño y guardia, y escribe `paso-N.png` y `prompts.txt` (con el prompt exacto de cada paso). Usa el proveedor configurado en `.env.local` y **gasta cuota gratuita**; no toca la base de datos ni el almacenamiento.

## Qué NO está verificado
- **El texto del prompt no se ha probado contra el modelo real** desde este entorno (sin claves ni red): se ha redactado según el comportamiento observado en tus historiales (el modelo pierde objetos y a veces deja halos) y se cubre con tests de *contenido* del prompt y de la guardia con imágenes sintéticas. Usa `ai:lab` con tus fotos (casa, batido, mascota…) para comparar variantes y dime qué falla.
- Un modelo mayor (de pago) cumpliría mejor las instrucciones; no se activa por regla del proyecto (solo proveedores gratuitos).

## Comparador de modelos (superadmin)

`/admin/ia/comparar` (enlazado desde `/admin/ia`) ejecuta la **misma edición que una compra real** con hasta 4 proveedores a la vez: imagen base (archivo o biblioteca), uno o dos elementos con nombre (el segundo se añade encima del resultado del primero, con `previousItems` como en la partida) y tema opcional. Usa `buildEditPrompt`/`buildBlendPrompt` dentro de cada adaptador, los tamaños de `normalize.ts` y la guardia de zona (`IMAGE_EDIT_GUARD`) mediante `src/lib/ai/edit-pipeline.ts`, que comparten `jobs-service` y `compare-service`. Cada resultado muestra el **prompt exacto enviado** (desplegable «Prompt enviado»), proveedor, modelo, notas (con la semilla), tiempo y, si falla, el motivo. Nada se guarda: la imagen viaja como data URL. «Repetir con otra semilla» relanza solo ese proveedor (cada llamada elige una semilla nueva).
