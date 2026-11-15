// Física del billar (bola 8). Módulo puro, sin DOM ni imports: el servidor lo corre como árbitro
// y los dos navegadores corren exactamente lo mismo para animar el tiro.
//
// DETERMINISMO: todo lo que influye en el resultado usa solo + - * / y Math.sqrt/abs/min/max/floor
// (exactos según IEEE-754 en cualquier motor JS). Nada de sin/cos/pow/exp/random/Date. Las bolas se
// recorren siempre en el orden de entrada y el número de subpasos sale del propio estado.
//
// Unidades SI. Ejes: x a la derecha, y hacia ABAJO (como en pantalla) y z hacia adentro de la mesa,
// así (x, y, z) es una terna derecha y los productos cruz se escriben como siempre.
//
// Convención del efecto (shot.sx, shot.sy), vista desde quien tira:
//  - sx > 0: la punta pega a la DERECHA del centro ("efecto derecho"). Vista desde arriba la blanca gira
//    en sentido antihorario; al chocar de frente con una banda sale hacia la DERECHA del tiro, y a la
//    bola que toca la "tira" hacia la izquierda. La derecha del tiro (dx, dy) es el vector (-dy, dx).
//  - sy > 0: pega ARRIBA del centro (corrido / follow). sy < 0: abajo (retroceso / draw).
//    Con sy = +0.8 la blanca sale ya rodando natural; con sy ≈ -0.1…-0.3 llega "muerta" (stun) a corta distancia.

const R = 0.028575, W = 2.54, H = 1.27, D = 2 * R;

/**
 * Constantes ajustables. Se leen al empezar cada simulate(): servidor y clientes deben usar las mismas.
 * Valores contrastados con lo publicado (Alciatore "Dr. Dave", Marlow, Shepard, Mathavan et al., WPA):
 *  - Bola WPA: 2¼" (57.15 mm) y 5½–6 oz (156–170 g). Como todas pesan lo mismo, la masa se cancela en
 *    choques y frenado: solo cuenta frente al taco. Lo que decide cuánto rueda una bola es el PAÑO.
 *  - Rodadura: 0.005–0.015 (Dr. Dave); Marlow midió 0.016 de media en mesas de pool. "Velocidad de mesa"
 *    = 1/μr: ~100 con paño peinado de torneo (Simonis 860), 50–70 en mesas lentas de bar o de casa
 *    (Shepard). Usamos 0.015 (mesa ≈ 67): una mesa casual, donde la bola frena 1.5 veces más rápido
 *    que en una de torneo. Es constante: no depende de la velocidad (Mathavan 2009).
 *  - Deslizamiento 0.15–0.4 (típico 0.2); giro vertical 5–15 rad/s²; bola-bola e 0.92–0.98, μ 0.03–0.08;
 *    banda: una bola que llega rodando sale con ~0.7 de su velocidad y vuelve a rodar con ~0.5–0.55.
 */
export const PHYS = {
  g: 9.81,
  m: 0.17,              // masa de la bola (kg): 6 oz
  cueMass: 0.54,        // masa del taco (kg): 19 oz. Pegar lejos del centro transmite menos velocidad
  vMin: 0.3, vMax: 11, // velocidad de la blanca (m/s) con power 0 y 1, pegando al centro (11 m/s ≈ 25 mph: un buen saque)
  soft: [0.4, 2],       // zona suave de la barra: con power 0.4 la blanca sale a 2 m/s (casi todos los tiros reales van de 0.5 a 3 m/s)
  tipMax: 0.5,          // desplazamiento máximo de la punta, en radios (más allá sería pifia)
  squirt: 0.012,        // desvío de la blanca hacia el lado contrario al efecto (tangente por radio de offset; 0 = sin desvío)
  muS: 0.2,             // fricción bola-paño deslizando
  muR: 0.015,           // resistencia a la rodadura (paño de mesa casual; 0.01 sería paño rápido de torneo)
  muSp: 0.0127,         // fricción del giro vertical (efecto lateral): frena ~11 rad/s²
  eBall: 0.95,          // restitución bola-bola
  muBall: [0.01, 0.108, 1.088], // fricción bola-bola μ = a + b·e^(-c·s) (ajuste de Alciatore; e^ se aproxima sin exp)
  eCushion: 0.8,        // restitución de la goma (a lo largo de la línea de contacto)
  muCushion: [0.09, 0.38], // fricción bola-goma μ = a + b·cos²(incidencia): agarra de frente, resbala de refilón (ajuste de Han)
  cushionSin: 0.27,     // seno del ángulo de contacto: la nariz de la banda está a 0.635 diámetros de alto
  maxTime: 25,          // tope duro de la simulación (s)
};

// Un cuadro guardado cada 1/240 s. Quien anima interpola en línea recta entre cuadros, así que en el
// cuadro donde hay un choque la bola "corta la esquina": el error es como mucho v·FRAME_DT/2
// (1 cm a 5 m/s; con 1/60 eran 4 cm, más que el radio de la bola). Es el doble de fino que una pantalla de 120 Hz.
export const FRAME_DT = 1 / 240;

// ───────── Geometría de la mesa ─────────
const SQ = Math.SQRT1_2;
const MC = 0.115 * SQ;      // esquinas: boca de 11.5 cm entre puntas → cada punta a MC del vértice
const MS = 0.065;           // medias: boca de 13 cm
const RC = 0.06, RS = 0.055; // radio de los agujeros (esquina / medio)
const OC = (RC - 0.0275) * SQ; // el borde del agujero de esquina queda 3 cm detrás de la boca (repisa)

const POCKETS = [
  { x: -OC, y: -OC, r: RC }, { x: W / 2, y: -RS, r: RS }, { x: W + OC, y: -OC, r: RC },
  { x: -OC, y: H + OC, r: RC }, { x: W / 2, y: H + RS, r: RS }, { x: W + OC, y: H + OC, r: RC },
];
// Eje de cada tronera (unitario, apuntando hacia la mesa). Una bola cae cuando su centro cruza la
// tangente al borde del agujero: (c - p)·eje < r. En las medias eso es justo la línea de la banda.
const PAX = [SQ, 0, -SQ, SQ, 0, -SQ], PAY = [SQ, 1, SQ, -SQ, -1, -SQ];
const NEAR2 = 0.12 * 0.12;

// Tramos de goma: 6 bandas (nariz) + 12 caras de tronera. Cada uno guarda su dirección y su normal
// hacia AFUERA (hacia la goma). (ix, iy) es cualquier punto del lado donde sí puede haber bolas.
const SEG = [], JAWS = [];
function addSeg(x1, y1, x2, y2, ix, iy) {
  const lx = x2 - x1, ly = y2 - y1, len = Math.sqrt(lx * lx + ly * ly), ex = lx / len, ey = ly / len;
  let nx = ey, ny = -ex;
  if ((ix - x1) * nx + (iy - y1) * ny > 0) { nx = -nx; ny = -ny; }
  SEG.push({ x1, y1, x2, y2, ex, ey, len, nx, ny });
}
{
  const fx = (f, x) => (f ? W - x : x), fy = (f, y) => (f ? H - y : y);
  for (const b of [0, 1]) for (const a of [0, 1]) // bandas largas: arriba-izq, arriba-der, abajo-izq, abajo-der
    addSeg(fx(a, MC), fy(b, 0), fx(a, W / 2 - MS), fy(b, 0), W / 2, H / 2);
  addSeg(0, MC, 0, H - MC, W / 2, H / 2);       // banda corta izquierda
  addSeg(W, MC, W, H - MC, W / 2, H / 2);       // banda corta derecha
  const LC = 0.05, LS = 0.035;                  // largo de las caras (esquina / medio)
  for (const b of [0, 1]) for (const a of [0, 1]) {
    // Caras de la esquina: 142° con la banda (se cierran 7° hacia la garganta). Caras de la media: 104°.
    addSeg(fx(a, MC), fy(b, 0), fx(a, MC - LC * 0.788), fy(b, -LC * 0.616), fx(a, MC / 2), fy(b, MC / 2));
    addSeg(fx(a, 0), fy(b, MC), fx(a, -LC * 0.616), fy(b, MC - LC * 0.788), fx(a, MC / 2), fy(b, MC / 2));
    addSeg(fx(a, W / 2 - MS), fy(b, 0), fx(a, W / 2 - MS + LS * 0.242), fy(b, -LS * 0.97), W / 2, fy(b, 0));
    JAWS.push([fx(a, MC), fy(b, 0)], [fx(a, 0), fy(b, MC)], [fx(a, W / 2 - MS), fy(b, 0)]);
  }
}

export const TABLE = {
  W, H, R,
  pockets: POCKETS,                                   // arriba-izq, arriba-medio, arriba-der, abajo-izq, abajo-medio, abajo-der
  cushions: SEG.map((s) => [s.x1, s.y1, s.x2, s.y2]), // primero las 6 bandas, luego las 12 caras de tronera
  jaws: JAWS,                                         // las 12 puntas (donde la banda dobla hacia la tronera)
  headX: W * 0.25,
  foot: { x: W * 0.75, y: H / 2 },
};

// ───────── Parámetros numéricos ─────────
const STEP = 0.004;      // avance máximo por subpaso (m): los subpasos por cuadro salen de la bola más rápida
const SUB_MAX = 48;      // (con un cuadro cada 1/240 s, por debajo de ~1 m/s basta un subpaso por cuadro)
const SINK = 1 - Math.sqrt(Math.sqrt(0.65)); // la bola embocada se acerca al centro del agujero un 35 % cada 1/60 s (= 4 cuadros)
const TOL = 5e-5;        // holgura de contacto (lo que se comprime una bola al chocar): a menos de esto cuentan
                         // como pegadas, así un triángulo armado con micras de separación se abre como uno apretado
const TOUCH2 = (D + TOL) * (D + TOL), RT2 = (R + TOL) * (R + TOL), SEP2 = (D - 1e-9) * (D - 1e-9);
const SLIP = 1e-6;       // por debajo de esto el punto de apoyo no patina: la bola rueda
const V_REST = 0.002;    // rodando más lento que esto, la bola se queda quieta
const V_EVENT = 0.02;    // choques más suaves no generan evento (ni se oirían): evita ráfagas cuando una bola empuja a otra
const V_TOUCH = 1e-4;    // …pero desde aquí ya cuentan como toque para firstHit / railAfterHit
const PASSES = 8, ITERS = 12, K = 2.5 / R;
const LO = R + TOL;

const clamp = (v, a, b) => Math.min(b, Math.max(a, +v || 0));

// Dirección real de salida de la blanca: la apuntada, corrida un pelín hacia el lado contrario al
// efecto lateral (squirt). `a` = offset lateral de la punta en radios. Devuelve null si no hay dirección.
function launchDir(dx, dy, a) {
  dx = +dx || 0; dy = +dy || 0;
  const dl = Math.sqrt(dx * dx + dy * dy);
  if (!(dl > 0 && dl < 1e12)) return null;
  dx /= dl; dy /= dl;
  const q = PHYS.squirt * a, ux = dx + q * dy, uy = dy - q * dx, ul = Math.sqrt(ux * ux + uy * uy);
  return [ux / ul, uy / ul];
}

// Curva de fuerza: velocidad de la blanca (m/s, pegando al centro) para power 0..1.
// v = vMin + s·p + c·p³: casi una recta en la zona suave (pasa por vMin en 0 y por soft[1] en soft[0],
// de 3 a 7 cm/s por cada 1 % de barra) y el término cúbico sube hasta vMax arriba, donde solo viven los
// tiros fuertes y el saque. Con vMax = 11: 0.1 → 0.6, 0.2 → 1.0, 0.4 → 2.0, 0.6 → 3.8, 0.8 → 6.6 m/s.
function cueSpeed(p) {
  const span = PHYS.vMax - PHYS.vMin, ps = PHYS.soft[0];
  const c = Math.max(0, (span - (PHYS.soft[1] - PHYS.vMin) / ps) / (1 - ps * ps));
  return PHYS.vMin + p * (span - c + c * p * p);
}

/** Estado inicial de la blanca para un tiro: { vx, vy, wx, wy, wz } (m/s y rad/s), o null si no hay dirección. */
export function strike(shot) {
  const p = clamp(shot.power, 0, 1);
  let sx = clamp(shot.sx, -1, 1), sy = clamp(shot.sy, -1, 1);
  const sl = Math.sqrt(sx * sx + sy * sy);
  if (sl > 1) { sx /= sl; sy /= sl; }                 // el límite de pifia es un círculo
  const a = sx * PHYS.tipMax, b = sy * PHYS.tipMax;   // offset de la punta en radios (derecha, arriba)
  // Pérdida por golpe descentrado (Alciatore TP A.30).
  const k = PHYS.m / PHYS.cueMass;
  const v = cueSpeed(p) * (1 + k) / (1 + k + 2.5 * (a * a + b * b));
  const u = launchDir(shot.dx, shot.dy, a);
  if (!u) return null;
  const ux = u[0], uy = u[1];
  // ω = (5/2R²)·(r × v): arriba/abajo da giro sobre el eje horizontal, el lado da giro vertical.
  const w = K * v;
  return { vx: v * ux, vy: v * uy, wx: w * b * uy, wy: -w * b * ux, wz: -w * a };
}

/**
 * Simula un tiro completo hasta que todo queda quieto.
 * balls: [{ id, x, y }] (solo las que están en la mesa; id 0 = blanca). shot: { dx, dy, power, sx, sy }.
 * Devuelve { frames, spins, nFrames, n, events, final, firstHit, railAfterHit, duration } (ver el contrato del juego).
 * frames y spins guardan un cuadro cada FRAME_DT (el cuadro f es el instante f·FRAME_DT), 3 números por bola:
 * [x, y, distancia rodada] y [wx, wy, wz]. Los eventos llevan su tiempo propio, que no está redondeado a cuadros.
 */
export function simulate(balls, shot) {
  const n = balls.length;
  const g = PHYS.g, aS = PHYS.muS * g, aR = PHYS.muR * g, aSp = K * PHYS.muSp * g;
  const eB = PHYS.eBall, mbA = PHYS.muBall[0], mbB = PHYS.muBall[1], mbC = PHYS.muBall[2];
  const eC1 = 1 + PHYS.eCushion, mcA = PHYS.muCushion[0], mcB = PHYS.muCushion[1], sT = PHYS.cushionSin, cT = Math.sqrt(1 - sT * sT);

  const F = () => new Float64Array(n);
  const X = F(), Y = F(), VX = F(), VY = F(), WX = F(), WY = F(), WZ = F(), ROLL = F(), LAG = F();
  const MOV = new Uint8Array(n);           // 1 = se traslada o patina
  const PK = new Int8Array(n).fill(-1);    // tronera en la que cayó (-1 = sigue en la mesa)
  const maxC = Math.max(1, (n * (n - 1)) / 2);
  const CI = new Int32Array(maxC), CJ = new Int32Array(maxC);
  const CNX = new Float64Array(maxC), CNY = new Float64Array(maxC), CV0 = new Float64Array(maxC), CJN = new Float64Array(maxC);

  const maxFrames = Math.floor(PHYS.maxTime / FRAME_DT) + 2;
  const frames = new Float32Array(maxFrames * n * 3);
  // giro real de cada bola por cuadro (wx, wy, wz en rad/s, eje z hacia el paño): solo para dibujar
  const spins = new Float32Array(maxFrames * n * 3);
  const events = [];
  let firstHit = null, railAfterHit = false, t = 0, cue = -1;

  for (let i = 0; i < n; i++) {
    X[i] = balls[i].x; Y[i] = balls[i].y;
    if (balls[i].id === 0) cue = i;
  }
  const s0 = cue >= 0 && shot ? strike(shot) : null;
  if (s0) { VX[cue] = s0.vx; VY[cue] = s0.vy; WX[cue] = s0.wx; WY[cue] = s0.wy; WZ[cue] = s0.wz; MOV[cue] = 1; }

  // Movimiento libre sobre el paño durante dt, resuelto de forma exacta por tramos:
  // deslizando (la fricción actúa sobre la velocidad del punto de apoyo u = v + ω×r, y la lleva a
  // cero en |u|/(3.5·μs·g)) y luego rodando (frenado constante μr·g). De aquí salen solos el
  // corrido, el retroceso y la bola "muerta".
  function advance(i, dt) {
    let vx = VX[i], vy = VY[i], wx = WX[i], wy = WY[i], rem = dt;
    const wz = WZ[i];
    if (wz !== 0) WZ[i] = wz > 0 ? Math.max(0, wz - aSp * dt) : Math.min(0, wz + aSp * dt);
    const ux = vx + R * wy, uy = vy - R * wx, us = Math.sqrt(ux * ux + uy * uy);
    if (us > SLIP) {
      const ts = Math.min(rem, us / (3.5 * aS));
      const ax = -aS * ux / us, ay = -aS * uy / us;
      const mx = (vx + 0.5 * ax * ts) * ts, my = (vy + 0.5 * ay * ts) * ts;
      X[i] += mx; Y[i] += my; ROLL[i] += Math.sqrt(mx * mx + my * my);
      vx += ax * ts; vy += ay * ts; wx -= K * ay * ts; wy += K * ax * ts;
      rem -= ts;
      if (rem <= 0) { VX[i] = vx; VY[i] = vy; WX[i] = wx; WY[i] = wy; return; }
    }
    const v = Math.sqrt(vx * vx + vy * vy);
    if (v > V_REST) {
      const tr = Math.min(rem, v / aR), s = (v - 0.5 * aR * tr) * tr, f = (v - aR * tr) / v;
      X[i] += (vx / v) * s; Y[i] += (vy / v) * s; ROLL[i] += s;
      vx *= f; vy *= f;
    } else { vx = 0; vy = 0; MOV[i] = 0; }
    VX[i] = vx; VY[i] = vy; WX[i] = vy / R; WY[i] = -vx / R;   // rodadura natural
  }

  function tryPocket(i) {
    for (let p = 0; p < 6; p++) {
      const q = POCKETS[p], ox = X[i] - q.x, oy = Y[i] - q.y;
      if (ox * PAX[p] + oy * PAY[p] < q.r && ox * ox + oy * oy < NEAR2) {
        PK[i] = p; MOV[i] = 0;
        VX[i] = VY[i] = WX[i] = WY[i] = WZ[i] = 0;
        events.push({ t, type: 'pocket', a: balls[i].id, p });
        return;
      }
    }
  }

  // Fricción en el contacto bola-bola: da el "throw" (por corte y por efecto) y transfiere un poco de giro.
  function ballFriction(i, j, nx, ny, jn) {
    const wx = WX[i] + WX[j], wy = WY[i] + WY[j], wz = WZ[i] + WZ[j];
    let sx = VX[i] - VX[j] - R * wz * ny, sy = VY[i] - VY[j] + R * wz * nx;   // patinaje de i respecto a j
    const sz = R * (wx * ny - wy * nx), sn = sx * nx + sy * ny;
    sx -= sn * nx; sy -= sn * ny;
    const s = Math.sqrt(sx * sx + sy * sy + sz * sz);
    if (s < 1e-9) return;
    const cs = mbC * s, mu = mbA + mbB / (1 + cs + 0.5 * cs * cs);
    const f = -Math.min(mu * jn, s / 7) / s;         // sin pasarse de "engranar" (patinaje → 0)
    const ix = f * sx, iy = f * sy, iz = f * sz;     // impulso sobre i (j recibe el opuesto); el vertical lo absorbe la mesa
    VX[i] += ix; VY[i] += iy; VX[j] -= ix; VY[j] -= iy;
    const ax = K * ny * iz, ay = -K * nx * iz, az = K * (nx * iy - ny * ix);   // Δω = (5/2R)·n × impulso, igual en las dos
    WX[i] += ax; WY[i] += ay; WZ[i] += az; WX[j] += ax; WY[j] += ay; WZ[j] += az;
  }

  // Choques bola-bola. Cada pasada junta los contactos que se están cerrando (retrocediendo cada par al
  // instante exacto en que se tocan), los resuelve JUNTOS (Gauss-Seidel con impulso acumulado, así el
  // triángulo se abre parejo y sin depender del orden) y repite: el golpe viaja fila por fila.
  function collideBalls(dt) {
    for (let pass = 0; pass < PASSES; pass++) {
      let nc = 0;
      for (let i = 0; i < n; i++) {
        if (PK[i] >= 0) continue;
        for (let j = i + 1; j < n; j++) {
          if (PK[j] >= 0 || !(MOV[i] | MOV[j])) continue;
          let dx = X[j] - X[i], dy = Y[j] - Y[i], d2 = dx * dx + dy * dy;
          if (d2 >= TOUCH2 || d2 === 0) continue;
          const rx = VX[i] - VX[j], ry = VY[i] - VY[j], dn = dx * rx + dy * ry;
          if (dn <= 0) {                               // se alejan: si quedaron encimadas, sepáralas
            if (d2 < D * D) {
              const d = Math.sqrt(d2), h = (0.5 * (D - d)) / d;
              X[i] -= dx * h; Y[i] -= dy * h; X[j] += dx * h; Y[j] += dy * h;
            }
            continue;
          }
          if (d2 < D * D) {                            // retrocede al instante del contacto
            const r2 = rx * rx + ry * ry;
            const tau = Math.min(dt, (Math.sqrt(dn * dn + r2 * (D * D - d2)) - dn) / r2);
            X[i] -= VX[i] * tau; Y[i] -= VY[i] * tau; X[j] -= VX[j] * tau; Y[j] -= VY[j] * tau;
            LAG[i] += tau; LAG[j] += tau;
            dx = X[j] - X[i]; dy = Y[j] - Y[i]; d2 = dx * dx + dy * dy;
          }
          const d = Math.sqrt(d2);
          CI[nc] = i; CJ[nc] = j; CNX[nc] = dx / d; CNY[nc] = dy / d;
          CV0[nc] = (rx * dx + ry * dy) / d; CJN[nc] = 0; nc++;
        }
      }
      if (nc === 0) return;
      for (let it = 0; it < ITERS; it++) {
        for (let c = 0; c < nc; c++) {
          const i = CI[c], j = CJ[c], nx = CNX[c], ny = CNY[c];
          const vn = (VX[i] - VX[j]) * nx + (VY[i] - VY[j]) * ny;
          const acc = Math.max(0, CJN[c] + 0.5 * (vn + eB * CV0[c])), dj = acc - CJN[c];
          CJN[c] = acc;
          VX[i] -= dj * nx; VY[i] -= dj * ny; VX[j] += dj * nx; VY[j] += dj * ny;
        }
      }
      for (let c = 0; c < nc; c++) {
        if (!(CJN[c] > 0)) continue;
        const i = CI[c], j = CJ[c];
        ballFriction(i, j, CNX[c], CNY[c], CJN[c]);
        MOV[i] = MOV[j] = 1;
        const first = firstHit === null && CV0[c] > V_TOUCH && (i === cue || j === cue);
        if (first) firstHit = balls[i === cue ? j : i].id;                 // el primer toque siempre tiene su evento
        if (first || CV0[c] > V_EVENT) events.push({ t, type: 'ball', a: balls[i].id, b: balls[j].id, v: CV0[c] });
      }
      for (let i = 0; i < n; i++) {                    // devuelve el tiempo retrocedido, ya con la velocidad nueva
        if (LAG[i] > 0) { X[i] += VX[i] * LAG[i]; Y[i] += VY[i] * LAG[i]; LAG[i] = 0; }
      }
    }
  }

  // Rebote en la goma (modelo tipo Han 2005, con la fricción de Coulomb en la dirección real de patinaje).
  // La bola toca la nariz de la banda por ENCIMA de su centro: r = R·(cosθ·n − sinθ·z). El impulso normal va
  // por esa línea; la fricción frena el patinaje del punto de contacto (hasta 2/7 de él = "agarra") y es la
  // que convierte el efecto lateral en cambio de ángulo y se come parte del giro de avance.
  function bounce(i, nx, ny) {
    const tx = -ny, ty = nx;                                   // tangente = z × n
    const vn = VX[i] * nx + VY[i] * ny, vt = VX[i] * tx + VY[i] * ty;
    const wn = WX[i] * nx + WY[i] * ny, wt = WX[i] * tx + WY[i] * ty;
    const s1 = vn * sT - R * wt;                               // patinaje en el plano vertical
    const s2 = vt + R * (cT * WZ[i] + sT * wn);                // patinaje a lo largo de la banda
    const jn = eC1 * vn * cT, s = Math.sqrt(s1 * s1 + s2 * s2);
    const mu = mcA + (mcB * vn * vn) / (vn * vn + vt * vt);
    const f = s > 1e-12 ? -Math.min(2 / 7, (mu * jn) / s) : 0;
    const j1 = f * s1, j2 = f * s2;
    const vn2 = vn - jn * cT + j1 * sT, vt2 = vt + j2;         // la componente vertical se la queda la mesa
    const wn2 = wn + K * sT * j2, wt2 = wt - K * j1;
    VX[i] = vn2 * nx + vt2 * tx; VY[i] = vn2 * ny + vt2 * ty;
    WX[i] = wn2 * nx + wt2 * tx; WY[i] = wn2 * ny + wt2 * ty;
    WZ[i] += K * cT * j2;
    return vn;
  }

  function hitCushions(i, dt) {
    for (let k = 0; k < SEG.length; k++) {
      const s = SEG[k], vx = VX[i], vy = VY[i];
      const px = X[i] - s.x1, py = Y[i] - s.y1, tt = px * s.ex + py * s.ey;
      let nx, ny, tau = 0;
      if (tt > 0 && tt < s.len) {                              // contra el tramo recto
        const dist = -(px * s.nx + py * s.ny);
        if (dist >= LO || dist < -R) continue;
        nx = s.nx; ny = s.ny;
        const vn = vx * nx + vy * ny;
        if (vn <= 0) {
          if (dist < R) { X[i] -= nx * (R - dist); Y[i] -= ny * (R - dist); }
          continue;
        }
        if (dist < R) tau = Math.min(dt, (R - dist) / vn);
      } else {                                                 // contra la punta
        let ex = (tt <= 0 ? s.x1 : s.x2) - X[i], ey = (tt <= 0 ? s.y1 : s.y2) - Y[i], d2 = ex * ex + ey * ey;
        if (d2 >= RT2 || d2 === 0) continue;
        const dn = ex * vx + ey * vy;
        if (dn <= 0) {
          if (d2 < R * R) { const d = Math.sqrt(d2), h = (R - d) / d; X[i] -= ex * h; Y[i] -= ey * h; }
          continue;
        }
        if (d2 < R * R) {
          const v2 = vx * vx + vy * vy;
          tau = Math.min(dt, (Math.sqrt(dn * dn + v2 * (R * R - d2)) - dn) / v2);
          ex += vx * tau; ey += vy * tau; d2 = ex * ex + ey * ey;
        }
        const d = Math.sqrt(d2);
        nx = ex / d; ny = ey / d;
      }
      X[i] -= vx * tau; Y[i] -= vy * tau;                      // al instante del contacto…
      const vn = bounce(i, nx, ny);
      X[i] += VX[i] * tau; Y[i] += VY[i] * tau;                // …y de vuelta con la velocidad nueva
      if (vn > V_TOUCH && firstHit !== null) railAfterHit = true;
      if (vn > V_EVENT) events.push({ t, type: 'rail', a: balls[i].id, v: vn });
    }
  }

  const nearEdge = (i) => X[i] < LO || X[i] > W - LO || Y[i] < LO || Y[i] > H - LO;

  function record(f) {
    for (let i = 0, o = f * n * 3; i < n; i++, o += 3) {
      frames[o] = X[i]; frames[o + 1] = Y[i]; frames[o + 2] = ROLL[i];
      const live = PK[i] < 0;
      spins[o] = live ? WX[i] : 0; spins[o + 1] = live ? WY[i] : 0; spins[o + 2] = live ? WZ[i] : 0;
    }
  }

  record(0);
  let nFrames = 1;
  for (let f = 1; f < maxFrames; f++) {
    let vmax = 0, busy = false;
    for (let i = 0; i < n; i++) if (MOV[i]) vmax = Math.max(vmax, Math.sqrt(VX[i] * VX[i] + VY[i] * VY[i]));
    const ns = Math.min(SUB_MAX, Math.floor((vmax * FRAME_DT) / STEP) + 1), dt = FRAME_DT / ns;
    for (let k = 1; k <= ns; k++) {
      t = (f - 1) * FRAME_DT + k * dt;
      for (let i = 0; i < n; i++) {
        if (PK[i] >= 0) continue;
        if (MOV[i]) { advance(i, dt); if (nearEdge(i)) tryPocket(i); }
        else if (WZ[i] !== 0) WZ[i] = WZ[i] > 0 ? Math.max(0, WZ[i] - aSp * dt) : Math.min(0, WZ[i] + aSp * dt);
      }
      collideBalls(dt);
      for (let i = 0; i < n; i++) if (MOV[i] && PK[i] < 0 && nearEdge(i)) hitCushions(i, dt);
    }
    for (let i = 0; i < n; i++) {
      if (MOV[i]) busy = true;
      if (PK[i] < 0) continue;
      const q = POCKETS[PK[i]], ex = q.x - X[i], ey = q.y - Y[i];   // la bola embocada se desliza al centro del agujero
      if (ex * ex + ey * ey > 1e-6) { X[i] += ex * SINK; Y[i] += ey * SINK; busy = true; } else { X[i] = q.x; Y[i] = q.y; }
    }
    record(f);
    nFrames = f + 1;
    if (!busy) break;
  }

  // Red de seguridad: una bola puede detenerse justo al tocar a otra y quedar encimada unas micras.
  // El estado final (que es la entrada del siguiente tiro) sale siempre sin encimes.
  for (let pass = 0, again = true; again && pass < 32; pass++) {
    again = false;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = X[j] - X[i], dy = Y[j] - Y[i], d2 = dx * dx + dy * dy;
        if (PK[i] >= 0 || PK[j] >= 0 || d2 >= SEP2 || d2 === 0) continue;
        const d = Math.sqrt(d2), h = (0.5 * (D - d)) / d;
        X[i] -= dx * h; Y[i] -= dy * h; X[j] += dx * h; Y[j] += dy * h;
        again = true;
      }
    }
  }

  const final = [];
  for (let i = 0; i < n; i++) {
    if (PK[i] >= 0) { X[i] = POCKETS[PK[i]].x; Y[i] = POCKETS[PK[i]].y; }   // por si el tope cortó el deslizamiento
    final.push({ id: balls[i].id, x: X[i], y: Y[i], in: PK[i] >= 0 });
  }
  record(nFrames - 1);
  return {
    frames: frames.slice(0, nFrames * n * 3), spins: spins.slice(0, nFrames * n * 3), nFrames, n, events, final,
    firstHit, railAfterHit, duration: (nFrames - 1) * FRAME_DT,
  };
}

/**
 * Guía de puntería (bola fantasma): pura geometría, sin efecto.
 * Devuelve { x, y, target, tx, ty, cx, cy, cut }: (x, y) = centro de la blanca en el primer contacto (bola, banda
 * o tronera); target = id de la primera bola que tocaría (o null); (tx, ty) = hacia dónde sale esa bola;
 * (cx, cy) = tangente por la que se desvía la blanca; cut = seno del ángulo de corte (0 = bola llena, útil
 * para escalar las dos líneas). Devuelve null si no hay blanca. El 4º parámetro es opcional: si le pasas el
 * sx del tiro, la guía incluye el pequeño desvío (squirt) que ese efecto le da a la blanca.
 */
export function predict(balls, dx, dy, sx = 0) {
  let cue = null;
  for (const b of balls) if (b.id === 0) cue = b;
  const u = launchDir(dx, dy, clamp(sx, -1, 1) * PHYS.tipMax);
  if (!cue || !u) return null;
  dx = u[0]; dy = u[1];
  let best = Infinity, target = null;
  const hitCircle = (qx, qy, rad, who) => {            // rayo contra un círculo de radio rad
    const ox = qx - cue.x, oy = qy - cue.y, proj = ox * dx + oy * dy, perp2 = ox * ox + oy * oy - proj * proj;
    if (proj <= 0 || perp2 >= rad * rad) return;
    const u = Math.max(0, proj - Math.sqrt(rad * rad - perp2));
    if (u < best) { best = u; target = who; }
  };
  for (const b of balls) if (b !== cue) hitCircle(b.x, b.y, D, b);
  for (const s of SEG) {
    const dn = dx * s.nx + dy * s.ny;
    if (dn > 1e-9) {                                   // la recta de la goma, desplazada un radio
      const u = (-((cue.x - s.x1) * s.nx + (cue.y - s.y1) * s.ny) - R) / dn;
      const tt = (cue.x + dx * u - s.x1) * s.ex + (cue.y + dy * u - s.y1) * s.ey;
      if (u > -1e-6 && u < best && tt >= 0 && tt <= s.len) { best = Math.max(0, u); target = null; }
    }
    hitCircle(s.x1, s.y1, R, null); hitCircle(s.x2, s.y2, R, null);
  }
  for (let p = 0; p < 6; p++) {                        // o se va directo a una tronera
    const q = POCKETS[p], da = dx * PAX[p] + dy * PAY[p], f0 = (cue.x - q.x) * PAX[p] + (cue.y - q.y) * PAY[p];
    if (da >= -1e-9) continue;
    const u = Math.max(0, (q.r - f0) / da), ox = cue.x + dx * u - q.x, oy = cue.y + dy * u - q.y;
    if (u < best && ox * ox + oy * oy < NEAR2) { best = u; target = null; }
  }
  if (best === Infinity) best = 0;
  const x = cue.x + dx * best, y = cue.y + dy * best;
  if (!target) return { x, y, target: null, tx: 0, ty: 0, cx: 0, cy: 0, cut: 0 };
  let tx = target.x - x, ty = target.y - y;
  const tl = Math.sqrt(tx * tx + ty * ty) || 1;
  tx /= tl; ty /= tl;
  const along = dx * tx + dy * ty;
  let cx = dx - along * tx, cy = dy - along * ty;
  const cl = Math.sqrt(cx * cx + cy * cy);
  if (cl > 1e-9) { cx /= cl; cy /= cl; } else { cx = -ty; cy = tx; }   // tiro recto: la blanca se queda; perpendicular cualquiera
  return { x, y, target: target.id, tx, ty, cx, cy, cut: Math.min(1, cl) };
}
