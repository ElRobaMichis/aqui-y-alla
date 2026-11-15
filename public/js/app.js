import * as net from './net.js';
import { probeNat, supported as rtcSupported } from './rtc.js';
import * as audio from './audio.js';
import { critter, KINDS, KIND_NAMES, COLORS, COLOR_NAMES } from './critters.js';

/* ───────────── utilidades ───────────── */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const icon = (id, cls = 'icon') => `<svg class="${cls}"><use href="#i-${id}"/></svg>`;
const app = $('#app');
const fx = $('#fx');
const wide = matchMedia('(min-width: 900px)');

const MONTHS = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
const hhmm = (ts) => new Date(ts).toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit' });
function dayLabel(ts) {
  const d = new Date(ts), now = new Date();
  const k = (x) => x.toDateString();
  if (k(d) === k(now)) return 'hoy';
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (k(d) === k(y)) return 'ayer';
  return `${d.getDate()} ${MONTHS[d.getMonth()].toLowerCase()}`;
}
function ago(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'hace un momento';
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return `hace ${Math.round(s / 86400)} d`;
}

const REACTIONS = [
  { k: 'love', e: '❤️' }, { k: 'haha', e: '😂' }, { k: 'kiss', e: '😘' },
  { k: 'wow', e: '😮' }, { k: 'aww', e: '🥺' }, { k: 'fire', e: '🔥' },
];
const REACT_EMOJI = Object.fromEntries(REACTIONS.map((r) => [r.k, r.e]));

const GAMES = [
  { id: 'gato', ready: true, name: 'Gato', desc: 'Clásico o infinito: tus fichas viejas se borran.', g: 'var(--sky)',
    art: `<svg viewBox="0 0 70 70"><path d="M25 8v54M45 8v54M8 25h54M8 45h54" stroke="#22283F" stroke-width="4" stroke-linecap="round"/><path d="M12 12l9 9M21 12l-9 9" stroke="#E2553F" stroke-width="4.5" stroke-linecap="round"/><circle cx="35" cy="35" r="5.5" fill="none" stroke="#22283F" stroke-width="4"/><path d="M49 49l9 9M58 49l-9 9" stroke="#E2553F" stroke-width="4.5" stroke-linecap="round"/></svg>` },
  { id: 'billar', ready: true, name: 'Billar', desc: 'Bola 8 con efecto, fuerza y física de verdad.', g: 'var(--mint)',
    art: `<svg viewBox="0 0 70 70"><rect x="6" y="14" width="58" height="42" rx="7" fill="#2E7D6B" stroke="#22283F" stroke-width="3.5"/><circle cx="12" cy="20" r="3.5" fill="#22283F"/><circle cx="58" cy="20" r="3.5" fill="#22283F"/><circle cx="12" cy="50" r="3.5" fill="#22283F"/><circle cx="58" cy="50" r="3.5" fill="#22283F"/><circle cx="44" cy="33" r="6" fill="#EDB447" stroke="#22283F" stroke-width="2.5"/><circle cx="50" cy="41" r="6" fill="#E2553F" stroke="#22283F" stroke-width="2.5"/><circle cx="22" cy="37" r="6" fill="#FFF7EA" stroke="#22283F" stroke-width="2.5"/><path d="M4 66 L17 42" stroke="#F3E3C3" stroke-width="5" stroke-linecap="round"/><path d="M4 66 L17 42" stroke="#22283F" stroke-width="1.5" stroke-linecap="round" fill="none" opacity=".6"/></svg>` },
  { id: 'memo', name: 'Memorama', desc: 'Encuentren los pares por turnos.', g: 'var(--pink)',
    art: `<svg viewBox="0 0 70 70"><rect x="9" y="14" width="24" height="34" rx="4" fill="#FFF9EF" stroke="#22283F" stroke-width="3.5" transform="rotate(-8 21 31)"/><rect x="36" y="20" width="24" height="34" rx="4" fill="#EDB447" stroke="#22283F" stroke-width="3.5" transform="rotate(7 48 37)"/><path d="M21 27c-3-4-8-1-5 3l5 5 5-5c3-4-2-7-5-3z" fill="#E2553F" transform="rotate(-8 21 31)"/></svg>` },
  { id: 'dibujo', name: 'Dibujitos', desc: 'Uno dibuja, el otro adivina.', g: 'var(--butter)',
    art: `<svg viewBox="0 0 70 70"><path d="M10 52c8-14 14 4 22-10s12 6 20-6" fill="none" stroke="#2F7F72" stroke-width="4" stroke-linecap="round"/><path d="M44 12l12 12-22 22-14 3 3-14z" fill="#FFF9EF" stroke="#22283F" stroke-width="3.5" stroke-linejoin="round"/><path d="M40 16l12 12" stroke="#22283F" stroke-width="3.5"/></svg>` },
  { id: 'conoces', name: '¿Me conoces?', desc: 'Preguntas sobre ustedes dos.', g: 'var(--lav)',
    art: `<svg viewBox="0 0 70 70"><path d="M35 58S13 45 13 29a11 11 0 0 1 22-3 11 11 0 0 1 22 3c0 16-22 29-22 29z" fill="#E2553F" stroke="#22283F" stroke-width="3.5" stroke-linejoin="round"/><path d="M30 30a5 5 0 1 1 7 4.6c-1.4.6-2 1.6-2 3V39" fill="none" stroke="#FFF9EF" stroke-width="3.5" stroke-linecap="round"/><circle cx="35" cy="45" r="2.3" fill="#FFF9EF"/></svg>` },
  { id: 'cuatro', name: 'Cuatro en fila', desc: 'Fichas que caen, nervios que suben.', g: 'var(--mint)',
    art: `<svg viewBox="0 0 70 70"><rect x="8" y="14" width="54" height="44" rx="5" fill="#FFF9EF" stroke="#22283F" stroke-width="3.5"/><g stroke="#22283F" stroke-width="2.5"><circle cx="20" cy="27" r="5" fill="#E2553F"/><circle cx="35" cy="27" r="5" fill="#EADDC6"/><circle cx="50" cy="27" r="5" fill="#EDB447"/><circle cx="20" cy="44" r="5" fill="#EDB447"/><circle cx="35" cy="44" r="5" fill="#E2553F"/><circle cx="50" cy="44" r="5" fill="#E2553F"/></g></svg>` },
  { id: 'naval', name: 'Batallita naval', desc: 'Escondan sus barquitos.', g: 'var(--sky)',
    art: `<svg viewBox="0 0 70 70"><path d="M8 48c5 4 9 4 13 0s9-4 14 0 9 4 14 0 9-4 13 0" fill="none" stroke="#22283F" stroke-width="3.5" stroke-linecap="round"/><path d="M14 40h42l-6 8H20z" fill="#E2553F" stroke="#22283F" stroke-width="3.5" stroke-linejoin="round"/><path d="M34 40V12l16 22H34" fill="#FFF9EF" stroke="#22283F" stroke-width="3.5" stroke-linejoin="round"/></svg>` },
];

/* ───────────── estado ───────────── */

function loadProfile() {
  try {
    const p = JSON.parse(localStorage.getItem(net.K + 'me'));
    if (p && p.look) return p;
  } catch {}
  return { name: '', look: { k: KINDS[Math.floor(Math.random() * KINDS.length)], c: Math.floor(Math.random() * COLORS.length) } };
}
const saveProfile = () => localStorage.setItem(net.K + 'me', JSON.stringify(state.me));

const state = {
  me: loadProfile(),
  you: null,
  room: null,
  players: [],
  msgs: [],
  tab: 'room',
  game: null,
  invite: null,
  unread: 0,
  mySeenSent: 0,
  typingTimer: null,
  typingSentAt: 0,
  partnerTyping: false,
  partnerTypingTimer: null,
};

const partner = () => state.players.find((p) => p.id !== state.you) || null;
const meP = () => state.players.find((p) => p.id === state.you) || null;
const nameOf = (id) => (state.players.find((p) => p.id === id)?.name) || 'Alguien';

/* ───────────── toasts ───────────── */

function toast(text, ms = 2200) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  $('#toasts').append(el);
  setTimeout(() => { el.classList.add('out'); el.addEventListener('animationend', () => el.remove()); }, ms);
}

/* ───────────── LOBBY ───────────── */

function profileFormHTML(prefix = '') {
  const m = state.me;
  return `
    <div class="preview" id="${prefix}preview">${critter(m.look.k, m.look.c, 'bob')}</div>
    <label class="field"><span>Tu nombre</span>
      <input class="input" id="${prefix}name" maxlength="18" autocomplete="nickname" autocapitalize="words" enterkeyhint="done" placeholder="¿Cómo te dicen?" value="${esc(m.name)}"></label>
    <div class="field"><span>Personaje</span>
      <div class="pick-row" id="${prefix}kinds">
        ${KINDS.map((k) => `<button type="button" class="kind-btn" data-k="${k}" aria-pressed="${k === m.look.k}" title="${KIND_NAMES[k]}" aria-label="${KIND_NAMES[k]}">${critter(k, m.look.c)}</button>`).join('')}
      </div>
    </div>
    <div class="field"><span>Color</span>
      <div class="pick-row" id="${prefix}colors">
        ${COLORS.map((c, i) => `<button type="button" class="swatch" style="--c:${c}" data-c="${i}" aria-pressed="${i === m.look.c}" aria-label="${COLOR_NAMES[i]}"></button>`).join('')}
      </div>
    </div>`;
}

function bindProfileForm(root, prefix = '') {
  const refresh = () => {
    $(`#${prefix}preview`, root).innerHTML = critter(state.me.look.k, state.me.look.c, 'bob hop');
    $$(`#${prefix}kinds .kind-btn`, root).forEach((b) => {
      b.setAttribute('aria-pressed', b.dataset.k === state.me.look.k);
      b.innerHTML = critter(b.dataset.k, state.me.look.c);
    });
    $$(`#${prefix}colors .swatch`, root).forEach((b) => b.setAttribute('aria-pressed', Number(b.dataset.c) === state.me.look.c));
  };
  $(`#${prefix}kinds`, root).addEventListener('click', (e) => {
    const b = e.target.closest('.kind-btn'); if (!b) return;
    state.me.look.k = b.dataset.k; audio.sfx.tap(); refresh();
  });
  $(`#${prefix}colors`, root).addEventListener('click', (e) => {
    const b = e.target.closest('.swatch'); if (!b) return;
    state.me.look.c = Number(b.dataset.c); audio.sfx.tap(); refresh();
  });
  $(`#${prefix}preview`, root).addEventListener('click', () => {
    const svg = $(`#${prefix}preview .critter`, root);
    svg.classList.remove('hop'); void svg.getBoundingClientRect(); svg.classList.add('hop');
    audio.sfx.react();
  });
}

function readProfileForm(root, prefix = '') {
  state.me.name = $(`#${prefix}name`, root).value.trim().slice(0, 18);
  saveProfile();
}

function renderLobby(invite = null) {
  state.room = null;
  document.title = 'aquí y allá';
  app.innerHTML = `
  <main class="lobby">
    <header class="brand">
      <h1 class="wordmark">aquí <span class="amp">&amp;</span> allá</h1>
      <p class="tagline">un rinconcito para jugar juntos, aunque estemos lejos</p>
    </header>
    <div class="lobby-grid">
      <section class="card profile-card">
        <div class="profile-head"><span class="label-chip">tu timbre</span></div>
        ${profileFormHTML()}
      </section>
      <section class="card go-card">
        ${invite ? `
          <span class="label-chip" style="justify-self:start">te invitaron</span>
          <h2>Te están esperando en la sala</h2>
          <div class="invite-stamp">${esc(invite)}</div>
          <button class="btn primary block" id="join-invite">Entrar a la sala</button>
          <div class="or">o</div>
          <button class="btn ghost block" id="new-room">Abrir otra sala</button>
        ` : `
          <span class="label-chip" style="justify-self:start">empezar</span>
          <h2>Abre una sala y mándale el código</h2>
          <p>Son solo para ustedes dos. La sala se queda guardada aunque se corte la señal.</p>
          <button class="btn primary block" id="new-room">Abrir sala nueva</button>
          <div class="or">o entra con código</div>
          <form class="code-row" id="code-form">
            <input class="input code-input" id="code" maxlength="6" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCDEF" aria-label="Código de sala">
            <button class="btn yellow" type="submit">Entrar</button>
          </form>
        `}
      </section>
    </div>
    <p class="foot">pesa menos que una foto · la música se toca en tu navegador</p>
  </main>`;

  bindProfileForm(app);
  const go = (req) => {
    readProfileForm(app);
    if (!state.me.name) { $('#name').focus(); toast('Escribe tu nombre primero ✏️'); audio.sfx.error(); return; }
    enterRoom(req);
  };
  $('#new-room').addEventListener('click', () => go({ create: true }));
  $('#join-invite')?.addEventListener('click', () => go({ room: invite }));
  $('#code-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const code = $('#code').value.trim().toUpperCase();
    if (!/^[A-Z]{6}$/.test(code)) { toast('El código tiene 6 letras'); audio.sfx.error(); return; }
    go({ room: code });
  });
  $('#code')?.addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ''); });
}

/* ───────────── SALA ───────────── */

function enterRoom(req) {
  state.players = [];
  state.msgs = [];
  state.unread = 0;
  state.mySeenSent = 0;
  state.game = null;
  state.invite = null;
  renderRoom(req.room || '······');
  net.join({ ...req, profile: { name: state.me.name, look: state.me.look } });
}

function renderRoom(code) {
  app.innerHTML = `
  <div class="room" data-tab="${state.tab}">
    <header class="topbar">
      <div class="wordmark">aquí <span class="amp">&amp;</span> allá</div>
      <button class="code-stamp" id="share" title="Copiar invitación">${icon('link')}<span class="lbl">sala</span> <b id="room-code">${esc(code)}</b></button>
      <div class="spacer"></div>
      <div class="signal" id="signal" data-q="0" title="Calidad de conexión"><i></i><i></i><i></i><i></i><span>…</span></div>
      <button class="icon-btn ${audio.isMusicOn() ? '' : 'is-off'}" id="music" aria-label="Música">${icon('music')}${icon('off', 'slash')}</button>
      <button class="icon-btn ${audio.isSfxOn() ? '' : 'is-off'}" id="sfx" aria-label="Efectos de sonido">${icon('sound')}${icon('off', 'slash')}</button>
      <button class="icon-btn" id="menu-btn" aria-label="Menú" aria-haspopup="true">${icon('menu')}</button>
    </header>

    <section class="stage" id="stage">
     <div class="room-view" id="room-view">
      <div class="postcard" id="postcard"></div>
      <div class="invite-banner" id="invite-banner" hidden></div>
      <div class="reacts" id="reacts">${reactButtons()}</div>
      <div class="shelf-head"><h2>Juegos</h2><small>más en camino</small></div>
      <div class="shelf">
        ${GAMES.map((g) => `
          <button class="game ${g.ready ? 'ready' : ''}" style="--g:${g.g}" data-game="${g.id}">
            <span class="soon">${g.ready ? 'jugar' : 'pronto'}</span>
            <div class="art">${g.art}</div>
            <h3>${g.name}</h3>
            <p>${g.desc}</p>
          </button>`).join('')}
      </div>
     </div>
     <div class="game-view" id="game-view" hidden></div>
     <div class="reacts game-reacts" id="game-reacts" hidden>${reactButtons()}</div>
    </section>

    <aside class="chat" id="chat">
      <div class="chat-head" id="chat-head"></div>
      <div class="msgs" id="msgs"></div>
      <div class="typing" id="typing"></div>
      <div class="chat-reacts">${reactButtons()}</div>
      <form class="composer" id="composer">
        <textarea id="text" rows="1" maxlength="500" placeholder="Escribe una cartita…" enterkeyhint="send"></textarea>
        <button class="send" type="submit" aria-label="Enviar">${icon('send')}</button>
      </form>
    </aside>

    <nav class="tabs" role="tablist">
      <button class="tab" role="tab" data-tab="room" aria-selected="${state.tab === 'room'}">${icon('house')}<span id="tab-room-label">Sala</span></button>
      <button class="tab" role="tab" data-tab="chat" aria-selected="${state.tab === 'chat'}">${icon('chat')}Chat <span class="badge" id="badge"></span></button>
    </nav>
  </div>`;

  renderPostcard();
  renderChatHead();
  renderAllMsgs();
  renderSignal();
  gameHost = null;
  renderGame();
  renderInvite();

  $('#share').addEventListener('click', share);
  $('#music').addEventListener('click', (e) => {
    audio.unlock(); audio.setMusic(!audio.isMusicOn());
    e.currentTarget.classList.toggle('is-off', !audio.isMusicOn());
    toast(audio.isMusicOn() ? 'Música encendida ♪' : 'Música apagada');
  });
  $('#sfx').addEventListener('click', (e) => {
    audio.setSfx(!audio.isSfxOn());
    e.currentTarget.classList.toggle('is-off', !audio.isSfxOn());
    audio.sfx.tap();
  });
  $('#menu-btn').addEventListener('click', toggleMenu);
  $$('.tab').forEach((t) => t.addEventListener('click', () => setTab(t.dataset.tab)));
  $('.shelf').addEventListener('click', (e) => {
    const g = e.target.closest('.game'); if (!g) return;
    g.classList.remove('wiggle'); void g.offsetWidth; g.classList.add('wiggle');
    audio.sfx.tap();
    const def = GAMES.find((x) => x.id === g.dataset.game);
    if (def?.ready) openGameSetup(def);
    else toast('Ese juego viene en un siguiente paso 🛠️');
  });

  const ta = $('#text');
  ta.addEventListener('input', () => { autoGrow(ta); typing(true); });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault(); sendText();
    }
  });
  $('#composer').addEventListener('submit', (e) => { e.preventDefault(); sendText(); });
  // tocar "enviar" no debe cerrar el teclado del celular
  $('#composer .send').addEventListener('pointerdown', (e) => { if (document.activeElement === ta) e.preventDefault(); });
  ta.addEventListener('focus', () => setTimeout(() => scrollMsgs(true), 250));
  $('#msgs').addEventListener('scroll', maybeSeen, { passive: true });
}

function reactButtons() {
  return REACTIONS.map((r) => `<button class="react-btn" data-react="${r.k}" aria-label="${r.k}">${r.e}</button>`).join('')
    + `<button class="react-btn nudge" data-nudge aria-label="Zumbido">${icon('bell')}zumbido</button>`;
}

function setTab(t) {
  state.tab = t;
  const room = $('.room'); if (!room) return;
  room.dataset.tab = t;
  $$('.tab').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === t));
  if (t === 'chat') { scrollMsgs(true); maybeSeen(); }
  audio.sfx.tap();
}
wide.addEventListener('change', () => { if (wide.matches) maybeSeen(); });

/* tarjeta postal */
function slotHTML(p, side) {
  if (!p) {
    return `
    <div class="pc-slot ${side}">
      <div class="stamp-wrap"><div class="stamp empty"><div class="stamp-in"><span class="q">?</span></div></div></div>
      <div class="who"><b>Tu persona</b><span class="status">aún no llega</span></div>
    </div>`;
  }
  const st = p.on ? (p.away ? 'away' : 'on') : 'off';
  const stText = p.on ? (p.away ? 'en otra app' : 'en línea') : `se fue ${ago(p.last)}`;
  const isMe = p.id === state.you;
  return `
  <div class="pc-slot ${side}" data-pid="${p.id}">
    <div class="stamp-wrap">
      <div class="stamp" style="--c:${COLORS[p.look.c]}">
        <div class="stamp-in">
          <span class="sun"></span><span class="hills"></span>
          <span class="denom">$${isMe ? 5 : 7}</span><span class="country">MÉX</span>
          ${critter(p.look.k, p.look.c, st === 'off' ? 'sleepy' : 'bob')}
        </div>
      </div>
    </div>
    <div class="who"><b>${esc(p.name)}${isMe ? ' <small style="font-family:var(--font);font-size:12px;color:var(--ink-3)">(tú)</small>' : ''}</b><span class="status ${st}">${stText}</span></div>
  </div>`;
}

function renderPostcard() {
  const el = $('#postcard'); if (!el) return;
  const me = meP(), other = partner();
  const together = me?.on && other?.on;
  const d = new Date();
  let note;
  if (!other) note = `<span>Mándale el código <b>${esc(state.room || '')}</b> a tu persona</span><button class="btn yellow" data-share>${icon('link')}Invitar</button>`;
  else if (together) note = `Los dos aquí ♥ elijan un juego o platiquen un rato`;
  else note = `${esc(other.name)} no está ahorita — déjale una cartita en el chat`;
  el.innerHTML = `
    <div class="pc-top"><span class="pc-title">Tarjeta postal</span><span class="pc-date">${d.getDate()} ${MONTHS[d.getMonth()].toLowerCase()} · ${d.getFullYear()}</span></div>
    <div class="pc-body">
      ${slotHTML(me, 'left')}
      <svg class="route ${together ? 'together' : 'idle'}" viewBox="0 0 60 44" aria-hidden="true">
        <path d="M2 34 Q30 -2 58 34" fill="none" stroke="#22283F" stroke-width="2.5" stroke-linecap="round"/>
        <path class="heart" d="M30 33s-11-6.6-11-14A6.2 6.2 0 0 1 30 15.4 6.2 6.2 0 0 1 41 19c0 7.4-11 14-11 14z"
          fill="${together ? '#E2553F' : '#FFF9EF'}" stroke="#22283F" stroke-width="2.5" stroke-linejoin="round"/>
      </svg>
      ${slotHTML(other, 'right')}
    </div>
    <p class="pc-note">${note}</p>`;
  el.querySelector('[data-share]')?.addEventListener('click', share);
}

function renderChatHead() {
  const el = $('#chat-head'); if (!el) return;
  const p = partner();
  if (!p) { el.innerHTML = `<div><b>Cartitas</b><small>cuando llegue tu persona podrán platicar</small></div>`; return; }
  const st = p.on ? (p.away ? 'en otra app' : 'en línea') : `se fue ${ago(p.last)}`;
  el.innerHTML = `<div class="mini">${critter(p.look.k, p.look.c, p.on ? '' : 'sleepy')}</div>
    <div><b>${esc(p.name)}</b><small>${st}</small></div>`;
}

/* señal */
function renderSignal() {
  const el = $('#signal'); if (!el) return;
  const s = net.getStatus(), rtt = net.getRtt(), link = net.getLinkRtt();
  let q = 0, txt = s === 'on' ? '…' : 'sin señal';
  if (s === 'connecting') txt = 'conectando';
  if (s === 'on' && rtt != null) {
    // las rayitas son la calidad de MI conexión; los ms, lo que tarda ir y volver entre los dos
    const r = link || rtt;
    q = r <= 300 ? 4 : r <= 600 ? 3 : r <= 1200 ? 2 : 1;
    txt = `${rtt} ms`;
  }
  // ⚡ = los dos teléfonos hablan directo, sin pasar por el repetidor
  const direct = s === 'on' && net.isDirect();
  el.dataset.direct = direct ? '1' : '';
  el.title = direct ? 'Conexión directa entre los dos' : 'Calidad de conexión';
  el.dataset.q = q;
  el.querySelector('span').textContent = txt;
}

/* ───────────── chat ───────────── */

function isEmojiOnly(t) {
  return t.length <= 12 && /^(\p{Extended_Pictographic}|\p{Emoji_Component}|‍|️|\s)+$/u.test(t) && !/^[\d#*\s]+$/.test(t);
}

function msgHTML(m, prev, next) {
  const mine = m.f === state.you;
  const sameAsPrev = prev && prev.f === m.f && m.ts - prev.ts < 180000 && dayLabel(prev.ts) === dayLabel(m.ts);
  const sameAsNext = next && next.f === m.f && next.ts - m.ts < 180000 && dayLabel(next.ts) === dayLabel(m.ts);
  const day = !prev || dayLabel(prev.ts) !== dayLabel(m.ts) ? `<div class="day">${dayLabel(m.ts)}</div>` : '';
  const cls = ['msg', mine ? 'mine' : 'theirs', sameAsPrev ? 'cont' : '', sameAsNext ? 'cont-next' : '', isEmojiOnly(m.x) ? 'big' : '', m.pending ? 'pending' : ''].join(' ');
  return `${day}<div class="${cls}" data-id="${m.id ?? ''}" data-cid="${m.c ?? ''}">
    <div class="bubble">${esc(m.x)}</div>
    <div class="meta time">${m.pending ? 'enviando…' : hhmm(m.ts)}</div>
  </div>`;
}

function allMsgs() {
  const list = [...state.msgs];
  // lo que aún no confirma el servidor (se guarda en el teléfono y se reenvía solo)
  for (const o of net.pending()) list.push({ f: state.you, x: o.x, ts: o.ts, c: o.cid, pending: true });
  return list;
}

function renderAllMsgs() {
  const el = $('#msgs'); if (!el) return;
  const list = allMsgs();
  if (!list.length) {
    const p = partner();
    el.innerHTML = `<div class="empty">${p ? critter(p.look.k, p.look.c, 'bob') : critter(state.me.look.k, state.me.look.c, 'bob')}
      <span>${p ? `Escríbele algo bonito a ${esc(p.name)}` : 'Aquí aparecerán sus cartitas'}</span></div>`;
    return;
  }
  el.innerHTML = list.map((m, i) => msgHTML(m, list[i - 1], list[i + 1])).join('');
  renderSeenMark();
  scrollMsgs(true);
}

function nearBottom(el) { return el.scrollHeight - el.scrollTop - el.clientHeight < 120; }
function scrollMsgs(force) {
  const el = $('#msgs'); if (!el) return;
  if (force || nearBottom(el)) requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
}

function renderSeenMark() {
  $$('#msgs .seen').forEach((s) => s.remove());
  const p = partner(); if (!p || !p.seen) return;
  const mine = state.msgs.filter((m) => m.f === state.you && m.id <= p.seen);
  const last = mine[mine.length - 1];
  if (!last) return;
  // solo lo mostramos si es mi último mensaje confirmado
  const myLast = [...state.msgs].reverse().find((m) => m.f === state.you);
  if (myLast !== last) return;
  const el = $(`#msgs .msg[data-id="${last.id}"] .meta`);
  if (el) el.insertAdjacentHTML('beforeend', `<span class="seen">· visto</span>`);
}

function chatVisible() { return !document.hidden && (wide.matches || state.tab === 'chat'); }

function maybeSeen() {
  if (!chatVisible()) return;
  const last = state.msgs[state.msgs.length - 1];
  if (last && last.id > state.mySeenSent) {
    state.mySeenSent = last.id;
    net.send({ t: 'seen', id: last.id });
  }
  if (state.unread) { state.unread = 0; renderBadge(); }
}

function renderBadge() {
  const b = $('#badge'); if (b) b.textContent = state.unread ? String(Math.min(state.unread, 99)) : '';
  document.title = state.unread ? `(${state.unread}) aquí y allá` : 'aquí y allá';
}

function sendText() {
  const ta = $('#text');
  const x = ta.value.trim();
  if (!x) return;
  ta.value = ''; autoGrow(ta);
  net.chat(x);
  typing(false);
  audio.sfx.send();
  renderAllMsgs();
}

function autoGrow(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight + 5, 120) + 'px'; }

function typing(on) {
  clearTimeout(state.typingTimer);
  if (on) {
    if (Date.now() - state.typingSentAt > 2500) { net.send({ t: 'typing', on: true }); state.typingSentAt = Date.now(); }
    state.typingTimer = setTimeout(() => typing(false), 3500);
  } else if (state.typingSentAt) {
    net.send({ t: 'typing', on: false });
    state.typingSentAt = 0;
  }
}

function renderTyping() {
  const el = $('#typing'); if (!el) return;
  const p = partner();
  if (state.partnerTyping && p) {
    el.innerHTML = `<span class="dots"><i></i><i></i><i></i></span>${esc(p.name)} está escribiendo`;
    el.classList.add('on');
  } else el.classList.remove('on');
}

/* ───────────── reacciones y zumbido ───────────── */

function burst(emoji, fromMe) {
  const n = 9;
  for (let i = 0; i < n; i++) {
    const s = document.createElement('span');
    s.className = 'float';
    s.textContent = emoji;
    const x = fromMe ? 50 + (Math.random() - 0.5) * 50 : 50 + (Math.random() - 0.5) * 70;
    s.style.cssText = `--x:${x}vw;--dx:${(Math.random() - 0.5) * 30}vw;--r:${(Math.random() - 0.5) * 70}deg;--d:${2 + Math.random() * 1.3}s;--s:${26 + Math.random() * 26}px;--h:${-55 - Math.random() * 35}vh;animation-delay:${i * 70}ms`;
    s.addEventListener('animationend', () => s.remove());
    fx.append(s);
  }
}

function poke(pid, cls) {
  const svg = $(`.pc-slot[data-pid="${pid}"] .critter`);
  if (!svg) return;
  svg.classList.remove('hop', 'wiggle'); void svg.getBoundingClientRect(); svg.classList.add(cls);
}

let lastReact = 0;
function onReactClick(e) {
  const r = e.target.closest('[data-react]');
  const n = e.target.closest('[data-nudge]');
  if (!r && !n) return;
  if (Date.now() - lastReact < 180) return;
  lastReact = Date.now();
  if (r) {
    burst(REACT_EMOJI[r.dataset.react], true);
    audio.sfx.react();
    poke(state.you, 'hop');
    net.send({ t: 'react', e: r.dataset.react });
  } else {
    if (!partner()?.on) { toast('Tu persona no está conectada'); return; }
    net.send({ t: 'nudge' });
    n.classList.remove('wiggle'); void n.offsetWidth; n.classList.add('wiggle');
    toast('¡Zumbido enviado!');
  }
}

/* ───────────── menú y modales ───────────── */

function toggleMenu() {
  const old = $('.menu'); if (old) { old.remove(); return; }
  audio.sfx.tap();
  const m = document.createElement('div');
  m.className = 'menu';
  m.innerHTML = `
    <button data-act="edit">${icon('pencil')}Cambiar mi timbre</button>
    <button data-act="share">${icon('link')}Copiar invitación</button>
    <button data-act="net">${icon('bell')}Probar mi conexión</button>
    <button data-act="leave" class="danger">${icon('door')}Salir de la sala</button>`;
  $('.topbar').append(m);
  const close = (ev) => { if (!m.contains(ev.target) && ev.target.id !== 'menu-btn') { m.remove(); document.removeEventListener('pointerdown', close); } };
  setTimeout(() => document.addEventListener('pointerdown', close));
  m.addEventListener('click', (e) => {
    const a = e.target.closest('button')?.dataset.act; if (!a) return;
    m.remove(); document.removeEventListener('pointerdown', close);
    if (a === 'edit') editProfile();
    if (a === 'share') share();
    if (a === 'net') testConnection();
    if (a === 'leave') confirmLeave();
  });
}

/** ¿La red de este teléfono permite hablar directo con el otro? (se prueba con dos servidores STUN) */
async function testConnection() {
  const P = 'style="margin:0;color:var(--ink-2);font-weight:600"';
  const m = modal(`<div class="overlay-card"><h2>Probando tu conexión…</h2><p ${P}>Tarda unos segundos.</p></div>`);
  const link = net.getLinkRtt();
  const now = net.isDirect() ? 'directa entre los dos ⚡' : 'por el repetidor';
  let verdict;
  if (!rtcSupported()) verdict = 'Este navegador no permite conexión directa: las partidas van por el repetidor.';
  else {
    const r = await probeNat().catch(() => null);
    if (!r || (r.v4 === 'sin respuesta' && !r.v6)) verdict = 'No se pudo probar ahora (sin respuesta). Inténtalo otra vez en un rato.';
    else if (r.v4 === 'directa' || r.v6) verdict = 'Tu red <b>sí permite</b> conexión directa. Si la de tu persona también, en las partidas se hablan directo (más rápido).';
    else verdict = 'Tu red <b>no permite</b> conexión directa (pasa con algunas redes celulares). Todo sigue funcionando por el repetidor, solo un poco más lento.';
  }
  if (!m.isConnected) return;
  m.querySelector('.modal').innerHTML = `<div class="overlay-card">
    <h2>Tu conexión</h2>
    <p ${P}>${verdict}</p>
    <p ${P}>Ahora mismo: ${now}${link ? ` · ${link} ms a tu repetidor` : ''}</p>
    <div class="actions"><button class="btn primary" data-ok>Listo</button></div></div>`;
  m.querySelector('[data-ok]').addEventListener('click', () => m.remove());
}

function modal(html, { dismissable = true } = {}) {
  const s = document.createElement('div');
  s.className = 'scrim';
  s.innerHTML = `<div class="card modal">${html}</div>`;
  if (dismissable) s.addEventListener('pointerdown', (e) => { if (e.target === s) s.remove(); });
  document.body.append(s);
  return s;
}

function editProfile() {
  const snapshot = JSON.stringify(state.me);
  const s = modal(`<div class="profile-card">${profileFormHTML('m-')}
    <div class="actions"><button class="btn ghost" data-x>Cancelar</button><button class="btn primary" data-ok>Guardar</button></div></div>`);
  bindProfileForm(s, 'm-');
  $('[data-x]', s).addEventListener('click', () => { state.me = JSON.parse(snapshot); s.remove(); });
  $('[data-ok]', s).addEventListener('click', () => {
    readProfileForm(s, 'm-');
    if (!state.me.name) { toast('Tu nombre no puede ir vacío'); return; }
    net.send({ t: 'profile', name: state.me.name, look: state.me.look });
    s.remove();
    audio.sfx.join();
  });
}

function confirmLeave() {
  const s = modal(`<div class="overlay-card">
    ${critter(state.me.look.k, state.me.look.c, 'sleepy')}
    <h2>¿Salir de la sala?</h2>
    <p style="margin:0;color:var(--ink-2);font-weight:600">Tu lugar quedará libre. Si solo quieres cerrar la página, no hace falta: al volver entrarás directo.</p>
    <div class="actions"><button class="btn ghost" data-x>Quedarme</button><button class="btn primary" data-ok>Salir</button></div>
  </div>`);
  $('[data-x]', s).addEventListener('click', () => s.remove());
  $('[data-ok]', s).addEventListener('click', () => {
    s.remove();
    net.leave();
    clearRoomParam();
    audio.sfx.leave();
    renderLobby();
  });
}

async function share() {
  if (!state.room) return;
  const url = `${location.origin}/?s=${state.room}`;
  const text = `Vamos a jugar ♥ sala ${state.room}`;
  audio.sfx.tap();
  if (navigator.share && coarse.matches) {
    try { await navigator.share({ title: 'aquí y allá', text, url }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(url); toast('Invitación copiada ✓'); }
  catch { prompt('Copia este enlace:', url); }
}

/* ───────────── juegos ───────────── */

// cada juego se descarga solo cuando se juega (la carga inicial sigue siendo mínima)
const GAME_MODULES = { gato: () => import('./games/gato.js'), billar: () => import('./games/billar.js') };
const MODE_INFO = {
  gato: [
    { id: 'classic', name: 'Clásico', desc: 'El de toda la vida. Tablero lleno = empate.',
      art: '<svg viewBox="0 0 60 60"><path d="M21 6v48M39 6v48M6 21h48M6 39h48" stroke="#22283F" stroke-width="3.5" stroke-linecap="round"/><path d="M9 9l8 8M17 9l-8 8M43 43l8 8M51 43l-8 8" stroke="#E2553F" stroke-width="4" stroke-linecap="round"/><circle cx="30" cy="30" r="5" fill="none" stroke="#2F7F72" stroke-width="4"/><circle cx="47" cy="13" r="5" fill="none" stroke="#2F7F72" stroke-width="4"/></svg>' },
    { id: 'inf', name: 'Infinito', desc: 'Máximo 3 fichas cada quien: al poner la cuarta se borra la más vieja. Nunca hay empate.',
      art: '<svg viewBox="0 0 60 60"><path d="M21 6v48M39 6v48M6 21h48M6 39h48" stroke="#22283F" stroke-width="3.5" stroke-linecap="round"/><path d="M9 9l8 8M17 9l-8 8" stroke="#E2553F" stroke-width="4" stroke-linecap="round" opacity=".3"/><path d="M26 26l8 8M34 26l-8 8M43 43l8 8M51 43l-8 8" stroke="#E2553F" stroke-width="4" stroke-linecap="round"/><circle cx="47" cy="13" r="5" fill="none" stroke="#2F7F72" stroke-width="4"/></svg>' },
  ],
  billar: [
    { id: '8', name: 'Bola 8', desc: 'Lisas contra rayadas; gana quien mete la 8 al final. Faltas: meter la blanca o tocar primero una bola ajena.',
      art: '<svg viewBox="0 0 60 60"><circle cx="30" cy="30" r="17" fill="#22283F" stroke="#22283F" stroke-width="3"/><circle cx="30" cy="30" r="8" fill="#FFF7EA"/><text x="30" y="34" text-anchor="middle" font-size="11" font-weight="800" fill="#22283F" font-family="system-ui">8</text></svg>' },
  ],
};
let gameHost = null; // { type, api }

function gameCtx() {
  return {
    you: state.you,
    player: (id) => state.players.find((p) => p.id === id) || { name: 'Alguien', look: { k: 'ajolote', c: 0 }, on: false },
    send: (o) => net.send(o),
    rtt: () => net.getRtt(),
    busy: () => net.congested(),
    direct: () => net.isDirect(),
    sfx: audio.sfx,
    toast,
    confetti,
    critter,
    esc,
    confirmQuit,
  };
}

function setGame(g, ev = {}) {
  const had = !!state.game;
  state.game = g;
  net.setLive(!!g);
  if (!g && had && ev.k === 'quit' && ev.by !== state.you) toast(`${nameOf(ev.by)} terminó la partida`);
  if (g && !had && ev.k === 'start' && state.tab === 'chat' && !wide.matches) setTab('room');
  renderGame(ev);
}

async function renderGame(ev = {}) {
  const view = $('#game-view'), roomView = $('#room-view');
  if (!view) return;
  const g = state.game;
  view.hidden = !g;
  roomView.hidden = !!g;
  $('#game-reacts').hidden = !g;
  const label = $('#tab-room-label'); if (label) label.textContent = g ? 'Juego' : 'Sala';
  if (!g) { gameHost?.api?.destroy(); gameHost = null; return; }
  if (!gameHost || gameHost.type !== g.type) {
    gameHost?.api?.destroy();
    const host = { type: g.type, api: null };
    gameHost = host;
    view.innerHTML = '<p class="g-loading">Sacando el tablero…</p>';
    const mod = await GAME_MODULES[g.type]();
    if (gameHost !== host) return; // cambió mientras cargaba
    host.api = mod.mount(view, gameCtx());
    host.api.update(state.game, { k: 'start' });
    return;
  }
  gameHost.api?.update(g, ev);
}

function confirmQuit() {
  const s = modal(`<div class="overlay-card">
    <h2>¿Terminar la partida?</h2>
    <p style="margin:0;color:var(--ink-2);font-weight:600">Los dos regresan a la sala. El marcador se guarda.</p>
    <div class="actions"><button class="btn ghost" data-x>Seguir jugando</button><button class="btn primary" data-ok>Terminar</button></div>
  </div>`);
  $('[data-x]', s).addEventListener('click', () => s.remove());
  $('[data-ok]', s).addEventListener('click', () => { s.remove(); net.send({ t: 'g:quit' }); audio.sfx.leave(); });
}

function openGameSetup(def) {
  const p = partner();
  if (!p) { toast('Primero invita a tu persona a la sala'); return; }
  const modes = MODE_INFO[def.id];
  let mode = localStorage.getItem(net.K + 'mode:' + def.id) || modes[0].id;
  const s = modal(`<div class="setup">
    <div class="setup-head"><div class="setup-art" style="--g:${def.g}">${def.art}</div><div><h2>${def.name}</h2><p>Elige cómo quieren jugar</p></div></div>
    <div class="modes" role="radiogroup">
      ${modes.map((m) => `<button class="mode-card" role="radio" data-mode="${m.id}" aria-checked="${m.id === mode}">
        <span class="mode-art">${m.art}</span><span class="mode-txt"><b>${m.name}</b><small>${m.desc}</small></span></button>`).join('')}
    </div>
    ${p.on ? '' : `<p class="setup-note">${esc(p.name)} no está conectada ahorita; verá la invitación al volver.</p>`}
    <div class="actions"><button class="btn ghost" data-x>Cancelar</button><button class="btn primary" data-ok>Invitar a ${esc(p.name)}</button></div>
  </div>`);
  $('.modes', s).addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]'); if (!b) return;
    mode = b.dataset.mode; audio.sfx.tap();
    $$('.mode-card', s).forEach((x) => x.setAttribute('aria-checked', x.dataset.mode === mode));
  });
  $('[data-x]', s).addEventListener('click', () => s.remove());
  $('[data-ok]', s).addEventListener('click', () => {
    localStorage.setItem(net.K + 'mode:' + def.id, mode);
    if (!net.send({ t: 'g:invite', game: def.id, opts: { mode } })) { toast('Sin conexión… intenta en un momento'); return; }
    s.remove();
    audio.sfx.send();
  });
}

let inviteModal = null;
function renderInvite() {
  const inv = state.invite;
  const banner = $('#invite-banner');
  inviteModal?.remove(); inviteModal = null;
  if (banner) banner.hidden = true;
  if (!inv || state.game) return;
  const def = GAMES.find((x) => x.id === inv.game);
  if (!def) return;
  const modeName = MODE_INFO[inv.game]?.find((m) => m.id === inv.opts?.mode)?.name || '';
  if (inv.from === state.you) {
    const p = partner();
    if (!banner) return;
    banner.hidden = false;
    banner.innerHTML = `<div class="ib-art" style="--g:${def.g}">${def.art}</div>
      <div class="ib-txt"><b>Invitaste a ${esc(p?.name || 'tu persona')}</b><span>${def.name} · ${modeName} · esperando respuesta<span class="dots"><i></i><i></i><i></i></span></span></div>
      <button class="btn ghost small" data-cancel>Cancelar</button>`;
    banner.querySelector('[data-cancel]').addEventListener('click', () => { net.send({ t: 'g:cancel' }); audio.sfx.tap(); });
    return;
  }
  const from = state.players.find((p) => p.id === inv.from);
  inviteModal = modal(`<div class="overlay-card invite-card">
    ${from ? critter(from.look.k, from.look.c, 'bob') : ''}
    <span class="label-chip">invitación</span>
    <h2>${esc(from?.name || 'Alguien')} quiere jugar</h2>
    <div class="invite-game"><span class="ib-art" style="--g:${def.g}">${def.art}</span><span><b>${def.name}</b><small>${modeName}</small></span></div>
    <div class="actions"><button class="btn ghost" data-no>Ahora no</button><button class="btn primary" data-yes>¡Va!</button></div>
  </div>`, { dismissable: false });
  $('[data-no]', inviteModal).addEventListener('click', () => { net.send({ t: 'g:answer', ok: false }); });
  $('[data-yes]', inviteModal).addEventListener('click', () => { net.send({ t: 'g:answer', ok: true }); audio.sfx.join(); });
}

/** confeti de papel: rectangulitos planos que caen girando */
function confetti() {
  const colors = ['#E2553F', '#EDB447', '#6FB3A3', '#F2A3B6', '#8FBDE3', '#A99BD6'];
  for (let i = 0; i < 46; i++) {
    const c = document.createElement('i');
    c.className = 'confetti';
    const w = 6 + Math.random() * 7;
    c.style.cssText = `left:${Math.random() * 100}vw;width:${w}px;height:${(w * (0.5 + Math.random())).toFixed(1)}px;background:${colors[i % colors.length]};--dx:${((Math.random() - 0.5) * 30).toFixed(1)}vw;--r:${Math.round((Math.random() - 0.5) * 1080)}deg;--d:${(1.8 + Math.random() * 1.4).toFixed(2)}s;animation-delay:${(Math.random() * 0.35).toFixed(2)}s`;
    c.addEventListener('animationend', () => c.remove());
    fx.append(c);
  }
}

net.on('g:state', (m) => setGame(m.g, m.ev || {}));
net.on('g:aim', (m) => gameHost?.api?.aim?.(m.a || {}));
net.on('g:invite', (m) => {
  const before = state.invite;
  state.invite = m.inv;
  if (m.inv && m.inv.from !== state.you && !before) { audio.sfx.invite(); navigator.vibrate?.(80); }
  if (!m.inv && m.declined && m.declined !== state.you) toast(`${nameOf(m.declined)} dijo que ahorita no`);
  if (!m.inv && before && before.from !== state.you && !m.declined && !state.game) toast('La invitación se canceló');
  renderInvite();
});

function clearRoomParam() {
  const params = new URLSearchParams(location.search);
  params.delete('s');
  history.replaceState(null, '', params.size ? `?${params}` : location.pathname);
}

/* ───────────── eventos de red ───────────── */

net.on('status', (s) => {
  renderSignal();
  if (s === 'connecting' && state.room) document.body.dataset.net = 'connecting';
  else delete document.body.dataset.net;
});
net.on('rtt', renderSignal);
net.on('direct', renderSignal);

net.on('welcome', (m) => {
  const firstTime = !state.room;
  state.you = m.you;
  state.room = m.room;
  state.players = m.players;
  if (m.reset) state.msgs = m.msgs;
  else {
    const have = new Set(state.msgs.map((q) => q.id));
    for (const q of m.msgs) if (!have.has(q.id)) state.msgs.push(q);
  }
  // retomar el "visto" desde lo que el servidor sabe (por si el último se perdió en un corte)
  state.mySeenSent = m.players.find((p) => p.id === m.you)?.seen || 0;
  if (state.msgs.length) net.setLastId(state.msgs[state.msgs.length - 1].id);
  const params = new URLSearchParams(location.search);
  if (params.get('s') !== m.room) { params.set('s', m.room); history.replaceState(null, '', `?${params}`); }
  const code = $('#room-code'); if (code) code.textContent = m.room;
  renderPostcard(); renderChatHead(); renderAllMsgs();
  maybeSeen();
  state.invite = m.invite;
  renderInvite();
  setGame(m.game, { k: 'welcome' });
  if (firstTime && m.players.length === 1 && !m.msgs.length) toast(`Sala ${m.room} lista. ¡Invita a tu persona!`, 3200);
});

net.on('presence', (m) => {
  const before = partner();
  state.players = m.players;
  const after = partner();
  if (after && (!before || !before.on) && after.on) { audio.sfx.join(); if (before) toast(`${after.name} llegó ♥`); else toast(`${after.name} entró a la sala ♥`); }
  if (before?.on && after && !after.on) { audio.sfx.leave(); state.partnerTyping = false; renderTyping(); }
  if (before && !after) toast(`${before.name} salió de la sala`);
  renderPostcard(); renderChatHead(); renderSeenMark();
  gameHost?.api?.refresh();
});

net.on('chat', ({ m }) => {
  if (state.msgs.some((q) => q.id === m.id)) {
    // confirmación repetida de algo mío: solo quitar el "enviando…"
    if (m.f === state.you) renderAllMsgs();
    return;
  }
  state.msgs.push(m);
  net.setLastId(m.id);
  if (m.f !== state.you) {
    state.partnerTyping = false; renderTyping();
    audio.sfx.receive();
    if (!chatVisible()) { state.unread++; renderBadge(); }
    poke(m.f, 'hop');
  }
  renderAllMsgs();
  maybeSeen();
});

net.on('typing', (m) => {
  state.partnerTyping = !!m.on;
  clearTimeout(state.partnerTypingTimer);
  if (m.on) state.partnerTypingTimer = setTimeout(() => { state.partnerTyping = false; renderTyping(); }, 6000);
  renderTyping();
});

net.on('seen', (m) => {
  const p = state.players.find((q) => q.id === m.f);
  if (p) { p.seen = m.id; renderSeenMark(); }
});

net.on('react', (m) => {
  burst(REACT_EMOJI[m.e] || '❤️', false);
  audio.sfx.react();
  poke(m.f, 'hop');
});

net.on('nudge', (m) => {
  const root = $('.room');
  root?.classList.remove('shake'); void root?.offsetWidth; root?.classList.add('shake');
  navigator.vibrate?.([120, 60, 120]);
  audio.sfx.nudge();
  poke(m.f, 'wiggle');
  toast(`¡${nameOf(m.f)} te mandó un zumbido!`);
});

net.on('err', (m) => {
  const msg = {
    full: 'Esa sala ya tiene a sus dos personas',
    noroom: 'Esa sala no existe (o ya expiró)',
    busy: 'El servidor está ocupado, intenta en un minuto',
  }[m.code] || 'No se pudo entrar a la sala';
  audio.sfx.error();
  clearRoomParam();
  renderLobby();
  toast(msg, 3200);
});

net.on('replaced', () => {
  const s = modal(`<div class="overlay-card">
    ${critter(state.me.look.k, state.me.look.c, 'sleepy')}
    <h2>Abriste la sala en otro lado</h2>
    <p style="margin:0;color:var(--ink-2);font-weight:600">Solo una pestaña puede estar conectada a la vez.</p>
    <button class="btn primary" data-ok>Usar aquí</button></div>`);
  $('[data-ok]', s).addEventListener('click', () => { s.remove(); enterRoom({ room: state.room }); });
});

app.addEventListener('click', onReactClick);
document.addEventListener('visibilitychange', () => { if (!document.hidden) maybeSeen(); });
// refrescar los "hace X min" de vez en cuando
setInterval(() => { if (state.room && partner() && !partner().on) { renderPostcard(); renderChatHead(); } }, 60000);

/* audio: los navegadores exigen un gesto del usuario antes de sonar.
   Safari (iPhone) solo cuenta como gesto el final del toque, no el inicio. */
const unlock = () => audio.unlock();
for (const ev of ['touchend', 'pointerup', 'click', 'keydown']) document.addEventListener(ev, unlock, { passive: true });
document.addEventListener('visibilitychange', () => { if (!document.hidden) audio.resume(); });

/* ───────────── táctil / iPhone ───────────── */

const coarse = matchMedia('(pointer: coarse)');
const editable = (t) => t instanceof Element && !!t.closest('input, textarea, .bubble');

// Safari solo aplica :active en táctil si hay algún listener de touchstart
document.addEventListener('touchstart', () => {}, { passive: true });
// arrastrar el dedo o mantenerlo presionado no debe seleccionar texto ni abrir menús
document.addEventListener('selectstart', (e) => { if (!editable(e.target)) e.preventDefault(); });
document.addEventListener('contextmenu', (e) => { if (!editable(e.target)) e.preventDefault(); });
document.addEventListener('dragstart', (e) => { if (!editable(e.target)) e.preventDefault(); });

// En iOS el teclado no achica la página: tapa la parte de abajo. Hacemos que la
// sala mida exactamente lo visible para que el chat y la caja de texto queden arriba del teclado.
const vv = window.visualViewport;
function fitViewport() {
  if (!vv) return;
  const root = document.documentElement.style;
  root.setProperty('--vv-h', `${Math.round(vv.height)}px`);
  root.setProperty('--vv-top', `${Math.round(vv.offsetTop)}px`);
  const kb = coarse.matches && innerHeight - vv.height > 120;
  const room = $('.room');
  if (room) {
    const was = room.classList.contains('kb');
    room.classList.toggle('kb', kb);
    if (kb && !was) scrollMsgs(true);
  }
}
vv?.addEventListener('resize', fitViewport);
vv?.addEventListener('scroll', fitViewport);
fitViewport();

/* ───────────── arranque ───────────── */

(function boot() {
  const invite = new URLSearchParams(location.search).get('s')?.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6) || null;
  const saved = net.savedSession();
  if (saved && state.me.name && (!invite || invite === saved.room)) {
    state.room = null;
    enterRoom({ room: saved.room });
    return;
  }
  renderLobby(invite && invite.length === 6 ? invite : null);
})();

// guardar la app en el teléfono (sw.js) cuando ya cargó todo, para no competir por la señal
if ('serviceWorker' in navigator && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) {
  addEventListener('load', () => setTimeout(() => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
    // si esta página ya salió de la caché, cargar de una vez los juegos (también de la caché):
    // así, si mientras juegan se publica otra versión, nunca se mezclan archivos de dos versiones
    if (navigator.serviceWorker.controller) for (const load of Object.values(GAME_MODULES)) load().catch(() => {});
  }, 1500));
}
