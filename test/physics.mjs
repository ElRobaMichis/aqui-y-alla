// Pruebas de la física del billar: node test/physics.mjs  (no necesita el servidor)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TABLE, PHYS, FRAME_DT, simulate, predict, strike } from '../public/js/games/billar-physics.js';

const { W, H, R } = TABLE;
// Las pruebas de comportamiento (bola muerta, corrido, retroceso…) están calibradas para esta
// escala de velocidad; la fuerza máxima del juego (PHYS.vMax) se puede ajustar sin romperlas.
const GAME_VMAX = PHYS.vMax;
PHYS.vMax = 8.5;
const ok = (msg) => console.log('✓ ' + msg);
const cm = (m) => (m * 100).toFixed(1) + ' cm';

// Rapidez (m/s) con la que sale la blanca pegando al centro con esa fuerza, y la fuerza que da una rapidez.
// Las pruebas calibradas piden VELOCIDADES reales (P(2.35) = "tira a 2.35 m/s"), así no dependen de la
// forma de la curva de fuerza ni de vMax.
const v0 = (power) => strike({ dx: 1, dy: 0, power, sx: 0, sy: 0 }).vx;
function P(v) {
  let lo = 0, hi = 1;
  for (let k = 0; k < 50; k++) { const mid = (lo + hi) / 2; if (v0(mid) < v) lo = mid; else hi = mid; }
  assert.ok(Math.abs(v0(lo) - v) < 1e-6, `ninguna fuerza da ${v} m/s`);
  return lo;
}

// Triángulo de 15 bolas pegadas, con la punta en el foot spot, y la blanca detrás de la línea de saque.
function rackBalls() {
  const balls = [{ id: 0, x: TABLE.headX - 0.1, y: H / 2 }];
  for (let row = 0, id = 1; row < 5; row++)
    for (let k = 0; k <= row; k++)
      balls.push({ id: id++, x: TABLE.foot.x + row * Math.sqrt(3) * R, y: H / 2 + (k - row / 2) * 2 * R });
  return balls;
}
const BREAK = { dx: 1, dy: 0, power: 1, sx: 0, sy: 0 };

// Posición / distancia rodada de la bola i en el cuadro f, y rapidez media en el 1/60 s anterior a ese
// cuadro (un solo cuadro de 1/240 s no alcanza: la distancia va en float32 y el redondeo metería ruido).
const at = (r, f, i) => { const o = (f * r.n + i) * 3; return { x: r.frames[o], y: r.frames[o + 1], roll: r.frames[o + 2] }; };
const spinAt = (r, f, i) => { const o = (f * r.n + i) * 3; return { x: r.spins[o], y: r.spins[o + 1], z: r.spins[o + 2] }; };
const F = (seconds) => Math.round(seconds / FRAME_DT);
const WIN = F(1 / 60);
const speed = (r, f, i) => (at(r, f, i).roll - at(r, f - WIN, i).roll) / (WIN * FRAME_DT);
const frameOf = (r, t) => Math.min(r.nFrames - 1, Math.ceil(t / FRAME_DT));
const rolled = (r, i) => at(r, r.nFrames - 1, i).roll;

// El saque en frío (primera llamada del proceso, sin JIT caliente) es el peor caso de tiempo.
const t0 = performance.now();
const brk = simulate(rackBalls(), BREAK);
const coldMs = performance.now() - t0;

// ───────── 0. Constantes dentro de lo publicado ─────────
// WPA: bola de 2¼" y 5½–6 oz. Dr. Dave (propiedades físicas): deslizamiento 0.15–0.4, rodadura
// 0.005–0.015 (mesas lentas de bar/casa llegan a ~0.02: Shepard, Marlow), giro vertical 5–15 rad/s²,
// bola-bola e 0.92–0.98.
{
  const inRange = (v, a, b, what) => assert.ok(v >= a && v <= b, `${what} = ${v}, fuera de [${a}, ${b}]`);
  assert.ok(Math.abs(2 * R - 0.05715) < 1e-9, 'diámetro de 2¼ pulgadas');
  inRange(PHYS.m, 0.156, 0.1701, 'masa de la bola (kg)');
  inRange(PHYS.muS, 0.15, 0.4, 'fricción deslizando');
  inRange(PHYS.muR, 0.005, 0.02, 'resistencia a la rodadura');
  inRange((2.5 * PHYS.muSp * PHYS.g) / R, 5, 15, 'frenado del giro vertical (rad/s²)');
  inRange(PHYS.eBall, 0.92, 0.98, 'restitución bola-bola');
  inRange(GAME_VMAX, 9, 13.5, 'saque (m/s): 20–30 mph');
  ok(`constantes dentro de lo publicado: bola de ${(PHYS.m * 1000).toFixed(0)} g y ${(2 * R * 1000).toFixed(2)} mm, paño con "velocidad de mesa" ${(1 / PHYS.muR).toFixed(0)} (rodadura ${PHYS.muR})`);
}

// ───────── 1. Determinismo y forma del resultado ─────────
{
  const src = readFileSync(new URL('../public/js/games/billar-physics.js', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');      // sin comentarios
  assert.equal(/Math\.(sin|cos|tan|asin|acos|atan2?|exp|pow|log\w*|hypot|cbrt|random)\b|\*\*|\bDate\b/.test(src), false,
    'el motor solo puede usar aritmética básica y sqrt/abs/min/max/floor');

  const shots = [[rackBalls(), BREAK], [rackBalls(), { dx: 0.98, dy: 0.199, power: 0.83, sx: -0.6, sy: 0.4 }]];
  for (const [balls, shot] of shots) {
    const before = JSON.stringify(balls);
    const a = simulate(balls, shot), b = simulate(JSON.parse(before), JSON.parse(JSON.stringify(shot)));
    assert.equal(JSON.stringify(balls), before, 'simulate no modifica su entrada');
    assert.deepEqual(a.final, b.final);
    assert.deepEqual(a.events, b.events);
    assert.equal(a.nFrames, b.nFrames);
    assert.equal(Buffer.compare(Buffer.from(a.frames.buffer), Buffer.from(b.frames.buffer)), 0, 'cuadros idénticos');
    assert.equal(Buffer.compare(Buffer.from(a.spins.buffer), Buffer.from(b.spins.buffer)), 0, 'giros idénticos');

    assert.ok(a.frames instanceof Float32Array && a.spins instanceof Float32Array);
    assert.equal(a.n, balls.length);
    assert.equal(a.frames.length, a.nFrames * a.n * 3);
    assert.equal(a.spins.length, a.frames.length, 'spins tiene la misma forma que frames');
    assert.ok(Math.abs(a.duration - (a.nFrames - 1) * FRAME_DT) < 1e-9);
    assert.ok(a.events[a.events.length - 1].t <= a.duration, 'ningún evento después del último cuadro');
    const potAt = new Map(a.events.filter((e) => e.type === 'pocket').map((e) => [e.a, e.t]));
    balls.forEach((bl, i) => {
      assert.equal(at(a, 0, i).x, Math.fround(bl.x));
      assert.equal(at(a, 0, i).y, Math.fround(bl.y));
      assert.equal(a.final[i].id, bl.id);
      assert.equal(at(a, a.nFrames - 1, i).x, Math.fround(a.final[i].x), 'el último cuadro es el estado final');
      assert.equal(at(a, a.nFrames - 1, i).y, Math.fround(a.final[i].y));
      for (let f = 1; f < a.nFrames; f++) assert.ok(at(a, f, i).roll >= at(a, f - 1, i).roll, 'la distancia rodada no decrece');
      if (potAt.has(bl.id))                                          // una bola embocada ya no gira
        for (let f = frameOf(a, potAt.get(bl.id)); f < a.nFrames; f++) assert.deepEqual(spinAt(a, f, i), { x: 0, y: 0, z: 0 });
    });
    for (let k = 1; k < a.events.length; k++) assert.ok(a.events[k].t >= a.events[k - 1].t, 'eventos ordenados por t');
    assert.ok(a.events.every((e) => ['ball', 'rail', 'pocket'].includes(e.type) && e.t > 0));
  }
  assert.equal(TABLE.pockets.length, 6);
  assert.ok(TABLE.cushions.every((c) => c.length === 4) && TABLE.jaws.length === 12);
  // Huella (FNV-1a) de los cuadros del saque: debe salir igual en Node, Chrome y Safari.
  let h = 0x811c9dc5;
  for (const byte of new Uint8Array(brk.frames.buffer)) h = Math.imul(h ^ byte, 0x01000193) >>> 0;
  ok(`determinismo: mismo tiro dos veces → mismos cuadros, giros, eventos y estado final (huella del saque ${h.toString(16).padStart(8, '0')})`);
}

// ───────── 2-4. Bola muerta, corrido y retroceso ─────────
// Tiro recto de 30 cm a 2.35 m/s; la bola objetivo va derechito a la tronera de arriba a la derecha (no estorba después).
{
  const j1 = TABLE.jaws[3], j2 = TABLE.jaws[4];                    // las dos puntas de esa tronera
  const mouth = { x: (j1[0] + j2[0]) / 2, y: (j1[1] + j2[1]) / 2 };
  const d = { dx: 2 / Math.sqrt(5), dy: -1 / Math.sqrt(5) };
  const cue = { id: 0, x: mouth.x - 2.0 * d.dx, y: mouth.y - 2.0 * d.dy };
  const obj = { id: 1, x: mouth.x - 1.7 * d.dx, y: mouth.y - 1.7 * d.dy };
  const contact = { x: obj.x - 2 * R * d.dx, y: obj.y - 2 * R * d.dy };  // centro de la blanca al tocar
  const run = (sy) => {
    const r = simulate([cue, obj], { ...d, power: P(2.35), sx: 0, sy });
    const c = r.final[0];
    assert.equal(r.firstHit, 1);
    assert.equal(r.events[0].type, 'ball');
    assert.equal(r.final[1].in, true, 'la bola objetivo sale hacia adelante y cae');
    assert.equal(r.events.find((e) => e.type === 'pocket').p, 2);
    assert.equal(c.in, false);
    const along = (c.x - contact.x) * d.dx + (c.y - contact.y) * d.dy;
    const side = (c.x - contact.x) * -d.dy + (c.y - contact.y) * d.dx;
    assert.ok(Math.abs(side) < 1e-3, 'tiro recto: la blanca no se sale de la línea');
    return along;
  };
  const stun = run(-0.2), follow = run(0.8), draw = run(-0.8);
  assert.ok(Math.abs(stun) < 2 * R, `stun: ${stun}`);
  ok(`bola muerta (sy=-0.2): la blanca se queda a ${cm(stun)} del punto de contacto`);
  assert.ok(follow > 0.4, `follow: ${follow}`);
  ok(`corrido (sy=+0.8): la blanca sigue ${cm(follow)} hacia adelante`);
  assert.ok(draw < -0.12, `draw: ${draw}`);
  ok(`retroceso (sy=-0.8): la blanca regresa ${cm(-draw)}`);
}

// ───────── 5. Efecto lateral contra una banda ─────────
{
  const x0 = W * 0.7, shot = (sx) => simulate([{ id: 0, x: x0, y: 0.5 }], { dx: 0, dy: -1, power: P(1.86), sx, sy: 0 });
  // Tirando hacia arriba (dy = -1), la derecha de quien tira es +x.
  const drift = (r) => {
    assert.equal(r.events[0].type, 'rail');
    const f = frameOf(r, r.events[0].t + 0.25);
    assert.ok(at(r, f, 0).y > R + 0.05, 'ya viene de regreso');
    return at(r, f, 0).x - x0;
  };
  const right = drift(shot(0.8)), left = drift(shot(-0.8)), none = drift(shot(0));
  assert.ok(Math.abs(none) < 1e-6, 'sin efecto rebota derechito');
  assert.ok(right > 0.03, `efecto derecho: ${right}`);
  assert.ok(left < -0.03, `efecto izquierdo: ${left}`);
  assert.ok(Math.abs(right + left) < 1e-6, 'simétrico');
  ok(`efecto en banda: sx=+0.8 sale a la derecha (${cm(right)} en 0.25 s) y sx=-0.8 a la izquierda (${cm(left)})`);
}

// ───────── 6. Rodadura natural, distancia y energía ─────────
{
  const r = simulate([{ id: 0, x: 0.4, y: H / 2 }], { dx: 1, dy: 0, power: P(2.97), sx: 0, sy: 0 });
  const last = r.nFrames - 1, dist = rolled(r, 0);
  assert.ok(dist > 3 && dist < 9, `distancia ${dist}`);
  assert.ok(r.duration > 4 && r.duration < 15, `duración ${r.duration}`);
  assert.ok(Math.abs(r.final[0].y - H / 2) < 1e-9, 'va y viene por la misma línea');
  // Sin efecto, la rapidez (y con ella la energía) nunca sube: ni al deslizar, ni al rodar, ni al rebotar.
  for (let f = 2 * WIN; f <= last; f++) assert.ok(speed(r, f, 0) <= speed(r, f - WIN, 0) + 1e-4, `la rapidez sube en el cuadro ${f}`);
  // Al principio desliza (frena con μs·g); al final rueda (frena con μr·g, más de 10 veces menos).
  const decel = (f1, f2) => (speed(r, f1, 0) - speed(r, f2, 0)) / ((f2 - f1) * FRAME_DT);
  const sliding = decel(F(2 / 60), F(12 / 60)), rolling = decel(last - F(1), last - F(0.1));
  assert.ok(Math.abs(sliding / (PHYS.muS * PHYS.g) - 1) < 0.1, `deslizando frena ${sliding}`);
  assert.ok(Math.abs(rolling / (PHYS.muR * PHYS.g) - 1) < 0.1, `rodando frena ${rolling}`);
  // El giro guardado es el real: al salir (golpe al centro) la bola no gira; al final rueda sin patinar (ω = v/R).
  const s0 = spinAt(r, 0, 0), fr = last - F(0.5), sr = spinAt(r, fr, 0);
  assert.ok(Math.abs(s0.x) + Math.abs(s0.y) + Math.abs(s0.z) < 1e-9, 'golpe al centro: sale sin giro');
  const vr = (speed(r, fr, 0) + speed(r, fr + WIN, 0)) / 2;       // rapidez en el instante del cuadro fr
  assert.ok(Math.abs(Math.sqrt(sr.x * sr.x + sr.y * sr.y) * R / vr - 1) < 0.02 && sr.z === 0, 'rodando: ω·R = v');
  ok(`tiro medio al centro: ${dist.toFixed(2)} m en ${r.duration.toFixed(1)} s; desliza (${sliding.toFixed(2)} m/s²), luego rueda (${rolling.toFixed(3)} m/s²) y nunca gana energía`);
}

// ───────── 7. Troneras ─────────
{
  const p0 = TABLE.pockets[0], s = Math.SQRT1_2;
  const solo = simulate([{ id: 0, x: p0.x + 0.5 * s, y: p0.y + 0.5 * s }], { dx: -s, dy: -s, power: P(1.53), sx: 0, sy: 0 });
  assert.deepEqual(solo.events.map((e) => [e.type, e.a, e.p]), [['pocket', 0, 0]]);
  assert.equal(solo.final[0].in, true);
  assert.deepEqual([solo.final[0].x, solo.final[0].y], [p0.x, p0.y], 'la bola embocada queda en el centro del agujero');
  ok('una bola tirada al centro de la tronera de esquina desde 50 cm entra limpia');

  // Bola objetivo recta a la tronera de abajo a la izquierda; la blanca se queda (stun).
  const p3 = TABLE.pockets[3];
  const pot = simulate(
    [{ id: 0, x: p3.x + 1.0 * s, y: p3.y - 1.0 * s }, { id: 7, x: p3.x + 0.6 * s, y: p3.y - 0.6 * s }],
    { dx: -s, dy: s, power: P(2.97), sx: 0, sy: -0.25 },
  );
  assert.equal(pot.firstHit, 7);
  assert.deepEqual(pot.events.filter((e) => e.type === 'pocket').map((e) => [e.a, e.p]), [[7, 3]]);
  assert.deepEqual(pot.final.map((f) => f.in), [false, true]);
  ok('una bola objetivo empujada recto a otra esquina cae en la tronera correcta y la blanca se queda en la mesa');

  // Apuntando a la punta de la tronera: rebota. De frente no entra; en diagonal al menos pega en la goma antes.
  const [jx, jy] = TABLE.jaws[0];
  const square = simulate([{ id: 0, x: jx, y: 0.5 }], { dx: 0, dy: -1, power: P(2.2), sx: 0, sy: 0 });
  assert.equal(square.events[0].type, 'rail');
  assert.equal(square.final[0].in, false);
  const l = Math.sqrt((jx - 0.5) * (jx - 0.5) + (jy - 0.4) * (jy - 0.4));
  const angled = simulate([{ id: 0, x: 0.5, y: 0.4 }], { dx: (jx - 0.5) / l, dy: (jy - 0.4) / l, power: P(2.2), sx: 0, sy: 0 });
  assert.equal(angled.events[0].type, 'rail');
  assert.equal(angled.final[0].in, false);
  ok('una bola tirada a la punta de la tronera rebota en la goma y no entra');
}

// ───────── 8. Saque ─────────
{
  const start = rackBalls();
  let warmMs = Infinity;
  for (let k = 0; k < 5; k++) { const t = performance.now(); simulate(start, BREAK); warmMs = Math.min(warmMs, performance.now() - t); }
  assert.ok(coldMs < 60, `el saque tardó ${coldMs} ms`);
  assert.ok(brk.duration < PHYS.maxTime - 1, 'termina solo, antes del tope');
  assert.equal(brk.firstHit, 1);
  assert.equal(brk.railAfterHit, true);
  const on = brk.final.filter((b) => !b.in);
  for (const b of on) assert.ok(b.x >= 0 && b.x <= W && b.y >= 0 && b.y <= H, `bola ${b.id} fuera de la mesa`);
  for (let i = 0; i < on.length; i++)
    for (let j = i + 1; j < on.length; j++) {
      const dx = on[i].x - on[j].x, dy = on[i].y - on[j].y;
      assert.ok(Math.sqrt(dx * dx + dy * dy) >= 2 * R - 1e-6, `bolas ${on[i].id} y ${on[j].id} encimadas`);
    }
  const moved = brk.final.filter((b, i) => b.in || Math.abs(b.x - start[i].x) + Math.abs(b.y - start[i].y) > 0.01).length;
  assert.ok(moved >= 10, `solo se movieron ${moved}`);
  ok(`saque: ${coldMs.toFixed(1)} ms en frío (${warmMs.toFixed(1)} ms ya caliente), ${brk.duration.toFixed(1)} s de tiro, ${moved}/16 bolas movidas, ${brk.final.length - on.length} embocadas, sin encimes ni bolas fuera`);
}

// ───────── 8b. Saque con la fuerza máxima real del juego ─────────
{
  PHYS.vMax = GAME_VMAX;
  const t = performance.now();
  const b = simulate(rackBalls(), BREAK);
  const ms = performance.now() - t;
  const on = b.final.filter((q) => !q.in);
  for (let i = 0; i < on.length; i++)
    for (let j = i + 1; j < on.length; j++)
      assert.ok(Math.hypot(on[i].x - on[j].x, on[i].y - on[j].y) >= 2 * R - 1e-6, 'encimadas con vMax del juego');
  assert.ok(b.duration < PHYS.maxTime - 1 && ms < 60);
  // Cuadros para pantallas de 120 Hz: ni en el saque una bola avanza más de un diámetro entre dos cuadros
  // (con 1/60 s eran 18 cm, tres bolas), y el tiro entero sigue pesando poco.
  let jump = 0;
  for (let f = 1; f < b.nFrames; f++)
    for (let i = 0; i < b.n; i++) jump = Math.max(jump, Math.hypot(at(b, f, i).x - at(b, f - 1, i).x, at(b, f, i).y - at(b, f - 1, i).y));
  const kb = (b.frames.byteLength + b.spins.byteLength) / 1024;
  assert.ok(jump < 2 * R, `una bola avanzó ${cm(jump)} en un cuadro`);
  assert.ok(kb < 1536, `el saque ocupa ${kb} KB`);
  PHYS.vMax = 8.5;
  ok(`saque a ${GAME_VMAX} m/s (fuerza máxima del juego): ${ms.toFixed(1)} ms, ${b.duration.toFixed(1)} s, ${b.final.length - on.length} embocadas, sin encimes; ${b.nFrames} cuadros = ${kb.toFixed(0)} KB, salto máximo entre cuadros ${cm(jump)}`);
}

// ───────── 9. Guía de puntería ─────────
{
  const balls = [{ id: 0, x: 0.5, y: 0.6 }, { id: 5, x: 1.0, y: 0.6 }, { id: 9, x: 1.6, y: 0.6 }];
  const p = predict(balls, 1, 0);
  assert.equal(p.target, 5);
  assert.ok(Math.abs(p.x - (1.0 - 2 * R)) < 1e-9 && Math.abs(p.y - 0.6) < 1e-9);
  assert.ok(Math.abs(p.tx - 1) < 1e-9 && Math.abs(p.ty) < 1e-9);
  assert.ok(Math.abs(p.cx * p.tx + p.cy * p.ty) < 1e-9 && Math.abs(p.cx * p.cx + p.cy * p.cy - 1) < 1e-9);

  // Corte de media bola: la bola fantasma queda a 2R, el objetivo sale por la línea de centros y la tangente es perpendicular.
  const cut = predict([{ id: 0, x: 0.5, y: 0.6 + R }, { id: 5, x: 1.0, y: 0.6 }], 1, 0);
  assert.equal(cut.target, 5);
  assert.ok(Math.abs(Math.sqrt((1.0 - cut.x) ** 2 + (0.6 - cut.y) ** 2) - 2 * R) < 1e-9);
  assert.ok(Math.abs(cut.tx - (1.0 - cut.x) / (2 * R)) < 1e-9 && Math.abs(cut.ty + 0.5) < 1e-9);
  assert.ok(Math.abs(cut.cx * cut.tx + cut.cy * cut.ty) < 1e-9 && cut.cx > 0 && cut.cy > 0);

  // Sin bola en el camino: llega a la banda (a un radio de la nariz).
  const rail = predict(balls, 0, 1);
  assert.equal(rail.target, null);
  assert.ok(Math.abs(rail.x - 0.5) < 1e-9 && Math.abs(rail.y - (H - R)) < 1e-9);

  // La guía y la simulación coinciden en cuál es la primera bola (tiros al centro, sin efecto).
  let seed = 12345, checked = 0;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const power = P(2.97);
  for (let k = 0; k < 600; k++) {
    const layout = [];
    while (layout.length < 8) {
      const x = 2 * R + rnd() * (W - 4 * R), y = 2 * R + rnd() * (H - 4 * R);
      if (layout.every((b) => (b.x - x) ** 2 + (b.y - y) ** 2 > 4.2 * R * R)) layout.push({ id: layout.length, x, y });
    }
    let dx = rnd() - 0.5, dy = rnd() - 0.5;
    const dl = Math.sqrt(dx * dx + dy * dy);
    dx /= dl; dy /= dl;
    const g = predict(layout, dx, dy);
    if (g.target === null || g.cut > 0.98) continue;      // los roces finísimos no se comparan
    assert.equal(simulate(layout, { dx, dy, power, sx: 0, sy: 0 }).firstHit, g.target);
    checked++;
  }
  assert.ok(checked > 50);
  ok(`predict(): bola fantasma, dirección del objetivo y tangente correctas; coincide con simulate en ${checked} tiros al azar`);
}

// ───────── 10. Tiros suaves y curva de fuerza (con las constantes reales del juego) ─────────
// Referencias: Dr. Dave llama "soft touch" a < 0.45 m/s, "slow" a 0.45–0.9, "medium" a 0.9–1.9, "fast" a
// 1.9–3.2 y "power" a 3.2–4.5 m/s; el saque anda por 11 m/s. Un tiro suave tiene que morirse pronto.
{
  PHYS.vMax = GAME_VMAX;
  // La curva: empieza en vMin, llega a vMax, siempre sube, y el 40 % de abajo es la zona suave con control fino.
  assert.ok(Math.abs(v0(0) - PHYS.vMin) < 1e-12 && Math.abs(v0(1) - PHYS.vMax) < 1e-9);
  for (let k = 1; k <= 100; k++) {
    const step = v0(k / 100) - v0((k - 1) / 100);
    assert.ok(step > 0, 'más fuerza = más rápido');
    if (k <= 40) assert.ok(step < 0.1, `control fino: el 1 % nº ${k} de la barra cambia ${step} m/s`);
  }
  assert.ok(v0(0.03) < 0.45, 'el tiro más flojito es un toque');
  assert.ok(v0(0.15) > 0.45 && v0(0.15) < 0.9, `fuerza 0.15 = tiro lento: ${v0(0.15)}`);
  assert.ok(v0(0.4) > 1.5 && v0(0.4) < 2.2, `fuerza 0.4 = fin de la zona suave: ${v0(0.4)}`);
  assert.ok(v0(0.6) > 3 && v0(0.6) < 4.5, `fuerza 0.6 = tiro fuerte: ${v0(0.6)}`);

  // Mesa vacía, tiro a lo largo desde 30 cm de la banda de cabecera. Distancia de referencia: el modelo de
  // Dr. Dave (TP B.6): la bola patina 12v²/(49·μs·g), sigue rodando a 5/7 y frena con μr·g; cada banda le
  // deja 0.7 de la velocidad y sale patinando otra vez.
  const X0 = 0.3;
  const tpB6 = (v) => {
    let x = 0, leg = W - R - X0, rolling = false;
    for (let guard = 0; guard < 100; guard++) {
      const a = (rolling ? PHYS.muR : PHYS.muS) * PHYS.g;
      const reach = rolling ? (v * v) / (2 * a) : (12 * v * v) / (49 * a);   // hasta parar / hasta empezar a rodar
      if (reach < leg) {
        x += reach;
        if (rolling) return x;
        leg -= reach; v *= 5 / 7; rolling = true;
      } else { v = 0.7 * Math.sqrt(v * v - 2 * a * leg); x += leg; leg = W - 2 * R; rolling = false; }
    }
    return x;
  };
  const solo = (power) => simulate([{ id: 0, x: X0, y: H / 2 }], { dx: 1, dy: 0, power, sx: 0, sy: 0 });
  const rows = [];
  for (const power of [0.05, 0.15, 0.25, 0.4, 0.6, 1]) {
    const r = solo(power), d = rolled(r, 0), ref = tpB6(v0(power));
    assert.ok(Math.abs(d / ref - 1) < 0.1, `fuerza ${power}: rodó ${d} m y la referencia dice ${ref} m`);
    rows.push(`${power} → ${v0(power).toFixed(2)} m/s → ${d.toFixed(2)} m`);
  }
  const soft = solo(0.15), dSoft = rolled(soft, 0);
  assert.ok(dSoft > 0.7 && dSoft < 1.6, `tiro suave: ${dSoft} m`);                 // media mesa, no la mesa entera
  assert.ok(soft.duration < 5, `tiro suave: tarda ${soft.duration} s en parar`);
  assert.equal(soft.events.length, 0, 'un tiro suave no llega a la otra banda');
  assert.ok(rolled(solo(0.03), 0) < 0.35, 'el toque mínimo avanza un palmo');
  ok(`curva de fuerza (fuerza → salida → rueda en mesa vacía): ${rows.join(' · ')}; a ±10 % del modelo de Dr. Dave`);

  // Tiro suave y recto a una bola a 50 cm. La blanca llega rodando, así que no se queda clavada: le pasa casi
  // toda su velocidad a la otra, pero el giro que traía la vuelve a empujar hasta ~2/7 de la velocidad con la
  // que llegó. Eso es ~9 % de la energía: rueda unas 6-7 veces menos que la bola golpeada, y se para pronto.
  const gap = 0.5, balls = [{ id: 0, x: 0.6, y: H / 2 }, { id: 1, x: 0.6 + gap, y: H / 2 }];
  const shot = { dx: 1, dy: 0, power: 0.2, sx: 0, sy: 0 };
  const hit = simulate(balls, shot), alone = simulate([balls[0]], shot);
  const e = hit.events[0], fHit = frameOf(hit, e.t);
  assert.ok(e.type === 'ball' && hit.firstHit === 1);
  const cueAfter = hit.final[0].x - (balls[1].x - 2 * R), objAfter = hit.final[1].x - balls[1].x;
  const cueLeft = rolled(alone, 0) - (gap - 2 * R);                   // lo que le faltaba rodar si no hubiera bola
  let tStop = 0;
  for (let f = fHit + 1; f < hit.nFrames; f++) if (at(hit, f, 0).roll > at(hit, f - 1, 0).roll) tStop = f * FRAME_DT - e.t;
  assert.ok(cueAfter > 0.02 && cueAfter < 0.15, `la blanca sigue ${cueAfter} m`);
  assert.ok(cueAfter / cueLeft > 0.06 && cueAfter / cueLeft < 0.13, `la blanca conserva ${cueAfter / cueLeft} de su recorrido`);
  assert.ok(objAfter / cueAfter > 4.5 && objAfter / cueAfter < 9, `la otra bola rueda ${objAfter / cueAfter} veces más`);
  assert.ok(tStop < 1.5, `la blanca tarda ${tStop} s en parar`);
  ok(`tiro suave a una bola (${e.v.toFixed(2)} m/s al chocar): la blanca sigue ${cm(cueAfter)} y para en ${tStop.toFixed(1)} s; la otra rueda ${cm(objAfter)} (${(objAfter / cueAfter).toFixed(1)} veces más)`);
  PHYS.vMax = 8.5;
}

// ───────── 11. Cuadros finos para pantallas de 120 Hz ─────────
// Quien anima interpola en línea recta entre cuadros. Tiro recto a 5 m/s: en el instante del choque, las dos
// bolas interpoladas deben verse tocándose (o casi). El peor caso teórico es v·FRAME_DT/2 de hueco.
{
  assert.ok(FRAME_DT <= 1 / 120, 'al menos un cuadro por refresco de una pantalla de 120 Hz');
  const v = 5, power = P(v);
  let worst = 0;
  for (let k = 0; k < 24; k++) {                                     // 24 distancias: el choque cae en distintos puntos del cuadro
    const balls = [{ id: 0, x: 0.8, y: H / 2 }, { id: 1, x: 1.1 + k * 0.0009, y: H / 2 }];
    const r = simulate(balls, { dx: 1, dy: 0, power, sx: 0, sy: -0.3 });
    const e = r.events[0];
    assert.equal(e.type, 'ball');
    const fi = e.t / FRAME_DT, f0 = Math.floor(fi), f1 = Math.min(r.nFrames - 1, f0 + 1), kk = fi - f0;   // igual que el renderer
    const x = (i) => at(r, f0, i).x + (at(r, f1, i).x - at(r, f0, i).x) * kk;
    worst = Math.max(worst, Math.abs(x(1) - x(0) - 2 * R));
    for (const ev of r.events) assert.ok(ev.t <= r.duration && ev.t > 0);
  }
  assert.ok(worst < (v * FRAME_DT) / 2 + 0.004, `hueco al chocar: ${worst} m`);
  assert.ok(worst < 0.5 * R, `hueco al chocar: ${worst} m (más de media bola de radio)`);
  ok(`${Math.round(1 / FRAME_DT)} cuadros por segundo: en un choque a ${v} m/s la animación interpolada deja como mucho ${cm(worst)} de hueco entre las bolas (el radio es ${cm(R)})`);
}

console.log('\nTodo bien ♥');
