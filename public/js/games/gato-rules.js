// Reglas del gato, compartidas por el servidor (árbitro) y el navegador (respuesta instantánea).
//
// Modos:
//  - 'classic': el de siempre. Tres en línea gana; tablero lleno = empate.
//  - 'inf'    : gato infinito. Cada quien tiene máximo 3 fichas; al poner la cuarta,
//               desaparece la más vieja (antes de revisar si ganaste). Nunca hay empate.

export const MODES = ['classic', 'inf'];
export const MAX_MARKS = 3;
export const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

/** Ronda nueva. `starter`: índice (0 = X, 1 = O) de quien empieza. */
export function newRound(mode, starter = 0) {
  return {
    mode: MODES.includes(mode) ? mode : 'classic',
    cells: Array(9).fill(-1),   // -1 vacía, 0 = X, 1 = O
    hist: [[], []],             // orden en que cada quien puso sus fichas (para el modo infinito)
    turn: starter,
    starter,
    winner: -1,
    line: null,
    draw: false,
    moves: 0,
    last: -1,
    vanished: -1,
  };
}

export const isOver = (r) => r.winner !== -1 || r.draw;

/** La ficha que desaparecerá cuando `who` ponga la siguiente (solo en modo infinito). */
export function nextToVanish(r, who) {
  if (r.mode !== 'inf' || isOver(r)) return -1;
  return r.hist[who].length >= MAX_MARKS ? r.hist[who][0] : -1;
}

/** Aplica una jugada. Devuelve { ok: true, round } o { ok: false, err }. No muta `r`. */
export function play(r, who, cell) {
  if (isOver(r)) return { ok: false, err: 'over' };
  if (who !== r.turn) return { ok: false, err: 'turn' };
  if (!Number.isInteger(cell) || cell < 0 || cell > 8 || r.cells[cell] !== -1) return { ok: false, err: 'cell' };

  const n = {
    ...r,
    cells: r.cells.slice(),
    hist: [r.hist[0].slice(), r.hist[1].slice()],
    vanished: -1,
  };
  n.cells[cell] = who;
  n.hist[who].push(cell);
  if (n.mode === 'inf' && n.hist[who].length > MAX_MARKS) {
    const old = n.hist[who].shift();
    n.cells[old] = -1;
    n.vanished = old;
  }
  n.moves++;
  n.last = cell;

  const line = LINES.find((l) => l.every((i) => n.cells[i] === who));
  if (line) { n.winner = who; n.line = line; }
  else if (n.mode === 'classic' && n.cells.every((c) => c !== -1)) n.draw = true;
  else n.turn = 1 - who;
  return { ok: true, round: n };
}
