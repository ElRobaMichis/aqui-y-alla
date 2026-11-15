// Reglas de bola 8 (versión casera, sin "cantar" tronera), compartidas por servidor y navegador.
//
//  - Saque: la blanca se coloca en la "cocina" (a la izquierda de la línea de cabecera).
//  - Mesa abierta hasta que alguien mete una bola después del saque: esa define su grupo
//    (lisas 1–7 o rayadas 9–15).
//  - Sigues tirando mientras metas bolas de tu grupo sin cometer falta.
//  - Faltas: meter la blanca, no tocar ninguna bola, o tocar primero una bola que no es tuya
//    (con mesa abierta, tocar primero la 8). Tras falta, el otro pone la blanca donde quiera.
//  - La 8 se mete al final: si la metes antes de tiempo o con falta, pierdes.
//    Si entra en el saque, se vuelve a colocar en el punto de pie.

import { TABLE, simulate } from './billar-physics.js';

export const MODES = ['8'];
export const SOLIDS = [1, 2, 3, 4, 5, 6, 7];
export const STRIPES = [9, 10, 11, 12, 13, 14, 15];
export const groupOf = (id) => (id >= 1 && id <= 7 ? 'solids' : id >= 9 ? 'stripes' : null);
export const GROUP_NAMES = { solids: 'lisas', stripes: 'rayadas' };

const EPS = 1.0004; // separación mínima en el triángulo para que no arranquen encimadas

function shuffle(a, rnd) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Triángulo de 15 bolas con la 8 al centro y una lisa y una rayada en las esquinas de atrás. */
export function rack(rnd = Math.random) {
  const { R, foot } = TABLE;
  const spots = [];
  for (let k = 0; k < 5; k++) {
    for (let j = 0; j <= k; j++) {
      spots.push({ x: foot.x + k * R * Math.sqrt(3) * EPS, y: foot.y + (j - k / 2) * 2 * R * EPS, k, j });
    }
  }
  const apexIdx = 0;
  const eightIdx = spots.findIndex((s) => s.k === 2 && s.j === 1);
  const cornerA = spots.findIndex((s) => s.k === 4 && s.j === 0);
  const cornerB = spots.findIndex((s) => s.k === 4 && s.j === 4);
  const solids = shuffle(SOLIDS.slice(), rnd), stripes = shuffle(STRIPES.slice(), rnd);
  const ids = Array(15).fill(0);
  ids[eightIdx] = 8;
  const flip = rnd() < 0.5;
  ids[cornerA] = flip ? solids.pop() : stripes.pop();
  ids[cornerB] = flip ? stripes.pop() : solids.pop();
  ids[apexIdx] = rnd() < 0.5 ? solids.pop() : stripes.pop();
  const rest = shuffle([...solids, ...stripes], rnd);
  for (let i = 0; i < 15; i++) if (!ids[i]) ids[i] = rest.pop();
  return spots.map((s, i) => ({ id: ids[i], x: round6(s.x), y: round6(s.y) }));
}

const round6 = (v) => Math.round(v * 1e6) / 1e6;

export function newRound(starter = 0, rnd = Math.random) {
  return {
    balls: [{ id: 0, x: round6(TABLE.headX - 0.25), y: TABLE.H / 2 }, ...rack(rnd)],
    down: [],               // bolas metidas, en orden
    turn: starter,
    starter,
    groups: [null, null],   // grupo de cada asiento
    hand: 'kitchen',        // blanca en mano: 'kitchen' (detrás de la línea), 'table' (donde sea) o null
    isBreak: true,
    winner: -1,
    reason: '',
    shots: 0,
    last: null,             // resumen del último tiro (para mensajes)
  };
}

export const isOver = (r) => r.winner !== -1;

/** ¿Se puede poner la blanca aquí? */
export function canPlaceCue(r, x, y) {
  const { R, W, H, headX } = TABLE;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  if (x < R || x > W - R || y < R || y > H - R) return false;
  if (r.hand === 'kitchen' && x > headX) return false;
  for (const p of TABLE.pockets) {
    const dx = x - p.x, dy = y - p.y;
    if (dx * dx + dy * dy < (p.r + R) * (p.r + R)) return false;
  }
  for (const b of r.balls) {
    if (b.id === 0) continue;
    const dx = x - b.x, dy = y - b.y;
    if (dx * dx + dy * dy < 4 * R * R * 1.0001) return false;
  }
  return true;
}

function cleanShot(s) {
  const n = (v, lo, hi) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null);
  const dx = n(s?.dx, -1, 1), dy = n(s?.dy, -1, 1), power = n(s?.power, 0.02, 1);
  const sx = n(s?.sx, -1, 1) ?? 0, sy = n(s?.sy, -1, 1) ?? 0;
  if (dx === null || dy === null || power === null) return null;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 0.5) return null;
  return { dx: dx / len, dy: dy / len, power, sx, sy };
}

/** Bolas sobre la mesa justo antes del tiro (con la blanca recién colocada si estaba en mano). */
export function prepare(r, mv) {
  const shot = cleanShot(mv?.shot);
  if (!shot) return { ok: false, err: 'shot' };
  let balls = r.balls;
  if (r.hand) {
    const cx = mv?.cue?.x, cy = mv?.cue?.y;
    if (!canPlaceCue(r, cx, cy)) return { ok: false, err: 'cue' };
    balls = [{ id: 0, x: cx, y: cy }, ...r.balls.filter((b) => b.id !== 0)];
  }
  return { ok: true, balls, shot };
}

/** Coloca la 8 en el punto de pie (o lo más cerca libre, hacia la banda de pie). */
function respotEight(balls) {
  const { R, foot, W } = TABLE;
  for (let x = foot.x; x < W - R; x += R / 4) {
    if (balls.every((b) => (b.x - x) ** 2 + (b.y - foot.y) ** 2 >= 4 * R * R * 1.0001)) return { id: 8, x: round6(x), y: foot.y };
  }
  return { id: 8, x: foot.x, y: foot.y };
}

/**
 * Juega un tiro. mv = { shot: { dx, dy, power, sx, sy }, cue?: { x, y } }
 * Devuelve { ok, round, sim } o { ok: false, err }. No muta `r`.
 */
export function play(r, seat, mv) {
  if (isOver(r)) return { ok: false, err: 'over' };
  if (seat !== r.turn) return { ok: false, err: 'turn' };
  const prep = prepare(r, mv);
  if (!prep.ok) return prep;
  const sim = simulate(prep.balls, prep.shot);
  return { ok: true, round: judge(r, seat, sim), sim };
}

function judge(r, seat, sim) {
  const other = 1 - seat;
  const n = { ...r, groups: r.groups.slice(), down: r.down.slice(), shots: r.shots + 1, isBreak: false };
  const potted = sim.events.filter((e) => e.type === 'pocket').map((e) => e.a);
  const scratch = potted.includes(0);
  const objects = potted.filter((id) => id !== 0);
  const eightIn = objects.includes(8);
  const mine = r.groups[seat];
  const myBallsLeftBefore = mine ? (mine === 'solids' ? SOLIDS : STRIPES).filter((id) => !r.down.includes(id)).length : 7;

  // ── falta
  let foul = null;
  if (scratch) foul = 'metiste la blanca';
  else if (sim.firstHit == null) foul = 'no tocaste ninguna bola';
  else if (mine) {
    const legalFirst = myBallsLeftBefore === 0 ? sim.firstHit === 8 : groupOf(sim.firstHit) === mine;
    if (!legalFirst) foul = myBallsLeftBefore === 0 ? 'había que tocar primero la 8' : 'tocaste primero una bola del otro';
  } else if (!r.isBreak && sim.firstHit === 8) foul = 'con mesa abierta no se toca primero la 8';

  // ── nuevas posiciones
  let balls = sim.final.filter((b) => !b.in).map((b) => ({ id: b.id, x: round6(b.x), y: round6(b.y) }));
  n.down.push(...objects.filter((id) => id !== 8 || !r.isBreak));

  n.last = { by: seat, potted: objects, scratch, foul, firstHit: sim.firstHit };

  // ── la 8
  if (eightIn) {
    if (r.isBreak) {
      balls = balls.filter((b) => b.id !== 8);
      balls.push(respotEight(balls));
      n.last.respot = true;
    } else {
      const cleared = mine && myBallsLeftBefore === 0;
      if (cleared && !foul) { n.winner = seat; n.reason = 'metió la 8'; }
      else { n.winner = other; n.reason = foul ? 'metió la 8 con falta' : 'metió la 8 antes de tiempo'; }
      n.balls = balls;
      n.hand = null;
      return n;
    }
  }

  // ── grupos: la primera bola metida tras el saque, sin falta, decide
  if (!mine && !r.isBreak && !foul) {
    const first = objects.find((id) => groupOf(id));
    if (first) {
      n.groups[seat] = groupOf(first);
      n.groups[other] = groupOf(first) === 'solids' ? 'stripes' : 'solids';
      n.last.assigned = n.groups[seat];
    }
  }

  // ── ¿quién sigue?
  const myGroup = n.groups[seat];
  const pottedMine = myGroup ? objects.some((id) => groupOf(id) === myGroup) : objects.some((id) => groupOf(id));
  if (foul) {
    n.turn = other;
    n.hand = r.isBreak && scratch ? 'kitchen' : 'table';
    balls = balls.filter((b) => b.id !== 0);
  } else {
    n.turn = pottedMine ? seat : other;
    n.hand = null;
  }
  n.balls = balls;
  return n;
}
