// Minigolf: física determinista, reglas, y que cada hoyo se pueda jugar.
//   node test/golf.mjs          (rápido: revisa todo y juega cada hoyo con un robot)
import { HOLES } from '../public/js/games/golf-courses.js';
import { simulate, inPoly, R, CUP_R } from '../public/js/games/golf-physics.js';
import { newRound, play, isOver, totalOf, MAX_STROKES } from '../public/js/games/golf-rules.js';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('✗ ' + msg); } };
const inGreen = (h, x, y) => h.green.some((p) => inPoly(x, y, p));
const inWater = (h, x, y) => (h.zones || []).some((z) => z.type === 'water' && inPoly(x, y, z.poly));

// ── geometría de cada hoyo
for (const h of HOLES) {
  ok(inGreen(h, h.tee.x, h.tee.y) && !inWater(h, h.tee.x, h.tee.y), `${h.id}: la salida no está en el pasto`);
  ok(inGreen(h, h.cup.x, h.cup.y) && !inWater(h, h.cup.x, h.cup.y), `${h.id}: el hoyo no está en el pasto`);
  // una pelota quieta en la salida no debe moverse sola
  const s = simulate(h, h.tee, { dx: 1, dy: 0, power: 0.02 }, 0);
  ok(s.end === 'stop' && Math.hypot(s.x - h.tee.x, s.y - h.tee.y) < 0.2, `${h.id}: un toquecito desde la salida no se queda cerca`);
}

// ── determinismo: el mismo tiro da exactamente lo mismo
{
  const h = HOLES.find((x) => x.id === 'zocalo');
  const a = simulate(h, h.tee, { dx: 0.8, dy: -0.6, power: 0.9 }, 12.345);
  const b = simulate(h, h.tee, { dx: 0.8, dy: -0.6, power: 0.9 }, 12.345);
  ok(a.x === b.x && a.y === b.y && a.n === b.n && a.end === b.end, 'la simulación no es determinista');
  console.log('✓ determinista');
}

// ── un robot juega cada hoyo: prueba direcciones y fuerzas y elige el mejor golpe
function bestShot(h, ball, ph) {
  let best = null;
  for (let a = 0; a < 360; a += 1.5) {
    const dx = Math.cos((a * Math.PI) / 180), dy = Math.sin((a * Math.PI) / 180);
    for (let p = 0.06; p <= 1.0001; p += 0.035) {
      const s = simulate(h, ball, { dx, dy, power: p }, ph);
      if (s.end === 'cup') return { dx, dy, power: p, d: 0, s };
      if (s.end === 'water') continue;
      const d = Math.hypot(s.x - h.cup.x, s.y - h.cup.y);
      if (!best || d < best.d) best = { dx, dy, power: p, d, s };
    }
  }
  return best;
}
const t0 = Date.now();
let totalBot = 0, totalPar = 0;
for (const h of HOLES) {
  let ball = { ...h.tee }, strokes = 0, inCup = false;
  while (!inCup && strokes < MAX_STROKES) {
    const b = bestShot(h, ball, strokes * 3.7);
    strokes++;
    if (!b) break;
    if (b.s.end === 'cup') inCup = true;
    else ball = { x: b.s.x, y: b.s.y };
  }
  totalBot += strokes; totalPar += h.par;
  const verdict = inCup && strokes <= h.par + 1;
  ok(verdict, `${h.id}: el robot no lo terminó razonablemente (${inCup ? strokes + ' golpes' : 'no entró'}, par ${h.par})`);
  console.log(`${verdict ? '✓' : '✗'} ${h.name.padEnd(16)} par ${h.par} · robot ${inCup ? strokes : 'no'}`);
}
console.log(`  (robot ${totalBot} vs par ${totalPar}, ${((Date.now() - t0) / 1000).toFixed(1)} s)`);

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
  // turno ajeno, pelota ya adentro, tiro inválido
  const r2 = newRound('9', 1);
  ok(!play(r2, 0, { shot: { dx: 1, dy: 0, power: 0.5 } }).ok, 'aceptó jugar fuera de turno');
  ok(!play(r2, 1, { shot: { dx: 0, dy: 0, power: 0.5 } }).ok, 'aceptó un tiro sin dirección');
  console.log('✓ reglas');
}

// ── agua: castigo y vuelve a donde estaba
{
  const r = newRound('9', 0);
  r.hole = HOLES.findIndex((h) => h.id === 'xochi');
  const h = HOLES[r.hole];
  r.balls = [0, 1].map(() => ({ ...h.tee, in: false }));
  const res = play(r, 0, { shot: { dx: 1, dy: -0.2, power: 0.6 } });
  ok(res.ok && res.sim.end === 'water', 'ese tiro debía caer al canal');
  ok(res.round.strokes[0][r.hole] === 2 && res.round.balls[0].x === h.tee.x, 'agua: castigo y regresar a la salida');
  console.log('✓ agua');
}

console.log(fails ? `\n${fails} problema(s)` : '\nMinigolf bien ⛳');
process.exit(fails ? 1 : 0);
