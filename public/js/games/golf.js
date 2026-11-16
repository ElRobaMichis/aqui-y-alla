// Minigolf mexicano: 9 hoyos con tema (la cuadra, el metro, Xochimilco, la glorieta, la pirámide,
// el mercado, lucha libre, Día de muertos y la pista de hielo del Zócalo).
// Se apunta como resortera: tocas, jalas hacia atrás y sueltas. La física (golf-physics.js) es
// determinista: el árbitro simula el golpe y los dos teléfonos animan exactamente el mismo.
// Los hoyos son más grandes que la pantalla: la cámara sigue a la pelota (y se puede ver todo).

import { simulate, travel, fanOn, tunnelOut, turnAt, R, CUP_R, FRAME_DT } from './golf-physics.js';
import { HOLE_BY_ID } from './golf-courses.js';
import { prepare, isOver, holeOf, totalOf, parOf, MAX_STROKES, PHASE_SPAN } from './golf-rules.js';

const INK = '#22283F';
const GRASS = '#6CB06A', GRASS_2 = '#62A660';
const SEAT_COLORS = ['#FFF7EA', '#F2A3B6'];
const VIEW_L = 4.8, VIEW_S = 2.9; // lo que se ve a la vez (m): como un hoyo de los chiquitos

/** fase de lo que se mueve: la misma en los dos teléfonos (reloj del sistema) */
const phaseNow = () => (Date.now() / 1000) % PHASE_SPAN;

const FALLS = { water: '¡al agua!', pit: '¡al bache!', tracks: '¡a las vías!', ice: '¡se rompió el hielo!', out: '¡se salió!' };

export function mount(root, ctx) {
  let g = null;
  let anim = null;              // { sim, seat, t0, ph, evIdx, done, wear }
  let pendingShot = null;
  let limbo = null;             // dónde quedó mi pelota mientras el árbitro confirma
  let queued = null;
  let aim = null;               // { dx, dy, p } mientras jalo
  let drag = null;
  let remoteAim = null, shownAim = null;
  let lastAimSent = 0, aimTimer = null;
  let view = null;
  let cam = null;               // { x, y, z } centro (m) y acercamiento
  let overview = false, introUntil = 0, lastT = 0;
  let layerHole = null;         // de qué hoyo es la capa pintada
  let raf = 0, destroyed = false, banner = null;
  const trail = [];

  root.innerHTML = `
    <div class="golf">
      <div class="game-head">
        <button class="btn ghost small" data-quit>← Sala</button>
        <div class="game-title"><h2>Minigolf</h2><span class="label-chip" data-holechip></span>
          <button class="icon-btn focus-btn" type="button" aria-label="Pantalla grande" title="Pantalla grande"></button></div>
      </div>
      <div class="vs golf-vs">
        <div class="chip" data-seat="0"></div>
        <div class="vs-mid">vs</div>
        <div class="chip" data-seat="1"></div>
      </div>
      <p class="g-status" aria-live="polite"></p>
      <div class="golf-main">
        <div class="golf-course surface"><canvas aria-label="Hoyo de minigolf"></canvas>
          <button class="golf-ov" type="button" aria-pressed="false" aria-label="Ver todo el hoyo" title="Ver todo el hoyo" hidden>
            <svg viewBox="0 0 24 24"><path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20z M9 4v13.5 M15 6.5V20" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg></button>
          <div class="golf-banner" hidden></div></div>
      </div>
      <p class="golf-tip"></p>
      <div class="golf-card" hidden></div>
      <div class="result" hidden></div>
    </div>`;
  const $ = (s) => root.querySelector(s);
  const canvas = $('canvas');
  const c2d = canvas.getContext('2d');
  const layer = document.createElement('canvas');
  $('[data-quit]').addEventListener('click', () => ctx.confirmQuit());

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
  const ovBtn = $('.golf-ov');
  ovBtn.addEventListener('click', () => {
    ctx.sfx.tap();
    overview = !overview; introUntil = 0;
    ovBtn.setAttribute('aria-pressed', overview);
    kick();
  });

  const mySeat = () => (g ? g.seats.indexOf(ctx.you) : -1);
  const round = () => g?.round;
  const hole = () => (g ? holeOf(g.round) : null);
  const myTurn = () => g && !anim && !pendingShot && !isOver(g.round) && g.round.turn === mySeat();

  /* ───────────── tamaño, orientación y cámara ───────────── */

  function layout() {
    const h = hole();
    if (!h) return;
    const main = $('.golf-main');
    const stage = root.closest('.stage');
    const vvH = window.visualViewport?.height || window.innerHeight;
    const tabs = document.querySelector('.tabs');
    const tabsH = tabs && getComputedStyle(tabs).display !== 'none' ? tabs.offsetHeight : 0;
    const top = main.getBoundingClientRect().top + (stage?.scrollTop || 0) - (window.visualViewport?.offsetTop || 0);
    const availH = Math.max(200, vvH - top - tabsH - 40);
    const availW = main.clientWidth - 6; // (menos el relleno para la sombra)
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const W = h.w, H = h.h;
    // horizontal o girado 90° (celular parado): gana el que deja ver las cosas más grandes
    const sH = Math.min(availW / Math.min(W, VIEW_L), availH / Math.min(H, VIEW_S));
    const sV = Math.min(availW / Math.min(H, VIEW_S), availH / Math.min(W, VIEW_L));
    const vertical = sV > sH * 1.05;
    const s = Math.max(40, vertical ? sV : sH);
    const cw = Math.round(Math.min(availW, (vertical ? H : W) * s)), ch = Math.round(Math.min(availH, (vertical ? W : H) * s));
    canvas.style.width = cw + 'px'; canvas.style.height = ch + 'px';
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
    const fit = Math.min(1, vertical ? Math.min(cw / (H * s), ch / (W * s)) : Math.min(cw / (W * s), ch / (H * s)));
    // la capa con todo lo que no se mueve: el hoyo completo (con tope de memoria para Safari)
    let L = s * dpr;
    if (W * H * L * L > 6e6) L = Math.sqrt(6e6 / (W * H));
    L = Math.min(L, 4000 / W, 4000 / H);
    layer.width = Math.round(W * L); layer.height = Math.round(H * L);
    view = { s, dpr, vertical, cw, ch, fit, L, hid: h.id };
    ovBtn.hidden = fit > 0.97;
    if (ovBtn.hidden) overview = false;
    layerHole = null;
    if (!cam) cam = camTarget();
    clampCam(cam);
    draw();
  }
  let lastW = 0;
  const ro = new ResizeObserver(() => { const w = root.clientWidth; if (w !== lastW) { lastW = w; layout(); } });
  ro.observe(root);
  const onVV = () => layout();
  window.visualViewport?.addEventListener('resize', onVV);
  window.addEventListener('orientationchange', onVV);

  // hoyo (m) → pantalla, con la cámara
  const setT = (c) => {
    const { s, dpr, vertical, cw, ch } = view, k = s * cam.z;
    if (vertical) c.setTransform(0, -k * dpr, k * dpr, 0, (cw / 2 - cam.y * k) * dpr, (ch / 2 + cam.x * k) * dpr);
    else c.setTransform(k * dpr, 0, 0, k * dpr, (cw / 2 - cam.x * k) * dpr, (ch / 2 - cam.y * k) * dpr);
  };
  // dirección en pantalla → dirección en el hoyo
  const toCourseDir = (sx, sy) => (view.vertical ? [-sy, sx] : [sx, sy]);

  function camTarget() {
    const h = hole(), r = g.round, now = performance.now();
    if (view && (overview || now < introUntil)) return { x: h.w / 2, y: h.h / 2, z: view.fit };
    let x, y;
    if (anim) { x = anim.x; y = anim.y; }
    else {
      const seat = isOver(r) ? mySeat() : r.turn;
      let b = r.balls[seat] || h.tee;
      if (pendingShot && limbo && seat === mySeat()) b = limbo;
      if (b.in) b = h.cup;
      x = b.x; y = b.y;
      // mira un poco hacia donde se apunta
      const a = myTurn() ? aim : shownAim;
      if (a) { const lead = 0.15 + a.p * 0.85; x += a.dx * lead; y += a.dy * lead; }
    }
    return { x, y, z: 1 };
  }
  function clampCam(c) {
    const { s, vertical, cw, ch } = view, k = s * c.z, h = hole();
    const hx = (vertical ? ch : cw) / (2 * k), hy = (vertical ? cw : ch) / (2 * k);
    c.x = h.w <= 2 * hx ? h.w / 2 : Math.min(h.w - hx, Math.max(hx, c.x));
    c.y = h.h <= 2 * hy ? h.h / 2 : Math.min(h.h - hy, Math.max(hy, c.y));
  }
  /** mueve la cámara hacia donde debe estar; true si todavía se está moviendo */
  function stepCam(dt) {
    const t = camTarget();
    clampCam(t);
    if (!Number.isFinite(cam.x + cam.y + cam.z)) Object.assign(cam, t); // nunca dejar la cámara trabada
    const f = 1 - Math.exp(-dt * (anim ? 7 : 4.5));
    cam.x += (t.x - cam.x) * f; cam.y += (t.y - cam.y) * f; cam.z += (t.z - cam.z) * f;
    clampCam(cam);
    return Math.abs(t.x - cam.x) + Math.abs(t.y - cam.y) > 0.004 || Math.abs(t.z - cam.z) > 0.002;
  }

  /* ───────────── dibujo ───────────── */

  function paintLayer(h) {
    const c = layer.getContext('2d');
    c.setTransform(view.L, 0, 0, view.L, 0, 0);
    c.clearRect(0, 0, h.w, h.h);
    paintHole(c, h);
    layerHole = h.id;
  }

  /** cómo va cada pista de hielo (durante un golpe, según lo que ya pasó) */
  function iceWear(t) {
    const base = anim ? anim.wear : g.round.wear || [];
    const w = base.slice();
    if (anim) for (const e of anim.sim.events) {
      if (e.t > t) break;
      if (e.type === 'crack' || e.type === 'break') w[e.ice] = Math.max(w[e.ice] || 0, e.w);
    }
    return w;
  }

  function draw() {
    if (!view || !g) return;
    const h = hole();
    if (view.hid !== h.id) { layout(); return; }
    UPRIGHT = view.vertical ? Math.PI / 2 : 0;
    if (layerHole !== h.id) paintLayer(h);
    c2d.setTransform(1, 0, 0, 1, 0, 0);
    c2d.fillStyle = THEMES[h.id].bg;
    c2d.fillRect(0, 0, canvas.width, canvas.height);
    setT(c2d);
    c2d.drawImage(layer, 0, 0, h.w, h.h);
    const at = anim ? Math.max(0, (performance.now() - anim.t0) / 1000) : 0;
    const t = anim ? anim.ph + at : phaseNow();
    // hielo (se va cuarteando)
    if (h.zones?.some((z) => z.type === 'ice')) {
      const w = iceWear(at);
      let i = 0;
      for (const z of h.zones) if (z.type === 'ice') { paintIce(c2d, z, w[i] || 0, i); i++; }
    }
    for (const f of h.fans || []) paintFan(c2d, f, fanOn(f, t), t);
    for (const tu of h.tunnels || []) paintPortals(c2d, tu, tunnelOut(tu, t), t);
    for (const pf of h.platforms || []) { const p = travel(pf, t); paintPlatform(c2d, pf, p); }
    for (const m of h.movers || []) {
      const p = travel(m, t);
      if (m.clip) { c2d.save(); poly(c2d, m.clip); c2d.clip(); }
      paintMover(c2d, m, p.x, p.y);
      if (m.clip) c2d.restore();
    }
    for (const sp of h.spinners || []) paintSpinner(c2d, sp, turnAt(sp, t));
    for (const rg of h.rings || []) paintRing(c2d, rg, turnAt(rg, t));
    paintCup(c2d, h);
    // pelotas
    const r = g.round, me = mySeat();
    for (const seat of [1 - me, me]) {
      let b = r.balls[seat];
      if (anim && anim.seat === seat) continue;
      if (pendingShot && seat === me && limbo) b = limbo;
      if (b.in) continue;
      const turnSeat = !isOver(r) && r.turn === seat;
      paintBall(c2d, b.x, b.y, SEAT_COLORS[seat], turnSeat || anim ? 1 : 0.55, turnSeat && !anim, 0, 0);
    }
    if (anim) {
      const a = anim;
      if (trail.length > 1) {
        c2d.lineCap = 'round';
        for (let i = 1; i < trail.length; i++) {
          c2d.strokeStyle = `rgba(255,247,234,${(0.35 * i) / trail.length})`;
          c2d.lineWidth = R * 1.4 * (i / trail.length);
          c2d.beginPath(); c2d.moveTo(trail[i - 1][0], trail[i - 1][1]); c2d.lineTo(trail[i][0], trail[i][1]); c2d.stroke();
        }
      }
      if (a.vis) paintBall(c2d, a.x, a.y, SEAT_COLORS[a.seat], 1, false, a.sink, a.z);
    }
    // puntería
    if (myTurn() && aim) paintAim(c2d, r.balls[me], aim, true);
    else if (!anim && shownAim && !pendingShot && g.round.turn !== me && !isOver(r)) paintAim(c2d, r.balls[r.turn], shownAim, false);
  }

  function paintAim(c, b, a, mine) {
    const len = 0.18 + a.p * 1.15;
    const ex = b.x + a.dx * len, ey = b.y + a.dy * len;
    const col = a.p > 0.8 ? '#E2553F' : a.p > 0.5 ? '#EDB447' : '#FFF7EA';
    c.save();
    c.globalAlpha = mine ? 1 : 0.6;
    c.setLineDash([0.05, 0.05]);
    c.lineCap = 'round';
    c.strokeStyle = INK; c.lineWidth = 0.05;
    c.beginPath(); c.moveTo(b.x, b.y); c.lineTo(ex, ey); c.stroke();
    c.strokeStyle = col; c.lineWidth = 0.028;
    c.beginPath(); c.moveTo(b.x, b.y); c.lineTo(ex, ey); c.stroke();
    c.setLineDash([]);
    const nx = -a.dy, ny = a.dx, hs = 0.075;
    c.fillStyle = col; c.strokeStyle = INK; c.lineWidth = 0.018;
    c.beginPath();
    c.moveTo(ex + a.dx * hs, ey + a.dy * hs);
    c.lineTo(ex + nx * hs * 0.7, ey + ny * hs * 0.7);
    c.lineTo(ex - nx * hs * 0.7, ey - ny * hs * 0.7);
    c.closePath(); c.fill(); c.stroke();
    c.restore();
  }

  function frame(now) {
    raf = 0;
    if (destroyed) return;
    const dt = Math.min(0.1, lastT ? (now - lastT) / 1000 : 0.016);
    lastT = now;
    if (anim) stepAnim(now);
    if (remoteAim && shownAim) {
      const k = 0.25;
      shownAim.dx += (remoteAim.dx - shownAim.dx) * k; shownAim.dy += (remoteAim.dy - shownAim.dy) * k;
      const l = Math.hypot(shownAim.dx, shownAim.dy) || 1; shownAim.dx /= l; shownAim.dy /= l;
      shownAim.p += (remoteAim.p - shownAim.p) * k;
    }
    const moving = view && g ? stepCam(dt) : false;
    draw();
    const h = hole();
    const alive = h && (h.movers?.length || h.platforms?.length || h.spinners?.length || h.rings?.length || h.fans?.length || h.tunnels?.length);
    if (anim || alive || shownAim || moving || performance.now() < introUntil + 1500) kick();
    else lastT = 0;
  }
  function kick() { if (!raf && !destroyed) raf = requestAnimationFrame(frame); }

  /* ───────────── animación del golpe ───────────── */

  function startAnim(seat, prep, done) {
    const sim = simulate(prep.hole, prep.ball, prep.shot, prep.ph, prep.wear);
    trail.length = 0;
    introUntil = 0;
    anim = { sim, seat, ph: prep.ph, wear: prep.wear, t0: performance.now(), evIdx: 0, done, x: prep.ball.x, y: prep.ball.y, z: 0, vis: true, sink: 0 };
    ctx.sfx.cue(prep.shot.power * 0.8);
    updateUI();
    kick();
  }
  function stepAnim(now) {
    const a = anim;
    // (el reloj de requestAnimationFrame puede ir unos ms antes que el de cuando se tiró)
    const t = Math.max(0, (now - a.t0) / 1000);
    const { frames, n, events } = a.sim;
    const fi = Math.min(n - 1, t / FRAME_DT);
    const f0 = Math.floor(fi), f1 = Math.min(n - 1, f0 + 1), k = fi - f0;
    a.x = frames[f0 * 3] + (frames[f1 * 3] - frames[f0 * 3]) * k;
    a.y = frames[f0 * 3 + 1] + (frames[f1 * 3 + 1] - frames[f0 * 3 + 1]) * k;
    const v0 = frames[f0 * 3 + 2], v1 = frames[f1 * 3 + 2];
    a.vis = v0 > 0 && v1 > 0;
    a.z = a.vis ? Math.max(0, v0 + (v1 - v0) * k - 1) : 0;
    // (si la pelota "brincó" —túnel— o se saltaron cuadros mientras estaba escondida, la estela
    // no debe unir los dos lados)
    const lastP = trail[trail.length - 1];
    let hid = !a.vis;
    for (let i = (a.lastF ?? f0) + 1; i <= f1 && !hid; i++) if (frames[i * 3 + 2] === 0) hid = true;
    a.lastF = f1;
    if (hid || (lastP && Math.hypot(a.x - lastP[0], a.y - lastP[1]) > 0.35)) trail.length = 0;
    if (a.vis) { trail.push([a.x, a.y]); if (trail.length > 14) trail.shift(); }
    while (a.evIdx < events.length && events[a.evIdx].t <= t) {
      const e = events[a.evIdx++];
      if (t - e.t > 0.2) continue;
      if (e.type === 'wall') ctx.sfx.rail(Math.min(1, e.v / 2.5));
      else if (e.type === 'rope') { ctx.sfx.rail(Math.min(1, e.v / 2)); ctx.sfx.clack(0.4); }
      else if (e.type === 'whack') ctx.sfx.clack(Math.min(1, 0.3 + e.v / 3));
      else if (e.type === 'cup') { ctx.sfx.pocket(); a.sink = performance.now(); }
      else if (e.type === 'water') ctx.sfx.poof();
      else if (e.type === 'tunnel' || e.type === 'jump' || e.type === 'hop') ctx.sfx.send();
      else if (e.type === 'land') ctx.sfx.clack(0.25);
      else if (e.type === 'board') ctx.sfx.tap();
      else if (e.type === 'crack') ctx.sfx.scribble(1, 1.4);
      else if (e.type === 'break') ctx.sfx.poof();
      else if (e.type === 'sand') ctx.sfx.scribble(1, 0.5);
    }
    const end = fi >= n - 1;
    const sinkDone = !a.sink || now - a.sink > 380;
    if (end && sinkDone && t > a.sim.dur + 0.15) {
      const done = a.done;
      if (a.seat === mySeat() && pendingShot) {
        const s = a.sim;
        limbo = s.end === 'cup' ? { x: s.x, y: s.y, in: true } : s.end === 'water' ? { ...g.round.balls[a.seat] } : { x: s.x, y: s.y, in: false };
      }
      anim = null; trail.length = 0;
      done?.();
      updateUI();
    }
  }

  /* ───────────── apuntar: resortera ───────────── */

  const MAX_PULL = () => Math.max(110, Math.min(view.cw, view.ch) * 0.42); // px de jalón = fuerza máxima
  canvas.addEventListener('pointerdown', (e) => {
    if (!view || !g) return;
    if (!myTurn()) { if (!isOver(g.round) && !anim) ctx.toast('Espera tu turno'); return; }
    try { canvas.setPointerCapture(e.pointerId); } catch {}
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY };
    aim = null;
    introUntil = 0;
    ctx.sfx.tap();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    const l = Math.hypot(dx, dy);
    if (l < 8) { aim = null; kick(); sendAim(); return; }
    // se jala hacia atrás: la pelota sale para el otro lado
    const [ux, uy] = toCourseDir(-dx / l, -dy / l);
    aim = { dx: ux, dy: uy, p: Math.min(1, l / MAX_PULL()) };
    kick(); sendAim();
  });
  const endDrag = (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    drag = null;
    if (aim && aim.p > 0.04 && myTurn()) shoot();
    else { aim = null; kick(); sendAim(); }
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', (e) => { if (drag?.id === e.pointerId) { drag = null; aim = null; kick(); sendAim(); } });

  const q4 = (v) => Math.round(v * 1e4) / 1e4;
  function sendAim() {
    if (!myTurn()) return;
    const every = ctx.direct?.() ? 70 : 150;
    const doSend = () => {
      aimTimer = null;
      if (!myTurn()) return;
      if (ctx.busy()) { aimTimer = setTimeout(doSend, every); return; }
      lastAimSent = performance.now();
      ctx.send({ t: 'g:aim', a: aim ? { dx: q4(aim.dx), dy: q4(aim.dy), p: q4(aim.p) } : { dx: 0, dy: 0, p: 0 } });
    };
    const now = performance.now();
    if (now - lastAimSent >= every) { clearTimeout(aimTimer); doSend(); }
    else if (!aimTimer) aimTimer = setTimeout(doSend, every - (now - lastAimSent));
  }

  function shoot() {
    const r = round(), me = mySeat();
    const mv = { shot: { dx: q4(aim.dx), dy: q4(aim.dy), power: q4(aim.p) }, ph: Math.round(phaseNow() * 1000) / 1000 };
    const prep = prepare(r, me, mv);
    aim = null;
    if (!prep.ok) { ctx.sfx.error(); ctx.toast('Ese golpe no se puede'); kick(); return; }
    if (!ctx.send({ t: 'g:move', v: g.v, m: mv })) ctx.toast('Sin señal: tu golpe se manda en cuanto vuelva');
    clearTimeout(aimTimer); aimTimer = null;
    pendingShot = { v: g.v, mv };
    startAnim(me, prep, () => { if (queued) applyQueued(); });
  }

  /* ───────────── estado ───────────── */

  function applyQueued() { const q = queued; queued = null; apply(q.g, q.ev); }

  function apply(next, ev = {}) {
    const prevHole = g ? g.round.hole : -1, prevV = g?.v;
    g = next;
    pendingShot = null; limbo = null;
    if (!g) return;
    const r = g.round;
    if (ev.k === 'move' && r.last) narrate(r);
    if ((r.hole !== prevHole || ev.k === 'round' || ev.k === 'start' || prevV == null) && !isOver(r)) showBanner();
    if (myTurn() && ev.k === 'move' && ev.by !== ctx.you) setTimeout(() => ctx.sfx.turn(), 200);
    if (!myTurn()) { remoteAim = null; shownAim = null; }
    if (ev.k === 'move' && isOver(r)) outcome(r);
    if (!view || view.hid !== hole().id) { cam = null; layout(); }
    updateUI();
    kick();
  }

  function showBanner() {
    const h = hole(), r = g.round;
    const el = $('.golf-banner');
    el.innerHTML = `<small>Hoyo ${r.hole + 1} de ${r.holes.length} · par ${h.par}</small><b>${h.name}</b><span>${h.place}</span>`;
    el.hidden = false;
    el.classList.remove('out');
    clearTimeout(banner);
    // mientras está el cartel se ve el hoyo completo; luego la cámara baja a la pelota
    introUntil = performance.now() + 2600;
    banner = setTimeout(() => { el.classList.add('out'); banner = setTimeout(() => { el.hidden = true; }, 400); }, 2400);
  }

  function narrate(r) {
    const L = r.last, mine = L.by === mySeat();
    const who = mine ? 'Tú' : ctx.player(g.seats[L.by]).name;
    if (L.end === 'cup') {
      const par = HOLE_BY_ID[r.holes[L.hole]].par, d = L.strokes - par;
      const word = L.strokes === 1 ? '¡HOYO EN UNO!' : d <= -2 ? '¡Águila!' : d === -1 ? '¡Birdie!' : d === 0 ? 'Par' : d === 1 ? 'Bogey' : `${L.strokes} golpes`;
      ctx.toast(`${who}: ${word}`, 2600);
      if (L.strokes === 1 || d <= -1) { ctx.sfx.win(); if (mine) ctx.confetti(); }
    } else if (L.penalty) ctx.toast(`${who}: ${FALLS[L.why] || FALLS.water} +1 de castigo`, 2400);
    else if (L.maxed) ctx.toast(`${who}: ${MAX_STROKES} golpes, se apuntan ${MAX_STROKES + 1}`, 2400);
  }

  function outcome(r) {
    const me = mySeat();
    setTimeout(() => {
      if (r.winner === me) { ctx.sfx.win(); ctx.confetti(); }
      else if (r.winner === -1) ctx.sfx.draw();
      else ctx.sfx.lose();
    }, 300);
  }

  const diff = (n) => (n === 0 ? 'par' : n > 0 ? `+${n}` : `${n}`);
  function chipHTML(seat) {
    const id = g.seats[seat];
    const p = ctx.player(id);
    const r = g.round;
    const done = r.strokes[seat].slice(0, r.hole + (isOver(r) ? 1 : 0));
    const parSoFar = r.holes.slice(0, done.length).reduce((a, hid) => a + HOLE_BY_ID[hid].par, 0);
    const tot = totalOf(r, seat);
    const cur = isOver(r) ? '' : `<span class="golf-now">hoyo: ${r.strokes[seat][r.hole]}</span>`;
    return `<div class="chip-av">${ctx.critter(p.look.k, p.look.c, p.on ? '' : 'sleepy')}</div>
      <div class="chip-txt"><b>${ctx.esc(p.name)}${id === ctx.you ? ' <small>(tú)</small>' : ''}</b>
        <span class="golf-sum"><i class="gb" style="--c:${SEAT_COLORS[seat]}"></i>${tot} golpes${done.length ? ` · ${diff(done.reduce((a, b) => a + b, 0) - parSoFar)}` : ''}</span>${cur}</div>
      <div class="chip-score">${g.score?.[id] || 0}</div>`;
  }

  function cardHTML() {
    const r = g.round, me = mySeat();
    const order = [me, 1 - me];
    const cell = (seat, i) => {
      const n = r.strokes[seat][i];
      if (i > r.hole || (i === r.hole && !isOver(r) && !r.balls[seat].in)) return '<td></td>';
      const par = HOLE_BY_ID[r.holes[i]].par;
      return `<td class="${n === 1 ? 'ace' : n < par ? 'under' : n > par ? 'over' : ''}">${n}</td>`;
    };
    return `<table><thead><tr><th></th>${r.holes.map((id, i) => `<th title="${HOLE_BY_ID[id].name}">${i + 1}</th>`).join('')}<th>Σ</th></tr></thead><tbody>
      <tr class="par"><th>par</th>${r.holes.map((id) => `<td>${HOLE_BY_ID[id].par}</td>`).join('')}<td>${parOf(r)}</td></tr>
      ${order.map((seat) => `<tr><th>${ctx.esc(ctx.player(g.seats[seat]).name)}</th>${r.holes.map((_, i) => cell(seat, i)).join('')}<td><b>${totalOf(r, seat)}</b></td></tr>`).join('')}
    </tbody></table>`;
  }

  function updateUI() {
    if (!g) return;
    const r = g.round, me = mySeat(), h = hole();
    for (const seat of [0, 1]) {
      const chip = root.querySelector(`.chip[data-seat="${seat}"]`);
      const html = chipHTML(seat);
      if (chip.dataset.html !== html) { chip.innerHTML = html; chip.dataset.html = html; }
      chip.classList.toggle('turn', !isOver(r) && r.turn === seat && !anim);
      chip.classList.toggle('won', r.winner === seat);
    }
    $('[data-holechip]').textContent = isOver(r) ? 'final' : `hoyo ${r.hole + 1}/${r.holes.length}`;
    const op = ctx.player(g.seats[1 - me]);
    const st = $('.g-status');
    if (anim) st.textContent = '…';
    else if (isOver(r)) st.textContent = '';
    else if (r.turn === me) st.innerHTML = `<b>Tu turno</b>&nbsp;· golpe ${r.strokes[me][r.hole] + 1} · ${h.name}`;
    else st.innerHTML = `Turno de ${ctx.esc(ctx.player(g.seats[r.turn]).name)} · ${h.name}`;
    st.classList.toggle('mine', myTurn());
    $('.golf').classList.toggle('my-turn', !!myTurn());
    $('.golf-tip').textContent = isOver(r) ? '' : myTurn() ? `Toca, jala hacia atrás y suelta · ${h.tip}` : h.tip;
    const card = $('.golf-card');
    card.hidden = false;
    const ch = cardHTML(); if (card.dataset.html !== ch) { card.innerHTML = ch; card.dataset.html = ch; }
    // resultado
    const box = $('.result');
    if (!isOver(r) || anim) { box.hidden = true; return; }
    const iWon = r.winner === me, draw_ = r.winner === -1;
    const iAgain = g.again.includes(ctx.you), theyAgain = g.again.includes(g.seats[1 - me]);
    box.hidden = false;
    box.className = `result ${draw_ ? 'is-draw' : iWon ? 'is-win' : 'is-lose'}`;
    const a = totalOf(r, me), b = totalOf(r, 1 - me);
    box.innerHTML = `<div><h3>${draw_ ? '¡Empate!' : iWon ? '¡Ganaste!' : `Ganó ${ctx.esc(op.name)}`}</h3><p>${a} contra ${b} golpes (par ${parOf(r)}).</p></div>
      <div class="result-actions">${theyAgain && !iAgain ? `<span class="tag">${ctx.esc(op.name)} quiere otra ✓</span>` : ''}
      <button class="btn primary" data-again ${iAgain ? 'disabled' : ''}>${iAgain ? `Esperando a ${ctx.esc(op.name)}…` : 'Otra partida'}</button></div>`;
    box.querySelector('[data-again]')?.addEventListener('click', () => { ctx.sfx.tap(); ctx.send({ t: 'g:again' }); });
  }

  return {
    update(next, ev = {}) {
      if (!next) return;
      const prev = g;
      // golpe del otro: se anima desde el estado anterior
      if (ev.k === 'move' && ev.by !== ctx.you && prev && !anim) {
        const seat = prev.seats.indexOf(ev.by);
        const prep = prepare(prev.round, seat, ev.m);
        if (prep.ok) {
          remoteAim = null; shownAim = null;
          queued = { g: next, ev };
          startAnim(seat, prep, () => applyQueued());
          return;
        }
      }
      if (ev.k === 'move' && ev.by === ctx.you && anim) { queued = { g: next, ev }; pendingShot = null; return; }
      if (ev.k === 'sync' && pendingShot) { anim = null; queued = null; limbo = null; ctx.sfx.error(); apply(next, ev); return; }
      if (ev.k === 'welcome' && pendingShot && next.v === pendingShot.v) { ctx.send({ t: 'g:move', v: next.v, m: pendingShot.mv }); return; }
      if (anim) { queued = { g: next, ev: queued?.ev?.k === 'move' ? queued.ev : ev }; return; }
      apply(next, ev);
    },
    aim(a) {
      if (!g || myTurn() || anim) return;
      if (!Number.isFinite(a.dx) || !Number.isFinite(a.dy)) return;
      if (!a.p || (a.dx === 0 && a.dy === 0)) { remoteAim = null; shownAim = null; kick(); return; }
      remoteAim = { dx: a.dx, dy: a.dy, p: a.p };
      if (!shownAim) shownAim = { ...remoteAim };
      kick();
    },
    refresh() { updateUI(); kick(); },
    destroy() {
      destroyed = true; roomEl?.classList.remove('focus'); ro.disconnect();
      window.visualViewport?.removeEventListener('resize', onVV); window.removeEventListener('orientationchange', onVV);
      cancelAnimationFrame(raf); clearTimeout(aimTimer); clearTimeout(banner); root.innerHTML = '';
    },
  };
}

/* ═════════════ arte: todo plano, tinta oscura y sombras duras ═════════════ */

// con el celular parado el hoyo se dibuja girado 90°; las banderas, letreros y el banderín del
// hoyo se giran de regreso para que sigan derechos
let UPRIGHT = 0;

const THEMES = {
  cuadra: { bg: '#B9B3A6', wall: '#D8CFC0' },
  metro: { bg: '#3C4058', wall: '#F8DB8E' },
  xochi: { bg: '#5FA8C9', wall: '#8C4A2F' },
  glorieta: { bg: '#8F8B94', wall: '#E6DFD2' },
  piramide: { bg: '#E3C38E', wall: '#B9824E' },
  mercado: { bg: '#E7B9A0', wall: '#D9673F' },
  lucha: { bg: '#2C2D45', wall: '#E2553F' },
  muertos: { bg: '#4A3566', wall: '#EE8A3A' },
  zocalo: { bg: '#CFC6B8', wall: '#8FBDE3' },
};

/* números "al azar" pero siempre iguales (para que el dibujo no cambie entre cuadros) */
const hash = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

/* texto en metros: se dibuja a tamaño normal y se escala (Safari maneja mal fuentes de 0.1 px) */
function label(c, str, x, y, size, color = INK, upright = true) {
  c.save(); c.translate(x, y); if (upright) c.rotate(UPRIGHT); c.scale(size / 100, size / 100);
  c.fillStyle = color; c.font = '800 100px ui-rounded, system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(str, 0, 0); c.restore();
}
function poly(c, pts) { c.beginPath(); c.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]); c.closePath(); }
function rr(c, x, y, w, h, r) { c.beginPath(); c.roundRect(x, y, w, h, r); }
function ink(c, w = 0.02) { c.strokeStyle = INK; c.lineWidth = w; c.lineJoin = 'round'; c.lineCap = 'round'; c.stroke(); }
function circle(c, x, y, r) { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); }
function shadow(c, draw, dx = 0.035, dy = 0.04) {
  c.save(); c.translate(dx, dy); c.fillStyle = 'rgba(34,40,63,.28)'; draw(); c.fill(); c.restore();
}
const bbox = (pts) => {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
};

function paintHole(c, h) {
  const th = THEMES[h.id], W = h.w, H = h.h;
  c.fillStyle = th.bg; c.fillRect(0, 0, W, H);
  background(c, h);
  // pasto con franjas de podadora
  c.save();
  for (const p of h.green) shadow(c, () => poly(c, p), 0.05, 0.06);
  c.beginPath(); for (const p of h.green) { c.moveTo(p[0][0], p[0][1]); for (let i = 1; i < p.length; i++) c.lineTo(p[i][0], p[i][1]); c.closePath(); }
  c.clip();
  c.fillStyle = GRASS; c.fillRect(0, 0, W, H);
  c.fillStyle = GRASS_2; for (let x = 0; x < W; x += 0.4) c.fillRect(x, 0, 0.2, H);
  c.restore();
  for (const p of h.green) { poly(c, p); ink(c, 0.025); }
  // superficies (el hielo se dibuja aparte: se va cuarteando)
  for (const z of h.zones || []) zone(c, z, h);
  // decoración del suelo (antes de paredes y postes)
  for (const d of h.decor || []) decorFloor(c, d, h);
  // paredes
  for (const w of h.walls) {
    const pts = w.pts || w;
    const rope = (w.e ?? 0) > 1;
    c.save();
    c.lineCap = 'round'; c.lineJoin = 'round';
    c.beginPath(); c.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
    if (rope) {
      c.strokeStyle = INK; c.lineWidth = 0.075; c.stroke();
      c.strokeStyle = '#E2553F'; c.lineWidth = 0.05; c.stroke();
      c.setLineDash([0.12, 0.12]); c.strokeStyle = '#FFF7EA'; c.lineWidth = 0.05; c.stroke(); c.setLineDash([]);
    } else {
      c.strokeStyle = INK; c.lineWidth = 0.075; c.stroke();
      c.strokeStyle = th.wall; c.lineWidth = 0.045; c.stroke();
    }
    c.restore();
  }
  // postes
  for (const p of h.posts || []) {
    if ((h.decor || []).some((d) => d.x === p.x && d.y === p.y)) continue; // los pinta su decoración
    shadow(c, () => circle(c, p.x, p.y, p.r));
    circle(c, p.x, p.y, p.r); c.fillStyle = '#EADDC6'; c.fill(); ink(c);
  }
  // decoración encima
  for (const d of h.decor || []) decorTop(c, d, h);
  // la salida
  c.fillStyle = 'rgba(255,247,234,.55)'; rr(c, h.tee.x - 0.11, h.tee.y - 0.11, 0.22, 0.22, 0.04); c.fill();
  c.setLineDash([0.03, 0.03]); ink(c, 0.012); c.setLineDash([]);
}

function waves(c, x0, y0, x1, y1, col = 'rgba(255,255,255,.45)') {
  c.strokeStyle = col; c.lineWidth = 0.018; c.lineCap = 'round';
  let k = 0;
  for (let y = y0 + 0.12; y < y1; y += 0.22, k++) for (let x = x0 + 0.05 + (k % 2) * 0.25; x < x1; x += 0.5) {
    c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + 0.06, y - 0.04, x + 0.12, y); c.quadraticCurveTo(x + 0.18, y + 0.04, x + 0.24, y); c.stroke();
  }
}

function zone(c, z, h) {
  const b = bbox(z.poly);
  if (z.type === 'sand' || z.type === 'petals') {
    c.fillStyle = z.type === 'sand' ? '#F1E6CC' : '#F4A63A';
    poly(c, z.poly); c.fill();
    c.fillStyle = z.type === 'sand' ? '#D9C9A3' : '#E2553F';
    let k = 0;
    for (let y = b.y0 + 0.05; y < b.y1; y += 0.08) for (let x = b.x0 + 0.05 + ((k++ % 2) * 0.04); x < b.x1; x += 0.08) { circle(c, x, y, z.type === 'sand' ? 0.009 : 0.016); c.fill(); }
  } else if (z.type === 'slope') {
    const big = b.x1 - b.x0 > 3 && b.y1 - b.y0 > 1.5;
    if (h.id === 'piramide') return; // la pirámide se pinta entera en su decoración
    c.save(); poly(c, z.poly); c.clip();
    c.fillStyle = big ? 'rgba(0,0,0,0)' : 'rgba(34,40,63,.10)'; c.fill();
    const l = Math.hypot(z.ax, z.ay) || 1, ux = z.ax / l, uy = z.ay / l, nx = -uy, ny = ux;
    c.strokeStyle = big ? 'rgba(255,255,255,.12)' : 'rgba(255,255,255,.35)'; c.lineWidth = 0.018; c.lineCap = 'round';
    const step = big ? 0.5 : 0.16;
    for (let x = b.x0 + step / 2; x < b.x1; x += step) for (let y = b.y0 + step / 2; y < b.y1; y += step) {
      const a = 0.035;
      c.beginPath();
      c.moveTo(x - ux * a + nx * a, y - uy * a + ny * a); c.lineTo(x + ux * a, y + uy * a); c.lineTo(x - ux * a - nx * a, y - uy * a - ny * a);
      c.stroke();
    }
    c.restore();
  } else if (z.type === 'water') {
    c.fillStyle = '#5FA8C9'; poly(c, z.poly); c.fill();
    c.save(); poly(c, z.poly); c.clip(); waves(c, b.x0, b.y0, b.x1, b.y1); c.restore();
    if (b.x1 - b.x0 < 1.5) { poly(c, z.poly); ink(c, 0.02); }
  } else if (z.type === 'pit') {
    if (z.why === 'tracks') return; // las vías las pinta el fondo del metro
    if (b.x1 - b.x0 > 0.5 && b.y1 - b.y0 > 1) return; // la zanja la pinta la obra
    // bache: hoyo oscuro con orilla de asfalto roto
    c.fillStyle = '#8A8478'; poly(c, z.poly.map(([x, y]) => [x + (x - (b.x0 + b.x1) / 2) * 0.18, y + (y - (b.y0 + b.y1) / 2) * 0.18])); c.fill();
    poly(c, z.poly); c.fillStyle = '#2B2E40'; c.fill(); ink(c, 0.018);
    c.fillStyle = '#1A1E30'; circle(c, (b.x0 + b.x1) / 2 + 0.02, (b.y0 + b.y1) / 2 + 0.02, (b.x1 - b.x0) * 0.25); c.fill();
  } else if (z.type === 'ramp') {
    // tablón de madera con flechas
    shadow(c, () => poly(c, z.poly), 0.03, 0.04);
    c.fillStyle = '#C98F5A'; poly(c, z.poly); c.fill();
    c.strokeStyle = 'rgba(34,40,63,.35)'; c.lineWidth = 0.01;
    for (let y = b.y0 + 0.08; y < b.y1; y += 0.09) { c.beginPath(); c.moveTo(b.x0 + 0.02, y); c.lineTo(b.x1 - 0.02, y); c.stroke(); }
    poly(c, z.poly); ink(c, 0.02);
    c.strokeStyle = '#FFF7EA'; c.lineWidth = 0.025;
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    for (const o of [-0.1, 0.06]) {
      c.beginPath(); c.moveTo(cx + o * z.dx - 0.08 * z.dy - 0.06 * z.dx, cy + o * z.dy + 0.08 * z.dx - 0.06 * z.dy);
      c.lineTo(cx + o * z.dx, cy + o * z.dy);
      c.lineTo(cx + o * z.dx + 0.08 * z.dy - 0.06 * z.dx, cy + o * z.dy - 0.08 * z.dx - 0.06 * z.dy); c.stroke();
    }
  }
}

/* hielo: azul clarito con rayones de patines; las grietas crecen con el desgaste */
function paintIce(c, z, wear, idx) {
  const b = bbox(z.poly), f = Math.min(1, wear / z.life);
  if (f >= 1) {
    // roto: agua con pedazos flotando
    c.fillStyle = '#5FA8C9'; poly(c, z.poly); c.fill();
    c.save(); poly(c, z.poly); c.clip(); waves(c, b.x0, b.y0, b.x1, b.y1);
    for (let i = 0; i < 14; i++) {
      const x = b.x0 + hash(idx * 50 + i) * (b.x1 - b.x0), y = b.y0 + hash(idx * 50 + i + 20) * (b.y1 - b.y0), s = 0.08 + hash(i + 7) * 0.12;
      c.beginPath(); c.moveTo(x, y - s); c.lineTo(x + s, y - s * 0.2); c.lineTo(x + s * 0.4, y + s); c.lineTo(x - s * 0.8, y + s * 0.5); c.closePath();
      c.fillStyle = '#E4F6FC'; c.fill(); ink(c, 0.012);
    }
    c.restore();
    return;
  }
  c.fillStyle = '#D8F1FA'; poly(c, z.poly); c.fill();
  c.save(); poly(c, z.poly); c.clip();
  // rayones de patines
  c.strokeStyle = 'rgba(255,255,255,.9)'; c.lineWidth = 0.012; c.lineCap = 'round';
  for (let i = 0; i < 9; i++) {
    const x = b.x0 + hash(i + 3) * (b.x1 - b.x0), y = b.y0 + hash(i + 11) * (b.y1 - b.y0), r = 0.3 + hash(i) * 0.5;
    c.beginPath(); c.arc(x, y, r, hash(i + 5) * 6, hash(i + 5) * 6 + 1.4); c.stroke();
  }
  // grietas: cada vez más (y más oscuras)
  const n = Math.floor(f * 14);
  c.strokeStyle = f > 0.66 ? INK : 'rgba(34,40,63,.6)'; c.lineWidth = f > 0.66 ? 0.016 : 0.011;
  for (let i = 0; i < n; i++) {
    let x = b.x0 + 0.2 + hash(idx * 31 + i) * (b.x1 - b.x0 - 0.4), y = b.y0 + 0.15 + hash(idx * 31 + i + 9) * (b.y1 - b.y0 - 0.3);
    c.beginPath(); c.moveTo(x, y);
    for (let k = 0; k < 4; k++) { x += (hash(i * 7 + k) - 0.5) * 0.4; y += (hash(i * 13 + k) - 0.5) * 0.4; c.lineTo(x, y); }
    c.stroke();
  }
  if (f > 0.75) { c.fillStyle = 'rgba(95,168,201,.25)'; poly(c, z.poly); c.fill(); }
  c.restore();
}

/* ventilador: aspas que giran y ráfagas mientras está prendido */
function paintFan(c, f, on, t) {
  const [x0, y0, x1, y1] = f.box, [dx, dy] = f.dir;
  if (on) {
    c.save(); c.beginPath(); c.rect(x0, y0, x1 - x0, y1 - y0); c.clip();
    c.strokeStyle = f.kind === 'snow' ? 'rgba(255,255,255,.85)' : 'rgba(255,255,255,.55)'; c.lineWidth = 0.02; c.lineCap = 'round';
    const along = dx ? x1 - x0 : y1 - y0, across = dx ? y1 - y0 : x1 - x0;
    const off = (t * 1.6) % 0.5;
    for (let a = 0.1; a < across; a += 0.18) for (let s = -0.5 + off + (hash(a * 10) * 0.4); s < along; s += 0.5) {
      // ráfagas que avanzan en la dirección del viento
      const u = dx > 0 || dy > 0 ? s : along - s;
      const px = dx ? x0 + u : x0 + a, py = dx ? y0 + a : y0 + u;
      c.beginPath(); c.moveTo(px, py); c.lineTo(px + dx * 0.16, py + dy * 0.16); c.stroke();
      if (f.kind === 'snow') { c.fillStyle = '#FFFFFF'; circle(c, px + dx * 0.25, py + dy * 0.25 + 0.03, 0.012); c.fill(); }
    }
    c.restore();
  }
  // el aparato
  const { x, y } = f.at;
  c.save(); c.translate(x, y);
  shadow(c, () => circle(c, 0, 0, 0.17));
  circle(c, 0, 0, 0.17); c.fillStyle = f.kind === 'snow' ? '#8FBDE3' : '#6FB3A3'; c.fill(); ink(c, 0.02);
  c.save(); c.rotate(on ? t * 25 : 0.3);
  for (let i = 0; i < 3; i++) { c.rotate((Math.PI * 2) / 3); c.beginPath(); c.ellipse(0.075, 0, 0.07, 0.035, 0, 0, Math.PI * 2); c.fillStyle = '#FFF7EA'; c.fill(); ink(c, 0.01); }
  c.restore();
  circle(c, 0, 0, 0.03); c.fillStyle = INK; c.fill();
  // rejita
  c.strokeStyle = 'rgba(34,40,63,.5)'; c.lineWidth = 0.008;
  circle(c, 0, 0, 0.13); c.stroke();
  // foquito: verde prendido, rojo apagado
  circle(c, -dy * 0.2 + dx * -0.12, dx * 0.2 + dy * -0.12, 0.035); c.fillStyle = on ? '#6CD07A' : '#E2553F'; c.fill(); ink(c, 0.01);
  c.restore();
}

/* portal de muertos: la salida activa brilla */
function paintPortals(c, tu, active, t) {
  const outs = tu.outs || [tu.out];
  outs.forEach((o, i) => {
    const on = i === active;
    c.save(); c.translate(o.x, o.y);
    circle(c, 0, 0, 0.17); c.fillStyle = on ? '#F8DB8E' : 'rgba(34,40,63,.35)'; c.fill(); ink(c, 0.015);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + (on ? t * 1.5 : 0);
      c.fillStyle = on ? '#F4A63A' : '#8A7AA8'; circle(c, Math.cos(a) * 0.17, Math.sin(a) * 0.17, 0.035); c.fill();
    }
    circle(c, 0, 0, 0.09); c.fillStyle = on ? '#FFF7EA' : '#3A2A52'; c.fill();
    c.restore();
  });
  // la entrada da vueltas
  c.save(); c.translate(tu.in.x, tu.in.y); c.rotate(t * 2);
  c.strokeStyle = '#F8DB8E'; c.lineWidth = 0.02;
  for (let k = 0; k < 3; k++) { c.rotate((Math.PI * 2) / 3); c.beginPath(); c.arc(0, 0, 0.1, 0, 1.6); c.stroke(); }
  c.restore();
}

/* fondos por tema: lo que rodea al hoyo */
function background(c, h) {
  const id = h.id, W = h.w, H = h.h;
  if (id === 'cuadra') {
    // casitas de colores arriba y abajo, banquetas, y la calle que cruza
    const cols = ['#F2A3B6', '#8FBDE3', '#F8DB8E', '#6FB3A3', '#EE8A3A', '#A99BD6'];
    c.fillStyle = '#E6DFD2'; c.fillRect(0, 0.55, W, 0.15); c.fillRect(0, 2.1, W, 0.15);
    for (let i = 0; i < Math.ceil(W / 0.55); i++) {
      const x = i * 0.55;
      c.fillStyle = cols[i % cols.length]; c.fillRect(x, 0, 0.55, 0.55); c.strokeStyle = INK; c.lineWidth = 0.015; c.strokeRect(x, 0, 0.55, 0.55);
      c.fillStyle = '#FFF7EA'; c.fillRect(x + 0.08, 0.12, 0.14, 0.16); c.fillRect(x + 0.32, 0.12, 0.14, 0.16);
      c.fillStyle = INK; c.fillRect(x + 0.21, 0.33, 0.12, 0.22);
      c.fillStyle = cols[(i + 3) % cols.length]; c.fillRect(x, 2.25, 0.55, 0.55); c.strokeRect(x, 2.25, 0.55, 0.55);
      c.fillStyle = '#FFF7EA'; c.fillRect(x + 0.1, 2.4, 0.13, 0.14); c.fillRect(x + 0.32, 2.4, 0.13, 0.14);
    }
    papelPicado(c, 0.03, ['#E2553F', '#F8DB8E', '#6FB3A3', '#F2A3B6', '#8FBDE3'], W);
  } else if (id === 'metro') {
    // vías, y el muro del túnel de abajo
    c.fillStyle = '#2B2E40'; c.fillRect(0, 1.3, W, 0.65);
    c.strokeStyle = '#5A4A3A'; c.lineWidth = 0.05;
    for (let x = 0.05; x < W; x += 0.16) { c.beginPath(); c.moveTo(x, 1.4); c.lineTo(x, 1.85); c.stroke(); }
    c.strokeStyle = '#A9AEC2'; c.lineWidth = 0.028;
    for (const y of [1.47, 1.78]) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
    c.fillStyle = '#EE8A3A'; c.fillRect(0, 1.95, W, H - 1.95); c.fillRect(0, 0, W, 0.35);
    c.strokeStyle = 'rgba(34,40,63,.25)'; c.lineWidth = 0.008;
    for (let x = 0; x < W; x += 0.1) { c.beginPath(); c.moveTo(x, 1.95); c.lineTo(x, H); c.moveTo(x, 0); c.lineTo(x, 0.35); c.stroke(); }
    for (let y = 2.05; y < H; y += 0.1) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
    c.fillStyle = INK; c.fillRect(0, 1.93, W, 0.03);
  } else if (id === 'xochi') {
    waves(c, 2.0, 0, 6.0, H);
  } else if (id === 'glorieta') {
    // asfalto con cebras en las esquinas
    c.fillStyle = '#FFF7EA';
    for (let x = 1.0; x < W - 1.0; x += 0.18) { c.fillRect(x, 0.06, 0.09, 0.2); c.fillRect(x, H - 0.26, 0.09, 0.2); }
  } else if (id === 'piramide') {
    c.fillStyle = '#D7B47D';
    for (let i = 0; i < 60; i++) { const x = hash(i) * W, y = hash(i + 99) * H; if (y < 0.3 || y > H - 0.3 || x < 0.25 || x > W - 0.25) { circle(c, x, y, 0.02); c.fill(); } }
  } else if (id === 'mercado') {
    c.fillStyle = '#F2D2BE';
    for (let x = 0; x < W; x += 0.2) for (let y = 0; y < H; y += 0.2) if (((x / 0.2 + y / 0.2) | 0) % 2) c.fillRect(x, y, 0.2, 0.2);
    papelPicado(c, 0.03, ['#F2A3B6', '#6FB3A3', '#F8DB8E', '#A99BD6', '#EE8A3A'], W);
  } else if (id === 'lucha') {
    const cols = ['#E2553F', '#F8DB8E', '#8FBDE3', '#F2A3B6', '#6FB3A3', '#FFF7EA'];
    for (let i = 0; i < 260; i++) {
      const x = hash(i) * W, y = hash(i + 500) * H;
      if (x > 0.6 && x < W - 0.6 && y > 0.3 && y < H - 0.3) continue;
      c.fillStyle = cols[i % cols.length]; circle(c, x, y, 0.05); c.fill();
    }
    c.fillStyle = '#3B6FB6'; rr(c, 0.65, 0.35, W - 1.3, H - 0.7, 0.05); c.fill(); ink(c, 0.02);
  } else if (id === 'muertos') {
    c.fillStyle = 'rgba(255,247,234,.7)';
    for (let i = 0; i < 40; i++) { circle(c, hash(i) * W, 0.04 + hash(i + 7) * 0.28, 0.01); c.fill(); }
    papelPicado(c, 0.03, ['#F2A3B6', '#A99BD6', '#F4A63A', '#6FB3A3', '#FFF7EA'], W);
    for (let x = 0.15; x < W; x += 0.22) { c.fillStyle = '#F4A63A'; circle(c, x, H - 0.17, 0.07); c.fill(); ink(c, 0.012); c.fillStyle = '#E2553F'; circle(c, x, H - 0.17, 0.025); c.fill(); }
  } else if (id === 'zocalo') {
    // losas de la plaza y la catedral arriba
    c.strokeStyle = 'rgba(34,40,63,.12)'; c.lineWidth = 0.01;
    for (let x = 0; x < W; x += 0.4) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }
    for (let y = 0; y < H; y += 0.4) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
    c.fillStyle = '#B9A68A'; c.fillRect(2.4, 0, 3.2, 0.33); c.strokeStyle = INK; c.lineWidth = 0.015; c.strokeRect(2.4, 0, 3.2, 0.33);
    for (const x of [2.5, 5.35]) { c.fillStyle = '#A8936F'; c.fillRect(x, 0, 0.15, 0.33); c.strokeRect(x, 0, 0.15, 0.33); }
    c.fillStyle = INK; for (let x = 2.85; x < 5.2; x += 0.26) { rr(c, x, 0.12, 0.1, 0.17, [0.05, 0.05, 0, 0]); c.fill(); }
    // luces de colores
    const cols = ['#E2553F', '#F8DB8E', '#6FB3A3', '#8FBDE3', '#F2A3B6'];
    for (let x = 0.1, i = 0; x < W; x += 0.2, i++) { c.fillStyle = cols[i % 5]; circle(c, x, H - 0.05, 0.025); c.fill(); }
  }
}

function papelPicado(c, y, cols, W) {
  c.strokeStyle = INK; c.lineWidth = 0.008;
  c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke();
  for (let i = 0, x = 0.05; x < W - 0.1; x += 0.22, i++) {
    c.fillStyle = cols[i % cols.length];
    c.beginPath(); c.moveTo(x, y); c.lineTo(x + 0.18, y); c.lineTo(x + 0.18, y + 0.14); c.lineTo(x + 0.135, y + 0.18); c.lineTo(x + 0.09, y + 0.14); c.lineTo(x + 0.045, y + 0.18); c.lineTo(x, y + 0.14); c.closePath();
    c.fill(); ink(c, 0.008);
    c.fillStyle = 'rgba(255,255,255,.55)'; circle(c, x + 0.09, y + 0.07, 0.022); c.fill();
  }
}

function decorFloor(c, d, h) {
  const k = d.k;
  if (k === 'tope') {
    const g = h.green[0], y0 = g[0][1], y1 = g[2][1];
    c.fillStyle = '#F8DB8E'; c.fillRect(d.x - 0.15, y0, 0.3, y1 - y0);
    c.fillStyle = INK; for (let y = y0; y < y1; y += 0.18) c.fillRect(d.x - 0.15, y, 0.3, 0.09);
    c.strokeStyle = INK; c.lineWidth = 0.012; c.strokeRect(d.x - 0.15, y0, 0.3, y1 - y0);
  } else if (k === 'obra') {
    // zanja de obra: tierra y hoyo
    const g = h.green[0], y0 = g[0][1], y1 = g[2][1];
    c.fillStyle = '#8C6A4A'; c.fillRect(d.x0, y0, d.x1 - d.x0, y1 - y0);
    c.fillStyle = '#4A3A2E'; c.fillRect(d.x0 + 0.06, y0, d.x1 - d.x0 - 0.12, y1 - y0);
    c.fillStyle = '#2B2E40'; c.fillRect(d.x0 + 0.14, y0, d.x1 - d.x0 - 0.28, y1 - y0);
    c.strokeStyle = INK; c.lineWidth = 0.02; c.strokeRect(d.x0, y0, d.x1 - d.x0, y1 - y0);
    label(c, 'OBRA', (d.x0 + d.x1) / 2, y0 - 0.08, 0.1, '#FFF7EA');
  } else if (k === 'cross') {
    // la calle de cruce: rayas de paso de cebra en la banqueta
    c.fillStyle = '#FFF7EA';
    for (let x = d.x - 0.27; x < d.x + 0.27; x += 0.12) { c.fillRect(x, 0.58, 0.06, 0.1); c.fillRect(x, 2.12, 0.06, 0.1); }
  } else if (k === 'tunnelWall') {
    // la pared entre andenes con la boca del túnel
    c.fillStyle = '#EE8A3A'; c.fillRect(d.x0, 0.35, d.x1 - d.x0, 0.95);
    c.strokeStyle = 'rgba(34,40,63,.25)'; c.lineWidth = 0.008;
    for (let x = d.x0; x < d.x1; x += 0.1) { c.beginPath(); c.moveTo(x, 0.35); c.lineTo(x, 1.3); c.stroke(); }
    c.fillStyle = '#1A1E30'; c.beginPath(); c.moveTo(d.x0 + 0.25, 1.3); c.lineTo(d.x0 + 0.25, 0.85); c.arc((d.x0 + d.x1) / 2, 0.85, (d.x1 - d.x0) / 2 - 0.25, Math.PI, 0); c.lineTo(d.x1 - 0.25, 1.3); c.closePath(); c.fill(); ink(c, 0.02);
    c.strokeStyle = INK; c.lineWidth = 0.02; c.strokeRect(d.x0, 0.35, d.x1 - d.x0, 0.95);
  } else if (k === 'dock') {
    // muelle de madera
    const left = d.x < 4;
    const x0 = left ? d.x - 0.32 : d.x, x1 = left ? d.x : d.x + 0.32;
    c.fillStyle = '#C98F5A'; c.fillRect(x0, d.y - 0.3, x1 - x0, 0.6);
    c.strokeStyle = 'rgba(34,40,63,.4)'; c.lineWidth = 0.01;
    for (let x = x0 + 0.08; x < x1; x += 0.08) { c.beginPath(); c.moveTo(x, d.y - 0.3); c.lineTo(x, d.y + 0.3); c.stroke(); }
    c.strokeStyle = INK; c.lineWidth = 0.015; c.strokeRect(x0, d.y - 0.3, x1 - x0, 0.6);
  } else if (k === 'chinampa') {
    shadow(c, () => rr(c, d.x - 0.5, d.y - 0.22, 1.0, 0.44, 0.12));
    rr(c, d.x - 0.5, d.y - 0.22, 1.0, 0.44, 0.12); c.fillStyle = '#6CB06A'; c.fill(); ink(c, 0.02);
    for (let i = 0; i < 7; i++) flower(c, d.x - 0.36 + i * 0.12, d.y - 0.05 + (i % 2) * 0.1, 0.04, ['#F2A3B6', '#F8DB8E', '#FFF7EA', '#E2553F'][i % 4]);
  } else if (k === 'pyramid') {
    const { x, y } = d;
    // dos pisos con escalones, la escalinata del frente y la plaza de arriba
    const steps = (o, i, a, b) => {
      for (let s = 0; s < 4; s++) {
        const hs = o - ((o - i) * s) / 4;
        c.fillStyle = s % 2 ? a : b; c.fillRect(x - hs, y - hs, hs * 2, hs * 2);
        c.strokeStyle = 'rgba(34,40,63,.35)'; c.lineWidth = 0.01; c.strokeRect(x - hs, y - hs, hs * 2, hs * 2);
      }
    };
    shadow(c, () => c.rect(x - 1.35, y - 1.35, 2.7, 2.7), 0.06, 0.08);
    steps(1.35, 0.9, '#C99A62', '#D9AE74');
    c.fillStyle = '#E8C48E'; c.fillRect(x - 0.9, y - 0.9, 1.8, 1.8); c.strokeRect(x - 0.9, y - 0.9, 1.8, 1.8);
    steps(0.72, 0.46, '#BF8D55', '#CFA068');
    c.fillStyle = '#E8C48E'; c.fillRect(x - 0.46, y - 0.46, 0.92, 0.92); c.strokeStyle = INK; c.lineWidth = 0.015; c.strokeRect(x - 0.46, y - 0.46, 0.92, 0.92);
    c.strokeStyle = 'rgba(34,40,63,.3)'; c.lineWidth = 0.01;
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { c.beginPath(); c.moveTo(x + sx * 0.46, y + sy * 0.46); c.lineTo(x + sx * 1.35, y + sy * 1.35); c.stroke(); }
    // escalinata del frente
    c.fillStyle = 'rgba(255,247,234,.35)'; c.fillRect(x - 1.35, y - 0.16, 0.89, 0.32);
    c.strokeStyle = 'rgba(34,40,63,.3)';
    for (let k2 = x - 1.3; k2 < x - 0.46; k2 += 0.07) { c.beginPath(); c.moveTo(k2, y - 0.16); c.lineTo(k2, y + 0.16); c.stroke(); }
    c.strokeStyle = INK; c.lineWidth = 0.02; c.strokeRect(x - 1.35, y - 1.35, 2.7, 2.7);
  } else if (k === 'sacks') {
    for (let x = d.x0 + 0.12; x < d.x1 - 0.05; x += 0.26) {
      rr(c, x - 0.09, d.y0 + 0.08, 0.18, 0.24, 0.05); c.fillStyle = '#FFF7EA'; c.fill(); ink(c, 0.012);
      c.fillStyle = '#E2553F'; c.fillRect(x - 0.05, d.y0 + 0.17, 0.1, 0.025);
    }
  } else if (k === 'petals') {
    for (let i = 0; i < 5; i++) {
      const x = d.x0 + 0.12 + ((i * 0.37) % (d.x1 - d.x0 - 0.2)), y = d.y0 + 0.14 + ((i * 0.29) % (d.y1 - d.y0 - 0.25));
      flower(c, x, y, 0.06, '#F8DB8E');
    }
  } else if (k === 'ring') {
    c.fillStyle = 'rgba(255,255,255,.18)';
    star(c, (d.x0 + d.x1) / 2, (d.y0 + d.y1) / 2, 0.75, 0.3, 5); c.fill();
  } else if (k === 'rink') {
    // pista: el hielo se dibuja aparte; aquí la orilla
    c.fillStyle = '#5FA8C9'; c.fillRect(d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0);
  } else if (k === 'portal') {
    // arco de cempasúchil alrededor de la entrada
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      c.fillStyle = i % 2 ? '#F4A63A' : '#EE8A3A'; circle(c, d.x + Math.cos(a) * 0.22, d.y + Math.sin(a) * 0.22, 0.05); c.fill(); ink(c, 0.008);
    }
    circle(c, d.x, d.y, 0.14); c.fillStyle = '#1A1230'; c.fill(); ink(c, 0.015);
  }
}

function decorTop(c, d, h) {
  const k = d.k;
  if (k === 'vocho') {
    shadow(c, () => rr(c, d.x - 0.27, d.y - 0.14, 0.54, 0.28, 0.13));
    rr(c, d.x - 0.27, d.y - 0.14, 0.54, 0.28, 0.13); c.fillStyle = '#6FB3A3'; c.fill(); ink(c);
    rr(c, d.x - 0.12, d.y - 0.1, 0.22, 0.2, 0.07); c.fillStyle = '#4E9686'; c.fill(); ink(c, 0.012);
    c.fillStyle = '#F8DB8E'; circle(c, d.x + 0.24, d.y - 0.08, 0.025); c.fill(); circle(c, d.x + 0.24, d.y + 0.08, 0.025); c.fill();
  } else if (k === 'bote') {
    shadow(c, () => circle(c, d.x, d.y, 0.07));
    circle(c, d.x, d.y, 0.07); c.fillStyle = '#2F7F72'; c.fill(); ink(c);
    circle(c, d.x, d.y, 0.035); c.fillStyle = '#25685A'; c.fill();
  } else if (k === 'obra') {
    // conos y vallas a los lados del tablón
    const g = h.green[0], y0 = g[0][1], y1 = g[2][1];
    for (const y of [y0 + 0.12, y0 + 0.3, y1 - 0.3, y1 - 0.12]) cone(c, d.x0 - 0.08, y);
    for (const y of [y0 + 0.12, y1 - 0.12]) cone(c, d.x1 + 0.08, y);
  } else if (k === 'column') {
    shadow(c, () => circle(c, d.x, d.y, 0.08));
    circle(c, d.x, d.y, 0.08); c.fillStyle = '#EE8A3A'; c.fill(); ink(c);
    circle(c, d.x, d.y, 0.035); c.fillStyle = '#FFF7EA'; c.fill();
  } else if (k === 'sign') {
    c.save(); c.translate(d.x, d.y);
    rr(c, -0.5, -0.12, 1.0, 0.24, 0.04); c.fillStyle = '#FFF7EA'; c.fill(); ink(c, 0.015);
    label(c, d.t, 0, 0.005, 0.12, INK, false);
    c.restore();
  } else if (k === 'ahuejote') {
    shadow(c, () => circle(c, d.x, d.y, 0.18));
    circle(c, d.x, d.y, 0.18); c.fillStyle = '#4E8F4A'; c.fill(); ink(c);
    circle(c, d.x - 0.05, d.y - 0.05, 0.08); c.fillStyle = '#62A85D'; c.fill();
  } else if (k === 'flowers') {
    for (let i = 0; i < 5; i++) flower(c, d.x + (i % 3) * 0.09 - 0.09, d.y + Math.floor(i / 3) * 0.09, 0.035, ['#F2A3B6', '#F8DB8E', '#FFF7EA'][i % 3]);
  } else if (k === 'angel') {
    // el monumento: base, flores y la columna con la figura dorada
    shadow(c, () => circle(c, d.x, d.y, 0.42), 0.05, 0.06);
    circle(c, d.x, d.y, 0.42); c.fillStyle = '#EADDC6'; c.fill(); ink(c, 0.025);
    circle(c, d.x, d.y, 0.3); c.fillStyle = '#6CB06A'; c.fill(); ink(c, 0.015);
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; flower(c, d.x + Math.cos(a) * 0.24, d.y + Math.sin(a) * 0.24, 0.03, i % 2 ? '#E2553F' : '#F8DB8E'); }
    circle(c, d.x, d.y, 0.13); c.fillStyle = '#FFF7EA'; c.fill(); ink(c, 0.018);
    star(c, d.x, d.y, 0.1, 0.045, 5); c.fillStyle = '#EDB447'; c.fill(); ink(c, 0.012);
  } else if (k === 'fountain') {
    circle(c, d.x, d.y, 0.3); c.strokeStyle = INK; c.lineWidth = 0.07; c.stroke(); c.strokeStyle = '#E6DFD2'; c.lineWidth = 0.045; c.stroke();
    circle(c, d.x, d.y, 0.05); c.fillStyle = '#FFF7EA'; c.fill(); ink(c, 0.01);
  } else if (k === 'tree' || k === 'pine') {
    shadow(c, () => circle(c, d.x, d.y, 0.2));
    if (k === 'pine') {
      star(c, d.x, d.y, 0.22, 0.13, 8); c.fillStyle = '#2F7F5B'; c.fill(); ink(c, 0.015);
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; c.fillStyle = ['#E2553F', '#F8DB8E', '#8FBDE3'][i % 3]; circle(c, d.x + Math.cos(a) * 0.12, d.y + Math.sin(a) * 0.12, 0.025); c.fill(); }
      star(c, d.x, d.y, 0.06, 0.025, 5); c.fillStyle = '#EDB447'; c.fill(); ink(c, 0.008);
    } else {
      circle(c, d.x, d.y, 0.2); c.fillStyle = '#4E8F4A'; c.fill(); ink(c);
      circle(c, d.x - 0.06, d.y - 0.05, 0.08); c.fillStyle = '#62A85D'; c.fill();
    }
  } else if (k === 'serpent') {
    // cabeza de serpiente emplumada (Quetzalcóatl) a los pies de la escalinata
    shadow(c, () => circle(c, d.x, d.y, 0.12));
    circle(c, d.x, d.y, 0.12); c.fillStyle = '#9FB86A'; c.fill(); ink(c);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; c.fillStyle = i % 2 ? '#E2553F' : '#6FB3A3'; circle(c, d.x + Math.cos(a) * 0.12, d.y + Math.sin(a) * 0.12, 0.03); c.fill(); }
    c.fillStyle = INK; circle(c, d.x + 0.04, d.y - 0.03, 0.018); c.fill(); circle(c, d.x + 0.04, d.y + 0.03, 0.018); c.fill();
  } else if (k === 'nopal') {
    for (const [ox, oy, r] of [[0, 0, 0.09], [-0.08, -0.1, 0.06], [0.08, -0.1, 0.06]]) {
      c.beginPath(); c.ellipse(d.x + ox, d.y + oy, r * 0.8, r, 0, 0, Math.PI * 2); c.fillStyle = '#4E8F4A'; c.fill(); ink(c, 0.012);
    }
    c.fillStyle = '#E2553F'; circle(c, d.x + 0.08, d.y - 0.17, 0.02); c.fill();
  } else if (k === 'stall') {
    const cols = [['#E2553F', '#FFF7EA'], ['#6FB3A3', '#FFF7EA'], ['#A99BD6', '#FFF7EA']][d.c];
    shadow(c, () => c.rect(d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0));
    c.fillStyle = cols[0]; c.fillRect(d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0);
    c.fillStyle = cols[1];
    for (let y = d.y0; y < d.y1; y += 0.16) c.fillRect(d.x0, y, d.x1 - d.x0, 0.08);
    c.strokeStyle = INK; c.lineWidth = 0.02; c.strokeRect(d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0);
    const fr = ['#EE8A3A', '#E2553F', '#F8DB8E', '#6CB06A'];
    for (let i = 0, y = d.y0 + 0.12; y < d.y1 - 0.08; y += 0.22, i++) { c.fillStyle = fr[(i + d.c) % 4]; circle(c, (d.x0 + d.x1) / 2, y, 0.06); c.fill(); ink(c, 0.01); }
  } else if (k === 'referee') {
    shadow(c, () => circle(c, d.x, d.y, 0.14));
    circle(c, d.x, d.y, 0.14); c.fillStyle = '#FFF7EA'; c.fill();
    c.save(); circle(c, d.x, d.y, 0.14); c.clip(); c.fillStyle = INK;
    for (let x = d.x - 0.14; x < d.x + 0.14; x += 0.07) c.fillRect(x, d.y - 0.14, 0.035, 0.28);
    c.restore(); circle(c, d.x, d.y, 0.14); ink(c, 0.02);
    circle(c, d.x, d.y, 0.07); c.fillStyle = '#F2C79C'; c.fill(); ink(c, 0.012);
  } else if (k === 'silla') {
    // silla plegable de metal (de las que salen volando en la lucha)
    shadow(c, () => rr(c, d.x - 0.13, d.y - 0.13, 0.26, 0.26, 0.04));
    rr(c, d.x - 0.13, d.y - 0.13, 0.26, 0.26, 0.04); c.fillStyle = '#A9AEC2'; c.fill(); ink(c, 0.018);
    rr(c, d.x - 0.13, d.y - 0.13, 0.26, 0.07, 0.03); c.fillStyle = '#8A8FA6'; c.fill(); ink(c, 0.012);
    c.strokeStyle = 'rgba(34,40,63,.35)'; c.lineWidth = 0.008;
    for (let y = d.y - 0.02; y < d.y + 0.12; y += 0.04) { c.beginPath(); c.moveTo(d.x - 0.1, y); c.lineTo(d.x + 0.1, y); c.stroke(); }
  } else if (k === 'calavera') {
    shadow(c, () => circle(c, d.x, d.y, 0.1));
    circle(c, d.x, d.y, 0.1); c.fillStyle = '#FFF7EA'; c.fill(); ink(c);
    c.fillStyle = INK; circle(c, d.x - 0.035, d.y - 0.01, 0.025); c.fill(); circle(c, d.x + 0.035, d.y - 0.01, 0.025); c.fill();
    c.beginPath(); c.moveTo(d.x, d.y + 0.02); c.lineTo(d.x - 0.012, d.y + 0.042); c.lineTo(d.x + 0.012, d.y + 0.042); c.closePath(); c.fill();
    flower(c, d.x, d.y - 0.075, 0.025, '#F2A3B6');
    c.strokeStyle = INK; c.lineWidth = 0.008; for (let i = -2; i <= 2; i++) { c.beginPath(); c.moveTo(d.x + i * 0.015, d.y + 0.06); c.lineTo(d.x + i * 0.015, d.y + 0.08); c.stroke(); }
  } else if (k === 'ofrenda') {
    // la ofrenda: un muro de escalones con velas, fotos y flores
    shadow(c, () => c.rect(d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0));
    c.fillStyle = '#A99BD6'; c.fillRect(d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0);
    c.fillStyle = '#8A7AC0'; c.fillRect(d.x0 + 0.1, d.y0, d.x1 - d.x0 - 0.2, d.y1 - d.y0);
    c.strokeStyle = INK; c.lineWidth = 0.02; c.strokeRect(d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0);
    for (let y = d.y0 + 0.15, i = 0; y < d.y1 - 0.1; y += 0.3, i++) {
      if (i % 2) { rr(c, d.x0 + 0.1, y - 0.07, 0.2, 0.15, 0.02); c.fillStyle = '#FFF7EA'; c.fill(); ink(c, 0.01); }
      else { c.fillStyle = '#FFF7EA'; c.fillRect(d.x0 + 0.17, y - 0.06, 0.06, 0.12); c.fillStyle = '#F4A63A'; circle(c, d.x0 + 0.2, y - 0.08, 0.028); c.fill(); }
      flower(c, d.x0 + 0.05, y + 0.08, 0.035, '#F4A63A'); flower(c, d.x1 - 0.05, y + 0.08, 0.035, '#F4A63A');
    }
  } else if (k === 'flag') {
    shadow(c, () => circle(c, d.x, d.y, 0.16));
    circle(c, d.x, d.y, 0.16); c.fillStyle = '#A99E8C'; c.fill(); ink(c);
    circle(c, d.x, d.y, 0.045); c.fillStyle = '#EADDC6'; c.fill(); ink(c, 0.012);
    c.save(); c.translate(d.x, d.y); c.rotate(UPRIGHT);
    const fx = 0.04, fy = -0.62, fw = 0.21;
    c.strokeStyle = INK; c.lineWidth = 0.02; c.beginPath(); c.moveTo(0, 0); c.lineTo(0, fy); c.stroke();
    ['#2F8F5B', '#FFF7EA', '#E2553F'].forEach((col, i) => { c.fillStyle = col; c.fillRect(fx + i * fw, fy, fw, 0.36); });
    c.strokeStyle = INK; c.lineWidth = 0.015; c.strokeRect(fx, fy, fw * 3, 0.36);
    c.restore();
  } else if (k === 'salida') {
    // letrero verde de salida sobre el hueco
    c.save(); c.translate(d.x, 0.2);
    rr(c, -0.24, -0.08, 0.48, 0.16, 0.03); c.fillStyle = '#2F8F5B'; c.fill(); ink(c, 0.012);
    label(c, 'SALIDA', 0, 0.004, 0.085, '#FFF7EA', false);
    c.restore();
  } else if (k === 'exit') {
    // (las salidas del portal se pintan vivas)
  }
}

function cone(c, x, y) {
  shadow(c, () => circle(c, x, y, 0.06));
  circle(c, x, y, 0.06); c.fillStyle = '#EE8A3A'; c.fill(); ink(c, 0.012);
  circle(c, x, y, 0.035); c.fillStyle = '#FFF7EA'; c.fill();
  circle(c, x, y, 0.015); c.fillStyle = '#EE8A3A'; c.fill();
}

function paintMover(c, m, x, y) {
  const w = m.w, h = m.h;
  if (m.kind === 'micro') {
    // microbús verde y blanco, visto desde arriba (va y viene por el carril)
    shadow(c, () => rr(c, x - w / 2, y - h / 2, w, h, 0.08));
    rr(c, x - w / 2, y - h / 2, w, h, 0.08); c.fillStyle = '#5FAF6E'; c.fill(); ink(c, 0.02);
    c.fillStyle = '#FFF7EA'; c.fillRect(x - w / 2 + 0.18, y - h / 2 + 0.06, w - 0.36, h - 0.12);
    c.strokeStyle = INK; c.lineWidth = 0.01; c.strokeRect(x - w / 2 + 0.18, y - h / 2 + 0.06, w - 0.36, h - 0.12);
    c.fillStyle = '#C8E0F0';
    rr(c, x + w / 2 - 0.15, y - h / 2 + 0.06, 0.09, h - 0.12, 0.03); c.fill(); ink(c, 0.01);
    rr(c, x - w / 2 + 0.06, y - h / 2 + 0.06, 0.08, h - 0.12, 0.03); c.fill(); ink(c, 0.01);
    label(c, 'RUTA 2', x, y + 0.005, 0.1, '#2F7F5B', false);
  } else if (m.kind === 'diablito') {
    // diablito con cajas de fruta
    shadow(c, () => rr(c, x - w / 2, y - h / 2, w, h, 0.03));
    c.fillStyle = INK; circle(c, x - w / 2 + 0.04, y + h / 2 - 0.02, 0.035); c.fill(); circle(c, x + w / 2 - 0.04, y + h / 2 - 0.02, 0.035); c.fill();
    rr(c, x - w / 2, y - h / 2, w, h * 0.55, 0.02); c.fillStyle = '#C98F5A'; c.fill(); ink(c, 0.012);
    rr(c, x - w / 2, y - h / 2 + h * 0.5, w, h * 0.45, 0.02); c.fillStyle = '#B9824E'; c.fill(); ink(c, 0.012);
    for (let i = 0; i < 3; i++) { c.fillStyle = ['#EE8A3A', '#E2553F', '#6CB06A'][i]; circle(c, x - w / 4 + (i * w) / 4, y - h / 2 + 0.06, 0.03); c.fill(); }
  } else if (m.kind === 'luchador') {
    const col = m.c ? '#8FBDE3' : '#F2A3B6', col2 = m.c ? '#2F5FA8' : '#E2553F';
    shadow(c, () => circle(c, x, y, w / 2));
    circle(c, x, y, w / 2); c.fillStyle = col2; c.fill(); ink(c, 0.022);
    circle(c, x, y, w / 2 - 0.06); c.fillStyle = col; c.fill();
    c.fillStyle = '#FFF7EA';
    c.beginPath(); c.ellipse(x - 0.07, y - 0.02, 0.055, 0.04, -0.4, 0, Math.PI * 2); c.fill(); ink(c, 0.01);
    c.beginPath(); c.ellipse(x + 0.07, y - 0.02, 0.055, 0.04, 0.4, 0, Math.PI * 2); c.fill(); ink(c, 0.01);
    c.fillStyle = INK; circle(c, x - 0.065, y - 0.02, 0.018); c.fill(); circle(c, x + 0.065, y - 0.02, 0.018); c.fill();
    c.fillStyle = col2; c.fillRect(x - 0.02, y - w / 2 + 0.02, 0.04, 0.12);
    c.fillStyle = '#FFF7EA'; rr(c, x - 0.05, y + 0.08, 0.1, 0.04, 0.02); c.fill();
  } else if (m.kind === 'catrina') {
    shadow(c, () => circle(c, x, y, 0.16));
    // sombrero grande con flores
    circle(c, x, y, 0.16); c.fillStyle = '#A99BD6'; c.fill(); ink(c, 0.018);
    flower(c, x - 0.08, y - 0.08, 0.035, '#F2A3B6'); flower(c, x + 0.09, y - 0.06, 0.03, '#F4A63A');
    circle(c, x, y + 0.02, 0.085); c.fillStyle = '#FFF7EA'; c.fill(); ink(c, 0.012);
    c.fillStyle = INK; circle(c, x - 0.03, y + 0.01, 0.02); c.fill(); circle(c, x + 0.03, y + 0.01, 0.02); c.fill();
    c.fillStyle = '#E2553F'; circle(c, x, y + 0.06, 0.012); c.fill();
  } else if (m.kind === 'elotes') {
    shadow(c, () => rr(c, x - w / 2, y - h / 2, w, h, 0.04));
    rr(c, x - w / 2, y - h / 2, w, h, 0.04); c.fillStyle = '#F8DB8E'; c.fill(); ink(c, 0.02);
    c.fillStyle = '#E2553F'; c.fillRect(x - w / 2, y - h / 2, w, 0.06); c.strokeStyle = INK; c.lineWidth = 0.012; c.strokeRect(x - w / 2, y - h / 2, w, 0.06);
    for (let i = -1; i <= 1; i++) { c.beginPath(); c.ellipse(x + i * 0.1, y + 0.03, 0.03, 0.06, 0, 0, Math.PI * 2); c.fillStyle = '#EDB447'; c.fill(); ink(c, 0.01); }
    c.fillStyle = INK; circle(c, x - w / 2 + 0.06, y + h / 2, 0.03); c.fill(); circle(c, x + w / 2 - 0.06, y + h / 2, 0.03); c.fill();
  } else if (m.kind === 'skater') {
    shadow(c, () => circle(c, x, y, 0.1));
    circle(c, x, y, 0.1); c.fillStyle = '#E2553F'; c.fill(); ink(c, 0.016);
    circle(c, x, y, 0.06); c.fillStyle = '#F2C79C'; c.fill(); ink(c, 0.01);
    c.fillStyle = '#FFF7EA'; c.fillRect(x - 0.1, y - 0.02, 0.2, 0.035);
    c.fillStyle = '#6FB3A3'; circle(c, x, y - 0.075, 0.03); c.fill();
  }
}

/* plataformas: el vagón del metro y las trajineras */
function paintPlatform(c, pf, p) {
  const { w, h } = pf, x = p.x, y = p.y;
  if (pf.kind === 'train') {
    shadow(c, () => rr(c, x - w / 2, y - h / 2, w, h, 0.1));
    rr(c, x - w / 2, y - h / 2, w, h, 0.1); c.fillStyle = '#EE8A3A'; c.fill(); ink(c, 0.022);
    // piso del vagón
    rr(c, x - w / 2 + 0.06, y - h / 2 + 0.07, w - 0.12, h - 0.14, 0.05); c.fillStyle = '#D9D4C8'; c.fill(); ink(c, 0.012);
    c.strokeStyle = 'rgba(34,40,63,.15)'; c.lineWidth = 0.01;
    for (let k = x - w / 2 + 0.2; k < x + w / 2 - 0.1; k += 0.2) { c.beginPath(); c.moveTo(k, y - h / 2 + 0.08); c.lineTo(k, y + h / 2 - 0.08); c.stroke(); }
    // asientos al fondo
    c.fillStyle = '#5A8FC8'; for (let k = x - w / 2 + 0.25; k < x + w / 2 - 0.2; k += 0.45) { rr(c, k, y + h / 2 - 0.16, 0.3, 0.08, 0.02); c.fill(); ink(c, 0.008); }
    // puertas (del lado del andén): abiertas en la estación
    const open = p.at >= 0;
    for (let k = x - w / 2 + 0.35; k < x + w / 2 - 0.2; k += 0.6) {
      c.fillStyle = open ? '#D9D4C8' : '#C8CCDA';
      c.fillRect(k, y - h / 2 - 0.01, 0.3, 0.08); c.strokeStyle = INK; c.lineWidth = 0.01; c.strokeRect(k, y - h / 2 - 0.01, 0.3, 0.08);
      if (!open) { c.beginPath(); c.moveTo(k + 0.15, y - h / 2 - 0.01); c.lineTo(k + 0.15, y - h / 2 + 0.07); c.stroke(); }
    }
    if (!open) { c.fillStyle = INK; c.fillRect(x - w / 2 + 0.05, y - h / 2 - 0.01, w - 0.1, 0.02); }
  } else if (pf.kind === 'trajinera') {
    shadow(c, () => rr(c, x - w / 2, y - h / 2, w, h, 0.2));
    rr(c, x - w / 2, y - h / 2, w, h, 0.2); c.fillStyle = '#8C4A2F'; c.fill(); ink(c, 0.02);
    rr(c, x - w / 2 + 0.06, y - h / 2 + 0.06, w - 0.12, h - 0.12, 0.14); c.fillStyle = '#C98F5A'; c.fill(); ink(c, 0.01);
    c.strokeStyle = 'rgba(34,40,63,.3)'; c.lineWidth = 0.008;
    for (let k = y - h / 2 + 0.12; k < y + h / 2 - 0.08; k += 0.07) { c.beginPath(); c.moveTo(x - w / 2 + 0.12, k); c.lineTo(x + w / 2 - 0.12, k); c.stroke(); }
    // el arco con el nombre (en la punta que no estorba) y flores en las orillas
    const cols = ['#E2553F', '#F8DB8E', '#6FB3A3', '#F2A3B6'];
    for (let i = 0; i < 8; i++) { c.fillStyle = cols[i % 4]; circle(c, x - w / 2 + 0.15 + i * ((w - 0.3) / 7), y - h / 2 + 0.035, 0.03); c.fill(); circle(c, x - w / 2 + 0.15 + i * ((w - 0.3) / 7), y + h / 2 - 0.035, 0.03); c.fill(); }
    rr(c, x - 0.3, y - 0.09, 0.6, 0.18, 0.05); c.fillStyle = '#FFF7EA'; c.fill(); ink(c, 0.012);
    label(c, pf.name || '', x, y + 0.005, 0.1, '#E2553F', false);
  }
}

/* brazos que giran: torniquetes del metro o el tráfico de la glorieta */
function paintSpinner(c, sp, turn) {
  const a0 = turn * Math.PI * 2;
  for (let k = 0; k < sp.arms; k++) {
    const a = a0 + (k / sp.arms) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
    if (sp.kind === 'traffic') {
      // fila de cochecitos de colores
      const cols = ['#E2553F', '#F8DB8E', '#8FBDE3', '#6FB3A3', '#F2A3B6', '#FFF7EA'];
      for (let i = 0, u = sp.hub + 0.13; u < sp.L - 0.05; u += 0.24, i++) {
        c.save(); c.translate(sp.x + ca * u, sp.y + sa * u); c.rotate(a + Math.PI / 2);
        shadow(c, () => rr(c, -0.065, -0.1, 0.13, 0.2, 0.05), 0.02, 0.025);
        rr(c, -0.065, -0.1, 0.13, 0.2, 0.05); c.fillStyle = cols[(i + k * 3) % cols.length]; c.fill(); ink(c, 0.012);
        rr(c, -0.045, -0.05, 0.09, 0.07, 0.02); c.fillStyle = '#C8E0F0'; c.fill(); ink(c, 0.008);
        c.restore();
      }
    } else {
      c.save(); c.lineCap = 'round';
      c.strokeStyle = INK; c.lineWidth = sp.t * 2 + 0.022;
      c.beginPath(); c.moveTo(sp.x + ca * sp.hub, sp.y + sa * sp.hub); c.lineTo(sp.x + ca * sp.L, sp.y + sa * sp.L); c.stroke();
      c.strokeStyle = '#C8CCDA'; c.lineWidth = sp.t * 2;
      c.beginPath(); c.moveTo(sp.x + ca * sp.hub, sp.y + sa * sp.hub); c.lineTo(sp.x + ca * sp.L, sp.y + sa * sp.L); c.stroke();
      c.restore();
    }
  }
  if (sp.kind !== 'traffic') { circle(c, sp.x, sp.y, sp.hub + 0.02); c.fillStyle = '#8A8FA6'; c.fill(); ink(c, 0.014); }
}

/* la Piedra del Sol: anillo de piedra con huecos que gira */
function paintRing(c, g, turn) {
  const gaps = g.gaps.map((q) => ((turn + q.a) % 1 + 1) % 1).map((a, i) => [a - g.gaps[i].w, a + g.gaps[i].w]).sort((p, q) => p[0] - q[0]);
  // centro (piedra pintada)
  circle(c, g.x, g.y, g.r - g.t); c.fillStyle = '#D9C9A3'; c.fill();
  c.save(); c.translate(g.x, g.y); c.rotate(turn * Math.PI * 2);
  c.strokeStyle = 'rgba(34,40,63,.35)'; c.lineWidth = 0.01;
  for (let i = 0; i < 20; i++) { const a = (i / 20) * Math.PI * 2; c.beginPath(); c.moveTo(Math.cos(a) * 0.12, Math.sin(a) * 0.12); c.lineTo(Math.cos(a) * (g.r - g.t - 0.02), Math.sin(a) * (g.r - g.t - 0.02)); c.stroke(); }
  c.restore();
  for (let i = 0; i < gaps.length; i++) {
    const from = gaps[i][1], to = gaps[(i + 1) % gaps.length][0] + (i + 1 === gaps.length ? 1 : 0);
    c.lineCap = 'round';
    c.beginPath(); c.arc(g.x, g.y, g.r, from * Math.PI * 2, to * Math.PI * 2);
    c.strokeStyle = INK; c.lineWidth = g.t * 2 + 0.024; c.stroke();
    c.beginPath(); c.arc(g.x, g.y, g.r, from * Math.PI * 2, to * Math.PI * 2);
    c.strokeStyle = '#B9A68A'; c.lineWidth = g.t * 2; c.stroke();
    // marcas talladas
    c.strokeStyle = 'rgba(34,40,63,.45)'; c.lineWidth = 0.008;
    for (let a = from + 0.03; a < to - 0.02; a += 0.04) {
      const r0 = g.r - g.t * 0.6, r1 = g.r + g.t * 0.6, aa = a * Math.PI * 2;
      c.beginPath(); c.moveTo(g.x + Math.cos(aa) * r0, g.y + Math.sin(aa) * r0); c.lineTo(g.x + Math.cos(aa) * r1, g.y + Math.sin(aa) * r1); c.stroke();
    }
  }
}

function paintCup(c, h) {
  const { x, y } = h.cup;
  circle(c, x, y, CUP_R + 0.012); c.fillStyle = '#FFF7EA'; c.fill();
  circle(c, x, y, CUP_R); c.fillStyle = '#1A1E30'; c.fill(); ink(c, 0.012);
  // banderita (siempre derecha en pantalla)
  c.save(); c.translate(x, y); c.rotate(UPRIGHT);
  c.strokeStyle = INK; c.lineWidth = 0.016; c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -0.42); c.stroke();
  c.beginPath(); c.moveTo(0, -0.42); c.lineTo(0.2, -0.36); c.lineTo(0, -0.29); c.closePath();
  c.fillStyle = '#E2553F'; c.fill(); ink(c, 0.012);
  c.restore();
}

function paintBall(c, x, y, col, alpha, ring, sinkAt, z = 0) {
  c.save();
  c.globalAlpha = alpha;
  let r = R * (1 + z * 1.4);
  if (sinkAt) { const u = Math.min(1, (performance.now() - sinkAt) / 350); r = R * (1 - 0.6 * u); c.globalAlpha = alpha * (1 - u * 0.8); }
  if (ring) { circle(c, x, y, R * 1.9); c.strokeStyle = 'rgba(255,247,234,.85)'; c.lineWidth = 0.012; c.setLineDash([0.025, 0.02]); c.stroke(); c.setLineDash([]); }
  // la sombra se aleja cuando va en el aire
  circle(c, x + 0.012 + z * 0.35, y + 0.016 + z * 0.45, R * (1 - z * 0.3)); c.fillStyle = 'rgba(34,40,63,.35)'; c.fill();
  circle(c, x, y, r); c.fillStyle = col; c.fill(); ink(c, 0.014);
  circle(c, x - r * 0.35, y - r * 0.35, r * 0.3); c.fillStyle = 'rgba(255,255,255,.8)'; c.fill();
  c.restore();
}

function flower(c, x, y, r, col) {
  c.fillStyle = col;
  for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; circle(c, x + Math.cos(a) * r * 0.6, y + Math.sin(a) * r * 0.6, r * 0.5); c.fill(); }
  c.fillStyle = '#EDB447'; circle(c, x, y, r * 0.35); c.fill();
}
function star(c, x, y, R1, R2, n) {
  c.beginPath();
  for (let i = 0; i < n * 2; i++) { const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2, r = i % 2 ? R2 : R1; c.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
  c.closePath();
}

/** Dibuja un hoyo completo, con lo que se mueve en el tiempo t (para revisar los hoyos). */
export function preview(canvas, id, t = 0, wear = [], ball = null) {
  const h = HOLE_BY_ID[id], c = canvas.getContext('2d');
  const s = canvas.width / h.w;
  canvas.height = Math.round(h.h * s);
  UPRIGHT = 0;
  c.setTransform(s, 0, 0, s, 0, 0);
  paintHole(c, h);
  let i = 0;
  for (const z of h.zones || []) if (z.type === 'ice') { paintIce(c, z, wear[i] || 0, i); i++; }
  for (const f of h.fans || []) paintFan(c, f, fanOn(f, t), t);
  for (const tu of h.tunnels || []) paintPortals(c, tu, tunnelOut(tu, t), t);
  for (const pf of h.platforms || []) paintPlatform(c, pf, travel(pf, t));
  for (const m of h.movers || []) { const p = travel(m, t); paintMover(c, m, p.x, p.y); }
  for (const sp of h.spinners || []) paintSpinner(c, sp, turnAt(sp, t));
  for (const rg of h.rings || []) paintRing(c, rg, turnAt(rg, t));
  paintCup(c, h);
  const b = ball || h.tee;
  paintBall(c, b.x, b.y, SEAT_COLORS[0], 1, !ball, 0, b.z || 0);
}
