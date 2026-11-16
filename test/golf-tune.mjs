// Herramienta para ajustar los hoyos del minigolf (no corre en las pruebas: tarda minutos).
//   node test/golf-tune.mjs            todos los hoyos
//   node test/golf-tune.mjs metro xochi
// Por hoyo dice:
//   azar    de 3000 tiros al azar desde la salida (dirección, fuerza y momento): % que entran / al agua
//   directo tiros con fuerza máxima derecho al hoyo en 40 momentos distintos: cuántos entran
//   robot   un robot que prueba miles de tiros y elige el mejor (puede esperar el momento):
//           sus golpes y qué tan "fino" tuvo que ser cada tiro (% de tiros parecidos que también sirven)
//   solución los tiros del robot (para test/golf.mjs)
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = '../public/js/games/';

if (isMainThread) {
  const { HOLES } = await import(ROOT + 'golf-courses.js');
  const args = process.argv.slice(2);
  const noisy = args.includes('--noisy') ? 10 : 0, trace = args.includes('--trace');
  const want = args.filter((x) => !x.startsWith('--'));
  const ids = HOLES.map((h) => h.id).filter((id) => !want.length || want.includes(id));
  const out = {};
  let next = 0;
  const run = () => new Promise((res) => {
    const go = () => {
      if (next >= ids.length) return res();
      const id = ids[next++];
      const w = new Worker(fileURLToPath(import.meta.url), { workerData: { id, noisy, trace } });
      w.on('message', (m) => { out[id] = m; console.log(m.text); });
      w.on('error', (e) => { console.log(id, 'ERROR', e); });
      w.on('exit', go);
    };
    go();
  });
  await Promise.all(Array.from({ length: Math.min(ids.length, Math.max(1, cpus().length - 1)) }, run));
  if (!noisy) {
    // las soluciones del robot quedan para test/golf.mjs (que revisa que cada hoyo se pueda terminar)
    const { readFileSync, writeFileSync, existsSync } = await import('node:fs');
    const file = fileURLToPath(new URL('./golf-solutions.json', import.meta.url));
    const all = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
    for (const id of ids) if (out[id]) all[id] = out[id].solution;
    writeFileSync(file, '{\n' + Object.keys(all).map((id) => `  ${JSON.stringify(id)}: ${JSON.stringify(all[id])}`).join(',\n') + '\n}\n');
    console.log('\nsoluciones guardadas en test/golf-solutions.json');
  }
} else {
  const { HOLE_BY_ID } = await import(ROOT + 'golf-courses.js');
  const { simulate, inPoly, R } = await import(ROOT + 'golf-physics.js');
  const h = HOLE_BY_ID[workerData.id];
  const W = h.w, H = h.h;

  // ── distancia "caminando" al hoyo (rodea paredes; el agua cuesta más; los túneles conectan)
  const G = 0.05, nx = Math.ceil(W / G), ny = Math.ceil(H / G);
  const segs = [];
  for (const w of h.walls) { const p = w.pts || w; for (let i = 0; i + 1 < p.length; i++) segs.push([p[i][0], p[i][1], p[i + 1][0], p[i + 1][1]]); }
  const distSeg = (x, y, [ax, ay, bx, by]) => {
    const ex = bx - ax, ey = by - ay, L2 = ex * ex + ey * ey;
    let u = L2 ? ((x - ax) * ex + (y - ay) * ey) / L2 : 0; u = Math.max(0, Math.min(1, u));
    return Math.hypot(x - ax - ex * u, y - ay - ey * u);
  };
  const cost = new Float64Array(nx * ny).fill(Infinity);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = (i + 0.5) * G, y = (j + 0.5) * G;
    const green = h.green.some((p) => inPoly(x, y, p));
    const wet = (h.zones || []).some((z) => (z.type === 'water' || z.type === 'pit') && inPoly(x, y, z.poly));
    if (!green && !wet) continue;
    if (segs.some((s) => distSeg(x, y, s) < R * 0.9)) continue;
    if ((h.posts || []).some((p) => Math.hypot(x - p.x, y - p.y) < p.r + R * 0.5)) continue;
    cost[j * nx + i] = wet ? 4 : 1;
  }
  const cell = (x, y) => Math.max(0, Math.min(ny - 1, Math.floor(y / G))) * nx + Math.max(0, Math.min(nx - 1, Math.floor(x / G)));
  const dist = new Float64Array(nx * ny).fill(Infinity);
  const extra = new Map(); // túneles: de cualquier salida se "regresa" a la entrada
  for (const tu of h.tunnels || []) for (const o of tu.outs || [tu.out]) {
    const k = cell(o.x, o.y); if (!extra.has(k)) extra.set(k, []); extra.get(k).push(cell(tu.in.x, tu.in.y));
  }
  {
    const start = cell(h.cup.x, h.cup.y); dist[start] = 0;
    const heap = [[0, start]];
    const push = (d, k) => { heap.push([d, k]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    while (heap.length) {
      const [d, k] = pop(); if (d > dist[k]) continue;
      const i = k % nx, j = (k - i) / nx;
      // (la distancia se propaga "al revés": de vecinos hacia aquí)
      for (const [di, dj, l] of [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]]) {
        const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
        const q = b * nx + a; if (cost[q] === Infinity) continue;
        const nd = d + G * l * (cost[q] + cost[k]) / 2; if (nd < dist[q]) { dist[q] = nd; push(nd, q); }
      }
      // si k es la entrada de un túnel, desde sus salidas se llega aquí gratis
      for (const [o, ins] of extra) if (ins.includes(k) && d < dist[o]) { dist[o] = d; push(d, o); }
    }
  }
  const geo = (x, y) => dist[cell(x, y)];

  // ── tiros
  let rnd = 12345; const rand = () => ((rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648);
  const tee = h.tee;
  let aceR = 0, wetR = 0;
  const NR = 3000;
  for (let k = 0; k < NR; k++) {
    const a = rand() * Math.PI * 2, s = simulate(h, tee, { dx: Math.cos(a), dy: Math.sin(a), power: 0.05 + rand() * 0.95 }, rand() * 100);
    if (s.end === 'cup') aceR++; else if (s.end === 'water') wetR++;
  }
  let direct = 0;
  {
    const dx = h.cup.x - tee.x, dy = h.cup.y - tee.y, l = Math.hypot(dx, dy);
    for (let k = 0; k < 40; k++) for (const p of [1, 0.8, 0.6]) if (simulate(h, tee, { dx: dx / l, dy: dy / l, power: p }, k * 0.77).end === 'cup') direct++;
  }
  // robot
  const PH = [0, 1.3, 2.9, 4.4, 6.2, 7.7, 9.1, 11.3];
  // como persona: de los mejores tiros, el que sale bien aunque el dedo falle un poquito
  const noisyShot = (shot, ph) => {
    const a = Math.atan2(shot.dy, shot.dx) + (rand() - 0.5) * 0.105;
    return { shot: { dx: Math.cos(a), dy: Math.sin(a), power: Math.min(1, Math.max(0.05, shot.power * (1 + (rand() - 0.5) * 0.16))) }, ph: ph + (rand() - 0.5) * 0.6 };
  };
  const scoreOf = (s, here) => (s.end === 'cup' ? -1 : s.end === 'water' ? here + 1.5 : geo(s.x, s.y));
  function safest(ball, wear, t0) {
    const here = geo(ball.x, ball.y);
    const cands = [];
    for (let ai = 0; ai < 144; ai++) {
      const a = (ai / 144) * Math.PI * 2, dx = Math.cos(a), dy = Math.sin(a);
      for (let p = 0.06; p <= 1.0001; p += 0.047) for (const ph of PH) {
        const s = simulate(h, ball, { dx, dy, power: p }, t0 + ph, wear);
        cands.push({ sc: scoreOf(s, here), shot: { dx, dy, power: p }, ph: t0 + ph });
      }
    }
    cands.sort((x, y) => x.sc - y.sc);
    let b = null;
    for (const c of cands.slice(0, 40)) {
      let tot = 0;
      for (let k = 0; k < 10; k++) { const n = noisyShot(c.shot, c.ph); tot += scoreOf(simulate(h, ball, n.shot, n.ph, wear), here); }
      const ex = tot / 10;
      if (!b || ex < b.ex) b = { ...c, ex };
    }
    return b;
  }
  // el tiro tal como lo manda el juego (redondeado) y como lo limpia golf-rules.js: así la
  // solución se puede repetir exacta en test/golf.mjs
  const q4 = (v) => Math.round(v * 1e4) / 1e4, round6 = (v) => Math.round(v * 1e6) / 1e6;
  const gameShot = (dx, dy, p, ph) => {
    const raw = { dx: q4(dx), dy: q4(dy), power: q4(p) }, l = Math.sqrt(raw.dx * raw.dx + raw.dy * raw.dy);
    return { raw, shot: { dx: raw.dx / l, dy: raw.dy / l, power: Math.min(1, Math.max(0.02, raw.power)) }, ph: Math.round(ph * 1000) / 1000 };
  };
  function best(ball, wear, t0) {
    let b = null, cups = 0, tries = 0;
    for (let ai = 0; ai < 144; ai++) {
      const a = (ai / 144) * Math.PI * 2;
      for (let p = 0.06; p <= 1.0001; p += 0.047) for (const ph of PH) {
        const q = gameShot(Math.cos(a), Math.sin(a), p, t0 + ph);
        const s = simulate(h, ball, q.shot, q.ph, wear);
        tries++;
        let sc;
        if (s.end === 'cup') { sc = -1; cups++; }
        else if (s.end === 'water') continue;
        else sc = geo(s.x, s.y);
        if (!b || sc < b.sc) b = { sc, shot: q.shot, raw: q.raw, ph: q.ph, s };
      }
    }
    return b && { ...b, cupRate: cups / tries };
  }
  function robust(ball, wear, b) {
    // tiros parecidos (dedo humano): ±3°, ±7% fuerza, ±0.25 s
    let good = 0; const N = 40;
    for (let k = 0; k < N; k++) {
      const a = Math.atan2(b.shot.dy, b.shot.dx) + (rand() - 0.5) * 0.105;
      const p = Math.min(1, Math.max(0.05, b.shot.power * (1 + (rand() - 0.5) * 0.14)));
      const s = simulate(h, ball, { dx: Math.cos(a), dy: Math.sin(a), power: p }, b.ph + (rand() - 0.5) * 0.5, wear);
      if (b.sc < 0 ? s.end === 'cup' : s.end !== 'water' && (s.end === 'cup' || geo(s.x, s.y) < b.sc + 0.6)) good++;
    }
    return Math.round((good / N) * 100);
  }
  if (workerData.noisy) {
    // robot "humano": elige el mejor tiro pero lo ejecuta con error (±3°, ±8% fuerza, ±0.3 s)
    const games = [];
    for (let g = 0; g < workerData.noisy; g++) {
      let ball = { ...tee }, wear = Array(10).fill(0), strokes = 0, t0 = g * 37.3;
      for (;;) {
        const b = safest(ball, wear, t0);
        strokes++;
        if (!b) break;
        const { shot, ph } = noisyShot(b.shot, b.ph);
        const s = simulate(h, ball, shot, ph, wear);
        if (workerData.trace) console.log(h.id, strokes, `(${ball.x.toFixed(2)},${ball.y.toFixed(2)})`, '→', s.end, s.why, `(${s.x.toFixed(2)},${s.y.toFixed(2)})`, 'esperado', b.ex.toFixed(2), s.events.map((e) => e.type).join(','));
        wear = s.wear.concat(Array(10).fill(0)).slice(0, 10);
        if (s.end === 'water') strokes++;
        else if (s.end === 'cup') break;
        else ball = { x: s.x, y: s.y };
        t0 = ph + s.dur + 3;
        if (strokes >= 6) { strokes = 7; break; }
      }
      games.push(strokes);
    }
    const avg = games.reduce((a, b) => a + b, 0) / games.length;
    parentPort.postMessage({ text: `${h.id.padEnd(9)} par ${h.par} · humano: promedio ${avg.toFixed(2)} [${games.join(' ')}]`, solution: [] });
    await new Promise(() => setTimeout(() => process.exit(0), 10));
  }
  let ball = { ...tee }, wear = Array(10).fill(0), strokes = 0, inCup = false, t0 = 0;
  const log = [], solution = [];
  const tStart = Date.now();
  while (!inCup && strokes < 7) {
    const b = best(ball, wear, t0);
    strokes++;
    if (!b) { log.push('sin tiro'); break; }
    const rb = robust(ball, wear, b);
    solution.push([b.raw.dx, b.raw.dy, b.raw.power, b.ph]);
    log.push(`${b.s.end === 'cup' ? 'HOYO' : b.sc.toFixed(2) + 'm'}(${rb}%${b.cupRate ? ' ace' + (b.cupRate * 100).toFixed(2) + '%' : ''})`);
    wear = b.s.wear.map(round6);
    if (b.s.end === 'cup') inCup = true; else ball = { x: round6(b.s.x), y: round6(b.s.y) };
    t0 = b.ph + b.s.dur + 3;
  }
  const text = `${h.id.padEnd(9)} par ${h.par} · azar: ${((aceR / NR) * 100).toFixed(2)}% entra, ${((wetR / NR) * 100).toFixed(0)}% agua · directo ${direct}/120 · robot ${inCup ? strokes : 'NO'}: ${log.join(' → ')} (${((Date.now() - tStart) / 1000).toFixed(0)} s)`;
  parentPort.postMessage({ text, solution });
}
