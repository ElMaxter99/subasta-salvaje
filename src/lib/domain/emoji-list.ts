/** Emojis para el selector (sin dependencias): categorías con palabras clave en español para buscar. */
export interface EmojiCategory { id: string; label: string; icon: string; items: [emoji: string, keywords: string][] }

const e = (s: string): [string, string][] => s.trim().split('\n').map((l) => { const [em, ...k] = l.trim().split(' '); return [em!, k.join(' ')]; });

export const EMOJI_CATEGORIES: EmojiCategory[] = [
  { id: 'caras', label: 'Caras', icon: '😀', items: e(`
😀 feliz sonrisa
😂 risa carcajada llorar
😍 enamorado corazones ojos
😎 gafas guay sol
🤩 estrella asombro
🥳 fiesta cumpleanos
😱 miedo susto grito
😴 dormir sueno
🤔 pensar duda
😇 angel
😈 diablo travieso
🤡 payaso
👻 fantasma halloween
💀 calavera muerte
👽 alien extraterrestre
🤖 robot
💩 caca
🥶 frio hielo
🥵 calor
🤑 dinero rico
😜 guino lengua
🙈 mono no ver
😺 gato cara`) },
  { id: 'gestos', label: 'Personas', icon: '👍', items: e(`
👍 pulgar bien ok
👏 aplauso
🙌 manos celebrar
💪 fuerza musculo
🧙 mago brujo hechicero
🧛 vampiro
🧟 zombi
🧜 sirena
🧚 hada
🦸 superheroe
👑 corona rey reina
🎩 sombrero chistera
👒 sombrero paja
🧢 gorra
👓 gafas
👟 zapatilla deporte
👗 vestido
🧣 bufanda
🧤 guantes
👜 bolso`) },
  { id: 'animales', label: 'Animales', icon: '🐶', items: e(`
🐶 perro
🐱 gato
🐭 raton
🐰 conejo
🦊 zorro
🐻 oso
🐼 panda
🐨 koala
🐯 tigre
🦁 leon
🐮 vaca
🐷 cerdo
🐸 rana
🐵 mono
🐔 gallina pollo
🐧 pinguino
🦆 pato
🦉 buho
🦇 murcielago
🐺 lobo
🐴 caballo
🦄 unicornio
🐝 abeja
🦋 mariposa
🐢 tortuga
🐍 serpiente
🐙 pulpo
🐬 delfin
🐳 ballena
🦈 tiburon
🐊 cocodrilo
🦖 dinosaurio
🐘 elefante
🦒 jirafa
🐿️ ardilla
🦔 erizo
🕷️ arana
🐜 hormiga
⚡ pikachu rayo electrico`) },
  { id: 'naturaleza', label: 'Naturaleza', icon: '🌳', items: e(`
🌳 arbol
🌲 pino
🌴 palmera playa
🌵 cactus
🌻 girasol
🌹 rosa flor
🍄 seta champinon
🌈 arcoiris
☀️ sol
🌙 luna
⭐ estrella
☁️ nube
🌧️ lluvia
⛈️ tormenta
❄️ nieve copo
🔥 fuego
💧 gota agua
🌊 ola mar
🌋 volcan
🏔️ montana
🏝️ isla
🌍 mundo tierra
🪐 planeta saturno
☄️ cometa`) },
  { id: 'comida', label: 'Comida', icon: '🍕', items: e(`
🍎 manzana
🍌 platano banana
🍇 uvas
🍓 fresa
🍉 sandia
🍑 melocoton
🍍 pina
🥑 aguacate
🍅 tomate
🥕 zanahoria
🌽 maiz
🥦 brocoli
🍞 pan
🥐 cruasan
🧀 queso
🍔 hamburguesa
🍟 patatas fritas
🍕 pizza
🌭 perrito caliente
🌮 taco
🍣 sushi
🍜 fideos ramen
🍝 pasta espaguetis
🥚 huevo
🍗 pollo muslo
🥩 carne filete
🍫 chocolate
🍬 caramelo
🍭 piruleta
🍩 donut rosquilla
🍪 galleta
🎂 tarta pastel
🍦 helado
🍰 tarta
🍿 palomitas
☕ cafe
🍵 te
🥛 leche batido
🥤 refresco vaso
🍺 cerveza
🍷 vino
🍹 cocktail
🥂 brindis champan
🎃 calabaza halloween`) },
  { id: 'objetos', label: 'Objetos', icon: '🎁', items: e(`
🎁 regalo
🎈 globo
🎉 fiesta confeti
🎊 confeti
🏆 trofeo copa
🥇 medalla oro
🎮 videojuego mando
🧸 peluche oso
🎲 dado
🎨 pintura arte
🎭 teatro mascaras
🎸 guitarra
🎹 piano
🎺 trompeta
🥁 bateria tambor
🎤 microfono
🎧 auriculares
📷 camara foto
📱 movil telefono
💻 portatil ordenador
📺 television tele
⌚ reloj
💡 bombilla idea
🔦 linterna
🔑 llave
🔒 candado
🧲 iman
🔨 martillo
🔧 llave inglesa
⚙️ engranaje
🧹 escoba
🧺 cesta
🛏️ cama
🛋️ sofa
🚪 puerta
🪑 silla
🚽 inodoro
🛁 banera
🧴 crema
📚 libros
📦 paquete caja
💰 dinero bolsa
💎 diamante joya
💍 anillo
🕯️ vela
🧪 probeta quimica
💊 pastilla
⚽ futbol balon
🏀 baloncesto
🎾 tenis
🏓 pingpong
🎯 diana
🔮 bola cristal
🗡️ espada
🛡️ escudo
🏹 arco flecha
🎣 pesca cana`) },
  { id: 'viajes', label: 'Viajes', icon: '🚗', items: e(`
🚗 coche
🚕 taxi
🚌 autobus
🏎️ carreras
🚓 policia
🚑 ambulancia
🚒 bomberos
🚜 tractor
🛵 moto scooter
🚲 bicicleta bici
🚂 tren
✈️ avion
🚀 cohete espacio
🛸 ovni
🚁 helicoptero
⛵ velero barco
🚤 lancha
🛶 canoa
🚣 remo barca pedales
⚓ ancla
🏠 casa
🏡 casa jardin
🏰 castillo
🏯 castillo japones
⛺ tienda campana
🎡 noria
🎢 montana rusa
⛲ fuente
🗼 torre
🗽 estatua libertad
🏖️ playa sombrilla
⛱️ sombrilla
🏕️ camping
🌆 ciudad
🗺️ mapa
🧭 brujula`) },
  { id: 'simbolos', label: 'Símbolos', icon: '❤️', items: e(`
❤️ corazon amor rojo
🧡 corazon naranja
💛 corazon amarillo
💚 corazon verde
💙 corazon azul
💜 corazon morado
🖤 corazon negro
💔 corazon roto
💯 cien
✨ brillo magia
💥 explosion
💫 mareo estrellas
🎵 nota musica
✅ correcto
❌ error cruz
❓ pregunta
❗ exclamacion
💤 sueno zzz
♻️ reciclar
⚠️ aviso peligro
🚫 prohibido
🏁 meta bandera
🚩 bandera
🔔 campana
💣 bomba
🎰 tragaperras
🃏 comodin carta`) },
];

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Búsqueda por palabra clave (sin acentos ni mayúsculas) en todas las categorías. */
export function searchEmojis(query: string): string[] {
  const q = norm(query).trim();
  if (!q) return [];
  const out: string[] = [];
  for (const c of EMOJI_CATEGORIES) for (const [em, k] of c.items) if (norm(k).includes(q) && !out.includes(em)) out.push(em);
  return out;
}
