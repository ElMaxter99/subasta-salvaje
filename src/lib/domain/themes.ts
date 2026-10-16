/** Plantillas de temática: escena vacía inicial y catálogo de partida (contenido del producto, no datos de prueba). */
export interface ThemePreset {
  id: string;
  label: string;
  emoji: string;
  /** Descripción de la escena vacía inicial, usada en el prompt de generación. */
  emptyScene: string;
  items: { name: string; description: string; emoji: string }[];
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'house',
    label: 'Casa',
    emoji: '🏠',
    emptyScene: 'a bright empty modern house with bare walls and a bare floor, seen as a cutaway isometric cross-section',
    items: [
      { name: 'Piscina infinita', description: 'Piscina de borde infinito con agua turquesa.', emoji: '🏊' },
      { name: 'Sofá gigante', description: 'Un sofá enorme y mullido para toda la familia.', emoji: '🛋️' },
      { name: 'Chimenea de piedra', description: 'Chimenea rústica con el fuego encendido.', emoji: '🔥' },
      { name: 'Cine en casa', description: 'Pantalla enorme y butacas de cine.', emoji: '🎬' },
      { name: 'Jardín zen', description: 'Arena rastrillada, rocas y un pequeño bonsái.', emoji: '🎍' },
      { name: 'Cocina de chef', description: 'Cocina profesional con isla central.', emoji: '🍳' },
      { name: 'Biblioteca de roble', description: 'Estanterías hasta el techo llenas de libros.', emoji: '📚' },
      { name: 'Piano de cola', description: 'Un elegante piano de cola negro.', emoji: '🎹' },
      { name: 'Acuario gigante', description: 'Un acuario de pared con peces tropicales.', emoji: '🐠' },
      { name: 'Sala de videojuegos', description: 'Recreativas, neones y puf gigante.', emoji: '🕹️' },
      { name: 'Helipuerto en el tejado', description: 'Helipuerto con un helicóptero aparcado.', emoji: '🚁' },
      { name: 'Tobogán interior', description: 'Un tobogán de colores de planta a planta.', emoji: '🛝' },
    ],
  },
  {
    id: 'island',
    label: 'Isla desierta',
    emoji: '🏝️',
    emptyScene: 'a small empty deserted tropical island with white sand, a few palm trees and clear water, seen from above at an angle',
    items: [
      { name: 'Cabaña sobre el agua', description: 'Bungalow de madera sobre pilotes.', emoji: '🛖' },
      { name: 'Muelle con barco', description: 'Un muelle de madera y un velero.', emoji: '⛵' },
      { name: 'Volcán', description: 'Un volcán humeante en el centro de la isla.', emoji: '🌋' },
      { name: 'Cascada', description: 'Una cascada que cae a una laguna.', emoji: '💦' },
      { name: 'Faro', description: 'Un faro blanco y rojo en la punta.', emoji: '🗼' },
      { name: 'Chiringuito', description: 'Bar de playa con sombrillas y hamacas.', emoji: '🍹' },
      { name: 'Tesoro pirata', description: 'Un cofre del tesoro semienterrado.', emoji: '💰' },
      { name: 'Dinosaurio amistoso', description: 'Un diplodocus paseando por la playa.', emoji: '🦕' },
      { name: 'Observatorio', description: 'Una cúpula con un gran telescopio.', emoji: '🔭' },
      { name: 'Pista de aterrizaje', description: 'Una avioneta en una pista de hierba.', emoji: '🛩️' },
    ],
  },
  {
    id: 'spaceship',
    label: 'Nave espacial',
    emoji: '🚀',
    emptyScene: 'an empty spaceship interior bay with bare metal floor, plain panels and a big window showing stars',
    items: [
      { name: 'Cúpula de cultivo', description: 'Un invernadero con plantas y luz solar artificial.', emoji: '🌱' },
      { name: 'Piscina de gravedad cero', description: 'Esferas de agua flotando.', emoji: '💧' },
      { name: 'Robot mayordomo', description: 'Un robot amable con bandeja.', emoji: '🤖' },
      { name: 'Cañón láser', description: 'Un cañón de defensa en el casco.', emoji: '🔫' },
      { name: 'Sala de máquinas', description: 'Un reactor brillante y tuberías.', emoji: '⚙️' },
      { name: 'Mascota alienígena', description: 'Una criatura peluda y simpática.', emoji: '👽' },
      { name: 'Mapa estelar holográfico', description: 'Un mapa de galaxias en 3D.', emoji: '🌌' },
      { name: 'Cafetería espacial', description: 'Una barra con cafeteras futuristas.', emoji: '☕' },
      { name: 'Cápsula de escape', description: 'Una cápsula lista para despegar.', emoji: '🛟' },
      { name: 'Trono del capitán', description: 'Un sillón de mando imponente.', emoji: '💺' },
    ],
  },
  {
    id: 'castle',
    label: 'Castillo',
    emoji: '🏰',
    emptyScene: 'an empty undecorated medieval castle courtyard and great hall with plain stone walls and floor',
    items: [
      { name: 'Foso con cocodrilos', description: 'Un foso lleno de agua y cocodrilos.', emoji: '🐊' },
      { name: 'Dragón mascota', description: 'Un pequeño dragón verde.', emoji: '🐉' },
      { name: 'Salón del trono', description: 'Trono dorado y alfombra roja.', emoji: '👑' },
      { name: 'Armería', description: 'Espadas, escudos y armaduras.', emoji: '⚔️' },
      { name: 'Torre del mago', description: 'Una torre con luces mágicas.', emoji: '🔮' },
      { name: 'Banquete real', description: 'Una mesa larguísima llena de comida.', emoji: '🍗' },
      { name: 'Establos con unicornio', description: 'Un unicornio blanco en el establo.', emoji: '🦄' },
      { name: 'Mazmorra', description: 'Celdas, cadenas y antorchas.', emoji: '⛓️' },
      { name: 'Catapulta', description: 'Una catapulta en la muralla.', emoji: '🪨' },
      { name: 'Jardín de rosas', description: 'Un laberinto de rosales.', emoji: '🌹' },
    ],
  },
  {
    id: 'shop',
    label: 'Local comercial',
    emoji: '🏪',
    emptyScene: 'an empty commercial shop space with bare walls, a plain floor and large shop-front windows',
    items: [
      { name: 'Escaparate de neón', description: 'Un letrero y luces de neón llamativos.', emoji: '💡' },
      { name: 'Mostrador de madera', description: 'Un mostrador artesanal con caja registradora.', emoji: '🧾' },
      { name: 'Máquina de café', description: 'Una cafetera italiana enorme.', emoji: '☕' },
      { name: 'Estanterías de colores', description: 'Estanterías con productos coloridos.', emoji: '🗄️' },
      { name: 'Gato de la suerte', description: 'Un gato dorado que saluda.', emoji: '🐱' },
      { name: 'Zona de juegos', description: 'Un rincón con puf y videojuegos.', emoji: '🎮' },
      { name: 'Árbol interior', description: 'Un árbol grande en el centro del local.', emoji: '🌳' },
      { name: 'Cinta transportadora de sushi', description: 'Una cinta con platitos de sushi.', emoji: '🍣' },
    ],
  },
  {
    id: 'free',
    label: 'Libre',
    emoji: '✨',
    emptyScene: 'an empty open scene ready to be decorated, with a plain background and a clear central area',
    items: [
      { name: 'Objeto misterioso', description: 'Algo extraño que brilla.', emoji: '🎁' },
      { name: 'Animal inesperado', description: 'Un animal que nadie esperaba ver aquí.', emoji: '🦒' },
      { name: 'Máquina absurda', description: 'Una máquina de Rube Goldberg.', emoji: '🛠️' },
      { name: 'Planta gigante', description: 'Una planta enorme y exótica.', emoji: '🪴' },
      { name: 'Instrumento musical', description: 'Un instrumento enorme y llamativo.', emoji: '🎺' },
      { name: 'Vehículo extravagante', description: 'Un vehículo imposible.', emoji: '🛸' },
    ],
  },
];

export function getThemePreset(id: string): ThemePreset | undefined {
  return THEME_PRESETS.find((t) => t.id === id);
}

/** Descripción de la escena vacía para una temática (preset o texto libre). */
export function emptySceneFor(theme: string): string {
  const preset = getThemePreset(theme);
  if (preset) return preset.emptyScene;
  return `an empty ${theme} scene, undecorated and ready to be filled with objects`;
}

export function themeLabel(theme: string): string {
  return getThemePreset(theme)?.label ?? theme;
}
