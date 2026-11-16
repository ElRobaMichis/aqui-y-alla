// Los hoyos del minigolf: pura geometría (la usa el árbitro para simular; el dibujo vive en golf.js).
// Coordenadas en metros, x a la derecha, y hacia abajo. Todos miden 4.4 × 2.6; el área de juego
// deja un margen para la decoración.
//
//   walls   polilíneas (cerradas si repiten el primer punto); e = rebote (1.12 = cuerdas del ring)
//   posts   postes redondos { x, y, r }
//   zones   { type: 'sand' | 'petals' | 'ice' | 'water' | 'slope', poly, ax, ay }
//   movers  rectángulos que van y vienen entre path[0] y path[1]; solid = la pelota choca con ellos
//   tunnels entra por `in` y sale por `out` con dirección `dir`
//   green   lo que se pinta de pasto (uno o varios polígonos)
//   over    partes que se pintan ENCIMA de lo que se mueve (el puente: las trajineras pasan por debajo)

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const closed = (poly) => [...poly, poly[0]];
const FIELD = rect(0.3, 0.35, 4.1, 2.25);

export const W = 4.4, H = 2.6;

export const HOLES = [
  {
    id: 'cuadra', name: 'La cuadra', place: 'Una calle de la colonia', par: 2,
    tip: 'Los topes frenan si les pegas chueco',
    green: [rect(0.3, 0.85, 4.1, 1.75)],
    walls: [closed(rect(0.3, 0.85, 4.1, 1.75)), closed(rect(2.2, 1.45, 2.78, 1.75))],
    posts: [{ x: 3.2, y: 1.04, r: 0.07 }],
    zones: [
      { type: 'slope', poly: rect(1.55, 0.85, 1.7, 1.75), ax: -2.2, ay: 0 },
      { type: 'slope', poly: rect(1.7, 0.85, 1.85, 1.75), ax: 2.2, ay: 0 },
      { type: 'slope', poly: rect(2.95, 0.85, 3.1, 1.75), ax: -2.2, ay: 0 },
      { type: 'slope', poly: rect(3.1, 0.85, 3.25, 1.75), ax: 2.2, ay: 0 },
    ],
    tee: { x: 0.65, y: 1.3 }, cup: { x: 3.75, y: 1.3 },
    decor: [{ k: 'vocho', x: 2.49, y: 1.6 }, { k: 'bote', x: 3.2, y: 1.04 }, { k: 'tope', x: 1.7 }, { k: 'tope', x: 3.1 }],
  },
  {
    id: 'metro', name: 'El metro', place: 'Correspondencia: entra por la escalera de abajo', par: 3,
    tip: 'La pelota sale arriba con la fuerza que llevaba',
    green: [rect(0.3, 0.35, 4.1, 1.0), rect(0.3, 1.6, 4.1, 2.25)],
    walls: [closed(rect(0.3, 0.35, 4.1, 1.0)), closed(rect(0.3, 1.6, 4.1, 2.25))],
    posts: [{ x: 1.7, y: 1.75, r: 0.07 }, { x: 2.7, y: 2.1, r: 0.07 }, { x: 2.05, y: 0.5, r: 0.05 }, { x: 2.05, y: 0.85, r: 0.05 }],
    zones: [],
    movers: [{ kind: 'train', solid: false, w: 1.7, h: 0.44, path: [[-1.6, 1.3], [6.0, 1.3]], period: 14 }],
    tunnels: [{ in: { x: 3.82, y: 1.93, r: 0.11 }, out: { x: 0.62, y: 0.67 }, dir: [1, 0], keep: 0.9 }],
    tee: { x: 0.62, y: 1.93 }, cup: { x: 3.7, y: 0.67 },
    decor: [{ k: 'stairs', x: 3.82, y: 1.93 }, { k: 'stairsOut', x: 0.62, y: 0.67 }, { k: 'column', x: 1.7, y: 1.75 }, { k: 'column', x: 2.7, y: 2.1 }, { k: 'turnstile', x: 2.05 }],
  },
  {
    id: 'xochi', name: 'Xochimilco', place: 'Cruza el puentecito sin caerte al canal', par: 3,
    tip: 'Si cae al agua: un golpe de castigo y vuelves a donde tiraste',
    green: [rect(0.3, 0.35, 1.6, 2.25), rect(1.6, 1.1, 2.8, 1.5), rect(2.8, 0.35, 4.1, 2.25)],
    over: [rect(1.6, 1.1, 2.8, 1.5)],
    walls: [closed(FIELD)],
    posts: [{ x: 3.25, y: 1.5, r: 0.09 }],
    zones: [
      { type: 'water', poly: rect(1.6, 0.35, 2.8, 1.1) },
      { type: 'water', poly: rect(1.6, 1.5, 2.8, 2.25) },
    ],
    movers: [
      { kind: 'trajinera', solid: false, w: 0.36, h: 0.95, path: [[1.92, -0.7], [1.92, 3.3]], period: 18, name: 'Lupita', clip: rect(1.6, 0.35, 2.8, 2.25) },
      { kind: 'trajinera', solid: false, w: 0.36, h: 0.95, path: [[2.48, 3.3], [2.48, -0.7]], period: 23, name: 'Rosita', clip: rect(1.6, 0.35, 2.8, 2.25) },
    ],
    tee: { x: 0.65, y: 1.9 }, cup: { x: 3.7, y: 0.75 },
    decor: [{ k: 'ahuejote', x: 3.25, y: 1.5 }, { k: 'flowers', x: 0.9, y: 0.6 }, { k: 'flowers', x: 3.85, y: 2.0 }],
  },
  {
    id: 'glorieta', name: 'La glorieta', place: 'Dale la vuelta al monumento', par: 2,
    tip: 'Rebota en las orillas para rodearlo',
    green: [[[0.7, 0.35], [3.7, 0.35], [4.1, 0.75], [4.1, 1.85], [3.7, 2.25], [0.7, 2.25], [0.3, 1.85], [0.3, 0.75]]],
    walls: [closed([[0.7, 0.35], [3.7, 0.35], [4.1, 0.75], [4.1, 1.85], [3.7, 2.25], [0.7, 2.25], [0.3, 1.85], [0.3, 0.75]])],
    posts: [{ x: 2.2, y: 1.3, r: 0.42 }, { x: 2.2, y: 0.52, r: 0.1 }, { x: 2.2, y: 2.08, r: 0.1 }],
    zones: [],
    tee: { x: 0.62, y: 1.3 }, cup: { x: 3.8, y: 1.3 },
    decor: [{ k: 'angel', x: 2.2, y: 1.3 }, { k: 'planter', x: 2.2, y: 0.52 }, { k: 'planter', x: 2.2, y: 2.08 }],
  },
  {
    id: 'piramide', name: 'La pirámide', place: 'El hoyo está hasta arriba', par: 3,
    tip: 'Con poquita fuerza no sube; con mucha, se pasa del otro lado',
    green: [FIELD],
    walls: [closed(FIELD)],
    posts: [],
    zones: [
      { type: 'slope', poly: [[1.95, 0.5], [2.53, 1.08], [2.53, 1.52], [1.95, 2.1]], ax: -1.7, ay: 0 },
      { type: 'slope', poly: [[3.55, 0.5], [3.55, 2.1], [2.97, 1.52], [2.97, 1.08]], ax: 1.7, ay: 0 },
      { type: 'slope', poly: [[1.95, 0.5], [3.55, 0.5], [2.97, 1.08], [2.53, 1.08]], ax: 0, ay: -1.7 },
      { type: 'slope', poly: [[1.95, 2.1], [2.53, 1.52], [2.97, 1.52], [3.55, 2.1]], ax: 0, ay: 1.7 },
    ],
    tee: { x: 0.65, y: 1.3 }, cup: { x: 2.75, y: 1.3 },
    decor: [{ k: 'pyramid', x: 2.75, y: 1.3 }, { k: 'nopal', x: 0.7, y: 0.6 }, { k: 'nopal', x: 3.85, y: 2.0 }],
  },
  {
    id: 'mercado', name: 'El mercado', place: 'Zigzag entre los puestos', par: 3,
    tip: 'Ojo con los costales de harina: frenan muchísimo',
    green: [FIELD],
    walls: [closed(FIELD), closed(rect(1.35, 0.35, 1.65, 1.55)), closed(rect(2.75, 1.05, 3.05, 2.25))],
    posts: [],
    zones: [{ type: 'sand', poly: rect(1.65, 0.35, 2.75, 0.72) }],
    tee: { x: 0.65, y: 1.95 }, cup: { x: 3.6, y: 1.8 },
    decor: [{ k: 'stall', x0: 1.35, y0: 0.35, x1: 1.65, y1: 1.55, c: 0 }, { k: 'stall', x0: 2.75, y0: 1.05, x1: 3.05, y1: 2.25, c: 1 }, { k: 'sacks', x0: 1.65, y0: 0.35, x1: 2.75, y1: 0.72 }],
  },
  {
    id: 'lucha', name: 'Lucha libre', place: 'Las cuerdas del ring te regresan con todo', par: 2,
    tip: 'Usa las cuerdas: rebotan más fuerte que una pared',
    green: [rect(1.15, 0.4, 3.65, 2.2)],
    walls: [{ pts: closed(rect(1.15, 0.4, 3.65, 2.2)), e: 1.12 }],
    posts: [
      { x: 2.4, y: 1.3, r: 0.22, e: 0.9 },
      { x: 1.15, y: 0.4, r: 0.07, e: 0.5 }, { x: 3.65, y: 0.4, r: 0.07, e: 0.5 },
      { x: 1.15, y: 2.2, r: 0.07, e: 0.5 }, { x: 3.65, y: 2.2, r: 0.07, e: 0.5 },
    ],
    zones: [],
    tee: { x: 1.45, y: 1.9 }, cup: { x: 3.3, y: 0.72 },
    decor: [{ k: 'ring' }, { k: 'luchador', x: 2.4, y: 1.3 }],
  },
  {
    id: 'muertos', name: 'Día de muertos', place: 'Camino de cempasúchil hasta la ofrenda', par: 3,
    tip: 'Los pétalos frenan; las calaveritas estorban',
    green: [FIELD],
    walls: [closed(FIELD), closed(rect(3.35, 0.35, 4.1, 0.62))],
    posts: [{ x: 1.3, y: 1.55, r: 0.1 }, { x: 2.5, y: 1.25, r: 0.1 }, { x: 3.5, y: 1.05, r: 0.1 }],
    zones: [
      { type: 'petals', poly: rect(1.7, 0.35, 2.4, 1.05) },
      { type: 'petals', poly: rect(2.6, 1.55, 3.3, 2.25) },
    ],
    tee: { x: 0.6, y: 0.75 }, cup: { x: 3.75, y: 1.85 },
    decor: [{ k: 'petals', x0: 1.7, y0: 0.35, x1: 2.4, y1: 1.05 }, { k: 'petals', x0: 2.6, y0: 1.55, x1: 3.3, y1: 2.25 },
      { k: 'calavera', x: 1.3, y: 1.55 }, { k: 'calavera', x: 2.5, y: 1.25 }, { k: 'calavera', x: 3.5, y: 1.05 }, { k: 'ofrenda', x0: 3.35, y0: 0.35, x1: 4.1, y1: 0.62 }],
  },
  {
    id: 'zocalo', name: 'El Zócalo', place: 'Cuidado con el carrito de elotes', par: 3,
    tip: 'La plaza está tantito inclinada hacia abajo',
    green: [FIELD],
    walls: [closed(FIELD)],
    posts: [{ x: 2.2, y: 1.45, r: 0.16 }],
    zones: [{ type: 'slope', poly: FIELD, ax: 0, ay: 0.22 }],
    movers: [{ kind: 'elotes', solid: true, w: 0.38, h: 0.26, path: [[1.0, 0.82], [3.4, 0.82]], period: 7 }],
    tee: { x: 0.6, y: 1.95 }, cup: { x: 3.75, y: 0.65 },
    decor: [{ k: 'flag', x: 2.2, y: 1.45 }, { k: 'kiosk', x: 0.75, y: 0.6 }],
  },
];

export const HOLE_BY_ID = Object.fromEntries(HOLES.map((h) => [h.id, h]));
