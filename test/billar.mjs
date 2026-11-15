// Reglas de bola 8 sobre la física real: node test/billar.mjs
import assert from 'node:assert/strict';
import { TABLE } from '../public/js/games/billar-physics.js';
import { newRound, play, canPlaceCue, rack, groupOf } from '../public/js/games/billar-rules.js';

const { R, W, H } = TABLE;
const ok = (m) => console.log('✓ ' + m);
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

// rack
const rk = rack(rnd);
assert.equal(rk.length, 15);
for (let i = 0; i < rk.length; i++) for (let j = i + 1; j < rk.length; j++) {
  const d = Math.hypot(rk[i].x - rk[j].x, rk[i].y - rk[j].y);
  assert.ok(d >= 2 * R - 1e-9, `bolas ${rk[i].id} y ${rk[j].id} encimadas`);
}
const eight = rk.find((b) => b.id === 8);
assert.ok(Math.abs(eight.y - TABLE.foot.y) < 1e-6, 'la 8 va al centro');
const back = rk.filter((b) => Math.abs(b.x - rk.reduce((m, q) => Math.max(m, q.x), 0)) < 1e-6);
const corners = [back[0], back[back.length - 1]].map((b) => groupOf(b.id));
assert.notEqual(corners[0], corners[1], 'esquinas de atrás: una lisa y una rayada');
ok('triángulo: 15 bolas sin encimarse, 8 al centro, esquinas mixtas');

// saque
const r0 = newRound(0, rnd);
assert.equal(r0.hand, 'kitchen');
assert.ok(!canPlaceCue(r0, TABLE.headX + 0.1, H / 2), 'en el saque no se puede poner la blanca pasando la línea');
assert.ok(canPlaceCue(r0, TABLE.headX - 0.2, H / 2));
const t0 = performance.now();
const br = play(r0, 0, { shot: { dx: 1, dy: 0, power: 1, sx: 0, sy: 0 }, cue: { x: TABLE.headX - 0.2, y: H / 2 } });
const ms = performance.now() - t0;
assert.ok(br.ok, br.err);
assert.equal(br.round.isBreak, false);
assert.ok(br.round.groups.every((g) => g === null), 'tras el saque la mesa sigue abierta');
assert.ok(br.round.balls.every((b) => b.x >= 0 && b.x <= W && b.y >= 0 && b.y <= H));
ok(`saque válido (${ms.toFixed(1)} ms simulando + reglas); turno → ${br.round.turn === 0 ? 'sigue' : 'cambia'}; metidas: [${br.round.down}]`);
assert.equal(play(r0, 1, { shot: { dx: 1, dy: 0, power: 1 }, cue: { x: 0.3, y: H / 2 } }).err, 'turn');
ok('fuera de turno: rechazado');

// mesa a la medida para casos concretos
function table(balls, extra = {}) {
  return { ...newRound(0, rnd), balls, isBreak: false, hand: null, ...extra };
}
const toward = (from, to) => { const dx = to.x - from.x, dy = to.y - from.y, l = Math.hypot(dx, dy); return { dx: dx / l, dy: dy / l }; };
const pk = TABLE.pockets[5]; // abajo a la derecha
const u = toward({ x: pk.x - 1, y: pk.y - 1 }, pk);
const objAt = (dist) => ({ x: pk.x - u.dx * dist, y: pk.y - u.dy * dist });

// meter una lisa con mesa abierta asigna grupos y se sigue tirando
{
  const o = objAt(0.35), c = { x: o.x - u.dx * 0.35, y: o.y - u.dy * 0.35 };
  const r = table([{ id: 0, ...c }, { id: 3, ...o }, { id: 12, x: 0.5, y: 0.3 }, { id: 8, x: 0.6, y: 0.9 }]);
  const res = play(r, 0, { shot: { ...toward(c, o), power: 0.45, sx: 0, sy: -0.7 } });
  assert.ok(res.ok, res.err);
  assert.deepEqual(res.round.down, [3], 'entró la 3');
  assert.equal(res.round.groups[0], 'solids');
  assert.equal(res.round.groups[1], 'stripes');
  assert.equal(res.round.turn, 0, 'sigue tirando');
  assert.equal(res.round.last.foul, null);
  ok('mesa abierta: meter la 3 asigna lisas y repite turno');
}

// meter la blanca es falta: bola en mano para el otro
{
  const c = objAt(0.4);
  const r = table([{ id: 0, ...c }, { id: 3, x: 0.5, y: 0.3 }, { id: 12, x: 0.6, y: 0.9 }, { id: 8, x: 1.2, y: 0.6 }]);
  const res = play(r, 0, { shot: { ...u, power: 0.5, sx: 0, sy: 0 } });
  assert.ok(res.ok);
  assert.equal(res.round.last.foul, 'metiste la blanca');
  assert.equal(res.round.turn, 1);
  assert.equal(res.round.hand, 'table');
  assert.ok(!res.round.balls.some((b) => b.id === 0), 'la blanca sale de la mesa');
  ok('meter la blanca: falta y bola en mano para el otro');
}

// no tocar nada es falta
{
  const r = table([{ id: 0, x: 0.6, y: 0.6 }, { id: 3, x: 2.0, y: 1.0 }, { id: 8, x: 2.1, y: 0.3 }]);
  const res = play(r, 0, { shot: { dx: -1, dy: 0, power: 0.15, sx: 0, sy: 0 } });
  assert.equal(res.round.last.foul, 'no tocaste ninguna bola');
  assert.equal(res.round.turn, 1);
  ok('no tocar ninguna bola: falta');
}

// tocar primero una bola del otro es falta
{
  const o = objAt(0.35), c = { x: o.x - u.dx * 0.35, y: o.y - u.dy * 0.35 };
  const r = table([{ id: 0, ...c }, { id: 12, ...o }, { id: 3, x: 0.5, y: 0.3 }, { id: 8, x: 0.6, y: 0.9 }], { groups: ['solids', 'stripes'] });
  const res = play(r, 0, { shot: { ...toward(c, o), power: 0.45, sx: 0, sy: -0.7 } });
  assert.equal(res.round.last.foul, 'tocaste primero una bola del otro');
  assert.equal(res.round.turn, 1);
  ok('tocar primero una rayada siendo de lisas: falta (y la rayada metida cuenta para el otro)');
}

// meter la 8 antes de tiempo pierde; con el grupo limpio, gana
{
  const o = objAt(0.35), c = { x: o.x - u.dx * 0.35, y: o.y - u.dy * 0.35 };
  const balls = [{ id: 0, ...c }, { id: 8, ...o }, { id: 3, x: 0.5, y: 0.3 }];
  const early = play(table(balls, { groups: ['solids', 'stripes'] }), 0, { shot: { ...toward(c, o), power: 0.45, sx: 0, sy: -0.7 } });
  assert.equal(early.round.winner, 1, 'pierde quien mete la 8 antes de tiempo');
  const down = [1, 2, 3, 4, 5, 6, 7];
  const clean = play(table(balls.filter((b) => b.id !== 3), { groups: ['solids', 'stripes'], down }), 0, { shot: { ...toward(c, o), power: 0.45, sx: 0, sy: -0.7 } });
  assert.equal(clean.round.winner, 0, 'gana quien mete la 8 al final');
  ok('la 8: antes de tiempo pierdes, al final ganas');
}

// bola en mano: no se puede poner encima de otra bola
{
  const r = table([{ id: 3, x: 1, y: 0.6 }], { hand: 'table' });
  assert.ok(!canPlaceCue(r, 1 + R, 0.6));
  assert.ok(canPlaceCue(r, 1 + 3 * R, 0.6));
  assert.equal(play(r, 0, { shot: { dx: 1, dy: 0, power: 0.3 }, cue: { x: 1 + R, y: 0.6 } }).err, 'cue');
  ok('bola en mano: lugares ocupados rechazados');
}

console.log('\nReglas de billar ♥');
