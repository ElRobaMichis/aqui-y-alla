// Minigolf mexicano: 9 hoyos con tema (la cuadra, el metro, Xochimilco, la glorieta, la pirámide,
// el mercado, lucha libre, Día de muertos y el Zócalo).
// Se apunta como resortera: tocas, jalas hacia atrás y sueltas. La física (golf-physics.js) es
// determinista: el árbitro simula el golpe y los dos teléfonos animan exactamente el mismo.

import { simulate, moverAt, R, CUP_R, FRAME_DT } from './golf-physics.js';
import { W, H, HOLE_BY_ID } from './golf-courses.js';
import { prepare, isOver, holeOf, totalOf, parOf, MAX_STROKES, PHASE_SPAN } from './golf-rules.js';

const INK = '#22283F';
const CREAM = '#FFF7EA';
const GRASS = '#6CB06A', GRASS_2 = '#62A660';
const SEAT_COLORS = ['#FFF7EA', '#F2A3B6'];

/** fase de los obstáculos que se mueven: la misma en los dos teléfonos (reloj del sistema) */
const phaseNow = () => (Date.now() / 1000) % PHASE_SPAN;

export function mount(root, ctx) {
  let g = null;
  let anim = null;              // { sim, seat, t0, ph, evIdx, done }
  let pendingShot = null;
  let limbo = null;             // dónde quedó mi pelota mientras el árbitro confirma
  let queued = null;
  let aim = null;               // { dx, dy, p } mientras jalo
  let drag = null;
  let remoteAim = null, shownAim = null;
  let lastAimSent = 0, aimTimer = null;
  let view = null;
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
        <div class="golf-course surface"><canvas aria-label="Hoyo de minigolf"></canvas><div class="golf-banner" hidden></div></div>
      </div>
      <p class="golf-tip"></p>
      <div class="golf-card" hidden></div>
      <div class="result" hidden></div>
    </div>`;
  const $ = (s) => root.querySelector(s);
  const canvas = $('canvas');
  const c2d = canvas.getContext('2d');
  const layer = document.createElement('canvas');
  const overLayer = document.createElement('canvas'); // lo que va encima de los obstáculos que se mueven (el puente)
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

  const mySeat = () => (g ? g.seats.indexOf(ctx.you) : -1);
  const round = () => g?.round;
  const hole = () => (g ? holeOf(g.round) : null);
  const myTurn = () => g && !anim && !pendingShot && !isOver(g.round) && g.round.turn === mySeat();

  /* ───────────── tamaño y orientación ───────────── */

  function layout() {
    const main = $('.golf-main');
    const stage = root.closest('.stage');
    const vvH = window.visualViewport?.height || window.innerHeight;
    const tabs = document.querySelector('.tabs');
    const tabsH = tabs && getComputedStyle(tabs).display !== 'none' ? tabs.offsetHeight : 0;
    const top = main.getBoundingClientRect().top + (stage?.scrollTop || 0) - (window.visualViewport?.offsetTop || 0);
    const availH = Math.max(200, vvH - top - tabsH - 40);
    const availW = main.clientWidth - 6; // (menos el relleno para la sombra)
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    // horizontal o girado 90° (celular parado): gana el que deja el hoyo más grande
    const sH = Math.min(availW / W, availH / H), sV = Math.min(availW / H, availH / W);
    const vertical = sV > sH * 1.05;
    const s = Math.max(50, vertical ? sV : sH);
    const cw = Math.round((vertical ? H : W) * s), ch = Math.round((vertical ? W : H) * s);
    canvas.style.width = cw + 'px'; canvas.style.height = ch + 'px';
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
    layer.width = overLayer.width = canvas.width; layer.height = overLayer.height = canvas.height;
    view = { s, dpr, vertical, cw, ch };
    layerHole = null;
    draw();
  }
  let lastW = 0;
  const ro = new ResizeObserver(() => { const w = root.clientWidth; if (w !== lastW) { lastW = w; layout(); } });
  ro.observe(root);
  const onVV = () => layout();
  window.visualViewport?.addEventListener('resize', onVV);
  window.addEventListener('orientationchange', onVV);

  // hoyo (m) → pantalla (px CSS) y al revés
  const setT = (c) => {
    const { s, dpr, vertical } = view;
    if (vertical) c.setTransform(0, -s * dpr, s * dpr, 0, 0, W * s * dpr);
    else c.setTransform(s * dpr, 0, 0, s * dpr, 0, 0);
  };
  function toCourse(X, Y) {
    const { s, vertical } = view;
    return vertical ? [W - Y / s, X / s] : [X / s, Y / s];
  }
  const toScreenDir = (dx, dy) => (view.vertical ? [dy, -dx] : [dx, dy]);

  /* ───────────── dibujo ───────────── */

  function paintLayer(h) {
    UPRIGHT = view.vertical ? Math.PI / 2 : 0;
    const c = layer.getContext('2d');
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, layer.width, layer.height);
    setT(c);
    paintHole(c, h, view.s);
    const o = overLayer.getContext('2d');
    o.setTransform(1, 0, 0, 1, 0, 0);
    o.clearRect(0, 0, overLayer.width, overLayer.height);
    if (h.over) { setT(o); for (const p of h.over) paintBridge(o, p); }
    layerHole = h.id;
  }

  function draw() {
    if (!view || !g) return;
    const h = hole();
    if (layerHole !== h.id) paintLayer(h);
    UPRIGHT = view.vertical ? Math.PI / 2 : 0;
    c2d.setTransform(1, 0, 0, 1, 0, 0);
    c2d.clearRect(0, 0, canvas.width, canvas.height);
    c2d.drawImage(layer, 0, 0);
    setT(c2d);
    const t = anim ? anim.ph + (performance.now() - anim.t0) / 1000 : phaseNow();
    // obstáculos que se mueven
    for (const m of h.movers || []) {
      const p = moverAt(m, t);
      // (las trajineras solo se ven dentro del canal: salen de cuadro bajo las orillas)
      if (m.clip) { c2d.save(); poly(c2d, m.clip); c2d.clip(); }
      paintMover(c2d, m, p.x, p.y, view.s);
      if (m.clip) c2d.restore();
    }
    if (h.over) { c2d.setTransform(1, 0, 0, 1, 0, 0); c2d.drawImage(overLayer, 0, 0); setT(c2d); }
    paintCup(c2d, h);
    // pelotas
    const r = g.round, me = mySeat();
    for (const seat of [1 - me, me]) {
      let b = r.balls[seat];
      if (anim && anim.seat === seat) continue;
      if (pendingShot && seat === me && limbo) b = limbo;
      if (b.in) continue;
      const turnSeat = !isOver(r) && r.turn === seat;
      paintBall(c2d, b.x, b.y, SEAT_COLORS[seat], turnSeat || anim ? 1 : 0.55, turnSeat && !anim);
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
      if (a.vis) paintBall(c2d, a.x, a.y, SEAT_COLORS[a.seat], 1, false, a.sink);
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
    // punta de flecha
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
    if (anim) stepAnim(now);
    if (remoteAim && shownAim) {
      const k = 0.25;
      shownAim.dx += (remoteAim.dx - shownAim.dx) * k; shownAim.dy += (remoteAim.dy - shownAim.dy) * k;
      const l = Math.hypot(shownAim.dx, shownAim.dy) || 1; shownAim.dx /= l; shownAim.dy /= l;
      shownAim.p += (remoteAim.p - shownAim.p) * k;
    }
    draw();
    // con obstáculos que se mueven (o animando) se dibuja siempre; si no, solo cuando cambia algo
    if (anim || (hole()?.movers?.length) || shownAim) kick();
  }
  function kick() { if (!raf && !destroyed) raf = requestAnimationFrame(frame); }

  /* ───────────── animación del golpe ───────────── */

  function startAnim(seat, prep, done) {
    const sim = simulate(prep.hole, prep.ball, prep.shot, prep.ph);
    trail.length = 0;
    anim = { sim, seat, ph: prep.ph, t0: performance.now(), evIdx: 0, done, x: prep.ball.x, y: prep.ball.y, vis: true, sink: 0 };
    ctx.sfx.cue(prep.shot.power * 0.8);
    updateUI();
    kick();
  }
  function stepAnim(now) {
    const a = anim;
    const t = (now - a.t0) / 1000;
    const { frames, n, events } = a.sim;
    const fi = Math.min(n - 1, t / FRAME_DT);
    const f0 = Math.floor(fi), f1 = Math.min(n - 1, f0 + 1), k = fi - f0;
    a.x = frames[f0 * 3] + (frames[f1 * 3] - frames[f0 * 3]) * k;
    a.y = frames[f0 * 3 + 1] + (frames[f1 * 3 + 1] - frames[f0 * 3 + 1]) * k;
    a.vis = frames[f0 * 3 + 2] > 0 && frames[f1 * 3 + 2] > 0;
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
      else if (e.type === 'cup') { ctx.sfx.pocket(); a.sink = performance.now(); }
      else if (e.type === 'water') ctx.sfx.poof();
      else if (e.type === 'tunnel') ctx.sfx.send();
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
    ctx.sfx.tap();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    const l = Math.hypot(dx, dy);
    if (l < 8) { aim = null; draw(); sendAim(); return; }
    // se jala hacia atrás: la pelota sale para el otro lado
    const [cx0, cy0] = toCourse(0, 0), [cx1, cy1] = toCourse(-dx / l, -dy / l);
    let ux = cx1 - cx0, uy = cy1 - cy0; const ul = Math.hypot(ux, uy); ux /= ul; uy /= ul;
    aim = { dx: ux, dy: uy, p: Math.min(1, l / MAX_PULL()) };
    draw(); sendAim();
  });
  const endDrag = (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    drag = null;
    if (aim && aim.p > 0.04 && myTurn()) shoot();
    else { aim = null; draw(); sendAim(); }
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', (e) => { if (drag?.id === e.pointerId) { drag = null; aim = null; draw(); sendAim(); } });

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
    if (!prep.ok) { ctx.sfx.error(); ctx.toast('Ese golpe no se puede'); draw(); return; }
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
    } else if (L.penalty) ctx.toast(`${who}${mine ? '' : ''}: ¡al agua! +1 de castigo`, 2400);
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

// con el celular parado el hoyo se dibuja girado 90°; las banderas (y el banderín del hoyo)
// se giran de regreso para que sigan derechas (la de México acostada parece otra bandera)
let UPRIGHT = 0;

const THEMES = {
  cuadra: { bg: '#B9B3A6', wall: '#D8CFC0' },
  metro: { bg: '#3C4058', wall: '#EE8A3A' },
  xochi: { bg: '#5FA8C9', wall: '#8C4A2F' },
  glorieta: { bg: '#8F8B94', wall: '#E6DFD2' },
  piramide: { bg: '#E3C38E', wall: '#B9824E' },
  mercado: { bg: '#E7B9A0', wall: '#D9673F' },
  lucha: { bg: '#2C2D45', wall: '#E2553F' },
  muertos: { bg: '#4A3566', wall: '#EE8A3A' },
  zocalo: { bg: '#CFC6B8', wall: '#A99E8C' },
};

/* texto en metros: se dibuja a tamaño normal y se escala (Safari maneja mal fuentes de 0.1 px) */
function label(c, str, x, y, size, color = INK) {
  c.save(); c.translate(x, y); c.scale(size / 100, size / 100);
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

function paintHole(c, h, s) {
  const th = THEMES[h.id];
  c.fillStyle = th.bg; c.fillRect(0, 0, W, H);
  background(c, h);
  // agua del canal (debajo de todo lo demás en Xochimilco)
  for (const z of h.zones || []) if (z.type === 'water') { c.fillStyle = '#5FA8C9'; poly(c, z.poly); c.fill(); }
  // pasto con franjas de podadora
  c.save();
  for (const p of h.green) { shadow(c, () => poly(c, p), 0.05, 0.06); }
  c.beginPath(); for (const p of h.green) { c.moveTo(p[0][0], p[0][1]); for (let i = 1; i < p.length; i++) c.lineTo(p[i][0], p[i][1]); c.closePath(); }
  c.clip();
  c.fillStyle = GRASS; c.fillRect(0, 0, W, H);
  c.fillStyle = GRASS_2; for (let x = 0; x < W; x += 0.4) c.fillRect(x, 0, 0.2, H);
  // superficies
  for (const z of h.zones || []) zone(c, z);
  c.restore();
  for (const p of h.green) { poly(c, p); ink(c, 0.025); }
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
      c.strokeStyle = THEMES[h.id].wall; c.lineWidth = 0.045; c.stroke();
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

function zone(c, z) {
  if (z.type === 'sand' || z.type === 'petals') {
    c.fillStyle = z.type === 'sand' ? '#F1E6CC' : '#F4A63A';
    poly(c, z.poly); c.fill();
    const xs = z.poly.map((p) => p[0]), ys = z.poly.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    c.fillStyle = z.type === 'sand' ? '#D9C9A3' : '#E2553F';
    let k = 0;
    for (let y = y0 + 0.05; y < y1; y += 0.08) for (let x = x0 + 0.05 + ((k++ % 2) * 0.04); x < x1; x += 0.08) { circle(c, x, y, z.type === 'sand' ? 0.009 : 0.016); c.fill(); }
  } else if (z.type === 'slope') {
    const xs = z.poly.map((p) => p[0]), ys = z.poly.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const big = x1 - x0 > 3 && y1 - y0 > 1.5; // la plaza inclinada: apenas se nota
    c.save(); poly(c, z.poly); c.clip();
    c.fillStyle = big ? 'rgba(0,0,0,0)' : 'rgba(34,40,63,.10)'; c.fill();
    // chevrones que apuntan hacia donde rueda
    const l = Math.hypot(z.ax, z.ay) || 1, ux = z.ax / l, uy = z.ay / l, nx = -uy, ny = ux;
    c.strokeStyle = big ? 'rgba(255,255,255,.12)' : 'rgba(255,255,255,.35)'; c.lineWidth = 0.018; c.lineCap = 'round';
    const step = big ? 0.5 : 0.16;
    for (let x = x0 + step / 2; x < x1; x += step) for (let y = y0 + step / 2; y < y1; y += step) {
      const a = 0.035;
      c.beginPath();
      c.moveTo(x - ux * a + nx * a, y - uy * a + ny * a); c.lineTo(x + ux * a, y + uy * a); c.lineTo(x - ux * a - nx * a, y - uy * a - ny * a);
      c.stroke();
    }
    c.restore();
  } else if (z.type === 'water') {
    c.save(); poly(c, z.poly); c.clip();
    c.strokeStyle = 'rgba(255,255,255,.45)'; c.lineWidth = 0.018; c.lineCap = 'round';
    for (let y = 0.45; y < H; y += 0.22) for (let x = 0.1; x < W; x += 0.5) {
      c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + 0.06, y - 0.04, x + 0.12, y); c.quadraticCurveTo(x + 0.18, y + 0.04, x + 0.24, y); c.stroke();
    }
    c.restore();
  }
}

/* fondos por tema: lo que rodea al hoyo */
function background(c, h) {
  const id = h.id;
  if (id === 'cuadra') {
    // casitas de colores arriba y abajo, banqueta
    const cols = ['#F2A3B6', '#8FBDE3', '#F8DB8E', '#6FB3A3', '#EE8A3A', '#A99BD6'];
    c.fillStyle = '#E6DFD2'; c.fillRect(0, 0.62, W, 0.23); c.fillRect(0, 1.75, W, 0.25);
    for (let i = 0; i < 9; i++) {
      const x = i * 0.5;
      c.fillStyle = cols[i % cols.length]; c.fillRect(x, 0, 0.5, 0.62); c.strokeStyle = INK; c.lineWidth = 0.015; c.strokeRect(x, 0, 0.5, 0.62);
      c.fillStyle = '#FFF7EA'; c.fillRect(x + 0.08, 0.16, 0.13, 0.16); c.fillRect(x + 0.29, 0.16, 0.13, 0.16);
      c.fillStyle = INK; c.fillRect(x + 0.19, 0.4, 0.12, 0.22);
      c.fillStyle = cols[(i + 3) % cols.length]; c.fillRect(x, 2.0, 0.5, 0.6); c.strokeRect(x, 2.0, 0.5, 0.6);
      c.fillStyle = '#FFF7EA'; c.fillRect(x + 0.1, 2.18, 0.12, 0.14); c.fillRect(x + 0.28, 2.18, 0.12, 0.14);
    }
    papelPicado(c, 0.03, ['#E2553F', '#F8DB8E', '#6FB3A3', '#F2A3B6', '#8FBDE3']);
  } else if (id === 'metro') {
    // vías entre andenes; azulejo naranja en las orillas
    c.fillStyle = '#2B2E40'; c.fillRect(0, 1.0, W, 0.6);
    c.strokeStyle = '#8A8FA6'; c.lineWidth = 0.025;
    for (const y of [1.18, 1.42]) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
    c.strokeStyle = '#5A4A3A'; c.lineWidth = 0.04;
    for (let x = 0.05; x < W; x += 0.16) { c.beginPath(); c.moveTo(x, 1.12); c.lineTo(x, 1.48); c.stroke(); }
    c.fillStyle = '#EE8A3A'; c.fillRect(0, 0, W, 0.35); c.fillRect(0, 2.25, W, 0.35);
    c.strokeStyle = 'rgba(34,40,63,.25)'; c.lineWidth = 0.008;
    for (let x = 0; x < W; x += 0.1) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, 0.35); c.moveTo(x, 2.25); c.lineTo(x, 2.6); c.stroke(); }
    // letrero genérico de estación
    rr(c, 1.7, 0.06, 1.0, 0.22, 0.04); c.fillStyle = '#FFF7EA'; c.fill(); ink(c, 0.015);
    label(c, 'CORRESPONDENCIA', 2.2, 0.178, 0.12);
  } else if (id === 'xochi') {
    // todo es agua alrededor; flores en las orillas
    c.fillStyle = '#5FA8C9'; c.fillRect(0, 0, W, H);
  } else if (id === 'glorieta') {
    // asfalto con cebras
    c.fillStyle = '#FFF7EA';
    for (let x = 0.75; x < 3.7; x += 0.18) { c.fillRect(x, 0.08, 0.09, 0.2); c.fillRect(x, 2.32, 0.09, 0.2); }
  } else if (id === 'piramide') {
    c.fillStyle = '#D7B47D';
    for (let i = 0; i < 40; i++) { const x = (i * 0.731) % W, y = (i * 0.413) % H; if (y < 0.3 || y > 2.3 || x < 0.25 || x > 4.15) { circle(c, x, y, 0.02); c.fill(); } }
  } else if (id === 'mercado') {
    // piso de mosaico
    c.fillStyle = '#F2D2BE';
    for (let x = 0; x < W; x += 0.2) for (let y = 0; y < H; y += 0.2) if (((x / 0.2 + y / 0.2) | 0) % 2) c.fillRect(x, y, 0.2, 0.2);
    papelPicado(c, 0.03, ['#F2A3B6', '#6FB3A3', '#F8DB8E', '#A99BD6', '#EE8A3A']);
  } else if (id === 'lucha') {
    // público: puntitos de colores
    const cols = ['#E2553F', '#F8DB8E', '#8FBDE3', '#F2A3B6', '#6FB3A3', '#FFF7EA'];
    for (let i = 0; i < 160; i++) {
      const x = (i * 0.317) % W, y = (i * 0.173) % H;
      if (x > 1.0 && x < 3.8 && y > 0.25 && y < 2.35) continue;
      c.fillStyle = cols[i % cols.length]; circle(c, x, y, 0.045); c.fill();
    }
    // lona azul alrededor del ring
    c.fillStyle = '#3B6FB6'; rr(c, 1.0, 0.27, 2.8, 2.06, 0.05); c.fill(); ink(c, 0.02);
  } else if (id === 'muertos') {
    c.fillStyle = 'rgba(255,247,234,.7)';
    for (let i = 0; i < 26; i++) { const x = (i * 0.613) % W, y = (i * 0.29) % 0.3; circle(c, x, y + 0.02, 0.01); c.fill(); }
    papelPicado(c, 0.03, ['#F2A3B6', '#A99BD6', '#F4A63A', '#6FB3A3', '#FFF7EA']);
    // cempasúchil en la orilla de abajo
    for (let x = 0.15; x < W; x += 0.22) { c.fillStyle = '#F4A63A'; circle(c, x, 2.45, 0.07); c.fill(); ink(c, 0.012); c.fillStyle = '#E2553F'; circle(c, x, 2.45, 0.025); c.fill(); }
  } else if (id === 'zocalo') {
    // catedral arriba, en la orilla
    c.fillStyle = '#B9A68A'; c.fillRect(1.1, 0, 2.2, 0.33); c.strokeStyle = INK; c.lineWidth = 0.015; c.strokeRect(1.1, 0, 2.2, 0.33);
    for (const x of [1.25, 3.0]) { c.fillStyle = '#A8936F'; c.fillRect(x, 0, 0.15, 0.33); c.strokeRect(x, 0, 0.15, 0.33); }
    c.fillStyle = INK; for (let x = 1.5; x < 2.95; x += 0.24) { rr(c, x, 0.12, 0.1, 0.17, [0.05, 0.05, 0, 0]); c.fill(); }
  }
}

function papelPicado(c, y, cols) {
  c.strokeStyle = INK; c.lineWidth = 0.008;
  c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke();
  for (let i = 0, x = 0.05; x < W - 0.1; x += 0.22, i++) {
    c.fillStyle = cols[i % cols.length];
    c.beginPath(); c.moveTo(x, y); c.lineTo(x + 0.18, y); c.lineTo(x + 0.18, y + 0.14); c.lineTo(x + 0.135, y + 0.18); c.lineTo(x + 0.09, y + 0.14); c.lineTo(x + 0.045, y + 0.18); c.lineTo(x, y + 0.14); c.closePath();
    c.fill(); ink(c, 0.008);
    c.fillStyle = 'rgba(255,255,255,.55)'; circle(c, x + 0.09, y + 0.07, 0.022); c.fill();
  }
}

function decorFloor(c, d) {
  if (d.k === 'tope') {
    c.fillStyle = '#F8DB8E'; c.fillRect(d.x - 0.15, 0.85, 0.3, 0.9);
    c.fillStyle = INK; for (let y = 0.85; y < 1.75; y += 0.18) c.fillRect(d.x - 0.15, y, 0.3, 0.09);
    c.strokeStyle = INK; c.lineWidth = 0.012; c.strokeRect(d.x - 0.15, 0.85, 0.3, 0.9);
  } else if (d.k === 'stairs' || d.k === 'stairsOut') {
    rr(c, d.x - 0.17, d.y - 0.17, 0.34, 0.34, 0.04); c.fillStyle = '#2B2E40'; c.fill(); ink(c, 0.015);
    c.strokeStyle = '#8A8FA6'; c.lineWidth = 0.02;
    for (let k = -0.12; k <= 0.12; k += 0.06) { c.beginPath(); c.moveTo(d.x - 0.12, d.y + k); c.lineTo(d.x + 0.12, d.y + k); c.stroke(); }
    label(c, d.k === 'stairs' ? 'BAJA' : 'SALE', d.x, d.y - 0.23, 0.08, '#FFF7EA');
  } else if (d.k === 'pyramid') {
    const { x, y } = d;
    // escalones: cuadros concéntricos
    for (let k = 0; k < 5; k++) {
      const hs = 0.8 - k * 0.145;
      c.fillStyle = k % 2 ? '#C99A62' : '#D9AE74';
      c.fillRect(x - hs, y - hs, hs * 2, hs * 2);
      c.strokeStyle = 'rgba(34,40,63,.45)'; c.lineWidth = 0.012; c.strokeRect(x - hs, y - hs, hs * 2, hs * 2);
    }
    c.fillStyle = '#E8C48E'; c.fillRect(x - 0.22, y - 0.22, 0.44, 0.44); c.strokeRect(x - 0.22, y - 0.22, 0.44, 0.44);
    c.strokeStyle = 'rgba(34,40,63,.35)';
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { c.beginPath(); c.moveTo(x + sx * 0.22, y + sy * 0.22); c.lineTo(x + sx * 0.8, y + sy * 0.8); c.stroke(); }
  } else if (d.k === 'sacks') {
    for (let x = d.x0 + 0.12; x < d.x1 - 0.05; x += 0.26) {
      rr(c, x - 0.09, d.y0 + 0.04, 0.18, 0.13, 0.05); c.fillStyle = '#FFF7EA'; c.fill(); ink(c, 0.012);
      c.fillStyle = '#E2553F'; c.fillRect(x - 0.05, d.y0 + 0.09, 0.1, 0.025);
    }
  } else if (d.k === 'petals') {
    // ya se pintan como superficie; aquí unas flores grandes
    for (let i = 0; i < 4; i++) {
      const x = d.x0 + 0.12 + ((i * 0.37) % (d.x1 - d.x0 - 0.2)), y = d.y0 + 0.14 + ((i * 0.29) % (d.y1 - d.y0 - 0.25));
      flower(c, x, y, 0.06, '#F8DB8E');
    }
  } else if (d.k === 'ring') {
    // la lona del ring con su estrella al centro
    c.fillStyle = 'rgba(255,255,255,.18)';
    star(c, 2.4, 1.3, 0.55, 0.22, 5); c.fill();
  }
}

function decorTop(c, d) {
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
  } else if (k === 'column') {
    shadow(c, () => circle(c, d.x, d.y, 0.07));
    circle(c, d.x, d.y, 0.07); c.fillStyle = '#EE8A3A'; c.fill(); ink(c);
    circle(c, d.x, d.y, 0.03); c.fillStyle = '#FFF7EA'; c.fill();
  } else if (k === 'turnstile') {
    for (const y of [0.5, 0.85]) {
      circle(c, d.x, y, 0.05); c.fillStyle = '#C8CCDA'; c.fill(); ink(c, 0.015);
      c.strokeStyle = INK; c.lineWidth = 0.02; c.beginPath(); c.moveTo(d.x, y); c.lineTo(d.x + 0.09, y + (y < 0.6 ? 0.06 : -0.06)); c.stroke();
    }
  } else if (k === 'ahuejote') {
    shadow(c, () => circle(c, d.x, d.y, 0.16));
    circle(c, d.x, d.y, 0.16); c.fillStyle = '#4E8F4A'; c.fill(); ink(c);
    circle(c, d.x - 0.04, d.y - 0.04, 0.07); c.fillStyle = '#62A85D'; c.fill();
  } else if (k === 'flowers') {
    for (let i = 0; i < 5; i++) flower(c, d.x + (i % 3) * 0.09 - 0.09, d.y + Math.floor(i / 3) * 0.09, 0.035, ['#F2A3B6', '#F8DB8E', '#FFF7EA'][i % 3]);
  } else if (k === 'angel') {
    // el monumento de la glorieta: base, columna y figura dorada
    shadow(c, () => circle(c, d.x, d.y, 0.42), 0.05, 0.06);
    circle(c, d.x, d.y, 0.42); c.fillStyle = '#EADDC6'; c.fill(); ink(c, 0.025);
    circle(c, d.x, d.y, 0.3); c.fillStyle = '#6CB06A'; c.fill(); ink(c, 0.015);
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; flower(c, d.x + Math.cos(a) * 0.24, d.y + Math.sin(a) * 0.24, 0.03, i % 2 ? '#E2553F' : '#F8DB8E'); }
    circle(c, d.x, d.y, 0.13); c.fillStyle = '#FFF7EA'; c.fill(); ink(c, 0.018);
    star(c, d.x, d.y, 0.1, 0.045, 5); c.fillStyle = '#EDB447'; c.fill(); ink(c, 0.012);
  } else if (k === 'planter') {
    shadow(c, () => circle(c, d.x, d.y, 0.1));
    circle(c, d.x, d.y, 0.1); c.fillStyle = '#B9824E'; c.fill(); ink(c);
    flower(c, d.x, d.y, 0.05, '#F2A3B6');
  } else if (k === 'nopal') {
    for (const [ox, oy, r] of [[0, 0, 0.09], [-0.08, -0.1, 0.06], [0.08, -0.1, 0.06]]) {
      c.beginPath(); c.ellipse(d.x + ox, d.y + oy, r * 0.8, r, 0, 0, Math.PI * 2); c.fillStyle = '#4E8F4A'; c.fill(); ink(c, 0.012);
    }
    c.fillStyle = '#E2553F'; circle(c, d.x + 0.08, d.y - 0.17, 0.02); c.fill();
  } else if (k === 'stall') {
    const cols = [['#E2553F', '#FFF7EA'], ['#6FB3A3', '#FFF7EA']][d.c];
    shadow(c, () => c.rect(d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0));
    c.fillStyle = cols[0]; c.fillRect(d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0);
    c.fillStyle = cols[1];
    for (let y = d.y0; y < d.y1; y += 0.16) c.fillRect(d.x0, y, d.x1 - d.x0, 0.08);
    c.strokeStyle = INK; c.lineWidth = 0.02; c.strokeRect(d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0);
    // frutitas en el puesto
    const fr = ['#EE8A3A', '#E2553F', '#F8DB8E', '#6CB06A'];
    for (let i = 0, y = d.y0 + 0.12; y < d.y1 - 0.08; y += 0.22, i++) { c.fillStyle = fr[i % 4]; circle(c, (d.x0 + d.x1) / 2, y, 0.05); c.fill(); ink(c, 0.01); }
  } else if (k === 'luchador') {
    shadow(c, () => circle(c, d.x, d.y, 0.22));
    circle(c, d.x, d.y, 0.22); c.fillStyle = '#E2553F'; c.fill(); ink(c, 0.022);
    // máscara: ojos con antifaz y franja
    c.fillStyle = '#FFF7EA';
    c.beginPath(); c.ellipse(d.x - 0.075, d.y - 0.03, 0.055, 0.04, -0.4, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.ellipse(d.x + 0.075, d.y - 0.03, 0.055, 0.04, 0.4, 0, Math.PI * 2); c.fill();
    c.fillStyle = INK; circle(c, d.x - 0.07, d.y - 0.03, 0.018); c.fill(); circle(c, d.x + 0.07, d.y - 0.03, 0.018); c.fill();
    c.fillStyle = '#F8DB8E'; c.fillRect(d.x - 0.02, d.y - 0.21, 0.04, 0.12);
    c.fillStyle = '#FFF7EA'; rr(c, d.x - 0.05, d.y + 0.07, 0.1, 0.05, 0.02); c.fill();
  } else if (k === 'calavera') {
    shadow(c, () => circle(c, d.x, d.y, 0.1));
    circle(c, d.x, d.y, 0.1); c.fillStyle = '#FFF7EA'; c.fill(); ink(c);
    c.fillStyle = INK; circle(c, d.x - 0.035, d.y - 0.01, 0.025); c.fill(); circle(c, d.x + 0.035, d.y - 0.01, 0.025); c.fill();
    c.beginPath(); c.moveTo(d.x, d.y + 0.02); c.lineTo(d.x - 0.012, d.y + 0.042); c.lineTo(d.x + 0.012, d.y + 0.042); c.closePath(); c.fill();
    flower(c, d.x, d.y - 0.075, 0.025, '#F2A3B6');
    c.strokeStyle = INK; c.lineWidth = 0.008; for (let i = -2; i <= 2; i++) { c.beginPath(); c.moveTo(d.x + i * 0.015, d.y + 0.06); c.lineTo(d.x + i * 0.015, d.y + 0.08); c.stroke(); }
  } else if (k === 'ofrenda') {
    c.fillStyle = '#A99BD6'; c.fillRect(d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0);
    c.strokeStyle = INK; c.lineWidth = 0.02; c.strokeRect(d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0);
    for (let x = d.x0 + 0.1; x < d.x1; x += 0.16) { c.fillStyle = '#FFF7EA'; c.fillRect(x, d.y0 + 0.05, 0.04, 0.14); c.fillStyle = '#F4A63A'; circle(c, x + 0.02, d.y0 + 0.04, 0.022); c.fill(); }
    flower(c, d.x0 + 0.05, d.y1 - 0.06, 0.04, '#F4A63A'); flower(c, d.x1 - 0.06, d.y1 - 0.06, 0.04, '#F4A63A');
  } else if (k === 'flag') {
    // asta con base cuadrada y una bandera tricolor ondeando (sin escudo)
    shadow(c, () => circle(c, d.x, d.y, 0.16));
    circle(c, d.x, d.y, 0.16); c.fillStyle = '#A99E8C'; c.fill(); ink(c);
    circle(c, d.x, d.y, 0.045); c.fillStyle = '#EADDC6'; c.fill(); ink(c, 0.012);
    c.save(); c.translate(d.x, d.y); c.rotate(UPRIGHT);
    const fx = 0.04, fy = -0.62, fw = 0.21;
    c.strokeStyle = INK; c.lineWidth = 0.02; c.beginPath(); c.moveTo(0, 0); c.lineTo(0, fy); c.stroke();
    ['#2F8F5B', '#FFF7EA', '#E2553F'].forEach((col, i) => { c.fillStyle = col; c.fillRect(fx + i * fw, fy, fw, 0.36); });
    c.strokeStyle = INK; c.lineWidth = 0.015; c.strokeRect(fx, fy, fw * 3, 0.36);
    c.restore();
  } else if (k === 'kiosk') {
    shadow(c, () => circle(c, d.x, d.y, 0.17));
    circle(c, d.x, d.y, 0.17); c.fillStyle = '#F2A3B6'; c.fill(); ink(c);
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; c.strokeStyle = INK; c.lineWidth = 0.01; c.beginPath(); c.moveTo(d.x, d.y); c.lineTo(d.x + Math.cos(a) * 0.17, d.y + Math.sin(a) * 0.17); c.stroke(); }
  }
}

function paintMover(c, m, x, y) {
  const w = m.w, h = m.h;
  if (m.kind === 'train') {
    c.save();
    shadow(c, () => rr(c, x - w / 2, y - h / 2, w, h, 0.12));
    rr(c, x - w / 2, y - h / 2, w, h, 0.12); c.fillStyle = '#EE8A3A'; c.fill(); ink(c, 0.02);
    c.fillStyle = '#FFF7EA'; c.fillRect(x - w / 2, y - 0.02, w, 0.04);
    for (let k = -w / 2 + 0.12; k < w / 2 - 0.12; k += 0.22) { rr(c, x + k, y - h / 2 + 0.06, 0.14, 0.11, 0.02); c.fillStyle = '#C8E0F0'; c.fill(); ink(c, 0.01); }
    c.restore();
  } else if (m.kind === 'trajinera') {
    c.save();
    shadow(c, () => rr(c, x - w / 2, y - h / 2, w, h, 0.17));
    rr(c, x - w / 2, y - h / 2, w, h, 0.17); c.fillStyle = '#8C4A2F'; c.fill(); ink(c, 0.02);
    // techito de colores con su nombre
    const cols = ['#E2553F', '#F8DB8E', '#6FB3A3', '#F2A3B6'];
    for (let i = 0; i < 4; i++) { c.fillStyle = cols[i]; c.fillRect(x - w / 2 + 0.04, y - h / 2 + 0.12 + i * 0.17, w - 0.08, 0.17); }
    c.strokeStyle = INK; c.lineWidth = 0.012; c.strokeRect(x - w / 2 + 0.04, y - h / 2 + 0.12, w - 0.08, 0.68);
    c.save(); c.translate(x, y); c.rotate(-Math.PI / 2);
    label(c, m.name || '', 0, 0.005, 0.1);
    c.restore();
    c.restore();
  } else if (m.kind === 'elotes') {
    shadow(c, () => rr(c, x - w / 2, y - h / 2, w, h, 0.04));
    rr(c, x - w / 2, y - h / 2, w, h, 0.04); c.fillStyle = '#F8DB8E'; c.fill(); ink(c, 0.02);
    c.fillStyle = '#E2553F'; c.fillRect(x - w / 2, y - h / 2, w, 0.06); c.strokeStyle = INK; c.lineWidth = 0.012; c.strokeRect(x - w / 2, y - h / 2, w, 0.06);
    for (let i = -1; i <= 1; i++) { c.beginPath(); c.ellipse(x + i * 0.1, y + 0.03, 0.03, 0.06, 0, 0, Math.PI * 2); c.fillStyle = '#EDB447'; c.fill(); ink(c, 0.01); }
    // ruedas
    c.fillStyle = INK; circle(c, x - w / 2 + 0.06, y + h / 2, 0.03); c.fill(); circle(c, x + w / 2 - 0.06, y + h / 2, 0.03); c.fill();
  }
}

/* puentecito de tablas (se pinta encima de las trajineras) */
function paintBridge(c, p) {
  const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  shadow(c, () => c.rect(x0, y0, x1 - x0, y1 - y0), 0.03, 0.05);
  c.fillStyle = '#C98F5A'; c.fillRect(x0, y0, x1 - x0, y1 - y0);
  c.strokeStyle = 'rgba(34,40,63,.4)'; c.lineWidth = 0.012;
  for (let x = x0 + 0.1; x < x1; x += 0.1) { c.beginPath(); c.moveTo(x, y0); c.lineTo(x, y1); c.stroke(); }
  c.fillStyle = 'rgba(34,40,63,.35)';
  for (let x = x0 + 0.05; x < x1; x += 0.1) { circle(c, x, y0 + 0.05, 0.008); c.fill(); circle(c, x, y1 - 0.05, 0.008); c.fill(); }
  c.strokeStyle = INK; c.lineWidth = 0.025; c.strokeRect(x0, y0, x1 - x0, y1 - y0);
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

function paintBall(c, x, y, col, alpha, ring, sinkAt) {
  c.save();
  c.globalAlpha = alpha;
  let r = R;
  if (sinkAt) { const u = Math.min(1, (performance.now() - sinkAt) / 350); r = R * (1 - 0.6 * u); c.globalAlpha = alpha * (1 - u * 0.8); }
  if (ring) { circle(c, x, y, R * 1.9); c.strokeStyle = 'rgba(255,247,234,.85)'; c.lineWidth = 0.012; c.setLineDash([0.025, 0.02]); c.stroke(); c.setLineDash([]); }
  circle(c, x + 0.012, y + 0.016, r); c.fillStyle = 'rgba(34,40,63,.35)'; c.fill();
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
