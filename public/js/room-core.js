// Lógica de una sala (antes vivía en un servidor).
// Ahora corre en el navegador de quien "lleva" la sala en ese momento (el líder): el otro
// le manda sus mensajes por el repetidor y el líder contesta igual que lo hacía el servidor.
// Es una máquina de estados pura: no sabe nada de red ni de almacenamiento; para eso
// recibe `out` = { send(conn, msg), kick(conn, code), save(level), empty() }.
// level: 'soon' (chat, jugadas, alguien nuevo), 'later' (lo demás), 'lazy' ("visto": puede esperar).

import * as gato from './games/gato-rules.js';

export const MAX_PLAYERS = 2;
export const MAX_MSGS = 200;     // historial guardado por sala
export const FIRST_BATCH = 80;   // mensajes que se mandan al entrar sin historial
export const MAX_TEXT = 500;
const KINDS = ['ajolote', 'gato', 'conejo', 'oso', 'rana'];
const N_COLORS = 6;
const REACTIONS = new Set(['love', 'haha', 'kiss', 'wow', 'aww', 'fire']);
const TOKEN_RE = /^[\w-]{16,40}$/;

/* ───────────── juegos ─────────────
   Cada juego aporta sus reglas; el líder es el árbitro. El estado lleva una versión `v`:
   cada jugada dice sobre qué versión se hizo, así que jugadas repetidas o atrasadas se
   rechazan y quien las mandó recibe el estado bueno. */
export const GAMES = {
  gato: {
    modes: gato.MODES,
    newRound: (mode, starter) => gato.newRound(mode, starter),
    play: (round, seat, mv) => gato.play(round, seat, mv?.cell),
    isOver: gato.isOver,
  },
};

// el billar y el minigolf traen su motor de física: se cargan aparte, una sola vez
let billarLoad = null, golfLoad = null;
export function loadGames() {
  golfLoad ??= import('./games/golf-rules.js').then((golf) => {
    GAMES.golf = {
      modes: golf.MODES,
      newRound: (mode, starter) => golf.newRound(mode, starter),
      play: (round, seat, mv) => golf.play(round, seat, mv),
      isOver: golf.isOver,
      live: true,
    };
  }).catch((e) => { golfLoad = null; console.warn('minigolf no disponible', e); });
  billarLoad ??= import('./games/billar-rules.js').then((billar) => {
    GAMES.billar = {
      modes: billar.MODES,
      newRound: (mode, starter) => billar.newRound(starter),
      play: (round, seat, mv) => billar.play(round, seat, mv),
      isOver: billar.isOver,
      live: true, // retransmite la puntería en vivo (no se guarda)
    };
  }).catch((e) => { billarLoad = null; console.warn('billar no disponible', e); });
  return Promise.all([billarLoad, golfLoad]);
}

function rid(n = 6) {
  const abc = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_';
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return [...a].map((b) => abc[b & 63]).join('');
}

const cleanName = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 18) || 'Alguien';
function cleanLook(l) {
  const k = KINDS.includes(l?.k) ? l.k : 'ajolote';
  const c = Number.isInteger(l?.c) && l.c >= 0 && l.c < N_COLORS ? l.c : 0;
  return { k, c };
}
const pub = (p) => ({ id: p.id, name: p.name, look: p.look, on: !!p.conn, away: !!p.away, seen: p.seen, last: p.lastSeenAt });

/** Sala vacía. `epoch` identifica su historial (si cambia, el cliente pide todo de nuevo). */
export function newRoom(code, now = Date.now()) {
  return { code, epoch: rid(6), seq: 0, msgs: [], players: [], created: now, touched: now, scores: {}, game: null, invite: null };
}

export class Core {
  /** @param room estado guardado (o newRoom) · @param out salidas */
  constructor(room, out, now = () => Date.now()) {
    this.out = out;
    this.now = now;
    const r = structuredClone(room);
    r.players = (r.players || []).map((p) => ({ ...p, conn: null, away: false }));
    r.scores ??= {};
    // el marcador de la partida es el mismo objeto que el de la sala
    if (r.game && r.scores[r.game.type]) r.game.score = r.scores[r.game.type];
    this.room = r;
  }

  /** Estado para guardar (sin conexiones). */
  snapshot() {
    const r = this.room;
    return {
      code: r.code, epoch: r.epoch, seq: r.seq, created: r.created, touched: r.touched,
      msgs: r.msgs, scores: r.scores, game: r.game, invite: r.invite,
      players: r.players.map((p) => ({ id: p.id, token: p.token, name: p.name, look: p.look, seen: p.seen, lastSeenAt: p.lastSeenAt })),
    };
  }

  playerOf(conn) { return conn ? this.room.players.find((p) => p.conn === conn) : null; }
  send(conn, o) { if (conn) this.out.send(conn, o); }
  bcast(o, except) { for (const p of this.room.players) if (p !== except && p.conn) this.out.send(p.conn, o); }
  presence() { this.bcast({ t: 'presence', players: this.room.players.map(pub) }); }
  save(level) { this.out.save(level); }

  /** Llega un mensaje de una conexión. */
  message(conn, m) {
    if (!m || typeof m.t !== 'string') return;
    if (m.t === 'ping') { this.send(conn, { t: 'pong', n: Number(m.n) | 0 }); return; }
    if (m.t === 'hello') { this.hello(conn, m); return; }
    const me = this.playerOf(conn);
    if (!me) return;
    const room = this.room;
    room.touched = this.now();

    switch (m.t) {
      case 'chat': {
        const x = String(m.x ?? '').trim().slice(0, MAX_TEXT);
        const cid = String(m.cid ?? '').slice(0, 16);
        if (!x) return;
        // reenvío tras reconexión: no duplicar
        const dup = cid && room.msgs.find((q) => q.f === me.id && q.c === cid);
        if (dup) { this.send(conn, { t: 'chat', m: dup }); return; }
        const msg = { id: ++room.seq, f: me.id, x, ts: this.now(), c: cid };
        room.msgs.push(msg);
        if (room.msgs.length > MAX_MSGS) room.msgs.splice(0, room.msgs.length - MAX_MSGS);
        this.bcast({ t: 'chat', m: msg });
        this.save('soon');
        return;
      }
      case 'typing':
        this.bcast({ t: 'typing', f: me.id, on: !!m.on }, me);
        return;
      case 'react':
        if (!REACTIONS.has(m.e)) return;
        this.bcast({ t: 'react', f: me.id, e: m.e }, me);
        return;
      case 'nudge': {
        const now = this.now();
        if (now - (me.nudgedAt || 0) < 2500) return;
        me.nudgedAt = now;
        this.bcast({ t: 'nudge', f: me.id }, me);
        return;
      }
      case 'seen': {
        const id = Math.min(Number(m.id) || 0, room.seq);
        if (id > (me.seen || 0)) {
          me.seen = id;
          this.bcast({ t: 'seen', f: me.id, id }, me);
          this.save('lazy');
        }
        return;
      }
      case 'away':
        me.away = !!m.on;
        this.presence();
        return;
      case 'profile':
        me.name = cleanName(m.name);
        me.look = cleanLook(m.look);
        this.presence();
        this.save();
        return;
      case 'g:invite': case 'g:cancel': case 'g:answer': case 'g:move':
      case 'g:again': case 'g:mode': case 'g:quit': case 'g:aim':
        this.game(me, conn, m);
        return;
      case 'leave':
        if (room.game?.seats.includes(me.id)) { room.game = null; this.bcast({ t: 'g:state', g: null, ev: { k: 'quit', by: me.id } }, me); }
        if (room.invite?.from === me.id) { room.invite = null; this.bcast({ t: 'g:invite', inv: null }, me); }
        room.players = room.players.filter((p) => p !== me);
        me.conn = null;
        this.presence();
        if (!room.players.length) this.out.empty();
        else this.save();
        return;
    }
  }

  hello(conn, m) {
    const room = this.room;
    // el token lo genera el dispositivo antes del primer "hola": si se pierde la
    // bienvenida por un corte, al reintentar se reconoce a la misma persona
    const token = typeof m.token === 'string' && TOKEN_RE.test(m.token) ? m.token : null;
    if (!token) { this.send(conn, { t: 'err', code: 'badtoken' }); return; }
    const now = this.now();
    const gen = Number(m.gen) || 0;
    let p = room.players.find((q) => q.token === token);
    if (p) {
      // un "hola" viejo que llegó tarde (de una conexión ya abandonada): se ignora
      if (p.conn && p.conn !== conn && gen < (p.gen || 0)) { this.out.kick(conn, 4002); return; }
      // misma persona en una conexión nueva (cambio de red, otra pestaña…)
      if (p.conn && p.conn !== conn) this.out.kick(p.conn, 4000);
    } else {
      if (room.players.length >= MAX_PLAYERS) { this.send(conn, { t: 'err', code: 'full' }); return; }
      p = { id: rid(5), token, seen: 0, lastSeenAt: now };
      room.players.push(p);
    }
    const name = cleanName(m.name), look = cleanLook(m.look);
    // alguien que solo se reconecta (mismo nombre y personaje) no cambia nada que valga una
    // subida de la sala entera: se guarda con lo siguiente
    const changed = !p.name || p.name !== name || JSON.stringify(p.look) !== JSON.stringify(look);
    p.name = name;
    p.look = look;
    p.conn = conn;
    p.gen = gen;
    p.away = !!m.away;
    p.lastSeenAt = now;
    room.touched = now;

    // historial incremental: solo lo que el cliente no tiene, y solo si su historial
    // es de esta misma sala/época. Si además dice cuál es su último mensaje (`lc`, el cid),
    // tiene que ser el mismo que aquí lleva ese número: tras un cambio de líder a destiempo
    // el número puede coincidir con otro mensaje, y entonces se le manda todo de nuevo.
    const last = Number(m.last) || 0;
    const incremental = m.epoch === room.epoch && last > 0 && last <= room.seq
      && (m.lc == null || room.msgs.find((q) => q.id === last)?.c === m.lc);
    const msgs = incremental ? room.msgs.filter((q) => q.id > last) : room.msgs.slice(-FIRST_BATCH);

    this.send(conn, {
      t: 'welcome', you: p.id, room: room.code, seq: room.seq, epoch: room.epoch,
      players: room.players.map(pub), msgs, reset: !incremental,
      game: room.game ?? null, invite: room.invite ?? null,
      ...(changed ? {} : { ns: 1 }), // ns: este "hola" no provoca guardado (ver net.js, hv)
    });
    this.presence();
    this.save(changed ? 'soon' : 'lazy');
  }

  /** Se cayó una conexión (dejó de estar en el repetidor). */
  disconnect(conn) {
    const me = this.playerOf(conn);
    if (!me) return;
    me.conn = null;
    me.away = false;
    me.lastSeenAt = this.now();
    this.bcast({ t: 'typing', f: me.id, on: false });
    this.presence();
    this.save();
  }

  /* ───────────── juegos ───────────── */
  game(me, conn, m) {
    const room = this.room;
    const g = room.game;
    const sync = (err) => this.send(conn, { t: 'g:state', g: room.game ?? null, ev: { k: 'sync', err } });
    const push = (ev) => { this.bcast({ t: 'g:state', g: room.game, ev }); this.save('soon'); };

    switch (m.t) {
      case 'g:invite': {
        const G = GAMES[m.game];
        if (!G) return;
        if (g) { sync('busy'); return; }
        const mode = G.modes.includes(m.opts?.mode) ? m.opts.mode : G.modes[0];
        room.invite = { from: me.id, game: m.game, opts: { mode }, ts: this.now() };
        this.bcast({ t: 'g:invite', inv: room.invite });
        this.save();
        return;
      }
      case 'g:cancel':
        if (room.invite?.from !== me.id) return;
        room.invite = null;
        this.bcast({ t: 'g:invite', inv: null });
        this.save();
        return;
      case 'g:answer': {
        const inv = room.invite;
        if (!inv || inv.from === me.id) return;
        room.invite = null;
        if (!m.ok) { this.bcast({ t: 'g:invite', inv: null, declined: me.id }); this.save(); return; }
        const G = GAMES[inv.game];
        if (!G) { this.bcast({ t: 'g:invite', inv: null }); this.save(); return; }
        const score = (room.scores[inv.game] ??= { d: 0 });
        // quien invitó empieza; después se alternan
        room.game = { type: inv.game, v: 1, mode: inv.opts.mode, seats: [inv.from, me.id], round: G.newRound(inv.opts.mode, 0), again: [], score };
        // primero la partida y luego quitar la invitación (si no, parece que se canceló)
        push({ k: 'start' });
        this.bcast({ t: 'g:invite', inv: null });
        return;
      }
    }

    if (!g) { sync(); return; }
    const seat = g.seats.indexOf(me.id);
    if (seat < 0) return;
    const G = GAMES[g.type];
    if (!G) { sync('loading'); return; }

    switch (m.t) {
      case 'g:aim': {
        // puntería en vivo: solo se reenvía al otro, sin guardar nada
        if (!G.live || g.round.turn !== seat) return;
        const a = m.a || {};
        const num = (v) => (Number.isFinite(v) ? Math.round(v * 1e4) / 1e4 : undefined);
        this.bcast({ t: 'g:aim', a: { dx: num(a.dx), dy: num(a.dy), p: num(a.p), sx: num(a.sx), sy: num(a.sy), cx: num(a.cx), cy: num(a.cy) } }, me);
        return;
      }
      case 'g:move': {
        if (m.v !== g.v) { sync('stale'); return; }
        const res = G.play(g.round, seat, m.m);
        if (!res.ok) { sync(res.err); return; }
        g.round = res.round;
        g.v++;
        if (G.isOver(g.round)) {
          const w = g.round.winner;
          if (w >= 0) g.score[g.seats[w]] = (g.score[g.seats[w]] || 0) + 1;
          else g.score.d = (g.score.d || 0) + 1;
        }
        push({ k: 'move', by: me.id, m: m.m });
        return;
      }
      case 'g:mode':
        // cambiar de modo solo entre rondas
        if (!G.isOver(g.round) || !G.modes.includes(m.mode) || m.mode === g.mode) return;
        g.mode = m.mode;
        g.again = [];
        g.v++;
        push({ k: 'mode', by: me.id });
        return;
      case 'g:again':
        if (!G.isOver(g.round)) return;
        if (!g.again.includes(me.id)) g.again.push(me.id);
        if (g.again.length >= 2) {
          g.round = G.newRound(g.mode, 1 - g.round.starter);
          g.again = [];
          g.v++;
          push({ k: 'round' });
        } else {
          g.v++;
          push({ k: 'again', by: me.id });
        }
        return;
      case 'g:quit':
        room.game = null;
        this.bcast({ t: 'g:state', g: null, ev: { k: 'quit', by: me.id } });
        this.save('soon');
        return;
    }
  }
}
