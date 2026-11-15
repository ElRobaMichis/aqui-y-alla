// Billar (bola 8): mesa en canvas, taco con fuerza, efecto en la blanca y física realista.
// La física (billar-physics.js) es determinista: el servidor simula cada tiro como árbitro y
// los dos navegadores simulan el mismo tiro para animarlo. Por la red solo viaja el tiro.

import { TABLE, FRAME_DT, simulate, predict } from './billar-physics.js';
import { prepare, canPlaceCue, isOver, groupOf, GROUP_NAMES, SOLIDS, STRIPES } from './billar-rules.js';

const { W, H, R } = TABLE;
const RAIL = 0.115;            // ancho visual de la banda de madera (m)
const INK = '#22283F';
const CLOTH = '#2E7D6B';
const CLOTH_DARK = '#25685A';
const WOOD = '#8C4A2F';
const WOOD_DARK = '#6E3822';
const CREAM = '#FFF7EA';
const BALL_COLORS = {
  1: '#EDB447', 2: '#3B6FB6', 3: '#E2553F', 4: '#7A5BA6', 5: '#EE8A3A', 6: '#2F8F5B', 7: '#8E2F3A', 8: '#22283F',
};
const colorOf = (id) => (id === 0 ? CREAM : BALL_COLORS[id > 8 ? id - 8 : id]);

const SPIN_TIPS = [
  [(s) => s.sy > 0.3, 'Arriba: la blanca sigue de largo después del choque'],
  [(s) => s.sy < -0.3, 'Abajo: la blanca se regresa después del choque'],
  [(s) => Math.abs(s.sx) > 0.3, 'De lado: cambia el ángulo al rebotar en la banda'],
];

/* ── orientación 3D de cada bola (solo visual) ──
   Marco de la física: x, y sobre la mesa, z hacia el paño (lo que se ve desde arriba es z < 0).
   Cada bola lleva tres ejes propios que giran con la velocidad angular real de la simulación:
   n = hacia el número, a = eje de la franja (rayadas), e = n × a. */
const norm3 = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; v[0] /= l; v[1] /= l; v[2] /= l; return v; };
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function rotateBy(o, wx, wy, wz, dt) {
  const w = Math.hypot(wx, wy, wz);
  const ang = w * dt;
  if (ang < 1e-6) return;
  const kx = wx / w, ky = wy / w, kz = wz / w;
  const c = Math.cos(ang), s = Math.sin(ang);
  for (const v of [o.n, o.a]) {
    // Rodrigues: v' = v·c + (k×v)·s + k(k·v)(1−c)
    const kv = kx * v[0] + ky * v[1] + kz * v[2];
    const cx = ky * v[2] - kz * v[1], cy = kz * v[0] - kx * v[2], cz = kx * v[1] - ky * v[0];
    v[0] = v[0] * c + cx * s + kx * kv * (1 - c);
    v[1] = v[1] * c + cy * s + ky * kv * (1 - c);
    v[2] = v[2] * c + cz * s + kz * kv * (1 - c);
  }
  // re-ortogonalizar de vez en cuando para que el error numérico no deforme la bola
  if (++o.k % 30 === 0) { norm3(o.n); const e = norm3(cross3(o.n, o.a)); o.a = norm3(cross3(e, o.n)); }
  o.ver++;
}
function newOrient(id) {
  // el número mirando hacia arriba con una inclinación distinta por bola; la franja atravesada
  const t = id * 2.399;
  const n = norm3([Math.cos(t) * 0.35, Math.sin(t) * 0.35, -1]);
  const h = [Math.cos(t + 1.6), Math.sin(t + 1.6), 0];
  const e = norm3(cross3(n, h));
  return { n, a: norm3(cross3(e, n)), k: 0, ver: 1 };
}

/* colores en RGB para pintar pixel por pixel */
const hexRGB = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const RGB_CREAM = hexRGB(CREAM), RGB_RED = hexRGB('#E2553F');

export function mount(root, ctx) {
  let g = null;                 // estado confirmado
  let anim = null;              // { sim, t0, ids, queued }
  let pendingShot = null;       // { v, mv }
  let aim = { dx: 1, dy: 0 };
  let power = 0;
  let spin = { sx: 0, sy: 0 };
  let cuePos = null;            // dónde está la blanca en mano
  let remoteAim = null;         // puntería del otro { dx, dy, p, sx, sy, cx, cy }
  let shownAim = null;          // la que se dibuja (suavizada)
  const orient = new Map();
  let view = null;              // transformación mesa → pantalla
  let dirty = true;
  let raf = 0;
  let lastAimSent = 0, aimTimer = null;
  let destroyed = false;

  root.innerHTML = `
    <div class="pool">
      <div class="game-head">
        <button class="btn ghost small" data-quit>← Sala</button>
        <div class="game-title"><h2>Billar</h2><span class="label-chip">bola 8</span>
          <button class="icon-btn focus-btn" type="button" aria-label="Mesa grande" title="Mesa grande"></button></div>
      </div>
      <div class="vs pool-vs">
        <div class="chip" data-seat="0"></div>
        <div class="vs-mid">vs</div>
        <div class="chip" data-seat="1"></div>
      </div>
      <p class="g-status" aria-live="polite"></p>
      <div class="pool-main">
        <div class="pool-table surface"><canvas aria-label="Mesa de billar"></canvas></div>
        <div class="power surface" aria-label="Fuerza: jala hacia abajo y suelta para tirar">
          <div class="power-track"><div class="power-fill"></div><div class="power-handle"></div></div>
          <span class="power-label">jala<br>y suelta</span>
        </div>
        <div class="pool-side"></div>
      </div>
      <div class="pool-controls">
        <div class="spin surface" aria-label="Efecto: dónde le pegas a la blanca">
          <div class="spin-ball"><span class="spin-cross"></span><span class="spin-dot"></span></div>
          <button class="spin-reset" type="button">centro</button>
        </div>
        <div class="fine">
          <div class="fine-strip surface" aria-label="Ajuste fino de puntería"><div class="fine-ticks"></div></div>
          <p class="pool-tip"></p>
        </div>
      </div>
      <div class="result" hidden></div>
    </div>`;

  const $ = (s) => root.querySelector(s);
  const canvas = $('canvas');
  const mainCtx = canvas.getContext('2d');
  let c2d = mainCtx;            // contexto donde se dibuja ahora (la mesa se pinta una vez en otra capa)
  const tableLayer = document.createElement('canvas');
  const sprites = new Map();    // id → { cv, ver, S, vertical }: la bola pintada, se rehace solo si giró
  let lastFrameAt = 0;
  const tableEl = $('.pool-table');

  $('[data-quit]').addEventListener('click', () => ctx.confirmQuit());

  // "mesa grande": esconde la barra de arriba y las pestañas para que la mesa use toda la pantalla
  const roomEl = root.closest('.room');
  const focusBtn = $('.focus-btn');
  const setFocus = (on) => {
    roomEl?.classList.toggle('focus', on);
    focusBtn.innerHTML = on
      ? '<svg class="icon" viewBox="0 0 24 24"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      : '<svg class="icon" viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    focusBtn.setAttribute('aria-pressed', on);
    requestAnimationFrame(layout);
  };
  focusBtn.addEventListener('click', () => { ctx.sfx.tap(); setFocus(!roomEl?.classList.contains('focus')); });
  setFocus(window.matchMedia('(pointer: coarse)').matches);

  const mySeat = () => (g ? g.seats.indexOf(ctx.you) : -1);
  const round = () => g?.round;
  const myTurn = () => g && !anim && !pendingShot && !isOver(g.round) && g.round.turn === mySeat();

  /* ───────────── vista y tamaños ───────────── */

  function layout() {
    // Espacio disponible: el ancho real y lo que queda de alto en la pantalla visible.
    // Se prueban dos acomodos y gana el que deja la mesa más grande:
    //  - mesa horizontal con los controles abajo
    //  - mesa vertical con los controles a un lado (en celular en vertical sobra ancho, no alto)
    const main = $('.pool-main');
    const stage = root.closest('.stage');
    const vvH = window.visualViewport?.height || window.innerHeight;
    const tabs = document.querySelector('.tabs');
    const tabsH = tabs && getComputedStyle(tabs).display !== 'none' ? tabs.offsetHeight : 0;
    const top = main.getBoundingClientRect().top + (stage?.scrollTop || 0) - (window.visualViewport?.offsetTop || 0);
    const availH = Math.max(220, vvH - top - tabsH - 14);
    const powerW = $('.power').offsetWidth + 10;
    const SIDE = 118, CONTROLS_H = 96;
    // nitidez completa en pantallas de alta densidad (iPhone = 3×)
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const TW = W + 2 * RAIL, TH = H + 2 * RAIL;
    const freeW = main.clientWidth - powerW;
    // celular acostado: marcadores y controles van en una columna a la derecha (CSS), la mesa usa todo el alto
    const short = window.matchMedia('(max-height: 520px) and (orientation: landscape)').matches;
    const options = short
      ? [{ vertical: false, side: false, s: Math.min(freeW / TW, availH / TH) }]
      : [
        { vertical: false, side: false, s: Math.min(freeW / TW, (availH - CONTROLS_H) / TH) },
        { vertical: true, side: false, s: Math.min(freeW / TH, (availH - CONTROLS_H) / TW) },
        { vertical: true, side: true, s: Math.min((freeW - SIDE - 10) / TH, availH / TW) },
      ];
    // a igualdad (±5 %), preferir la mesa horizontal: es como se ve una mesa de verdad
    const best = options.reduce((a, b) => (b.s > a.s * 1.05 ? b : a));
    const { vertical, side } = best;
    const s = Math.max(60, Math.min(400, best.s));
    const cw = Math.round((vertical ? TH : TW) * s), ch = Math.round((vertical ? TW : TH) * s);
    main.style.height = `${Math.max(ch, 200)}px`; // la zona de juego mide lo que la mesa
    // los controles cambian de lugar según el acomodo
    const controls = $('.pool-controls');
    if (side && controls.parentElement !== $('.pool-side')) $('.pool-side').append(controls);
    if (!side && controls.parentElement !== root.querySelector('.pool')) main.after(controls);
    root.querySelector('.pool').classList.toggle('side-controls', side);
    canvas.style.width = cw + 'px'; canvas.style.height = ch + 'px';
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
    view = { s, dpr, vertical, cw, ch };
    root.querySelector('.pool').classList.toggle('is-vertical', vertical);
    // la mesa (madera, paño, diamantes, troneras) no cambia: se pinta una sola vez en su capa,
    // y cada cuadro solo la copia. Así sobra tiempo para 120 Hz.
    tableLayer.width = canvas.width; tableLayer.height = canvas.height;
    c2d = tableLayer.getContext('2d');
    c2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawTable();
    c2d = mainCtx;
    sprites.clear();
    dirty = true; kick();
  }
  // solo el ancho del contenedor y el alto de la pantalla deciden el tamaño (sin ciclos)
  let lastW = 0;
  const ro = new ResizeObserver(() => { const w = root.clientWidth; if (w !== lastW) { lastW = w; layout(); } });
  ro.observe(root);
  const onVV = () => layout();
  window.visualViewport?.addEventListener('resize', onVV);
  window.addEventListener('orientationchange', onVV);

  // mesa → pantalla (px CSS)
  function toScreen(x, y) {
    const { s, vertical } = view;
    return vertical ? [(RAIL + y) * s, (RAIL + W - x) * s] : [(RAIL + x) * s, (RAIL + y) * s];
  }
  function toTable(X, Y) {
    const { s, vertical } = view;
    return vertical ? [W - (Y / s - RAIL), X / s - RAIL] : [X / s - RAIL, Y / s - RAIL];
  }
  // dirección de mesa → pantalla (vector)
  const dirToScreen = (dx, dy) => (view.vertical ? [dy, -dx] : [dx, dy]);

  /* ───────────── bolas visibles ───────────── */

  function ballsNow() {
    // durante la animación: posiciones interpoladas; si no, las del estado
    if (anim) return anim.current;
    const r = round();
    if (!r) return [];
    // con bola en mano, la blanca es la que se está colocando: nunca la que dejó la mesa
    // (antes quedaban dos blancas y la guía se calculaba desde la equivocada)
    const list = r.balls.filter((b) => !(r.hand && b.id === 0)).map((b) => ({ id: b.id, x: b.x, y: b.y, alpha: 1 }));
    if (r.hand && myTurn() && cuePos) list.unshift({ id: 0, x: cuePos.x, y: cuePos.y, alpha: 1, hand: true, ok: canPlaceCue(r, cuePos.x, cuePos.y) });
    else if (r.hand && remoteAim && Number.isFinite(remoteAim.cx)) list.unshift({ id: 0, x: remoteAim.cx, y: remoteAim.cy, alpha: 0.85, hand: true, ok: true });
    return list;
  }
  const cueBall = () => ballsNow().find((b) => b.id === 0);

  /* ───────────── dibujo ───────────── */

  function drawTable() {
    const { s } = view;
    c2d.save();
    // madera
    c2d.fillStyle = WOOD;
    roundRect(0, 0, view.cw, view.ch, 0.06 * s); c2d.fill();
    c2d.lineWidth = 2.5; c2d.strokeStyle = INK; c2d.stroke();
    // marco interior (sombra plana de la banda)
    const [ax, ay] = toScreen(0, 0), [bx, by] = toScreen(W, H);
    const x0 = Math.min(ax, bx), y0 = Math.min(ay, by), w = Math.abs(bx - ax), h = Math.abs(by - ay);
    const cush = 0.035 * s;
    c2d.fillStyle = WOOD_DARK;
    c2d.fillRect(x0 - cush - 3, y0 - cush - 3, w + 2 * cush + 6, h + 2 * cush + 6);
    // paño + bandas de paño
    c2d.fillStyle = CLOTH_DARK;
    c2d.fillRect(x0 - cush, y0 - cush, w + 2 * cush, h + 2 * cush);
    c2d.fillStyle = CLOTH;
    c2d.fillRect(x0, y0, w, h);
    // línea de cabecera y punto de pie
    c2d.strokeStyle = 'rgba(255,247,234,.22)'; c2d.lineWidth = 1.5; c2d.setLineDash([4, 5]);
    line(TABLE.headX, 0, TABLE.headX, H); c2d.setLineDash([]);
    const [fx, fy] = toScreen(TABLE.foot.x, TABLE.foot.y);
    c2d.fillStyle = 'rgba(255,247,234,.35)'; c2d.beginPath(); c2d.arc(fx, fy, 2.2, 0, 7); c2d.fill();
    // diamantes en la madera
    c2d.fillStyle = CREAM;
    for (let i = 1; i < 8; i++) if (i !== 4) { diamond(W * i / 8, -RAIL / 2); diamond(W * i / 8, H + RAIL / 2); }
    for (let i = 1; i < 4; i++) { diamond(-RAIL / 2, H * i / 4); diamond(W + RAIL / 2, H * i / 4); }
    // bandas reales (segmentos de colisión) como borde de paño
    c2d.strokeStyle = 'rgba(0,0,0,.18)'; c2d.lineWidth = 2;
    for (const [x1, y1, x2, y2] of TABLE.cushions) line(x1, y1, x2, y2);
    // troneras
    for (const p of TABLE.pockets) {
      const [px, py] = toScreen(p.x, p.y);
      c2d.fillStyle = INK; c2d.beginPath(); c2d.arc(px, py, p.r * s, 0, 7); c2d.fill();
      c2d.strokeStyle = WOOD_DARK; c2d.lineWidth = 2; c2d.stroke();
    }
    c2d.restore();
  }
  function diamond(x, y) {
    const [X, Y] = toScreen(x, y);
    const d = Math.max(2.2, 0.008 * view.s);
    c2d.beginPath(); c2d.moveTo(X, Y - d); c2d.lineTo(X + d, Y); c2d.lineTo(X, Y + d); c2d.lineTo(X - d, Y); c2d.closePath(); c2d.fill();
  }
  function line(x1, y1, x2, y2) {
    const [a, b] = toScreen(x1, y1), [c, d] = toScreen(x2, y2);
    c2d.beginPath(); c2d.moveTo(a, b); c2d.lineTo(c, d); c2d.stroke();
  }
  function roundRect(x, y, w, h, r) {
    c2d.beginPath();
    c2d.moveTo(x + r, y); c2d.arcTo(x + w, y, x + w, y + h, r); c2d.arcTo(x + w, y + h, x, y + h, r);
    c2d.arcTo(x, y + h, x, y, r); c2d.arcTo(x, y, x + w, y, r); c2d.closePath();
  }

  /* Cada bola se pinta como esfera de verdad, pixel por pixel, en un lienzo chiquito que solo
     se rehace cuando la bola giró. Colores planos con sombreado de dos tonos (sin degradados):
     la franja de las rayadas, el círculo del número y los puntos de la blanca giran con la bola. */
  function ballSprite(id, o, rCss) {
    const dpr = view.dpr;
    const D = 2 * rCss * dpr;
    const SS = D < 28 ? 2 : 1;                // supermuestreo en bolas chicas: bordes suaves
    const S = Math.ceil(D * SS) + 2;
    let sp = sprites.get(id);
    if (sp && sp.ver === o.ver && sp.S === S && sp.vertical === view.vertical) return sp;
    if (!sp || sp.S !== S) {
      const cv = document.createElement('canvas'); cv.width = cv.height = S;
      sp = { cv, cx: cv.getContext('2d'), S, ver: -1, img: null };
      sp.img = sp.cx.createImageData(S, S);
      sprites.set(id, sp);
    }
    const data = sp.img.data;
    data.fill(0);
    const base = hexRGB(colorOf(id));
    const stripe = id > 8, cue = id === 0;
    const n = o.n, a = o.a, e = cross3(n, a);
    const dots = [n, a, e, [-n[0], -n[1], -n[2]], [-a[0], -a[1], -a[2]], [-e[0], -e[1], -e[2]]];
    const c = S / 2, rr = (D * SS) / 2;
    const vert = view.vertical;
    // círculo del número: más chico si la bola se ve chica (ahí no cabe el número y solo estorba
    // para distinguir lisas de rayadas)
    const numCut = rCss >= 5.5 ? 0.86 : 0.93;
    for (let py = 0; py < S; py++) {
      const qy = (py + 0.5 - c) / rr;
      for (let px = 0; px < S; px++) {
        const qx = (px + 0.5 - c) / rr;
        const q2 = qx * qx + qy * qy;
        if (q2 > 1) continue;
        const zv = Math.sqrt(1 - q2);            // hacia quien mira
        // punto de la esfera en el marco de la física (pantalla → mesa; z de la física apunta al paño)
        const tx = vert ? -qy : qx, ty = vert ? qx : qy, tz = -zv;
        let col;
        if (cue) {
          col = RGB_CREAM;
          for (const d of dots) if (tx * d[0] + ty * d[1] + tz * d[2] > 0.955) { col = RGB_RED; break; }
        } else {
          const pa = tx * a[0] + ty * a[1] + tz * a[2];
          const pn = tx * n[0] + ty * n[1] + tz * n[2];
          col = stripe && Math.abs(pa) > 0.5 ? RGB_CREAM : base;
          if (pn > numCut) col = RGB_CREAM;       // círculo del número
        }
        // sombreado de dos tonos: luz desde arriba a la izquierda
        const L = -0.42 * qx - 0.5 * qy + 0.76 * zv;
        const k = L > 0.965 ? 1.35 : L < 0.1 ? 0.78 : 1;
        const i4 = (py * S + px) * 4;
        data[i4] = Math.min(255, col[0] * k + (k > 1 ? 60 : 0));
        data[i4 + 1] = Math.min(255, col[1] * k + (k > 1 ? 60 : 0));
        data[i4 + 2] = Math.min(255, col[2] * k + (k > 1 ? 60 : 0));
        data[i4 + 3] = 255;
      }
    }
    sp.cx.putImageData(sp.img, 0, 0);
    sp.ver = o.ver; sp.vertical = vert;
    return sp;
  }

  function drawBall(b) {
    const r = R * view.s;
    const [X, Y] = toScreen(b.x, b.y);
    let o = orient.get(b.id);
    if (!o) { o = newOrient(b.id); orient.set(b.id, o); }
    c2d.save();
    c2d.globalAlpha = b.alpha ?? 1;
    const sc = b.scale ?? 1;
    // sombra plana
    c2d.fillStyle = 'rgba(20,25,40,.28)';
    c2d.beginPath(); c2d.ellipse(X + r * 0.28, Y + r * 0.34, r * sc, r * 0.9 * sc, 0, 0, 7); c2d.fill();
    const sp = ballSprite(b.id, o, r);
    const size = (sp.S / (2 * r * view.dpr * (2 * r * view.dpr < 28 ? 2 : 1))) * 2 * r * sc;
    c2d.imageSmoothingEnabled = true;
    c2d.drawImage(sp.cv, X - size / 2, Y - size / 2, size, size);
    // número: solo si la bola se ve lo bastante grande y el número mira hacia arriba
    const facing = -o.n[2];
    if (b.id !== 0 && r >= 5.5 && facing > 0.45) {
      const [sx, sy] = dirToScreen(o.n[0], o.n[1]);
      c2d.fillStyle = INK;
      c2d.font = `800 ${Math.round(r * (0.5 + 0.28 * facing) * sc)}px ui-rounded, system-ui, sans-serif`;
      c2d.textAlign = 'center'; c2d.textBaseline = 'middle';
      c2d.fillText(String(b.id), X + sx * r * sc, Y + sy * r * sc + r * 0.05);
    }
    c2d.beginPath(); c2d.arc(X, Y, r * sc, 0, 7);
    c2d.lineWidth = Math.max(1.1, r * 0.12);
    c2d.strokeStyle = b.hand && !b.ok ? '#E2553F' : INK;
    c2d.stroke();
    if (b.hand) {
      c2d.setLineDash([3, 3]); c2d.lineWidth = 1.5; c2d.strokeStyle = b.ok ? CREAM : '#E2553F';
      c2d.beginPath(); c2d.arc(X, Y, r * 1.9, 0, 7); c2d.stroke(); c2d.setLineDash([]);
    }
    c2d.restore();
  }

  function drawGuide(cb, a, mine) {
    // con efecto lateral la blanca se desvía un poquito (squirt): la guía lo refleja
    const p = predict(ballsNow().map((b) => ({ id: b.id, x: b.x, y: b.y })), a.dx, a.dy, mine ? spin.sx : (a.sx || 0));
    if (!p) return;
    const r = R * view.s;
    const [cx, cy] = toScreen(cb.x, cb.y), [gx, gy] = toScreen(p.x, p.y);
    c2d.save();
    c2d.strokeStyle = mine ? 'rgba(255,247,234,.85)' : 'rgba(255,247,234,.5)';
    c2d.lineWidth = 2; c2d.setLineDash([2, 6]); c2d.lineCap = 'round';
    c2d.beginPath(); c2d.moveTo(cx, cy); c2d.lineTo(gx, gy); c2d.stroke(); c2d.setLineDash([]);
    // bola fantasma
    c2d.beginPath(); c2d.arc(gx, gy, r, 0, 7); c2d.lineWidth = 1.8; c2d.stroke();
    if (p.target != null && mine) {
      const t = ballsNow().find((b) => b.id === p.target);
      if (t) {
        const [tx, ty] = toScreen(t.x, t.y);
        const [vx, vy] = dirToScreen(p.tx, p.ty);
        const [wx, wy] = dirToScreen(p.cx, p.cy);
        c2d.strokeStyle = colorOf(p.target) === INK ? CREAM : colorOf(p.target);
        c2d.lineWidth = 3;
        c2d.beginPath(); c2d.moveTo(tx, ty); c2d.lineTo(tx + vx * r * 7, ty + vy * r * 7); c2d.stroke();
        c2d.strokeStyle = 'rgba(255,247,234,.6)'; c2d.lineWidth = 2; c2d.setLineDash([3, 4]);
        c2d.beginPath(); c2d.moveTo(gx, gy); c2d.lineTo(gx + wx * r * 5, gy + wy * r * 5); c2d.stroke(); c2d.setLineDash([]);
      }
    }
    c2d.restore();
  }

  /**
   * Taco. `pw` = cuánto está jalado (0..1). opts.gap fija la distancia punta–bola en metros
   * (para la animación del golpe); opts.sx corre el taco a un lado según el efecto lateral,
   * como se ve en la vida real desde arriba; opts.alpha para desvanecerlo.
   */
  function drawCue(cb, a, pw, opts = {}) {
    const s = view.s, r = R * s;
    const [ux, uy] = dirToScreen(a.dx, a.dy);
    const nx = -uy, ny = ux;
    const side = (opts.sx || 0) * 0.5 * r;                    // punta corrida a la derecha/izquierda
    const [bx0, by0] = toScreen(cb.x, cb.y);
    const cx = bx0 + nx * side, cy = by0 + ny * side;
    const gap = opts.gap != null ? r + opts.gap * s : r * 1.4 + (0.012 + pw * 0.22) * s;
    const len = 1.2 * s;
    const sx = cx - ux * gap, sy = cy - uy * gap;           // punta
    const ex = cx - ux * (gap + len), ey = cy - uy * (gap + len);
    const tipW = Math.max(2.2, 0.0065 * s), buttW = Math.max(4.5, 0.015 * s);
    const seg = (t0, t1, w0, w1, col) => {
      const ax = sx + (ex - sx) * t0, ay = sy + (ey - sy) * t0, bx = sx + (ex - sx) * t1, by = sy + (ey - sy) * t1;
      c2d.beginPath();
      c2d.moveTo(ax + nx * w0, ay + ny * w0); c2d.lineTo(bx + nx * w1, by + ny * w1);
      c2d.lineTo(bx - nx * w1, by - ny * w1); c2d.lineTo(ax - nx * w0, ay - ny * w0); c2d.closePath();
      c2d.fillStyle = col; c2d.fill(); c2d.lineWidth = 1.5; c2d.strokeStyle = INK; c2d.stroke();
    };
    const wAt = (t) => tipW + (buttW - tipW) * t;
    c2d.save();
    if (opts.alpha != null) c2d.globalAlpha = opts.alpha;
    const baseAlpha = c2d.globalAlpha;
    // sombra
    c2d.globalAlpha = 0.25 * baseAlpha; c2d.fillStyle = INK;
    c2d.beginPath(); c2d.moveTo(sx + 4, sy + 6); c2d.lineTo(ex + 4, ey + 6); c2d.lineWidth = buttW * 1.4; c2d.strokeStyle = INK; c2d.stroke();
    c2d.globalAlpha = baseAlpha;
    seg(0.62, 1, wAt(0.62), wAt(1), '#5A3A2A');             // mango
    seg(0.55, 0.62, wAt(0.55), wAt(0.62), '#E2553F');       // anillo
    seg(0.02, 0.55, wAt(0.02), wAt(0.55), '#F3E3C3');       // flecha
    seg(0.0, 0.02, tipW, wAt(0.02), '#3B6FB6');              // suela azul (tiza)
    c2d.restore();
  }

  function draw() {
    if (!view || !g) return;
    c2d.setTransform(1, 0, 0, 1, 0, 0);
    c2d.clearRect(0, 0, canvas.width, canvas.height);
    c2d.drawImage(tableLayer, 0, 0);
    c2d.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    const balls = ballsNow();
    for (const b of balls) if (b.id !== 0) drawBall(b);
    const cb = balls.find((b) => b.id === 0);
    if (cb) drawBall(cb);
    if (anim?.stroke) drawStroke();
    else if (!anim && cb && !isOver(g.round)) {
      if (myTurn()) { drawGuide(cb, aim, true); drawCue(cb, aim, power, { sx: spin.sx }); }
      else if (shownAim && !pendingShot) { drawGuide(cb, shownAim, false); drawCue(cb, shownAim, shownAim.p || 0, { sx: shownAim.sx || 0 }); }
    }
  }

  function frame(now) {
    raf = 0;
    if (destroyed) return;
    let again = false;
    if (anim) { stepAnim(now); again = true; }
    const frameDt = Math.min(0.1, lastFrameAt ? (now - lastFrameAt) / 1000 : 1 / 60);
    lastFrameAt = now;
    if (remoteAim && shownAim) {
      // suavizar la puntería que llega por red; igual de suave a 60, 120 o 144 Hz
      const k = 1 - Math.exp(-frameDt * 22);
      const nx = shownAim.dx + (remoteAim.dx - shownAim.dx) * k, ny = shownAim.dy + (remoteAim.dy - shownAim.dy) * k;
      const l = Math.hypot(nx, ny) || 1;
      shownAim.dx = nx / l; shownAim.dy = ny / l;
      shownAim.p += ((remoteAim.p || 0) - shownAim.p) * k;
      if (Math.abs(shownAim.dx - remoteAim.dx) + Math.abs(shownAim.dy - remoteAim.dy) + Math.abs(shownAim.p - (remoteAim.p || 0)) > 1e-3) again = true;
      dirty = true;
    }
    if (dirty || again) { draw(); dirty = false; }
    if (again) kick();
  }
  function kick() { if (!raf && !destroyed) raf = requestAnimationFrame(frame); }

  /* ───────────── animación de un tiro ───────────── */

  function startAnim(balls, shot, done) {
    const sim = simulate(balls, shot);
    const ids = balls.map((b) => b.id);
    const pocketAt = new Map(sim.events.filter((e) => e.type === 'pocket').map((e) => [e.a, e]));
    const cue0 = balls.find((b) => b.id === 0);
    // el golpe: el taco viaja hacia la blanca (más rápido entre más fuerte) y la física
    // arranca justo en el contacto
    const strokeDur = 0.16 - 0.08 * shot.power;
    anim = {
      sim, ids, done, evIdx: 0, pocketAt, current: balls.map((b) => ({ ...b })), lastSound: 0,
      t0: performance.now() + strokeDur * 1000,
      stroke: cue0 ? { x: cue0.x, y: cue0.y, dx: shot.dx, dy: shot.dy, p: shot.power, sx: shot.sx || 0, dur: strokeDur, hit: false } : null,
    };
    updateUI();
    kick();
  }

  /** taco durante el golpe: jalado → contacto (acelerando) → sigue un poco de largo y se desvanece */
  function drawStroke() {
    const st = anim.stroke;
    const t = (performance.now() - anim.t0) / 1000;    // < 0 antes del contacto
    const pull = 0.012 + st.p * 0.22 + R * 0.4;           // donde estaba la punta al soltar (m)
    let gap, alpha = 1;
    if (t < 0) {
      const u = 1 + t / st.dur;                           // 0 → 1
      gap = pull * (1 - u * u);                           // acelera como un brazo de verdad
    } else {
      const follow = Math.min(1, t / 0.12);
      gap = -0.02 * (0.4 + st.p) * (1 - (1 - follow) * (1 - follow)); // sigue de largo
      alpha = Math.max(0, 1 - t / 0.32);
      if (alpha <= 0) { anim.stroke = null; return; }
    }
    drawCue({ x: st.x, y: st.y }, st, 0, { gap, alpha, sx: st.sx });
  }

  function stepAnim(now) {
    const a = anim;
    const t = (now - a.t0) / 1000;
    if (a.stroke && !a.stroke.hit && t >= 0) { a.stroke.hit = true; ctx.sfx.cue(a.stroke.p); }
    const dtReal = Math.min(0.1, Math.max(0, t - Math.max(0, a.lastT ?? 0))); // tras estar en segundo plano no se "acelera"
    a.lastT = t;
    const { frames, spins, nFrames, n, events } = a.sim;
    const fi = Math.max(0, Math.min(nFrames - 1, t / FRAME_DT));
    const f0 = Math.floor(fi), f1 = Math.min(nFrames - 1, f0 + 1), k = fi - f0;
    const cur = [];
    for (let i = 0; i < n; i++) {
      const id = a.ids[i];
      const o0 = (f0 * n + i) * 3, o1 = (f1 * n + i) * 3;
      const x = frames[o0] + (frames[o1] - frames[o0]) * k;
      const y = frames[o0 + 1] + (frames[o1 + 1] - frames[o0 + 1]) * k;
      const pe = a.pocketAt.get(id);
      let alpha = 1, scale = 1;
      if (pe) {
        // cae en la tronera: se achica y se hunde en lo oscuro
        const DROP = 0.3, dt = t - pe.t;
        if (dt > DROP) continue;
        if (dt > 0) { const u = dt / DROP; scale = 1 - 0.5 * u * u; alpha = 1 - u * u * u; }
      }
      // girar con la velocidad angular real de la simulación (retroceso, corrido, efecto…)
      let o = orient.get(id);
      if (!o) { o = newOrient(id); orient.set(id, o); }
      if (spins && dtReal > 0) rotateBy(o, spins[o0], spins[o0 + 1], spins[o0 + 2], dtReal);
      cur.push({ id, x, y, alpha, scale });
    }
    a.current = cur;
    // sonidos sincronizados con los eventos
    while (a.evIdx < events.length && events[a.evIdx].t <= t) {
      const e = events[a.evIdx++];
      // si la app estuvo en segundo plano, no disparar de golpe los sonidos atrasados
      if (t - e.t > 0.15) continue;
      if (e.type === 'ball') { if (now - a.lastSound > 14) { ctx.sfx.clack(e.v); a.lastSound = now; } }
      else if (e.type === 'rail') { if (e.v > 0.15) ctx.sfx.rail(e.v); }
      else if (e.type === 'pocket') ctx.sfx.pocket();
    }
    if (fi >= nFrames - 1) {
      const done = a.done;
      anim = null;
      done?.();
      updateUI();
    }
    dirty = true;
  }

  /* ───────────── entrada: apuntar, colocar, fuerza, efecto ───────────── */

  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (!myTurn() || !view) return;
    canvas.setPointerCapture(e.pointerId);
    const rect = canvas.getBoundingClientRect();
    const [x, y] = toTable(e.clientX - rect.left, e.clientY - rect.top);
    const cb = cueBall();
    const near = cb && Math.hypot(x - cb.x, y - cb.y) < Math.max(3 * R, 26 / view.s);
    drag = { mode: round().hand && near ? 'place' : 'aim', id: e.pointerId };
    move(x, y);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const rect = canvas.getBoundingClientRect();
    move(...toTable(e.clientX - rect.left, e.clientY - rect.top));
  });
  const endDrag = (e) => { if (drag && drag.id === e.pointerId) drag = null; };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  function move(x, y) {
    const cb = cueBall();
    if (drag.mode === 'place') {
      const cx = Math.min(W - R, Math.max(R, x)), cy = Math.min(H - R, Math.max(R, y));
      cuePos = { x: round().hand === 'kitchen' ? Math.min(cx, TABLE.headX) : cx, y: cy };
    } else if (cb) {
      const dx = x - cb.x, dy = y - cb.y, l = Math.hypot(dx, dy);
      if (l > R * 1.2) aim = { dx: dx / l, dy: dy / l };
    }
    sendAim(); dirty = true; kick(); updateTip();
  }

  // ajuste fino: arrastrar la regla gira poquito
  const fine = $('.fine-strip');
  let fineDrag = null;
  fine.addEventListener('pointerdown', (e) => { if (!myTurn()) return; fine.setPointerCapture(e.pointerId); fineDrag = { x: e.clientX, id: e.pointerId }; });
  fine.addEventListener('pointermove', (e) => {
    if (!fineDrag || fineDrag.id !== e.pointerId) return;
    const d = (e.clientX - fineDrag.x) * 0.0012; // ~0.07° por pixel
    fineDrag.x = e.clientX;
    const c = Math.cos(d), s = Math.sin(d);
    aim = { dx: aim.dx * c - aim.dy * s, dy: aim.dx * s + aim.dy * c };
    fine.style.setProperty('--off', `${(parseFloat(fine.style.getPropertyValue('--off')) || 0) + (d / 0.0012)}px`);
    sendAim(); dirty = true; kick();
  });
  const fineEnd = () => { fineDrag = null; };
  fine.addEventListener('pointerup', fineEnd); fine.addEventListener('pointercancel', fineEnd);

  // fuerza: jalar hacia abajo y soltar
  const pw = $('.power'), track = $('.power-track');
  let pDrag = null;
  pw.addEventListener('pointerdown', (e) => {
    if (!myTurn()) { if (g && !isOver(g.round)) ctx.toast('Espera tu turno'); return; }
    if (round().hand && (!cuePos || !canPlaceCue(round(), cuePos.x, cuePos.y))) { ctx.toast('Coloca la blanca en un lugar libre'); ctx.sfx.error(); return; }
    pw.setPointerCapture(e.pointerId);
    pDrag = { id: e.pointerId, y0: e.clientY };
    ctx.sfx.tap();
  });
  pw.addEventListener('pointermove', (e) => { if (pDrag && pDrag.id === e.pointerId) setPowerFrom(e.clientY); });
  pw.addEventListener('pointerup', (e) => {
    if (!pDrag || pDrag.id !== e.pointerId) return;
    pDrag = null;
    if (power > 0.03) shoot(); else { power = 0; renderPower(); sendAim(); }
  });
  pw.addEventListener('pointercancel', () => { pDrag = null; power = 0; renderPower(); sendAim(); });
  function setPowerFrom(clientY) {
    // cuánto jalaste desde donde tocaste (toda la barra = fuerza máxima)
    const r = track.getBoundingClientRect();
    power = Math.min(1, Math.max(0, (clientY - pDrag.y0) / (r.height * 0.9)));
    renderPower(); sendAim(); dirty = true; kick();
  }
  function renderPower() {
    pw.style.setProperty('--p', power.toFixed(3));
    pw.classList.toggle('hot', power > 0.75);
  }

  // efecto: dónde se le pega a la blanca
  const spinEl = $('.spin-ball');
  let sDrag = null;
  spinEl.addEventListener('pointerdown', (e) => { if (!myTurn()) return; spinEl.setPointerCapture(e.pointerId); sDrag = e.pointerId; setSpinFrom(e); });
  spinEl.addEventListener('pointermove', (e) => { if (sDrag === e.pointerId) setSpinFrom(e); });
  spinEl.addEventListener('pointerup', () => { sDrag = null; });
  spinEl.addEventListener('pointercancel', () => { sDrag = null; });
  $('.spin-reset').addEventListener('click', () => { spin = { sx: 0, sy: 0 }; renderSpin(); sendAim(); ctx.sfx.tap(); });
  function setSpinFrom(e) {
    const r = spinEl.getBoundingClientRect();
    let sx = ((e.clientX - r.left) / r.width - 0.5) * 2;
    let sy = -((e.clientY - r.top) / r.height - 0.5) * 2;
    const l = Math.hypot(sx, sy);
    if (l > 0.85) { sx *= 0.85 / l; sy *= 0.85 / l; } // más allá: pifia
    spin = { sx: Math.round(sx * 100) / 100, sy: Math.round(sy * 100) / 100 };
    renderSpin(); sendAim();
  }
  function renderSpin() {
    spinEl.style.setProperty('--sx', spin.sx);
    spinEl.style.setProperty('--sy', spin.sy);
    updateTip();
  }
  function updateTip() {
    const tip = $('.pool-tip');
    const r = round();
    if (r?.hand && myTurn()) { tip.textContent = r.hand === 'kitchen' ? 'Arrastra la blanca dentro de la zona de saque (antes de la línea)' : 'Bola en mano: arrastra la blanca a donde quieras'; return; }
    const t = SPIN_TIPS.find(([f]) => f(spin));
    tip.textContent = t ? t[1] : 'Toca o arrastra en la mesa para apuntar · jala la barra para tirar';
  }

  function sendAim() {
    if (!myTurn()) return;
    const now = performance.now();
    const doSend = () => {
      lastAimSent = performance.now(); aimTimer = null;
      const a = { dx: aim.dx, dy: aim.dy, p: power, sx: spin.sx, sy: spin.sy };
      if (round().hand && cuePos) { a.cx = cuePos.x; a.cy = cuePos.y; }
      ctx.send({ t: 'g:aim', a });
    };
    if (now - lastAimSent > 90) doSend();
    else if (!aimTimer) aimTimer = setTimeout(doSend, 90 - (now - lastAimSent));
  }

  function shoot() {
    const r = round();
    const mv = { shot: { dx: aim.dx, dy: aim.dy, power, sx: spin.sx, sy: spin.sy } };
    if (r.hand) mv.cue = { x: cuePos.x, y: cuePos.y };
    const prep = prepare(r, mv);
    if (!prep.ok) { ctx.sfx.error(); ctx.toast('Ese tiro no se puede'); return; }
    if (!ctx.send({ t: 'g:move', v: g.v, m: mv })) { ctx.toast('Sin conexión… espera un momento'); ctx.sfx.error(); power = 0; renderPower(); return; }
    clearTimeout(aimTimer); aimTimer = null;
    pendingShot = { v: g.v, mv };
    power = 0; renderPower();
    startAnim(prep.balls, prep.shot, () => { if (queued) applyQueued(); });
  }

  /* ───────────── estado del juego ───────────── */

  let queued = null; // estado que llegó mientras se animaba
  function applyQueued() { const q = queued; queued = null; apply(q.g, q.ev); }

  function apply(next, ev = {}) {
    const prevTurnSeat = g?.round?.turn;
    const prevV = g?.v;
    g = next;
    pendingShot = null;
    if (!g) return;
    const r = g.round;
    if (ev.k === 'round' || ev.k === 'start') orient.clear();
    // nuevo turno mío: preparar blanca en mano y puntería razonable
    if (myTurn()) {
      if (r.hand) cuePos = defaultCuePos(r);
      if (prevTurnSeat !== r.turn || prevV == null || ev.k === 'round') {
        spin = { sx: 0, sy: 0 }; renderSpin();
        aim = defaultAim(r);
        if (ev.k === 'move' && ev.by !== ctx.you) setTimeout(() => ctx.sfx.turn(), 200);
      }
    } else { remoteAim = null; shownAim = null; }
    // mensajes del último tiro
    if (ev.k === 'move' && r.last) narrate(r);
    if (ev.k === 'move' && isOver(r)) outcome(r);
    updateUI();
    dirty = true; kick();
  }

  function defaultCuePos(r) {
    const base = { x: r.hand === 'kitchen' ? TABLE.headX - 0.25 : W * 0.25, y: H / 2 };
    if (canPlaceCue(r, base.x, base.y)) return base;
    for (let k = 1; k < 40; k++) for (const sg of [1, -1]) {
      const p = { x: base.x, y: H / 2 + sg * k * R * 1.2 };
      if (canPlaceCue(r, p.x, p.y)) return p;
    }
    return base;
  }
  function defaultAim(r) {
    const cb = r.hand ? cuePos : r.balls.find((b) => b.id === 0);
    if (!cb) return aim;
    const mine = r.groups[mySeat()];
    const legal = r.balls.filter((b) => b.id !== 0 && (mine ? groupOf(b.id) === mine || (b.id === 8 && remaining(r, mine) === 0) : b.id !== 8));
    const pool = legal.length ? legal : r.balls.filter((b) => b.id !== 0);
    let best = null, bd = Infinity;
    for (const b of pool) { const d = Math.hypot(b.x - cb.x, b.y - cb.y); if (d < bd) { bd = d; best = b; } }
    if (!best) return aim;
    return { dx: (best.x - cb.x) / bd, dy: (best.y - cb.y) / bd };
  }
  const remaining = (r, group) => (group === 'solids' ? SOLIDS : STRIPES).filter((id) => !r.down.includes(id)).length;

  function narrate(r) {
    const L = r.last, who = ctx.player(g.seats[L.by]);
    const mine = L.by === mySeat();
    const subj = mine ? 'Tú' : who.name;
    if (L.foul) {
      const nextP = ctx.player(g.seats[r.turn]);
      ctx.toast(`Falta: ${mine ? L.foul : L.foul.replace(/^metiste/, 'metió').replace(/^tocaste/, 'tocó').replace(/^no tocaste/, 'no tocó')} · bola en mano para ${r.turn === mySeat() ? 'ti' : nextP.name}`, 3200);
    } else if (L.assigned) {
      ctx.toast(`${subj} ${mine ? 'vas' : 'va'} con las ${GROUP_NAMES[L.assigned]}`, 2600);
    } else if (L.respot) ctx.toast('La 8 entró en el saque: regresa a su lugar');
  }

  function outcome(r) {
    const me = mySeat();
    setTimeout(() => {
      if (r.winner === me) { ctx.sfx.win(); ctx.confetti(); } else ctx.sfx.lose();
    }, 250);
  }

  function chipHTML(seat) {
    const id = g.seats[seat];
    const p = ctx.player(id);
    const r = g.round;
    const grp = r.groups[seat];
    const dots = grp
      ? (grp === 'solids' ? SOLIDS : STRIPES).map((b) => `<i class="pd ${b > 8 ? 'st' : ''} ${r.down.includes(b) ? 'in' : ''}" style="--c:${colorOf(b)}"></i>`).join('')
      : '<em>mesa abierta</em>';
    return `<div class="chip-av">${ctx.critter(p.look.k, p.look.c, p.on ? '' : 'sleepy')}</div>
      <div class="chip-txt"><b>${ctx.esc(p.name)}${id === ctx.you ? ' <small>(tú)</small>' : ''}</b><span class="pool-dots">${dots}</span></div>
      <div class="chip-score">${g.score?.[id] || 0}</div>`;
  }

  function updateUI() {
    if (!g) return;
    const r = g.round, me = mySeat();
    for (const seat of [0, 1]) {
      const chip = root.querySelector(`.chip[data-seat="${seat}"]`);
      const html = chipHTML(seat);
      if (chip.dataset.html !== html) { chip.innerHTML = html; chip.dataset.html = html; }
      chip.classList.toggle('turn', !isOver(r) && r.turn === seat && !anim);
      chip.classList.toggle('won', r.winner === seat);
    }
    const op = ctx.player(g.seats[1 - me]);
    const st = $('.g-status');
    if (anim) st.innerHTML = '…';
    else if (isOver(r)) st.textContent = '';
    else if (r.turn === me) {
      const grp = r.groups[me];
      const need = grp && remaining(r, grp) === 0 ? 'te toca la 8' : grp ? `vas con ${GROUP_NAMES[grp]}` : r.isBreak ? 'saque' : 'mesa abierta';
      st.innerHTML = `<b>Tu turno</b> · ${need}${r.hand ? ' · bola en mano' : ''}`;
    } else st.innerHTML = op.on ? `Turno de <b>${ctx.esc(op.name)}</b>…` : `<b>${ctx.esc(op.name)}</b> se desconectó · la partida espera`;
    st.classList.toggle('mine', myTurn());
    root.querySelector('.pool').classList.toggle('my-turn', myTurn());
    updateTip();
    renderResult();
  }

  function renderResult() {
    const box = $('.result');
    const r = g.round;
    if (!isOver(r) || anim) { box.hidden = true; return; }
    const me = mySeat();
    const iWon = r.winner === me;
    const op = ctx.player(g.seats[1 - me]);
    const iAgain = g.again.includes(ctx.you), theyAgain = g.again.includes(g.seats[1 - me]);
    box.hidden = false;
    box.className = `result ${iWon ? 'is-win' : 'is-lose'}`;
    box.innerHTML = `<div><h3>${iWon ? '¡Ganaste!' : `Ganó ${ctx.esc(op.name)}`}</h3><p>${ctx.esc(r.winner === me ? (r.reason === 'metió la 8' ? 'Metiste la 8 como se debe.' : `${op.name} ${r.reason}.`) : (r.reason === 'metió la 8' ? `${op.name} metió la 8.` : `Uy: ${r.reason}.`))}</p></div>
      <div class="result-actions">${theyAgain && !iAgain ? `<span class="tag">${ctx.esc(op.name)} quiere otra ✓</span>` : ''}
      <button class="btn primary" data-again ${iAgain ? 'disabled' : ''}>${iAgain ? `Esperando a ${ctx.esc(op.name)}…` : 'Otra partida'}</button></div>`;
    box.querySelector('[data-again]')?.addEventListener('click', () => { ctx.sfx.tap(); ctx.send({ t: 'g:again' }); });
  }

  renderSpin(); renderPower();

  return {
    update(next, ev = {}) {
      if (!next) return;
      const prev = g;
      // tiro del otro: se anima desde el estado anterior con los mismos parámetros
      if (ev.k === 'move' && ev.by !== ctx.you && prev && !anim) {
        const prep = prepare(prev.round, ev.m);
        if (prep.ok) {
          remoteAim = null; shownAim = null;
          queued = { g: next, ev };
          startAnim(prep.balls, prep.shot, () => applyQueued());
          return;
        }
      }
      // confirmación de mi tiro: se aplica al terminar mi animación
      if (ev.k === 'move' && ev.by === ctx.you && anim) { queued = { g: next, ev }; pendingShot = null; return; }
      if (ev.k === 'sync' && pendingShot) {
        // el servidor no aceptó el tiro: cortar animación y regresar al estado bueno
        anim = null; queued = null; ctx.sfx.error();
        apply(next, ev); return;
      }
      if (ev.k === 'welcome' && pendingShot && next.v === pendingShot.v) { ctx.send({ t: 'g:move', v: next.v, m: pendingShot.mv }); return; }
      if (anim) {
        // llegó otro estado mientras se anima: guardar el más nuevo, sin perder el aviso del tiro
        queued = { g: next, ev: queued?.ev?.k === 'move' ? queued.ev : ev };
        return;
      }
      apply(next, ev);
    },
    aim(a) {
      if (!g || myTurn() || anim) return;
      if (!Number.isFinite(a.dx) || !Number.isFinite(a.dy)) return;
      remoteAim = { dx: a.dx, dy: a.dy, p: a.p || 0, sx: a.sx || 0, sy: a.sy || 0, cx: a.cx, cy: a.cy };
      if (!shownAim) shownAim = { ...remoteAim };
      dirty = true; kick();
    },
    refresh() { updateUI(); dirty = true; kick(); },
    destroy() { destroyed = true; roomEl?.classList.remove('focus'); ro.disconnect(); window.visualViewport?.removeEventListener('resize', onVV); window.removeEventListener('orientationchange', onVV); cancelAnimationFrame(raf); clearTimeout(aimTimer); root.innerHTML = ''; },
  };
}
