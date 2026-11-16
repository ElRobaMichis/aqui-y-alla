// Reglas del minigolf, compartidas por el árbitro (líder) y los dos navegadores.
//
//  - Los dos juegan el mismo hoyo, alternando golpes (cada quien su pelota; no chocan entre sí).
//  - Quien ya metió la suya espera; el otro sigue tirando.
//  - Agua: un golpe de castigo y la pelota vuelve a donde estaba.
//  - Máximo 6 golpes por hoyo: si no entra, se apunta 7 y se pasa al siguiente.
//  - Gana quien termine el recorrido con menos golpes. Empate si quedan iguales.
//  - Cada hoyo lo empieza alguien distinto.

import { HOLES, HOLE_BY_ID } from './golf-courses.js';
import { simulate, R } from './golf-physics.js';

export const MODES = ['9', '3'];
export const MAX_STROKES = 6;
export const PHASE_SPAN = 1000; // el vaivén de los obstáculos se mide en segundos dentro de este ciclo

const round6 = (v) => Math.round(v * 1e6) / 1e6;

function pickHoles(mode, rnd) {
  if (mode !== '3') return HOLES.map((h) => h.id);
  // rapidito: tres hoyos distintos al azar, en el orden del recorrido
  const idx = HOLES.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  return idx.slice(0, 3).sort((a, b) => a - b).map((i) => HOLES[i].id);
}

const teeBalls = (hole) => [0, 1].map(() => ({ x: hole.tee.x, y: hole.tee.y, in: false }));

export function newRound(mode = '9', starter = 0, rnd = Math.random) {
  const holes = pickHoles(mode, rnd);
  return {
    holes,
    hole: 0,
    balls: teeBalls(HOLE_BY_ID[holes[0]]),
    strokes: [holes.map(() => 0), holes.map(() => 0)],
    turn: starter,
    starter,
    winner: -1,
    done: false,
    shots: 0,
    last: null,
  };
}

export const isOver = (r) => r.done;
export const holeOf = (r) => HOLE_BY_ID[r.holes[Math.min(r.hole, r.holes.length - 1)]];
export const totalOf = (r, seat) => r.strokes[seat].reduce((a, b) => a + b, 0);
export const parOf = (r) => r.holes.reduce((a, id) => a + HOLE_BY_ID[id].par, 0);

function cleanShot(s) {
  const n = (v, lo, hi) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null);
  const dx = n(s?.dx, -1, 1), dy = n(s?.dy, -1, 1), power = n(s?.power, 0.02, 1);
  if (dx === null || dy === null || power === null) return null;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 0.5) return null;
  return { dx: dx / len, dy: dy / len, power };
}

/** Lo que hace falta para simular el tiro (el mismo cálculo en los dos teléfonos). */
export function prepare(r, seat, mv) {
  if (r.done) return { ok: false, err: 'over' };
  if (seat !== r.turn) return { ok: false, err: 'turn' };
  const shot = cleanShot(mv?.shot);
  if (!shot) return { ok: false, err: 'shot' };
  const ph = Number.isFinite(mv?.ph) ? Math.min(PHASE_SPAN, Math.max(0, mv.ph)) : 0;
  const ball = r.balls[seat];
  if (ball.in) return { ok: false, err: 'in' };
  return { ok: true, hole: holeOf(r), ball: { x: ball.x, y: ball.y }, shot, ph };
}

/**
 * Juega un golpe. mv = { shot: { dx, dy, power }, ph }
 * Devuelve { ok, round, sim } o { ok: false, err }. No muta `r`.
 */
export function play(r, seat, mv) {
  const prep = prepare(r, seat, mv);
  if (!prep.ok) return prep;
  const sim = simulate(prep.hole, prep.ball, prep.shot, prep.ph);
  return { ok: true, round: judge(r, seat, sim), sim };
}

function judge(r, seat, sim) {
  const h = r.hole;
  const n = {
    ...r,
    balls: r.balls.map((b) => ({ ...b })),
    strokes: r.strokes.map((s) => s.slice()),
    shots: r.shots + 1,
  };
  const other = 1 - seat;
  const ball = n.balls[seat];
  let strokes = n.strokes[seat][h] + 1;
  const last = { by: seat, end: sim.end, hole: h };
  if (sim.end === 'water') { strokes += 1; last.penalty = true; } // vuelve a donde estaba
  else if (sim.end === 'cup') { ball.x = HOLE_BY_ID[r.holes[h]].cup.x; ball.y = HOLE_BY_ID[r.holes[h]].cup.y; ball.in = true; }
  else { ball.x = round6(sim.x); ball.y = round6(sim.y); }
  if (!ball.in && strokes >= MAX_STROKES) { strokes = MAX_STROKES + 1; ball.in = true; last.maxed = true; }
  n.strokes[seat][h] = strokes;
  last.strokes = strokes;

  // ¿quién sigue?
  if (n.balls[other].in && ball.in) {
    // los dos terminaron este hoyo
    last.holeDone = true;
    if (h + 1 >= r.holes.length) {
      n.done = true;
      const a = totalOf(n, 0), b = totalOf(n, 1);
      n.winner = a < b ? 0 : b < a ? 1 : -1;
    } else {
      n.hole = h + 1;
      n.balls = teeBalls(HOLE_BY_ID[r.holes[h + 1]]);
      n.turn = (r.starter + h + 1) % 2;
    }
  } else n.turn = n.balls[other].in ? seat : other;
  n.last = last;
  return n;
}

export { R };
