// Gato: tablero dibujado a mano, fichas que se "pintan" con plumón.
// La jugada propia se muestra al instante (optimista) y el servidor la confirma.

import { play, isOver, nextToVanish, LINES } from './gato-rules.js';

const INK = '#22283F';
const SYM_COLOR = ['#E2553F', '#2F7F72']; // X tomate, O verde azulado
export const MODE_NAMES = { classic: 'Clásico', inf: 'Infinito' };

// trazos ligeramente chuecos, como hechos a mano (fijos para que no "bailen" al redibujar)
const GRID = [
  'M101 14 C 99 80, 103 170, 99 286',
  'M200 12 C 202 100, 197 200, 201 288',
  'M14 99 C 90 102, 200 96, 286 101',
  'M12 200 C 100 197, 210 203, 288 199',
];
const X_PATHS = ['M25 24 C 40 40, 60 60, 77 78', 'M76 23 C 60 42, 42 60, 23 77'];
const O_PATH = 'M51 17 C 71 16, 85 32, 84 51 C 83 71, 67 85, 48 84 C 29 83, 16 68, 17 49 C 18 30, 33 18, 55 19';

function markSVG(sym, { draw = false, cls = '' } = {}) {
  const d = sym === 0 ? X_PATHS : [O_PATH];
  const anim = draw ? ' class="ink-draw"' : '';
  const layers = d.map((p, i) => `
    <path d="${p}" pathLength="1" stroke="${INK}" stroke-width="17" ${anim ? `class="ink-draw" style="animation-delay:${i * 110}ms"` : ''}/>
    <path d="${p}" pathLength="1" stroke="${SYM_COLOR[sym]}" stroke-width="9" ${anim ? `class="ink-draw" style="animation-delay:${i * 110}ms"` : ''}/>`).join('');
  return `<svg class="mark ${cls}" viewBox="0 0 100 100" fill="none" stroke-linecap="round" aria-hidden="true">${layers}</svg>`;
}
export const symbolIcon = (sym) => markSVG(sym, { cls: 'mini' });

function cellCenter(i) { return [50 + (i % 3) * 100, 50 + Math.floor(i / 3) * 100]; }
function winPath(line) {
  const [a, , c] = line;
  const [x1, y1] = cellCenter(a), [x2, y2] = cellCenter(c);
  const dx = (x2 - x1) * 0.18, dy = (y2 - y1) * 0.18;
  const sx = x1 - dx, sy = y1 - dy, ex = x2 + dx, ey = y2 + dy;
  // un poquito curva, como trazo de mano
  const mx = (sx + ex) / 2 + (ey - sy) * 0.04, my = (sy + ey) / 2 - (ex - sx) * 0.04;
  return `M${sx} ${sy} Q${mx} ${my} ${ex} ${ey}`;
}

/**
 * ctx: { you, player(id), partnerOn(), send(o) → bool, sfx, toast(text), confetti(), critter(kind, c, cls), esc }
 */
export function mount(root, ctx) {
  let g = null;          // estado confirmado por el servidor
  let local = null;      // ronda con mi jugada optimista (o null)
  let pending = null;    // { v, cell }
  let shown = Array(9).fill(-1);
  let lastOutcomeKey = '';

  root.innerHTML = `
    <div class="gato">
      <div class="game-head">
        <button class="btn ghost small" data-quit>← Sala</button>
        <div class="game-title"><h2>Gato</h2><div class="seg" role="radiogroup" aria-label="Modo">
          <button role="radio" data-mode="classic">Clásico</button><button role="radio" data-mode="inf">Infinito</button>
        </div></div>
      </div>
      <div class="vs">
        <div class="chip" data-seat="0"></div>
        <div class="vs-mid"><span class="draws"></span></div>
        <div class="chip" data-seat="1"></div>
      </div>
      <p class="g-status" aria-live="polite"></p>
      <div class="board-wrap">
        <div class="board surface">
          <svg class="grid" viewBox="0 0 300 300" fill="none" stroke-linecap="round" aria-hidden="true">
            ${GRID.map((d, i) => `<path d="${d}" pathLength="1" stroke="${INK}" stroke-width="7" class="ink-draw" style="animation-delay:${i * 90}ms"/>`).join('')}
            <path class="winline" d="" pathLength="1" stroke="${INK}" stroke-width="10"/>
          </svg>
          ${Array.from({ length: 9 }, (_, i) => `<button class="cell" data-i="${i}" aria-label="casilla ${i + 1}"></button>`).join('')}
        </div>
      </div>
      <div class="result" hidden></div>
      <p class="g-hint"></p>
    </div>`;

  const $ = (s) => root.querySelector(s);
  const board = $('.board');
  const cells = [...root.querySelectorAll('.cell')];

  board.addEventListener('click', (e) => {
    const c = e.target.closest('.cell');
    if (c) tap(Number(c.dataset.i));
  });
  $('[data-quit]').addEventListener('click', () => ctx.confirmQuit());
  root.querySelector('.seg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]');
    if (!b || !g || b.dataset.mode === g.mode) return;
    if (!isOver(g.round)) { ctx.toast('El modo se cambia al terminar la ronda'); return; }
    ctx.sfx.tap();
    ctx.send({ t: 'g:mode', mode: b.dataset.mode });
  });

  const mySeat = () => (g ? g.seats.indexOf(ctx.you) : -1);
  const round = () => local || g?.round;

  function tap(i) {
    if (!g || pending) return;
    const r = g.round, me = mySeat();
    if (isOver(r)) return;
    if (r.turn !== me) {
      ctx.sfx.error();
      wiggle(cells[i]);
      return;
    }
    const res = play(r, me, i);
    if (!res.ok) { ctx.sfx.error(); wiggle(cells[i]); return; }
    pending = { v: g.v, cell: i };
    local = res.round;
    if (!ctx.send({ t: 'g:move', v: g.v, m: { cell: i } })) {
      // sin conexión: no fingimos que se jugó
      pending = null; local = null;
      ctx.toast('Sin conexión… espera un momento');
      ctx.sfx.error();
      return;
    }
    effects(local, true);
    render();
  }

  function wiggle(el) { el.classList.remove('nope'); void el.offsetWidth; el.classList.add('nope'); }

  /** sonidos y animaciones de una jugada (propia u otra) */
  function effects(r, mine) {
    if (r.last >= 0) ctx.sfx.scribble(r.cells[r.last] === 0 ? 2 : 1, r.cells[r.last] === 0 ? 1 : 0.8);
    if (r.vanished >= 0) setTimeout(() => ctx.sfx.poof(), 120);
    if (!mine && !isOver(r) && r.turn === mySeat()) setTimeout(() => ctx.sfx.turn(), 260);
  }

  function renderCells(r, animateLast) {
    const fade = nextToVanish(r, r.turn);
    const me = mySeat();
    const myTurn = !isOver(r) && r.turn === me && !pending;
    for (let i = 0; i < 9; i++) {
      const el = cells[i];
      const owner = r.cells[i];
      if (owner !== shown[i]) {
        if (owner === -1) {
          // la ficha se va con un "puf"
          const old = el.querySelector('.mark:not(.ghost)');
          if (old) {
            old.classList.add('vanish');
            el.insertAdjacentHTML('beforeend', `<span class="puff"><i></i><i></i><i></i><i></i><i></i></span>`);
            setTimeout(() => { old.remove(); el.querySelector('.puff')?.remove(); }, 520);
          }
        } else {
          el.querySelectorAll('.mark').forEach((m) => m.remove());
          el.insertAdjacentHTML('afterbegin', markSVG(owner, { draw: animateLast && i === r.last }));
        }
        shown[i] = owner;
      }
      el.classList.toggle('fading', i === fade);
      el.classList.toggle('playable', myTurn && owner === -1);
      el.classList.toggle('in-line', !!r.line && r.line.includes(i));
      // sombra de mi ficha al pasar el mouse (solo en computadora)
      const ghost = el.querySelector('.ghost');
      if (myTurn && owner === -1 && me >= 0) { if (!ghost) el.insertAdjacentHTML('beforeend', markSVG(me, { cls: 'ghost' })); }
      else ghost?.remove();
      el.disabled = !myTurn || owner !== -1;
      el.setAttribute('aria-label', `casilla ${i + 1}${owner === -1 ? '' : owner === 0 ? ', X' : ', O'}`);
    }
    const wl = $('.winline');
    if (r.line) {
      if (wl.dataset.line !== r.line.join()) { wl.setAttribute('d', winPath(r.line)); wl.dataset.line = r.line.join(); wl.classList.remove('ink-draw'); void wl.getBoundingClientRect(); wl.classList.add('ink-draw', 'on'); }
    } else { wl.classList.remove('on', 'ink-draw'); wl.dataset.line = ''; }
  }

  function chipHTML(seat) {
    const id = g.seats[seat];
    const p = ctx.player(id);
    const score = g.score?.[id] || 0;
    return `<div class="chip-av">${ctx.critter(p.look.k, p.look.c, p.on ? '' : 'sleepy')}</div>
      <div class="chip-txt"><b>${ctx.esc(p.name)}${id === ctx.you ? ' <small>(tú)</small>' : ''}</b><span class="sym">${symbolIcon(seat)}</span></div>
      <div class="chip-score">${score}</div>`;
  }

  function render(animateLast = true) {
    if (!g) return;
    const r = round();
    const me = mySeat();
    const other = g.seats[1 - me];
    const op = ctx.player(other);

    root.querySelectorAll('.seg [data-mode]').forEach((b) => {
      b.setAttribute('aria-checked', b.dataset.mode === g.mode);
      b.disabled = !isOver(g.round) && b.dataset.mode !== g.mode;
    });
    for (const seat of [0, 1]) {
      const chip = root.querySelector(`.chip[data-seat="${seat}"]`);
      const html = chipHTML(seat);
      if (chip.dataset.html !== html) { chip.innerHTML = html; chip.dataset.html = html; }
      chip.classList.toggle('turn', !isOver(r) && r.turn === seat);
      chip.classList.toggle('won', r.winner === seat);
    }
    $('.draws').textContent = g.mode === 'classic' ? `${g.score?.d || 0} empates` : 'vs';

    const st = $('.g-status');
    if (isOver(r)) st.textContent = '';
    else if (r.turn === me) st.innerHTML = `<b>Tu turno</b> · eres ${symbolIcon(me)}`;
    else st.innerHTML = op.on ? `Turno de <b>${ctx.esc(op.name)}</b>…` : `<b>${ctx.esc(op.name)}</b> se desconectó · la partida espera`;
    st.classList.toggle('mine', !isOver(r) && r.turn === me);

    $('.g-hint').textContent = g.mode === 'inf' && !isOver(r)
      ? 'Máximo 3 fichas cada quien: al poner la cuarta se borra tu más vieja (la que se ve tenue).'
      : '';

    renderCells(r, animateLast);
    renderResult(r, me, op);
  }

  function renderResult(r, me, op) {
    const box = $('.result');
    if (!isOver(r) || local) { box.hidden = true; return; }
    const iWon = r.winner === me, draw = r.draw;
    const iAgain = g.again.includes(ctx.you), theyAgain = g.again.includes(g.seats[1 - me]);
    const title = draw ? 'Empate' : iWon ? '¡Ganaste!' : `Ganó ${ctx.esc(op.name)}`;
    const sub = draw ? 'Nadie cedió ni un cuadrito.' : iWon ? 'Tres en línea, impecable.' : 'La próxima es tuya.';
    box.hidden = false;
    box.className = `result ${draw ? 'is-draw' : iWon ? 'is-win' : 'is-lose'}`;
    box.innerHTML = `
      <div><h3>${title}</h3><p>${sub}</p></div>
      <div class="result-actions">
        ${theyAgain && !iAgain ? `<span class="tag">${ctx.esc(op.name)} quiere otra ✓</span>` : ''}
        <button class="btn primary" data-again ${iAgain ? 'disabled' : ''}>${iAgain ? `Esperando a ${ctx.esc(op.name)}…` : 'Otra ronda'}</button>
      </div>`;
    box.querySelector('[data-again]')?.addEventListener('click', () => { ctx.sfx.tap(); ctx.send({ t: 'g:again' }); });
  }

  function outcome(r) {
    const key = `${g.v}:${r.winner}:${r.draw}`;
    if (!isOver(r) || key === lastOutcomeKey) return;
    lastOutcomeKey = key;
    const me = mySeat();
    setTimeout(() => {
      if (r.draw) ctx.sfx.draw();
      else if (r.winner === me) { ctx.sfx.win(); ctx.confetti(); }
      else ctx.sfx.lose();
    }, 380);
  }

  return {
    update(next, ev = {}) {
      const prev = g;
      g = next;
      const mine = ev.k === 'move' && ev.by === ctx.you;
      const wasOptimistic = mine && pending && local && local.last === g.round.last;
      // la confirmación de mi jugada no repite sonido ni animación
      if (ev.k === 'move' && !mine) effects(g.round, false);
      if (ev.k === 'sync' && pending && ev.err) ctx.sfx.error();
      if (ev.k === 'round' || ev.k === 'start') { shown = Array(9).fill(-1); root.querySelectorAll('.cell .mark').forEach((m) => m.remove()); }
      if (ev.k === 'welcome' && pending && g.v === pending.v && g.round.turn === mySeat() && g.round.cells[pending.cell] === -1) {
        // la jugada se perdió en un corte: se reenvía
        ctx.send({ t: 'g:move', v: g.v, m: { cell: pending.cell } });
        return;
      }
      pending = null; local = null;
      render(!wasOptimistic && ev.k === 'move');
      if (prev && (ev.k === 'move')) outcome(g.round);
      if (ev.k === 'round') ctx.sfx.scribble(1, 0.6);
    },
    refresh() { render(false); },
    destroy() { root.innerHTML = ''; },
  };
}

export { LINES };
