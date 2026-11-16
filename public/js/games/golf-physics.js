// Física del minigolf. Determinista como la del billar: solo + − × ÷, Math.sqrt, abs, min,
// max y floor (nada de Math.sin/cos/exp, que cambian de un navegador a otro: los giros usan
// sinT/cosT, un polinomio propio), así que el líder (árbitro) y los dos teléfonos calculan
// exactamente el mismo tiro. Por la red solo viaja el tiro: dirección, fuerza y en qué momento
// iban las cosas que se mueven (todas dependen solo del tiempo).
//
// Unidades: metros y segundos. La pelota es de caricatura (más grande que una de verdad)
// para que se vea bien en un teléfono.
//
// Lo que puede tener un hoyo (golf-courses.js):
//   walls      polilíneas; e = rebote (1.12 = cuerdas del ring)
//   posts      postes redondos { x, y, r, e }
//   zones      { type, poly, ... }:
//                slope (ax, ay)  pendiente
//                sand / petals   frenan mucho
//                ice (life)      resbala; aguanta `life` segundos de pelotas encima EN TOTAL
//                                (se va cuarteando turno tras turno; quedarse quieta encima
//                                lo cuartea de golpe) y luego se rompe: agua
//                water / pit     al agua / al bache: un golpe de castigo
//                ramp (dx, dy)   tablón: frena al subir y, si llega con fuerza, la pelota salta
//   movers     rectángulos que van y vienen (path, move, wait, offset); solid = estorban
//   platforms  rectángulos que te llevan (trajineras, el vagón del metro): si la pelota se
//              queda arriba, viaja con ellos y al llegar brinca al muelle (docks)
//   spinners   brazos que giran (torniquetes, el tráfico de la glorieta)
//   rings      anillo que gira con huecos (la Piedra del Sol)
//   fans       ventiladores: empujan dentro de su caja cuando están prendidos
//   tunnels    entra por `in` y sale por `outs` (si hay varias, va cambiando cada `every` s)

export const R = 0.045;          // radio de la pelota
export const CUP_R = 0.09;       // radio del hoyo
export const VMAX = 3.9;         // velocidad con fuerza máxima (m/s)
export const STEP = 1 / 480;     // paso de integración (a 3.9 m/s avanza < R/5: no atraviesa paredes)
export const FRAME_DT = 1 / 120; // cada cuánto se guarda un cuadro para animar
const REC = Math.round(FRAME_DT / STEP);
const MAX_TIME = 40;

const ROLL = 0.85;               // frenado sobre el pasto (m/s²)
const SURF = { sand: 4.2, ice: 0.22, petals: 2.4 }; // frenado de otras superficies
const STATIC = 0.32;             // una pendiente más suave que esto no mueve una pelota quieta
const STOP_V = 0.012;
const WALL_E = 0.72;             // rebote en paredes normales
const WALL_T = 0.9;              // lo que conserva de su velocidad a lo largo de la pared
const CUP_CAPTURE = 1.35;        // más rápido que esto, la pelota pasa sobre el hoyo
const CUP_PULL = 7.5;            // el borde del hoyo jala hacia adentro (curvea los tiros rápidos)
const TUNNEL_TIME = 0.55;        // lo que tarda dentro de un túnel
const G = 6.5;                   // gravedad de caricatura (saltos más lentos y bonitos)
const RAMP_LIFT = 0.55;          // qué tanto sube al salir del tablón
const RAMP_PUSH = 1.6;           // lo que frena subir el tablón
const JUMP_MIN = 0.45;           // más lento que esto no salta: solo baja del tablón
const HOP_TIME = 0.42;           // brinco de la plataforma al muelle
const RIDE_V = 0.06;             // más lento que esto (respecto a la plataforma), viaja con ella
const PIN_TIME = 0.8;
const MAX_WAIT = 12;             // lo más que se espera quieta a que algo la mueva
const MAX_RESTS = 3;             // ni más de 3 veces (si no, un luchador la puede traer de un lado a otro sin fin)
const ICE_REST = 1.2;            // quedarse quieta sobre el hielo lo cuartea como 1.2 s de pelota            // empujada contra una pared sin moverse: se da por quieta

const PI2 = 6.283185307179586;

/** Seno de u vueltas (u = 1 → 360°). Polinomio de Taylor: igual en todos los navegadores. */
export function sinT(u) {
  let f = u - Math.floor(u);
  if (f > 0.75) f -= 1;
  else if (f > 0.25) f = 0.5 - f;
  const x = f * PI2, x2 = x * x;
  return x * (1 - (x2 / 6) * (1 - (x2 / 20) * (1 - (x2 / 42) * (1 - (x2 / 72) * (1 - x2 / 110)))));
}
export const cosT = (u) => sinT(u + 0.25);

/**
 * Posición de algo que va y viene: de path[0] a path[1] en `move` s, espera `wait` s, regresa
 * y espera otra vez. at = 0/1 si está parado en una punta, -1 si va en camino.
 */
export function travel(m, t) {
  const mv = m.move, wt = m.wait || 0, P = 2 * (mv + wt);
  let u = (t + (m.offset || 0)) / P;
  u = (u - Math.floor(u)) * P;
  const [ax, ay] = m.path[0], [bx, by] = m.path[1];
  let k, s, at = -1;
  if (u < mv) { k = u / mv; s = 1 / mv; }
  else if (u < mv + wt) { k = 1; s = 0; at = 1; }
  else if (u < 2 * mv + wt) { k = 1 - (u - mv - wt) / mv; s = -1 / mv; }
  else { k = 0; s = 0; at = 0; }
  return { x: ax + (bx - ax) * k, y: ay + (by - ay) * k, vx: (bx - ax) * s, vy: (by - ay) * s, at };
}
export const moverAt = travel;

/** ¿Está prendido el ventilador en el tiempo t? */
export function fanOn(f, t) {
  if (!f.on) return true;
  const P = f.on + f.off;
  let u = (t + (f.offset || 0)) / P;
  u = (u - Math.floor(u)) * P;
  return u < f.on;
}

/** Por cuál boca sale un túnel en el tiempo t. */
export function tunnelOut(tu, t) {
  const outs = tu.outs || [tu.out];
  if (outs.length === 1 || !tu.every) return 0;
  return Math.floor((t + (tu.offset || 0)) / tu.every) % outs.length;
}

/** Ángulo (en vueltas) de algo que gira. */
export const turnAt = (sp, t) => (sp.a0 || 0) + sp.rev * t;

/** ¿El punto está dentro del polígono? (cruces de rayo; solo comparaciones y aritmética) */
export function inPoly(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Lo que se calcula una vez por hoyo: segmentos de pared, cajas de las zonas, cuál hielo es cuál. */
export function prepOf(hole) {
  if (hole._prep) return hole._prep;
  const segs = [];
  for (const w of hole.walls || []) {
    const pts = w.pts || w, e = w.e ?? WALL_E;
    for (let i = 0; i + 1 < pts.length; i++) segs.push({ ax: pts[i][0], ay: pts[i][1], bx: pts[i + 1][0], by: pts[i + 1][1], e });
  }
  let ice = 0;
  const zones = (hole.zones || []).map((z) => {
    const xs = z.poly.map((p) => p[0]), ys = z.poly.map((p) => p[1]);
    return { z, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), ice: z.type === 'ice' ? ice++ : -1 };
  });
  // zonas de peligro: si la pelota se queda quieta aquí, algo la va a mover (se sigue simulando)
  const danger = [];
  for (const m of hole.movers || []) if (m.solid) {
    const [a, b] = m.path;
    danger.push({ x0: Math.min(a[0], b[0]) - m.w / 2 - R, x1: Math.max(a[0], b[0]) + m.w / 2 + R, y0: Math.min(a[1], b[1]) - m.h / 2 - R, y1: Math.max(a[1], b[1]) + m.h / 2 + R });
  }
  for (const f of hole.fans || []) danger.push({ x0: f.box[0], y0: f.box[1], x1: f.box[2], y1: f.box[3] });
  const prep = { segs, zones, danger, nIce: ice };
  Object.defineProperty(hole, '_prep', { value: prep, enumerable: false });
  return prep;
}
export const segmentsOf = (hole) => prepOf(hole).segs;
export const iceCount = (hole) => prepOf(hole).nIce;

/* rebote contra el punto (cx, cy) que se mueve a (vxm, vym); rad = distancia mínima */
function bounce(st, cx, cy, rad, e, vxm, vym) {
  const dx = st.x - cx, dy = st.y - cy;
  const d2 = dx * dx + dy * dy;
  if (d2 >= rad * rad || d2 === 0) return 0;
  const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
  st.x = cx + nx * rad; st.y = cy + ny * rad;
  const rx = st.vx - vxm, ry = st.vy - vym;
  const vn = rx * nx + ry * ny;
  if (vn >= 0) return 0;
  const tx = rx - vn * nx, ty = ry - vn * ny;
  st.vx = tx * WALL_T - vn * e * nx + vxm;
  st.vy = ty * WALL_T - vn * e * ny + vym;
  // (las cuerdas del ring y lo que golpea rebotan fuerte, pero con tope)
  const v2 = st.vx * st.vx + st.vy * st.vy;
  if (v2 > VMAX * VMAX) { const k = VMAX / Math.sqrt(v2); st.vx *= k; st.vy *= k; }
  return -vn;
}
/* el punto de un segmento más cercano a la pelota (cubre también las esquinas) */
function hitSeg(ax, ay, bx, by, e, st, vxm, vym) {
  const ex = bx - ax, ey = by - ay;
  const L2 = ex * ex + ey * ey;
  let u = L2 > 0 ? ((st.x - ax) * ex + (st.y - ay) * ey) / L2 : 0;
  u = u < 0 ? 0 : u > 1 ? 1 : u;
  return bounce(st, ax + ex * u, ay + ey * u, R, e, vxm, vym);
}

/* rectángulo que se mueve: sus 4 lados; si se le vino encima a la pelota, la saca por el lado más cercano */
function hitBox(p, w, h, e, st, sides) {
  const hw = w / 2, hh = h / 2;
  const x0 = p.x - hw, x1 = p.x + hw, y0 = p.y - hh, y1 = p.y + hh;
  let best = 0;
  if (sides.n) best = Math.max(best, hitSeg(x0, y0, x1, y0, e, st, p.vx, p.vy));
  if (sides.e) best = Math.max(best, hitSeg(x1, y0, x1, y1, e, st, p.vx, p.vy));
  if (sides.s) best = Math.max(best, hitSeg(x1, y1, x0, y1, e, st, p.vx, p.vy));
  if (sides.w) best = Math.max(best, hitSeg(x0, y1, x0, y0, e, st, p.vx, p.vy));
  return best;
}
const ALL = { n: 1, e: 1, s: 1, w: 1 };
function hitMover(m, st, t) {
  const p = travel(m, t);
  const best = hitBox(p, m.w, m.h, 0.8, st, ALL);
  const hw = m.w / 2, hh = m.h / 2;
  const x0 = p.x - hw, x1 = p.x + hw, y0 = p.y - hh, y1 = p.y + hh;
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
/* brazos que giran alrededor de (x, y) */
function hitSpinner(sp, st, t) {
  const dx = st.x - sp.x, dy = st.y - sp.y, reach = sp.L + sp.t + R;
  if (dx * dx + dy * dy > reach * reach) return 0;
  const turn = turnAt(sp, t), om = PI2 * sp.rev;
  let best = 0;
  for (let k = 0; k < sp.arms; k++) {
    const a = turn + k / sp.arms, c = cosT(a), s = sinT(a);
    const h0 = sp.hub || 0;
    // punto del brazo más cercano a la pelota
    let u = dx * c + dy * s;
    u = u < h0 ? h0 : u > sp.L ? sp.L : u;
    const cx = sp.x + c * u, cy = sp.y + s * u;
    best = Math.max(best, bounce(st, cx, cy, sp.t + R, sp.e ?? 0.9, -om * (cy - sp.y), om * (cx - sp.x)));
  }
  if (sp.hub) best = Math.max(best, bounce(st, sp.x, sp.y, sp.hub + R, WALL_E, 0, 0));
  return best;
}
/* anillo que gira, con huecos */
function hitRing(g, st, t) {
  const dx = st.x - g.x, dy = st.y - g.y, d2 = dx * dx + dy * dy;
  const outer = g.r + g.t + R, inner = g.r - g.t - R;
  if (d2 >= outer * outer || d2 <= inner * inner || d2 === 0) return 0;
  const d = Math.sqrt(d2), ux = dx / d, uy = dy / d;
  const turn = turnAt(g, t), om = PI2 * g.rev, e = g.e ?? WALL_E;
  for (const gap of g.gaps) {
    const a = turn + gap.a;
    if (ux * cosT(a) + uy * sinT(a) > cosT(gap.w)) {
      // dentro del hueco: solo pueden pegarle las dos puntas del anillo
      let best = 0;
      for (const ca of [a - gap.w, a + gap.w]) {
        const px = g.x + cosT(ca) * g.r, py = g.y + sinT(ca) * g.r;
        best = Math.max(best, bounce(st, px, py, g.t + R, e, -om * (py - g.y), om * (px - g.x)));
      }
      return best;
    }
  }
  const cx = g.x + ux * g.r, cy = g.y + uy * g.r;
  return bounce(st, cx, cy, g.t + R, e, -om * (cy - g.y), om * (cx - g.x));
}
/* plataforma: barandales fijos (rails) y puertas que solo se cierran mientras viaja (doors) */
function railsOf(pf, at) {
  const r = pf.rails || '', dr = at < 0 ? pf.doors || '' : '';
  return { n: r.includes('n') || dr.includes('n'), e: r.includes('e') || dr.includes('e'), s: r.includes('s') || dr.includes('s'), w: r.includes('w') || dr.includes('w') };
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
 * @param t0    en qué momento iban las cosas que se mueven (s)
 * @param wear  segundos que ya aguantó cada pista de hielo (se va cuarteando)
 * @returns {{ frames: Float64Array, n: number, events: object[], end: 'stop'|'cup'|'water',
 *   why: string, x: number, y: number, dur: number, wear: number[] }}
 *   frames: por cuadro [x, y, v] — v = 0 escondida (túnel), 1 + altura si se ve (salto)
 *   why: 'water' | 'pit' | 'ice' | 'tracks' cuando end = 'water'
 */
export function simulate(hole, ball, shot, t0 = 0, wear = []) {
  const { segs, zones, danger } = prepOf(hole);
  const posts = hole.posts || [], movers = (hole.movers || []).filter((m) => m.solid);
  const platforms = hole.platforms || [], spinners = hole.spinners || [], rings = hole.rings || [];
  const fans = hole.fans || [], tunnels = hole.tunnels || [];
  const cup = hole.cup;
  const wr = zones.filter((q) => q.ice >= 0).map((q) => +wear[q.ice] || 0);
  const st = { x: ball.x, y: ball.y, ...launch(shot) };
  const maxSteps = Math.floor(MAX_TIME / STEP);
  // los cuadros crecen según se necesiten (casi todos los tiros duran pocos segundos)
  let frames = new Float64Array(256 * 3);
  let n = 0;
  let z = 0, vz = 0;               // altura (saltos)
  let hidden = 0;                  // dentro de un túnel
  let hop = null;                  // brincando de la plataforma al muelle
  let ride = -1;                   // en qué plataforma va (quieta respecto a ella)
  const rec = (vis) => {
    if ((n + 1) * 3 > frames.length) { const f = new Float64Array(frames.length * 2); f.set(frames); frames = f; }
    frames[n * 3] = st.x; frames[n * 3 + 1] = st.y; frames[n * 3 + 2] = vis; n++;
  };
  const events = [];
  let end = 'stop', why = '', lastHit = -1, inSand = false, lastTunnel = null, lastRamp = null, pin = 0, waited = 0, rests = 0, resting = false;
  const pfAt = platforms.map((pf) => travel(pf, t0).at);
  /* el hielo aguanta `life` segundos de pelota encima; true si con esto se rompió */
  const wearIce = (q, add, t) => {
    const i = q.ice, life = q.z.life, before = wr[i];
    wr[i] += add;
    for (const k of [0.25, 0.5, 0.75]) if (before < life * k && wr[i] >= life * k) events.push({ t, type: 'crack', ice: i, w: wr[i] });
    if (wr[i] >= life) { events.push({ t, type: 'break', ice: i, w: wr[i] }); return true; }
    return false;
  };
  rec(1);
  let step = 0;
  for (; step < maxSteps; step++) {
    const t = step * STEP, T = t0 + t;
    const frame = (step + 1) % REC === 0;
    // plataformas: dónde van y si alguna acaba de llegar a su muelle
    const pfs = platforms.map((pf) => travel(pf, T));
    for (let i = 0; i < pfs.length; i++) {
      const arrived = pfs[i].at >= 0 && pfAt[i] < 0;
      pfAt[i] = pfs[i].at;
      if (arrived && ride === i && !hop) {
        const dk = platforms[i].docks[pfs[i].at];
        hop = { x0: st.x, y0: st.y, x1: dk.x, y1: dk.y, t: 0 };
        ride = -1; st.vx = st.vy = 0;
        events.push({ t, type: 'hop' });
      }
    }
    if (hidden > 0) {
      hidden -= STEP;
      if (hidden <= 0) events.push({ t, type: 'out' });
      if (frame) rec(hidden > 0 ? 0 : 1);
      continue;
    }
    if (hop) {
      hop.t += STEP;
      const k = Math.min(1, hop.t / HOP_TIME);
      st.x = hop.x0 + (hop.x1 - hop.x0) * k; st.y = hop.y0 + (hop.y1 - hop.y0) * k;
      z = 0.9 * k * (1 - k);
      if (k >= 1) { hop = null; z = 0; events.push({ t, type: 'land' }); }
      if (frame) rec(1 + z);
      continue;
    }
    if (ride >= 0) {
      // viaja con la plataforma
      const p = pfs[ride];
      st.vx = p.vx; st.vy = p.vy;
      st.x += p.vx * STEP; st.y += p.vy * STEP;
      if (frame) rec(1);
      continue;
    }
    const air = z > 0;
    // ¿sobre una plataforma?
    let onP = -1;
    if (!air) for (let i = 0; i < platforms.length; i++) {
      const pf = platforms[i], p = pfs[i];
      if (Math.abs(st.x - p.x) < pf.w / 2 && Math.abs(st.y - p.y) < pf.h / 2) { onP = i; break; }
    }
    // superficie, pendiente y viento donde está la pelota
    let fric = ROLL, ax = 0, ay = 0, fall = '', sand = false, ramp = null, onIce = null;
    if (!air && onP < 0) {
      for (const q of zones) {
        if (st.x < q.x0 || st.x > q.x1 || st.y < q.y0 || st.y > q.y1 || !inPoly(st.x, st.y, q.z.poly)) continue;
        const zt = q.z.type;
        if (zt === 'water' || zt === 'pit') fall = q.z.why || zt;
        else if (zt === 'slope') { ax += q.z.ax; ay += q.z.ay; }
        else if (zt === 'ramp') { ramp = q; ax -= q.z.dx * RAMP_PUSH; ay -= q.z.dy * RAMP_PUSH; }
        else if (zt === 'ice') {
          if (wr[q.ice] >= q.z.life) { fall = 'water'; continue; }
          fric = SURF.ice; onIce = q;
          if (wearIce(q, STEP, t)) fall = 'ice';
        } else if (SURF[zt] != null) { fric = SURF[zt]; sand = true; }
      }
    }
    // salir del tablón con vuelo = salto (antes de ver si cayó: la zanja empieza donde acaba el tablón)
    if (!air && lastRamp && ramp !== lastRamp) {
      const along = st.vx * lastRamp.z.dx + st.vy * lastRamp.z.dy;
      if (along > JUMP_MIN) { vz = along * RAMP_LIFT; z = 1e-6; fall = ''; fric = 0; ax = ay = 0; events.push({ t, type: 'jump', v: along }); }
    }
    lastRamp = z > 0 ? null : ramp;
    if (fall) { events.push({ t, type: 'water', why: fall }); end = 'water'; why = fall; break; }
    if (sand && !inSand) events.push({ t, type: 'sand' });
    inSand = sand;
    for (const f of fans) {
      if (st.x < f.box[0] || st.x > f.box[2] || st.y < f.box[1] || st.y > f.box[3] || !fanOn(f, T)) continue;
      ax += f.ax; ay += f.ay;
    }
    // el hoyo: lento, cae; rápido, el borde lo curvea
    let speed = Math.sqrt(st.vx * st.vx + st.vy * st.vy);
    if (!air && onP < 0) {
      const cdx = cup.x - st.x, cdy = cup.y - st.y, cd2 = cdx * cdx + cdy * cdy;
      if (cd2 < CUP_R * CUP_R) {
        if (speed < CUP_CAPTURE && cd2 < (CUP_R - R * 0.35) * (CUP_R - R * 0.35)) {
          events.push({ t, type: 'cup', v: speed }); end = 'cup';
          st.x = cup.x; st.y = cup.y; st.vx = st.vy = 0; rec(1);
          break;
        }
        const cd = Math.sqrt(cd2) || 1;
        ax += (cdx / cd) * CUP_PULL; ay += (cdy / cd) * CUP_PULL;
      }
    }
    const acc = Math.sqrt(ax * ax + ay * ay);
    if (onP >= 0) {
      // sobre la plataforma: el pasto frena la velocidad RESPECTO a ella
      const p = pfs[onP];
      const rx = st.vx - p.vx, ry = st.vy - p.vy, rs = Math.sqrt(rx * rx + ry * ry);
      if (rs < RIDE_V) {
        ride = onP; st.vx = p.vx; st.vy = p.vy;
        events.push({ t, type: 'board' });
        if (frame) rec(1);
        continue;
      }
      const k = rs > fric * STEP ? (rs - fric * STEP) / rs : 0;
      st.vx = p.vx + rx * k; st.vy = p.vy + ry * k;
    } else if (!air) {
      // ¿se detuvo?
      if (speed < STOP_V && acc < STATIC) {
        st.vx = st.vy = 0;
        if (onIce) {
          // se quedó quieta sobre el hielo: con el peso, cruje de golpe (y si ya no aguanta, se rompe)
          if (wearIce(onIce, ICE_REST, t)) { events.push({ t, type: 'water', why: 'ice' }); end = 'water'; why = 'ice'; }
          break;
        }
        if (!dangerAt(st, danger, spinners, rings)) break;
        // está quieta donde algo la va a mover: se espera, sin moverse, a que pase
        if (!resting) { resting = true; rests++; }
        waited += STEP;
        if (waited > MAX_WAIT || rests > MAX_RESTS) break;
        ax = ay = 0;
      } else resting = false;
      // empujada contra una pared (viento, pendiente) sin poder moverse: también se da por quieta
      pin = speed < 0.05 && acc >= STATIC ? pin + STEP : 0;
      if (pin > PIN_TIME) { st.vx = st.vy = 0; break; }
      // fricción (sin pasarse: se frena hasta cero, no se regresa)
      if (speed > 0) {
        const dv = fric * STEP;
        const k = speed > dv ? (speed - dv) / speed : 0;
        st.vx *= k; st.vy *= k;
      }
    } else {
      // en el aire
      vz -= G * STEP; z += vz * STEP;
      if (z <= 0) { z = 0; vz = 0; st.vx *= 0.92; st.vy *= 0.92; events.push({ t, type: 'land' }); }
    }
    st.vx += ax * STEP; st.vy += ay * STEP;
    st.x += st.vx * STEP; st.y += st.vy * STEP;
    // choques
    let hit = 0, hitE = WALL_E, whack = false;
    for (const s of segs) { const h = hitSeg(s.ax, s.ay, s.bx, s.by, s.e, st, 0, 0); if (h > hit) { hit = h; hitE = s.e; } }
    for (const p of posts) { const h = bounce(st, p.x, p.y, p.r + R, p.e ?? WALL_E, 0, 0); if (h > hit) { hit = h; hitE = p.e ?? WALL_E; } }
    for (const m of movers) { const h = hitMover(m, st, T); if (h > hit) { hit = h; hitE = 0.8; } }
    for (let i = 0; i < platforms.length; i++) {
      const pf = platforms[i];
      const h = hitBox(pfs[i], pf.w, pf.h, 0.6, st, railsOf(pf, pfs[i].at));
      if (h > hit) { hit = h; hitE = 0.6; }
    }
    for (const sp of spinners) { const h = hitSpinner(sp, st, T); if (h > hit) { hit = h; hitE = sp.e ?? 0.9; whack = true; } }
    for (const g of rings) { const h = hitRing(g, st, T); if (h > hit) { hit = h; hitE = g.e ?? WALL_E; whack = true; } }
    if (hit > 0.05 && step - lastHit > 12) { events.push({ t, type: hitE > 1 ? 'rope' : whack ? 'whack' : 'wall', v: hit }); lastHit = step; }
    // túneles: entra por una boca y sale por otra
    if (!air) for (const tu of tunnels) {
      const dx = st.x - tu.in.x, dy = st.y - tu.in.y;
      if (dx * dx + dy * dy < tu.in.r * tu.in.r && lastTunnel !== tu) {
        speed = Math.sqrt(st.vx * st.vx + st.vy * st.vy);
        const v = Math.max(0.35, speed * (tu.keep ?? 0.85));
        const out = (tu.outs || [tu.out])[tunnelOut(tu, T)];
        const l = Math.sqrt(out.dir[0] * out.dir[0] + out.dir[1] * out.dir[1]);
        st.x = out.x; st.y = out.y;
        st.vx = (out.dir[0] / l) * v; st.vy = (out.dir[1] / l) * v;
        events.push({ t, type: 'tunnel', v: speed });
        hidden = TUNNEL_TIME; lastTunnel = tu;
        break;
      }
    }
    if (frame) rec(hidden > 0 ? 0 : 1 + z);
  }
  // red de seguridad: si algo la sacó del pasto (o se acabó el tiempo sobre el agua), es castigo
  if (end === 'stop' && (ride >= 0 || hop || z > 0 || !hole.green.some((p) => inPoly(st.x, st.y, p)) || fallAt(hole, st.x, st.y, wr))) {
    end = 'water'; why = 'out'; events.push({ t: step * STEP, type: 'water', why });
  }
  if (end !== 'cup') rec(1);
  return { frames, n, events, end, why, x: st.x, y: st.y, dur: step * STEP, wear: wr };
}

/** ¿Caer aquí es castigo? (agua, bache, vías o hielo ya roto) */
export function fallAt(hole, x, y, wear = []) {
  const { zones } = prepOf(hole);
  for (const q of zones) {
    if (x < q.x0 || x > q.x1 || y < q.y0 || y > q.y1 || !inPoly(x, y, q.z.poly)) continue;
    if (q.z.type === 'water' || q.z.type === 'pit') return true;
    if (q.z.type === 'ice' && (+wear[q.ice] || 0) >= q.z.life) return true;
  }
  return false;
}

/* ¿una pelota quieta aquí la va a mover algo? (brazos que giran, carritos, ventiladores) */
function dangerAt(st, danger, spinners, rings) {
  for (const d of danger) if (st.x > d.x0 && st.x < d.x1 && st.y > d.y0 && st.y < d.y1) return true;
  for (const sp of spinners) {
    const dx = st.x - sp.x, dy = st.y - sp.y, r = sp.L + sp.t + R - 0.002;
    if (dx * dx + dy * dy < r * r) return true;
  }
  for (const g of rings) {
    const dx = st.x - g.x, dy = st.y - g.y, d = Math.sqrt(dx * dx + dy * dy);
    if (Math.abs(d - g.r) < g.t + R - 0.002) return true;
  }
  return false;
}
