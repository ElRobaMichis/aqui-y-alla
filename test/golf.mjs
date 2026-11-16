// Minigolf: física determinista, reglas, mecánicas, y que cada hoyo se pueda terminar.
//   node test/golf.mjs
// Las "soluciones" (test/golf-solutions.json) las saca un robot con test/golf-tune.mjs: aquí se
// repiten golpe por golpe con las reglas del juego, así que si alguien cambia un hoyo o la física
// sin volver a correr el robot, esta prueba lo avisa.
import { readFileSync } from 'node:fs';
import { HOLES, HOLE_BY_ID } from '../public/js/games/golf-courses.js';
import { simulate, inPoly, sinT, cosT, travel, iceCount, R } from '../public/js/games/golf-physics.js';
import { newRound, play, isOver, totalOf, MAX_STROKES } from '../public/js/games/golf-rules.js';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('✗ ' + msg); } };
const inGreen = (h, x, y) => h.green.some((p) => inPoly(x, y, p));
const wet = (h, x, y) => (h.zones || []).some((z) => (z.type === 'water' || z.type === 'pit') && inPoly(x, y, z.poly));

// ── el seno propio (para lo que gira) se parece al de verdad
{
  let worst = 0;
  for (let u = -3; u < 3; u += 0.0137) worst = Math.max(worst, Math.abs(sinT(u) - Math.sin(u * Math.PI * 2)), Math.abs(cosT(u) - Math.cos(u * Math.PI * 2)));
  ok(worst < 1e-6, `sinT/cosT se alejan ${worst}`);
}

// ── geometría de cada hoyo
for (const h of HOLES) {
  ok(h.w > 4 && h.h > 2, `${h.id}: sin tamaño`);
  ok(inGreen(h, h.tee.x, h.tee.y) && !wet(h, h.tee.x, h.tee.y), `${h.id}: la salida no está en el pasto`);
  ok(inGreen(h, h.cup.x, h.cup.y) && !wet(h, h.cup.x, h.cup.y), `${h.id}: el hoyo no está en el pasto`);
  for (const w of h.walls) for (const [x, y] of w.pts || w) ok(x >= 0 && y >= 0 && x <= h.w && y <= h.h, `${h.id}: pared fuera del hoyo (${x}, ${y})`);
  for (const pf of h.platforms || []) for (const d of pf.docks) ok(inGreen(h, d.x, d.y) && !wet(h, d.x, d.y), `${h.id}: un muelle no está en tierra`);
  // una pelota quieta en la salida no debe moverse sola
  const s = simulate(h, h.tee, { dx: 1, dy: 0, power: 0.02 }, 0);
  ok(s.end === 'stop' && Math.hypot(s.x - h.tee.x, s.y - h.tee.y) < 0.2, `${h.id}: un toquecito desde la salida no se queda cerca`);
  // ni de un golpe con fuerza: derecho al hoyo con fuerza máxima no entra (en 60 momentos distintos)
  const dx = h.cup.x - h.tee.x, dy = h.cup.y - h.tee.y, l = Math.hypot(dx, dy);
  let aces = 0;
  for (let k = 0; k < 60; k++) for (const p of [1, 0.8]) if (simulate(h, h.tee, { dx: dx / l, dy: dy / l, power: p }, k * 0.731).end === 'cup') aces++;
  ok(aces === 0, `${h.id}: el tiro directo con fuerza entra ${aces} de 120 veces`);
}
console.log('✓ geometría');

// ── determinismo: el mismo tiro da exactamente lo mismo (con todo lo que se mueve)
for (const h of HOLES) {
  const a = simulate(h, h.tee, { dx: 0.8, dy: -0.6, power: 0.9 }, 12.345, [0.5]);
  const b = simulate(h, h.tee, { dx: 0.8, dy: -0.6, power: 0.9 }, 12.345, [0.5]);
  ok(a.x === b.x && a.y === b.y && a.n === b.n && a.end === b.end && a.events.length === b.events.length, `${h.id}: la simulación no es determinista`);
}
console.log('✓ determinista');

// ── cada hoyo se puede terminar: se repiten las soluciones del robot con las reglas del juego
const SOL = JSON.parse(readFileSync(new URL('./golf-solutions.json', import.meta.url), 'utf8'));
for (const h of HOLES) {
  const sol = SOL[h.id];
  ok(sol, `${h.id}: no hay solución guardada (corre: node test/golf-tune.mjs ${h.id})`);
  if (!sol) continue;
  let r = newRound('9', 0);
  r.hole = HOLES.indexOf(h);
  r.balls = [{ ...h.tee, in: false }, { ...h.tee, in: true }]; // solo juega el asiento 0
  r.wear = Array(iceCount(h)).fill(0);
  let strokes = 0;
  for (const [dx, dy, power, ph] of sol) {
    const res = play(r, 0, { shot: { dx, dy, power }, ph });
    if (!res.ok) { ok(false, `${h.id}: golpe rechazado (${res.err})`); break; }
    r = res.round; strokes = res.round.last.strokes;
    if (res.sim.end === 'cup') break;
  }
  const done = r.hole !== HOLES.indexOf(h) || r.done || r.balls[0].in;
  ok(done && strokes <= h.par, `${h.id}: la solución ya no entra (${strokes} golpes) — vuelve a correr el robot`);
}
console.log('✓ todos los hoyos se pueden terminar');

// ── mecánicas
{
  // el vagón: una pelota que se queda adentro viaja a la otra estación y brinca al andén
  const h = HOLE_BY_ID.metro, pf = h.platforms[0];
  let t = 0; while (travel(pf, t).at !== 0 || travel(pf, t + 1.5).at !== 0) t += 0.05; // en la estación 1 por un rato
  const s = simulate(h, { x: 2.35, y: 1.12 }, { dx: 0, dy: 1, power: 0.22 }, t);
  const ev = s.events.map((e) => e.type);
  ok(ev.includes('board') && ev.includes('hop') && Math.abs(s.x - pf.docks[1].x) < 1e-9, `metro: el vagón no llevó la pelota (${ev.join(',')} → ${s.x.toFixed(2)})`);
  // sin vagón, a las vías
  let t2 = 0; while (travel(pf, t2).at !== 1) t2 += 0.05;
  const s2 = simulate(h, { x: 2.35, y: 1.12 }, { dx: 0, dy: 1, power: 0.22 }, t2);
  ok(s2.end === 'water' && s2.why === 'tracks', 'metro: sin vagón la pelota debía caer a las vías');
}
{
  // el hielo: quedarse quieta encima lo cuartea; a la larga se rompe
  const h = HOLE_BY_ID.zocalo, life = h.zones.find((z) => z.type === 'ice').life;
  let wear = [0], broke = false;
  for (let k = 0; k < 10 && !broke; k++) {
    const s = simulate(h, { x: 2.6, y: 1.8 }, { dx: 0, dy: 1, power: 0.03 }, 0, wear);
    wear = s.wear;
    broke = s.end === 'water' && s.why === 'ice';
  }
  ok(broke && wear[0] >= life, 'hielo: no se rompió con pelotas quietas encima');
  // ya roto, es agua
  const s = simulate(h, { x: 2.0, y: 1.8 }, { dx: 1, dy: 0, power: 0.4 }, 0, [life]);
  ok(s.end === 'water', 'hielo roto: debía ser agua');
}
{
  // el tablón: con vuelo salta la zanja; sin vuelo cae
  const h = HOLE_BY_ID.cuadra;
  const hi = simulate(h, { x: 3.8, y: 1.4 }, { dx: 1, dy: 0, power: 0.8 }, 0);
  const lo = simulate(h, { x: 3.8, y: 1.4 }, { dx: 1, dy: 0, power: 0.62 }, 0);
  ok(hi.events.some((e) => e.type === 'jump') && hi.end !== 'water' && hi.x > 5.05, 'tablón: el tiro fuerte debía brincar la zanja');
  ok(lo.end === 'water' && lo.why === 'pit', 'tablón: el tiro flojo debía caer a la zanja');
}
console.log('✓ vagón, hielo y tablón');

// ── reglas: una partida rapidita completa con tiros flojitos (llega al máximo de golpes)
{
  let r = newRound('3', 0, () => 0.42);
  ok(r.holes.length === 3, 'rapidito debería tener 3 hoyos');
  let guard = 0;
  while (!isOver(r) && guard++ < 200) {
    const res = play(r, r.turn, { shot: { dx: 0, dy: -1, power: 0.05 }, ph: 0 });
    ok(res.ok, 'jugada válida rechazada: ' + res.err);
    if (!res.ok) break;
    r = res.round;
  }
  ok(isOver(r), 'la partida no terminó');
  ok(totalOf(r, 0) === 3 * (MAX_STROKES + 1) && totalOf(r, 1) === 3 * (MAX_STROKES + 1), 'con tiros flojitos cada hoyo debería sumar el máximo');
  ok(r.winner === -1, 'empate esperado');
  const r2 = newRound('9', 1);
  ok(!play(r2, 0, { shot: { dx: 1, dy: 0, power: 0.5 } }).ok, 'aceptó jugar fuera de turno');
  ok(!play(r2, 1, { shot: { dx: 0, dy: 0, power: 0.5 } }).ok, 'aceptó un tiro sin dirección');
  console.log('✓ reglas');
}

// ── agua: castigo y vuelve a donde estaba (Xochimilco sin trajinera en el muelle)
{
  const r = newRound('9', 0);
  r.hole = HOLES.findIndex((h) => h.id === 'xochi');
  const h = HOLES[r.hole];
  r.balls = [0, 1].map(() => ({ ...h.tee, in: false }));
  const dx = 2.3 - h.tee.x, dy = 0.85 - h.tee.y, l = Math.hypot(dx, dy);
  const res = play(r, 0, { shot: { dx: dx / l, dy: dy / l, power: 0.6 }, ph: 6 });
  ok(res.ok && res.sim.end === 'water', 'ese tiro debía caer al canal');
  ok(res.round.strokes[0][r.hole] === 2 && res.round.balls[0].x === h.tee.x && res.round.last.why === 'water', 'agua: castigo y regresar a la salida');
  console.log('✓ agua');
}

console.log(fails ? `\n${fails} problema(s)` : '\nMinigolf bien ⛳');
process.exit(fails ? 1 : 0);
