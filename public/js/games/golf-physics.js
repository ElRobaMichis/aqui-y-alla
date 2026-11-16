// Física del minigolf. Determinista como la del billar: solo + − × ÷, Math.sqrt, abs, min,
// max y floor (nada de sin/cos/exp, que cambian de un navegador a otro), así que el líder
// (árbitro) y los dos teléfonos calculan exactamente el mismo tiro. Por la red solo viaja
// el tiro: dirección, fuerza y en qué momento de su vaivén iban los obstáculos que se mueven.
//
// Unidades: metros y segundos. La pelota es de caricatura (más grande que una de verdad)
// para que se vea bien en un teléfono.

export const R = 0.045;          // radio de la pelota
export const CUP_R = 0.09;       // radio del hoyo
export const VMAX = 3.9;         // velocidad con fuerza máxima (m/s)
export const STEP = 1 / 480;     // paso de integración (a 3.9 m/s avanza < R/5: no atraviesa paredes)
export const FRAME_DT = 1 / 120; // cada cuánto se guarda un cuadro para animar
const REC = Math.round(FRAME_DT / STEP);
const MAX_TIME = 30;

const ROLL = 0.85;               // frenado sobre el pasto (m/s²)
const SURF = { sand: 4.2, ice: 0.12, petals: 2.4 }; // frenado de otras superficies
const STATIC = 0.32;             // una pendiente más suave que esto no mueve una pelota quieta
const STOP_V = 0.012;
const WALL_E = 0.72;             // rebote en paredes normales
const WALL_T = 0.9;              // lo que conserva de su velocidad a lo largo de la pared
const CUP_CAPTURE = 1.35;        // más rápido que esto, la pelota pasa sobre el hoyo
const CUP_PULL = 7.5;            // el borde del hoyo jala hacia adentro (curvea los tiros rápidos)
const TUNNEL_TIME = 0.55;        // lo que tarda dentro de un túnel

/** Onda triangular 0→1→0 (para el vaivén de los obstáculos). */
export const tri = (u) => 1 - Math.abs(2 * (u - Math.floor(u)) - 1);

/** Posición y velocidad de un obstáculo móvil en el tiempo t (s). */
export function moverAt(m, t) {
  const u = t / m.period;
  const k = tri(u);
  const [ax, ay] = m.path[0], [bx, by] = m.path[1];
  // en la primera mitad del ciclo va de A a B; en la segunda regresa
  const f = u - Math.floor(u) < 0.5 ? 1 : -1;
  const sp = (2 / m.period) * f;
  return { x: ax + (bx - ax) * k, y: ay + (by - ay) * k, vx: (bx - ax) * sp, vy: (by - ay) * sp };
}

/** ¿El punto está dentro del polígono? (cruces de rayo; solo comparaciones y aritmética) */
export function inPoly(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Paredes de un hoyo como lista de segmentos { ax, ay, bx, by, e } (se calcula una vez). */
export function segmentsOf(hole) {
  if (hole._segs) return hole._segs;
  const segs = [];
  for (const w of hole.walls) {
    const pts = w.pts || w, e = w.e ?? WALL_E;
    for (let i = 0; i + 1 < pts.length; i++) segs.push({ ax: pts[i][0], ay: pts[i][1], bx: pts[i + 1][0], by: pts[i + 1][1], e });
  }
  Object.defineProperty(hole, '_segs', { value: segs, enumerable: false });
  return segs;
}

/* choque contra el punto más cercano de un segmento (cubre también las esquinas) */
function hitSegment(s, st, vxm = 0, vym = 0) {
  const ex = s.bx - s.ax, ey = s.by - s.ay;
  const L2 = ex * ex + ey * ey;
  let u = L2 > 0 ? ((st.x - s.ax) * ex + (st.y - s.ay) * ey) / L2 : 0;
  u = u < 0 ? 0 : u > 1 ? 1 : u;
  const cx = s.ax + ex * u, cy = s.ay + ey * u;
  const dx = st.x - cx, dy = st.y - cy;
  const d2 = dx * dx + dy * dy;
  if (d2 >= R * R || d2 === 0) return 0;
  const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
  // sacar la pelota de la pared
  st.x = cx + nx * R; st.y = cy + ny * R;
  // velocidad relativa a la pared (las que se mueven empujan)
  const rx = st.vx - vxm, ry = st.vy - vym;
  const vn = rx * nx + ry * ny;
  if (vn >= 0) return 0;
  const tx = rx - vn * nx, ty = ry - vn * ny;
  const e = s.e;
  st.vx = tx * WALL_T - vn * e * nx + vxm;
  st.vy = ty * WALL_T - vn * e * ny + vym;
  // (las cuerdas del ring rebotan más fuerte que como llegaste, pero con tope)
  const v2 = st.vx * st.vx + st.vy * st.vy;
  if (v2 > VMAX * VMAX) { const k = VMAX / Math.sqrt(v2); st.vx *= k; st.vy *= k; }
  return -vn;
}
function hitPost(p, st) {
  const dx = st.x - p.x, dy = st.y - p.y, rr = p.r + R;
  const d2 = dx * dx + dy * dy;
  if (d2 >= rr * rr || d2 === 0) return 0;
  const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
  st.x = p.x + nx * rr; st.y = p.y + ny * rr;
  const vn = st.vx * nx + st.vy * ny;
  if (vn >= 0) return 0;
  const e = p.e ?? WALL_E;
  const tx = st.vx - vn * nx, ty = st.vy - vn * ny;
  st.vx = tx * WALL_T - vn * e * nx;
  st.vy = ty * WALL_T - vn * e * ny;
  return -vn;
}
/* rectángulo móvil: sus 4 lados como segmentos en la posición de este instante */
function hitMover(m, st, t) {
  const p = moverAt(m, t);
  const hw = m.w / 2, hh = m.h / 2;
  const x0 = p.x - hw, x1 = p.x + hw, y0 = p.y - hh, y1 = p.y + hh;
  let best = 0;
  for (const s of [
    { ax: x0, ay: y0, bx: x1, by: y0, e: 0.8 }, { ax: x1, ay: y0, bx: x1, by: y1, e: 0.8 },
    { ax: x1, ay: y1, bx: x0, by: y1, e: 0.8 }, { ax: x0, ay: y1, bx: x0, by: y0, e: 0.8 },
  ]) best = Math.max(best, hitSegment(s, st, p.vx, p.vy));
  // si el obstáculo se le vino encima y la dejó adentro, sale por el lado más cercano
  if (st.x > x0 && st.x < x1 && st.y > y0 && st.y < y1) {
    const dl = st.x - x0, dr = x1 - st.x, du = st.y - y0, dd = y1 - st.y;
    const m1 = Math.min(dl, dr, du, dd);
    if (m1 === dl) { st.x = x0 - R; st.vx = Math.min(st.vx, p.vx); }
    else if (m1 === dr) { st.x = x1 + R; st.vx = Math.max(st.vx, p.vx); }
    else if (m1 === du) { st.y = y0 - R; st.vy = Math.min(st.vy, p.vy); }
    else { st.y = y1 + R; st.vy = Math.max(st.vy, p.vy); }
  }
  return best;
}

/** Velocidad inicial de un tiro: dirección (unitaria) y fuerza 0..1. */
export function launch(shot) {
  const l = Math.sqrt(shot.dx * shot.dx + shot.dy * shot.dy) || 1;
  const p = Math.min(1, Math.max(0.02, shot.power));
  // la fuerza crece un poco más que proporcional: los toquecitos cerca del hoyo se controlan mejor
  const v = VMAX * p * (0.55 + 0.45 * p);
  return { vx: (shot.dx / l) * v, vy: (shot.dy / l) * v };
}

/**
 * Simula un tiro.
 * @param hole  definición del hoyo (golf-courses.js)
 * @param ball  { x, y } de donde sale
 * @param shot  { dx, dy, power }
 * @param t0    en qué momento del vaivén iban los obstáculos móviles (s)
 * @returns {{ frames: Float64Array, n: number, events: object[], end: 'stop'|'cup'|'water', x: number, y: number, dur: number }}
 *   frames: por cuadro [x, y, visible(0/1)]
 */
export function simulate(hole, ball, shot, t0 = 0) {
  const segs = segmentsOf(hole);
  const posts = hole.posts || [], zones = hole.zones || [], movers = (hole.movers || []).filter((m) => m.solid);
  const tunnels = hole.tunnels || [];
  const cup = hole.cup;
  const st = { x: ball.x, y: ball.y, ...launch(shot) };
  const maxSteps = Math.floor(MAX_TIME / STEP);
  // los cuadros crecen según se necesiten (casi todos los tiros duran pocos segundos: reservar
  // los 30 s posibles en cada simulación era mucha memoria para nada)
  let frames = new Float64Array(256 * 3);
  let n = 0;
  const rec = (vis) => {
    if ((n + 1) * 3 > frames.length) { const f = new Float64Array(frames.length * 2); f.set(frames); frames = f; }
    frames[n * 3] = st.x; frames[n * 3 + 1] = st.y; frames[n * 3 + 2] = vis; n++;
  };
  const events = [];
  let end = 'stop', hidden = 0, lastHit = -1, inSand = false, lastTunnel = null;
  rec(1);
  let step = 0;
  for (; step < maxSteps; step++) {
    const t = step * STEP;
    if (hidden > 0) {
      hidden -= STEP;
      if (hidden <= 0) { events.push({ t, type: 'out' }); }
      if ((step + 1) % REC === 0) rec(hidden > 0 ? 0 : 1);
      continue;
    }
    // superficie y pendiente donde está la pelota
    let fric = ROLL, ax = 0, ay = 0, water = false, sand = false;
    for (const z of zones) {
      if (!inPoly(st.x, st.y, z.poly)) continue;
      if (z.type === 'water') water = true;
      else if (z.type === 'slope') { ax += z.ax; ay += z.ay; }
      else if (SURF[z.type] != null) { fric = SURF[z.type]; sand = z.type === 'sand' || z.type === 'petals'; }
    }
    if (water) { events.push({ t, type: 'water' }); end = 'water'; break; }
    if (sand && !inSand) events.push({ t, type: 'sand' });
    inSand = sand;
    // el hoyo: lento, cae; rápido, el borde lo curvea
    const cdx = cup.x - st.x, cdy = cup.y - st.y, cd2 = cdx * cdx + cdy * cdy;
    let speed = Math.sqrt(st.vx * st.vx + st.vy * st.vy);
    if (cd2 < CUP_R * CUP_R) {
      if (speed < CUP_CAPTURE && cd2 < (CUP_R - R * 0.35) * (CUP_R - R * 0.35)) {
        events.push({ t, type: 'cup', v: speed }); end = 'cup';
        st.x = cup.x; st.y = cup.y; st.vx = st.vy = 0; rec(1);
        break;
      }
      const cd = Math.sqrt(cd2) || 1;
      ax += (cdx / cd) * CUP_PULL; ay += (cdy / cd) * CUP_PULL;
    }
    // ¿se detuvo?
    const slope = Math.sqrt(ax * ax + ay * ay);
    if (speed < STOP_V && slope < STATIC) { st.vx = st.vy = 0; break; }
    // fricción (sin pasarse: se frena hasta cero, no se regresa) + pendiente
    if (speed > 0) {
      const dv = fric * STEP;
      const k = speed > dv ? (speed - dv) / speed : 0;
      st.vx *= k; st.vy *= k;
    }
    st.vx += ax * STEP; st.vy += ay * STEP;
    st.x += st.vx * STEP; st.y += st.vy * STEP;
    // choques
    let hit = 0, hitE = 0.72;
    for (const s of segs) { const h = hitSegment(s, st); if (h > hit) { hit = h; hitE = s.e; } }
    for (const p of posts) { const h = hitPost(p, st); if (h > hit) { hit = h; hitE = p.e ?? 0.72; } }
    for (const m of movers) { const h = hitMover(m, st, t0 + t); if (h > hit) { hit = h; hitE = 0.8; } }
    if (hit > 0.05 && step - lastHit > 12) { events.push({ t, type: hitE > 1 ? 'rope' : 'wall', v: hit }); lastHit = step; }
    // túneles: entra por una boca y sale por la otra
    for (const tu of tunnels) {
      const dx = st.x - tu.in.x, dy = st.y - tu.in.y;
      if (dx * dx + dy * dy < tu.in.r * tu.in.r && lastTunnel !== tu) {
        speed = Math.sqrt(st.vx * st.vx + st.vy * st.vy);
        const v = Math.max(0.35, speed * (tu.keep ?? 0.85));
        const l = Math.sqrt(tu.dir[0] * tu.dir[0] + tu.dir[1] * tu.dir[1]);
        st.x = tu.out.x; st.y = tu.out.y;
        st.vx = (tu.dir[0] / l) * v; st.vy = (tu.dir[1] / l) * v;
        events.push({ t, type: 'tunnel', v: speed });
        hidden = TUNNEL_TIME; lastTunnel = tu;
        break;
      }
    }
    if ((step + 1) % REC === 0) rec(hidden > 0 ? 0 : 1);
  }
  if (end !== 'cup') rec(1);
  return { frames, n, events, end, x: st.x, y: st.y, dur: step * STEP };
}
