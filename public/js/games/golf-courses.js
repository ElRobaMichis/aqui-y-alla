// Los hoyos del minigolf: pura geometría (la usa el árbitro para simular; el dibujo vive en golf.js).
// Coordenadas en metros, x a la derecha, y hacia abajo. Cada hoyo mide w × h (más grandes que la
// pantalla: la cámara sigue a la pelota). Lo que puede tener cada hoyo está explicado en
// golf-physics.js. Además:
//   green   lo que se pinta de pasto (uno o varios polígonos)
//   decor   adornos que solo se dibujan

import { sinT, cosT } from './golf-physics.js';

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const box = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
/* polígono "redondo" de n lados (baches, estanques); sinT/cosT dan lo mismo en todos los navegadores */
const blob = (cx, cy, r, n = 10) => {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const k = i % 2 ? 0.9 : 1;
    pts.push([cx + cosT(i / n) * r * k, cy + sinT(i / n) * r * k]);
  }
  return pts;
};

export const HOLES = [
  {
    id: 'cuadra', name: 'La cuadra', place: 'Esquiva los baches y brinca la obra', par: 4, w: 8.4, h: 2.8,
    tip: 'Agarra vuelo en el tablón para brincar la zanja · ojo con el micro',
    green: [rect(0.3, 0.7, 8.1, 2.1)],
    walls: [box(0.3, 0.7, 8.1, 2.1), box(5.55, 0.7, 6.05, 0.98)],
    posts: [{ x: 7.6, y: 1.55, r: 0.07 }],
    zones: [
      { type: 'slope', poly: rect(1.75, 0.7, 1.9, 2.1), ax: -2.2, ay: 0 },
      { type: 'slope', poly: rect(1.9, 0.7, 2.05, 2.1), ax: 2.2, ay: 0 },
      { type: 'pit', why: 'pit', poly: blob(2.75, 1.4, 0.19) },
      { type: 'pit', why: 'pit', poly: blob(3.4, 0.98, 0.16) },
      { type: 'pit', why: 'pit', poly: blob(3.35, 1.86, 0.15) },
      { type: 'ramp', poly: rect(4.1, 1.1, 4.55, 1.7), dx: 1, dy: 0 },
      { type: 'pit', why: 'pit', poly: rect(4.55, 0.7, 5.05, 2.1) },
    ],
    movers: [{ kind: 'micro', solid: true, w: 1.05, h: 0.42, path: [[5.62, 1.86], [7.15, 1.86]], move: 2.6, wait: 1.4 }],
    tee: { x: 0.7, y: 1.4 }, cup: { x: 7.6, y: 1.15 },
    decor: [{ k: 'tope', x: 1.9 }, { k: 'obra', x0: 4.55, x1: 5.05 }, { k: 'vocho', x: 5.8, y: 0.84 }, { k: 'bote', x: 7.6, y: 1.55 }],
  },
  {
    id: 'metro', name: 'El metro', place: 'Pasa el torniquete y súbete al vagón', par: 4, w: 9.0, h: 2.6,
    tip: 'Si la pelota se queda en el vagón, te lleva a la otra estación · ¡no caigas a las vías!',
    green: [rect(0.3, 0.35, 3.6, 1.3), rect(5.4, 0.35, 8.7, 1.3)],
    walls: [
      [[1.3, 1.3], [0.3, 1.3], [0.3, 0.35], [3.6, 0.35], [3.6, 1.3], [3.4, 1.3]],
      [[6.0, 1.3], [5.4, 1.3], [5.4, 0.35], [8.7, 0.35], [8.7, 1.3], [8.1, 1.3]],
      [[1.1, 0.35], [1.1, 0.55]], [[1.1, 1.15], [1.1, 1.3]],
      [[7.85, 0.35], [7.85, 0.55]], [[7.85, 1.0], [7.85, 1.3]],
    ],
    posts: [{ x: 6.4, y: 0.7, r: 0.08 }],
    zones: [{ type: 'pit', why: 'tracks', poly: rect(0, 1.3, 9.0, 1.95) }],
    spinners: [
      { x: 1.1, y: 0.85, L: 0.27, arms: 3, t: 0.025, hub: 0.035, rev: 0.22 },
    ],
    platforms: [{
      kind: 'train', w: 2.3, h: 0.58, path: [[2.35, 1.58], [7.05, 1.58]], move: 4.5, wait: 3.5,
      rails: 'sew', doors: 'n', docks: [{ x: 2.35, y: 1.0 }, { x: 7.05, y: 1.0 }],
    }],
    tee: { x: 0.62, y: 0.65 }, cup: { x: 8.3, y: 0.75 },
    decor: [{ k: 'tunnelWall', x0: 3.6, x1: 5.4 }, { k: 'column', x: 6.4, y: 0.7 }, { k: 'salida', x: 7.85, y: 0.775 }, { k: 'sign', x: 2.0, y: 0.18, t: 'ANDÉN 1' }, { k: 'sign', x: 7.0, y: 0.18, t: 'ANDÉN 2' }],
  },
  {
    id: 'xochi', name: 'Xochimilco', place: 'Cruza el canal en trajinera', par: 3, w: 8.0, h: 3.0,
    tip: 'Tira cuando la trajinera esté en el muelle: si la pelota se queda arriba, te cruza',
    green: [rect(0.3, 0.35, 2.0, 2.65), rect(6.0, 0.35, 7.7, 2.65)],
    walls: [
      [[2.0, 0.55], [2.0, 0.35], [0.3, 0.35], [0.3, 2.65], [2.0, 2.65], [2.0, 2.45]], [[2.0, 1.15], [2.0, 1.85]],
      [[6.0, 0.55], [6.0, 0.35], [7.7, 0.35], [7.7, 2.65], [6.0, 2.65], [6.0, 2.45]], [[6.0, 1.15], [6.0, 1.85]],
    ],
    posts: [{ x: 6.85, y: 1.5, r: 0.11 }, { x: 0.9, y: 0.75, r: 0.11 }],
    zones: [
      { type: 'water', poly: rect(2.0, 0, 6.0, 3.0) },
      { type: 'petals', poly: rect(6.0, 1.15, 6.5, 1.85) },
    ],
    platforms: [
      { kind: 'trajinera', name: 'Lupita', w: 1.6, h: 0.6, path: [[2.8, 0.85], [5.2, 0.85]], move: 5, wait: 3.2, rails: 'ns', docks: [{ x: 1.62, y: 0.85 }, { x: 6.38, y: 0.85 }] },
      { kind: 'trajinera', name: 'Rosita', w: 1.6, h: 0.6, path: [[5.2, 2.15], [2.8, 2.15]], move: 5, wait: 3.2, offset: 3.4, rails: 'ns', docks: [{ x: 6.38, y: 2.15 }, { x: 1.62, y: 2.15 }] },
    ],
    tee: { x: 0.75, y: 1.5 }, cup: { x: 7.25, y: 2.05 },
    decor: [{ k: 'ahuejote', x: 6.85, y: 1.5 }, { k: 'ahuejote', x: 0.9, y: 0.75 }, { k: 'chinampa', x: 4.0, y: 1.5 },
      { k: 'flowers', x: 0.75, y: 2.3 }, { k: 'flowers', x: 7.3, y: 0.7 }, { k: 'dock', x: 2.0, y: 0.85 }, { k: 'dock', x: 2.0, y: 2.15 }, { k: 'dock', x: 6.0, y: 0.85 }, { k: 'dock', x: 6.0, y: 2.15 }],
  },
  {
    id: 'glorieta', name: 'La glorieta', place: 'El tráfico da vueltas alrededor del Ángel', par: 3, w: 6.4, h: 4.0,
    tip: 'Los coches giran sin parar: espera tu hueco · las fuentes son agua',
    green: [[[0.9, 0.35], [5.5, 0.35], [6.1, 0.95], [6.1, 3.05], [5.5, 3.65], [0.9, 3.65], [0.3, 3.05], [0.3, 0.95]]],
    walls: [[[0.9, 0.35], [5.5, 0.35], [6.1, 0.95], [6.1, 3.05], [5.5, 3.65], [0.9, 3.65], [0.3, 3.05], [0.3, 0.95], [0.9, 0.35]]],
    posts: [],
    zones: [
      { type: 'water', poly: blob(5.25, 1.05, 0.26) },
      { type: 'water', poly: blob(5.25, 2.95, 0.26) },
    ],
    spinners: [{ x: 3.2, y: 2.0, L: 1.5, arms: 2, t: 0.06, hub: 0.42, rev: 0.085, kind: 'traffic' }],
    tee: { x: 0.75, y: 2.0 }, cup: { x: 5.6, y: 2.0 },
    decor: [{ k: 'angel', x: 3.2, y: 2.0 }, { k: 'fountain', x: 5.25, y: 1.05 }, { k: 'fountain', x: 5.25, y: 2.95 }, { k: 'tree', x: 0.75, y: 0.95 }, { k: 'tree', x: 0.75, y: 3.05 }],
  },
  {
    id: 'piramide', name: 'La pirámide', place: 'El hoyo está arriba, dentro de la Piedra del Sol', par: 3, w: 7.0, h: 4.0,
    tip: 'La piedra gira: entra por un hueco · con poca fuerza no subes',
    green: [rect(0.3, 0.35, 6.7, 3.65)],
    walls: [box(0.3, 0.35, 6.7, 3.65)],
    posts: [{ x: 1.6, y: 1.0, r: 0.1 }, { x: 1.6, y: 3.0, r: 0.1 }, { x: 2.7, y: 1.72, r: 0.12 }, { x: 2.7, y: 2.28, r: 0.12 }],
    zones: pyramid(4.2, 2.0, [[1.35, 0.9, 1.35], [0.72, 0.46, 2.3]]),
    rings: [{ x: 4.2, y: 2.0, r: 0.3, t: 0.04, rev: 0.11, gaps: [{ a: 0, w: 0.075 }, { a: 0.5, w: 0.075 }] }],
    tee: { x: 0.75, y: 2.0 }, cup: { x: 4.2, y: 2.0 },
    decor: [{ k: 'pyramid', x: 4.2, y: 2.0 }, { k: 'serpent', x: 2.7, y: 1.72 }, { k: 'serpent', x: 2.7, y: 2.28 }, { k: 'nopal', x: 1.6, y: 1.0 }, { k: 'nopal', x: 1.6, y: 3.0 }],
  },
  {
    id: 'mercado', name: 'El mercado', place: 'Zigzag entre los puestos', par: 4, w: 8.0, h: 3.6,
    tip: 'Los ventiladores se prenden y se apagan · ojo con los diablitos y la harina',
    green: [rect(0.3, 0.35, 7.7, 3.25)],
    walls: [box(0.3, 0.35, 7.7, 3.25), box(2.0, 0.35, 2.4, 2.45), box(4.0, 1.15, 4.4, 3.25), box(6.0, 0.35, 6.4, 2.45)],
    posts: [],
    zones: [{ type: 'sand', poly: rect(6.4, 1.35, 7.7, 1.75) }],
    fans: [
      { box: [2.4, 1.35, 4.0, 2.25], ax: -1.5, ay: 0, on: 2.2, off: 2.2, at: { x: 4.0, y: 1.8 }, dir: [-1, 0] },
      { box: [4.4, 1.0, 6.0, 2.4], ax: 0, ay: -1.4, on: 2.6, off: 1.8, offset: 1.1, at: { x: 5.2, y: 2.45 }, dir: [0, -1] },
    ],
    movers: [
      { kind: 'diablito', solid: true, w: 0.34, h: 0.3, path: [[1.4, 1.2], [1.4, 2.85]], move: 2.4, wait: 0.6 },
      { kind: 'diablito', solid: true, w: 0.3, h: 0.34, path: [[2.75, 2.85], [3.65, 2.85]], move: 1.6, wait: 0.9, offset: 0.7 },
    ],
    tee: { x: 0.75, y: 0.75 }, cup: { x: 7.15, y: 0.85 },
    decor: [{ k: 'stall', x0: 2.0, y0: 0.35, x1: 2.4, y1: 2.45, c: 0 }, { k: 'stall', x0: 4.0, y0: 1.15, x1: 4.4, y1: 3.25, c: 1 }, { k: 'stall', x0: 6.0, y0: 0.35, x1: 6.4, y1: 2.45, c: 2 }, { k: 'sacks', x0: 6.4, y0: 1.35, x1: 7.7, y1: 1.75 }],
  },
  {
    id: 'lucha', name: 'Lucha libre', place: 'Las cuerdas del ring te regresan con todo', par: 3, w: 6.4, h: 4.2,
    tip: 'Dos luchadores cuidan el hoyo · el réferi y las sillas rebotan fuerte',
    green: [rect(0.9, 0.6, 5.5, 3.6)],
    walls: [{ pts: box(0.9, 0.6, 5.5, 3.6), e: 1.02 }],
    posts: [
      { x: 3.0, y: 2.1, r: 0.14, e: 1.1 },
      { x: 2.0, y: 1.2, r: 0.13, e: 1.1 }, { x: 3.3, y: 3.0, r: 0.13, e: 1.1 },
      { x: 0.9, y: 0.6, r: 0.08, e: 0.5 }, { x: 5.5, y: 0.6, r: 0.08, e: 0.5 },
      { x: 0.9, y: 3.6, r: 0.08, e: 0.5 }, { x: 5.5, y: 3.6, r: 0.08, e: 0.5 },
    ],
    zones: [],
    movers: [
      { kind: 'luchador', c: 0, solid: true, w: 0.42, h: 0.42, path: [[4.4, 0.85], [4.4, 1.95]], move: 0.9, wait: 0.25 },
      { kind: 'luchador', c: 1, solid: true, w: 0.42, h: 0.42, path: [[4.25, 1.6], [5.2, 1.6]], move: 0.8, wait: 0.25, offset: 0.5 },
    ],
    tee: { x: 1.3, y: 3.2 }, cup: { x: 5.05, y: 1.0 },
    decor: [{ k: 'ring', x0: 0.9, y0: 0.6, x1: 5.5, y1: 3.6 }, { k: 'referee', x: 3.0, y: 2.1 }, { k: 'silla', x: 2.0, y: 1.2 }, { k: 'silla', x: 3.3, y: 3.0 }],
  },
  {
    id: 'muertos', name: 'Día de muertos', place: 'El portal te lleva al otro lado de la ofrenda', par: 3, w: 7.6, h: 3.4,
    tip: 'El portal cambia de salida cada 2 segundos · los pétalos frenan',
    green: [rect(0.3, 0.35, 3.6, 3.05), rect(4.0, 0.35, 7.3, 3.05)],
    walls: [box(0.3, 0.35, 7.3, 3.05), box(3.6, 0.35, 4.0, 3.05)],
    posts: [{ x: 2.2, y: 1.25, r: 0.1 }, { x: 2.2, y: 2.15, r: 0.1 }, { x: 6.3, y: 1.25, r: 0.1 }],
    zones: [
      { type: 'petals', poly: rect(1.2, 0.35, 2.0, 1.2) },
      { type: 'petals', poly: rect(1.2, 2.2, 2.0, 3.05) },
      { type: 'petals', poly: rect(6.0, 1.9, 7.3, 2.4) },
    ],
    tunnels: [{
      in: { x: 3.05, y: 1.7, r: 0.12 }, every: 2, keep: 0.8,
      outs: [{ x: 4.4, y: 0.8, dir: [1, 0.35] }, { x: 4.4, y: 1.7, dir: [1, 0] }, { x: 4.4, y: 2.6, dir: [1, -0.35] }],
    }],
    movers: [{ kind: 'catrina', solid: true, w: 0.32, h: 0.32, path: [[5.25, 0.75], [5.25, 2.65]], move: 2.6, wait: 0.5 }],
    tee: { x: 0.75, y: 1.7 }, cup: { x: 6.75, y: 0.85 },
    decor: [{ k: 'portal', x: 3.05, y: 1.7 }, { k: 'ofrenda', x0: 3.6, y0: 0.35, x1: 4.0, y1: 3.05 }, { k: 'exit', x: 4.4, y: 0.8 }, { k: 'exit', x: 4.4, y: 1.7 }, { k: 'exit', x: 4.4, y: 2.6 },
      { k: 'calavera', x: 2.2, y: 1.25 }, { k: 'calavera', x: 2.2, y: 2.15 }, { k: 'calavera', x: 6.3, y: 1.25 }, { k: 'petals', x0: 1.2, y0: 0.35, x1: 2.0, y1: 1.2 }, { k: 'petals', x0: 1.2, y0: 2.2, x1: 2.0, y1: 3.05 }, { k: 'petals', x0: 6.0, y0: 1.9, x1: 7.3, y1: 2.4 }],
  },
  {
    id: 'zocalo', name: 'Pista de hielo', place: 'El Zócalo en diciembre', par: 4, w: 8.0, h: 3.6,
    tip: 'El hielo se cuartea con cada segundo que pasa una pelota encima (y más si se queda quieta): si se rompe, ¡al agua!',
    green: [rect(0.3, 0.35, 7.7, 3.25)],
    walls: [
      box(0.3, 0.35, 7.7, 3.25),
      [[2.2, 1.4], [2.2, 0.9], [5.8, 0.9], [5.8, 1.4]], [[2.2, 2.2], [2.2, 2.7], [5.8, 2.7], [5.8, 2.2]],
    ],
    posts: [{ x: 4.0, y: 1.8, r: 0.15 }],
    zones: [{ type: 'ice', life: 6, poly: rect(2.2, 0.9, 5.8, 2.7) }],
    movers: [
      { kind: 'elotes', solid: true, w: 0.4, h: 0.28, path: [[2.6, 0.62], [5.4, 0.62]], move: 3.2, wait: 0.8 },
      { kind: 'skater', solid: true, w: 0.2, h: 0.2, path: [[3.05, 1.15], [3.05, 2.45]], move: 1.4, wait: 0.2 },
      { kind: 'skater', solid: true, w: 0.2, h: 0.2, path: [[4.95, 2.45], [4.95, 1.15]], move: 1.7, wait: 0.2, offset: 0.6 },
    ],
    fans: [{ box: [2.2, 2.7, 5.8, 3.25], ax: -1.3, ay: 0, on: 2.0, off: 2.0, at: { x: 5.8, y: 2.98 }, dir: [-1, 0], kind: 'snow' }],
    tee: { x: 0.75, y: 1.8 }, cup: { x: 7.0, y: 1.8 },
    decor: [{ k: 'rink', x0: 2.2, y0: 0.9, x1: 5.8, y1: 2.7 }, { k: 'flag', x: 4.0, y: 1.8 }, { k: 'pine', x: 0.8, y: 0.8 }, { k: 'pine', x: 0.8, y: 2.8 }, { k: 'pine', x: 7.2, y: 0.8 }, { k: 'pine', x: 7.2, y: 2.8 }],
  },
];

/* pirámide escalonada: cada piso = [medio lado exterior, medio lado interior, pendiente] */
function pyramid(cx, cy, tiers) {
  const zones = [];
  for (const [o, i, s] of tiers) {
    zones.push(
      { type: 'slope', poly: [[cx - o, cy - o], [cx - i, cy - i], [cx - i, cy + i], [cx - o, cy + o]], ax: -s, ay: 0 },
      { type: 'slope', poly: [[cx + o, cy - o], [cx + o, cy + o], [cx + i, cy + i], [cx + i, cy - i]], ax: s, ay: 0 },
      { type: 'slope', poly: [[cx - o, cy - o], [cx + o, cy - o], [cx + i, cy - i], [cx - i, cy - i]], ax: 0, ay: -s },
      { type: 'slope', poly: [[cx - o, cy + o], [cx - i, cy + i], [cx + i, cy + i], [cx + o, cy + o]], ax: 0, ay: s },
    );
  }
  return zones;
}

export const HOLE_BY_ID = Object.fromEntries(HOLES.map((h) => [h.id, h]));
