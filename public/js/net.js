// Conexión resistente para redes móviles, sin servidor propio.
//
// La página vive en GitHub Pages (solo archivos). Para hablar entre los dos teléfonos se usa
// un repetidor MQTT público y gratuito: cada quien se conecta a él por WebSocket y se
// mandan mensajes por "temas" de la sala. Todo va cifrado (AES-GCM) con una clave que sale
// del código de la sala, así que el repetidor solo ve bytes sin sentido.
//
// Alguien tiene que hacer de árbitro (lo que antes hacía el servidor): el navegador
// "líder". Corre room-core.js, guarda el estado de la sala cifrado y retenido en el
// repetidor, y le contesta al otro como si fuera el servidor. Si el líder se va (cierra,
// cambia de app, se queda sin señal), el otro toma el estado guardado y sigue.
//
// Además, igual que antes:
// - Reconecta de inmediato al volver la red, al volver a la app o al cambiar wifi⇄datos.
// - Detecta conexiones "zombis" con ping y las reemplaza.
// - Mensajes de chat en cola (guardada en el teléfono) con id de cliente: se reenvían
//   hasta que el líder los confirma Y el estado que los incluye queda guardado en el
//   repetidor (si el líder cambia antes, se le reenvían al nuevo), y nunca se duplican.
// - Cada turno de líder lleva un número: si dos creen llevar la sala (uno despertó de un
//   sueño del teléfono), vale el turno más nuevo y el otro suelta el suyo sin pisar nada.
// - Identidad por dispositivo: el token se crea aquí, antes del primer "hola".

import { Mqtt, EMPTY } from './mqtt.js';
import { Core, newRoom, loadGames } from './room-core.js';

// ?as=b separa el almacenamiento: útil para probar a dos personas en el mismo navegador
const AS = new URLSearchParams(location.search).get('as')?.replace(/\W/g, '').slice(0, 8);
export const K = AS ? `aya-${AS}:` : 'aya:';

const listeners = new Map();
export function on(type, fn) {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type).add(fn);
  return () => listeners.get(type).delete(fn);
}
function emit(type, data) {
  const set = listeners.get(type);
  if (set) for (const fn of set) fn(data);
}

// repetidores públicos (sin cuenta). Los dos usan el primero que funcione, en el mismo orden.
const BROKERS = (new URLSearchParams(location.search).get('broker') || '').split(',').filter(Boolean).concat([
  // (EMQX es más rápido pero no guarda mensajes retenidos: no sirve para presencias ni estado)
  'wss://test.mosquitto.org:8081/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
]);
const KEEPALIVE = 60;          // s; el repetidor da por muerta la conexión a los ~90 s sin nada
const PING_EVERY = 10_000;     // ping al repetidor (y al líder) para medir latencia y detectar zombis
const PONG_GRACE = 7_000;      // sin respuesta en este tiempo => reconectar
const RESEND_AFTER = 5_000;    // mensajes sin confirmar se reenvían
const BACKOFF = [0, 500, 1000, 2000, 4000, 8000, 15000];
const SETTLE = 500;            // tras suscribirse, cuánto esperar lo retenido (llega justo después)
const HELLO_RETRY = 3500;
const HELLO_FAST = 600;        // margen para un "hola" que se cruzó con el anuncio del líder
// cada guardado sube la sala entera (~6 KB) al repetidor: según qué cambió, se espera más o menos
// para juntar varios cambios en una sola subida
const SAVE_SOON = 350;          // jugadas e invitaciones: que no se pierdan si este teléfono se apaga
const SAVE_LATER = 1500;        // chat, entradas y salidas (los mensajes quedan protegidos hasta guardarse)
const PRES_REFRESH = 50_000;   // la presencia se renueva; si se queda vieja, no cuenta
const PRES_STALE = 150_000;
export const CODE_LEN = 6;
const CODE_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // sin I ni O para no confundir

function randomId(n, abc = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_') {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return [...a].map((b) => abc[b % abc.length]).join('');
}
const TOKEN = localStorage.getItem(K + 'tok') || randomId(22);
localStorage.setItem(K + 'tok', TOKEN);

/* ───────────── cifrado ───────────── */

const te = new TextEncoder(), td = new TextDecoder();
const keyCache = new Map();
/** Clave AES y nombre de los temas, derivados del código (PBKDF2: adivinar códigos sale caro). */
function roomKeys(code) {
  if (!keyCache.has(code)) {
    keyCache.set(code, (async () => {
      const base = await crypto.subtle.importKey('raw', te.encode(code), 'PBKDF2', false, ['deriveBits']);
      const bits = new Uint8Array(await crypto.subtle.deriveBits(
        { name: 'PBKDF2', hash: 'SHA-256', salt: te.encode('aqui-y-alla/sala/v1'), iterations: 150_000 }, base, 384));
      const key = await crypto.subtle.importKey('raw', bits.slice(0, 32), 'AES-GCM', false, ['encrypt', 'decrypt']);
      const id = btoa(String.fromCharCode(...bits.slice(32))).replace(/[+/=]/g, (c) => ({ '+': '-', '/': '_', '=': '' }[c]));
      return { code, key, root: `aya1/${id}` };
    })());
  }
  return keyCache.get(code);
}

const canZip = typeof CompressionStream === 'function';
async function pipe(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}
async function seal(keys, obj, zip) {
  let body = te.encode(JSON.stringify(obj));
  let flag = 0;
  if (zip && canZip) { body = await pipe(body, new CompressionStream('deflate')); flag = 1; }
  const plain = new Uint8Array(body.length + 1);
  plain[0] = flag; plain.set(body, 1);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, keys.key, plain));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv); out.set(ct, 12);
  return out;
}
async function unseal(keys, bytes) {
  try {
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) }, keys.key, bytes.subarray(12)));
    let body = plain.subarray(1);
    if (plain[0] === 1) body = await pipe(body, new DecompressionStream('deflate'));
    return JSON.parse(td.decode(body));
  } catch { return null; } // no es de esta sala o llegó dañado
}

/* ───────────── estado ───────────── */

let mq = null;                 // conexión al repetidor
let conn = null, born = 0;     // id de esta conexión y cuándo nació
let keys = null;               // { code, key, root }
let status = 'off';            // off | connecting | on
let joinReq = null;            // { create, room, profile }
let session = null;            // { room, you }
let epoch = null;              // época del historial que tenemos
let attempt = 0, connGen = 0;
let brokerIdx = 0, brokerFails = 0;
let retryTimer = null, openTimer = null, pingTimer = null, settleTimer = null, helloTimer = null, presTimer = null, saveTimer = null;
let rtt = null;
// latencia al repetidor (promedio móvil, ms). En 3G o con una rayita todo tarda más, así que los
// plazos de espera crecen con ella en vez de cortar conexiones que solo van lentas
let mqRtt = 0;
const slow = (base, k) => Math.min(base + k * mqRtt, 30_000);
function noteMqRtt(ms) { ms = Math.min(ms, 8000); mqRtt = mqRtt ? mqRtt * 0.7 + ms * 0.3 : ms; } // (una página dormida no cuenta como red lenta)
let lastId = 0, lastC = null;  // último mensaje de chat recibido: id y cid (solo en memoria)
let outbox = [];               // [{ cid, x, ts, sent, held? }]  held: el árbitro ya lo aceptó, falta que se guarde (ver ackChats)
let closedOnPurpose = false;
let gen = 0;

let ready = false;             // ya llegó lo retenido tras suscribirse
const pres = new Map();        // conn -> { conn, born, vis, lead, sv, ts }
let leader = null;             // conn de quien lleva la sala
let core = null;               // room-core, solo si yo soy el líder
let leading = false, becoming = false, resigning = false;
let term = null, sv = 0, flushedSv = 0;
let turn = 0, myTurn = 0;      // número del turno de líder más alto que he visto, y el del mío
let deadTerm = null;           // turno mío que otro ya relevó: sus guardados pendientes no deben salir
let sentSv = 0, flushing = null; // versión del estado que ya va en camino al repetidor (y su promesa)
let retained = null, sSubscribed = false, sSettled = false;
const snapWaiters = new Set();
let welcomed = false, helloTries = 0;
let helloAt = 0, helloLead = false; // cuándo salió el último "hola" y si el líder ya se había anunciado
let rehelloTo = null, rehelloAt = 0;
let mqAwait = 0, mqLastPong = 0, pingAwait = 0, pingN = 0, leaderMiss = 0;
let recvQ = Promise.resolve(), sendQ = Promise.resolve();

export const getStatus = () => status;
export const getRtt = () => rtt;
/** La conexión tiene cosas atoradas por salir (señal mala): mejor no mandar lo que no es urgente. */
export const congested = () => (mq?.ws?.bufferedAmount ?? 0) > 2048;
export const getSession = () => session;
/** Lo que todavía no confirma el árbitro (lo que ya aceptó el mío no se muestra como pendiente). */
export const pending = () => outbox.filter((o) => o.held == null).map(({ cid, x, ts }) => ({ cid, x, ts }));

function setStatus(s) {
  if (s === status) return;
  status = s;
  emit('status', s);
}
function setRtt(v) { rtt = v; emit('rtt', v); }

const T = (sub) => `${keys.root}/${sub}`;

/** Publica cifrado, en orden. Con qos 1 la promesa se cumple cuando el repetidor confirma. */
function pubEnc(topic, obj, opts = {}) {
  const c = mq, k = keys;
  if (!c) return Promise.resolve();
  let ack = null;
  const p = sendQ.then(async () => {
    const bytes = await seal(k, obj, opts.zip);
    if (opts.when && !opts.when()) throw new Error('ya no aplica'); // cambió algo mientras se cifraba
    if (c.connected) ack = c.publish(topic, bytes, opts);
    else if (opts.qos) throw new Error('sin conexión');
  });
  // la cola solo cuida el orden de salida. La confirmación se espera aparte: si no, un
  // guardado lento (o de una conexión que ya murió) detiene todo lo que viene detrás
  sendQ = p.catch(() => {});
  return p.then(() => ack);
}

/* ── cola de salida persistente ── */
function outboxKey(room) { return K + 'outbox:' + room; }
function saveOutbox() {
  const room = session?.room ?? joinReq?.room;
  if (!room) return;
  if (outbox.length) localStorage.setItem(outboxKey(room), JSON.stringify(outbox));
  else localStorage.removeItem(outboxKey(room));
}
function loadOutbox(room) {
  try {
    const list = (room && JSON.parse(localStorage.getItem(outboxKey(room)))) || [];
    for (const o of list) delete o.held; // página nueva: todo lo que quedó en cola está por confirmar
    return list;
  } catch { return []; }
}

/** El árbitro ya aceptó estos mensajes míos, pero todavía no están a salvo: solo existen en
    el teléfono del líder hasta que suba el estado al repetidor. Se quedan en la cola (sin
    mostrarse como pendientes) con `held` = la versión del estado que los incluye, y salen
    cuando esa versión queda guardada (settleHeld). Si antes de eso cambia el líder, se le
    reenvían al nuevo (que no los duplica). `hv`: esa versión según el líder, si no soy yo;
    un líder que no la dice (versión vieja) confirma como antes, de inmediato. */
function ackChats(has, hv) {
  const v = leading && core ? sv : hv;
  let changed = false;
  outbox = outbox.filter((o) => {
    if (!has(o.cid)) return true;
    if (v > 0) { if (!o.held) { o.held = v; changed = true; } return true; }
    changed = true;
    return false;
  });
  if (changed) saveOutbox();
}
/** Lo mío que ya quedó guardado en el repetidor (hasta la versión `fv`) sale de la cola. */
function settleHeld(fv) {
  const n = outbox.length;
  outbox = outbox.filter((o) => !(o.held && o.held <= fv));
  if (outbox.length !== n) saveOutbox();
}
/** Cambió el árbitro (o su turno): lo que aceptó el anterior hay que confirmarlo con el nuevo. */
function unhold() {
  for (const o of outbox) if (o.held) o.held = 0;
}
/** Con cada mensaje del árbitro: ¿hasta dónde está guardado el estado? `e`: su sobre, si es otro. */
function settleNow(e) {
  if (leading) { if (core && !resigning) settleHeld(flushedSv); }
  else if (e && e.from === leader && e.fv > 0) settleHeld(e.fv);
}

/* ── copia local del estado de la sala (por si el repetidor la pierde) ── */
const snapKey = (code) => K + 'snap:' + code;
function loadLocalSnap(code) {
  try { return JSON.parse(localStorage.getItem(snapKey(code))); } catch { return null; }
}

function newCode() { return randomId(CODE_LEN, CODE_ABC); }

/** Entra a una sala. `req`: { create: bool, room?: string, profile } */
export function join(req) {
  joinReq = { ...req };
  if (req.create) joinReq.room = newCode();
  const saved = loadSession();
  session = saved && !req.create && saved.room === req.room ? saved : null;
  outbox = req.create ? [] : loadOutbox(req.room);
  lastId = 0; lastC = null; // página nueva o sala nueva: pedir el historial reciente completo
  epoch = null;
  closedOnPurpose = false;
  attempt = 0;
  connect();
}

export function leave() {
  const room = session?.room ?? joinReq?.room;
  const c = mq;
  // avisar que me voy (si soy líder lo proceso yo mismo y dejo el estado guardado)
  if (c?.connected && status === 'on') {
    up({ t: 'leave' });
    const last = leading ? flushRemote() : Promise.resolve();
    leading = false; core = null;
    const tc = keys && T('c/' + conn);
    last.catch(() => {}).finally(() => {
      sendQ.finally(() => { if (tc) c.publish(tc, EMPTY, { retain: true }); c.end(); });
    });
    mq = null; // que teardown no la cierre de golpe
  }
  if (room) {
    localStorage.removeItem(outboxKey(room));
    // ya no soy de esa sala: tampoco me quedo con su copia (si no, al volver a abrir el
    // código de una sala que ya se borró, renacería de esta copia vieja)
    localStorage.removeItem(snapKey(room));
  }
  outbox = [];
  closedOnPurpose = true;
  joinReq = null;
  clearSession();
  teardown();
  setStatus('off');
}

export function send(o) { return status === 'on' && up(o); }

export function chat(text) {
  const cid = randomId(10);
  const now = Date.now();
  outbox.push({ cid, x: text, ts: now, sent: now });
  saveOutbox();
  if (status === 'on') up({ t: 'chat', cid, x: text });
  return cid;
}

export function setLastId(id) { if (id > lastId) lastId = id; }

function loadSession() {
  try { return JSON.parse(localStorage.getItem(K + 'session')); } catch { return null; }
}
export const savedSession = loadSession;
function saveSession() { localStorage.setItem(K + 'session', JSON.stringify(session)); }
function clearSession() {
  localStorage.removeItem(K + 'session');
  session = null;
}

/* ───────────── conexión al repetidor ───────────── */

function teardown(graceful) {
  for (const t of [retryTimer, openTimer, settleTimer, helloTimer, saveTimer]) clearTimeout(t);
  clearInterval(pingTimer); clearInterval(presTimer);
  retryTimer = openTimer = settleTimer = helloTimer = saveTimer = pingTimer = presTimer = null;
  leading = becoming = resigning = false;
  core = null;
  ready = false; welcomed = false; leader = null;
  pres.clear();
  retained = null; sSubscribed = sSettled = false;
  sentSv = 0; flushing = null;
  mqAwait = pingAwait = leaderMiss = 0; // los pings pendientes eran de la conexión anterior
  for (const w of snapWaiters) w();
  snapWaiters.clear();
  if (mq) {
    const c = mq;
    mq = null;
    c.onconnect = c.onmessage = c.onclose = c.onpong = null;
    if (graceful && c.connected) { c.publish(T('c/' + conn), EMPTY, { retain: true }); c.end(); }
    else c.kill();
  }
}

async function connect() {
  teardown();
  if (!joinReq) return;
  setStatus('connecting');
  const my = ++connGen;
  const k = await roomKeys(joinReq.room);
  if (my !== connGen || !joinReq) return;
  keys = k;
  conn = randomId(10);
  born = Date.now();
  const c = new Mqtt(BROKERS[brokerIdx % BROKERS.length], {
    clientId: 'aya_' + conn,
    keepalive: KEEPALIVE,
    // si me caigo sin avisar, el repetidor borra mi presencia por mí
    will: { topic: T('c/' + conn), payload: EMPTY, retain: true },
  });
  mq = c;

  // en redes lentas el handshake tarda: el límite crece con cada intento
  const openTimeout = Math.min(10_000 + attempt * 4000, 30_000);
  const openAt = Date.now();
  openTimer = setTimeout(() => {
    if (c.connected) return;
    // si un repetidor no contesta varias veces seguidas, probamos el siguiente. (Si el reloj
    // sonó tarde es que el teléfono durmió la página a medio intento: eso no cuenta, o cada
    // quien acabaría en un repetidor distinto.)
    const slept = Date.now() - openAt > openTimeout + 2000;
    if (!slept && ++brokerFails >= 3) { brokerIdx++; brokerFails = 0; }
    retry();
  }, openTimeout);

  c.onconnect = async () => {
    clearTimeout(openTimer);
    // abrir (DNS + TLS + WebSocket + CONNECT) son unas 4 idas y vueltas: primera estimación
    noteMqRtt((Date.now() - openAt) / 4);
    brokerFails = 0;
    mqLastPong = Date.now();
    // si la conexión anterior de este dispositivo murió sin avisar, borrar su presencia
    // (se recuerda por pestaña, no por dispositivo: otra pestaña abierta en la misma sala sigue
    // viva, y a esa el líder la reemplaza con aviso cuando llegue mi "hola")
    const prevKey = K + 'conn:' + keys.code;
    let prev = null;
    try { prev = sessionStorage.getItem(prevKey); sessionStorage.setItem(prevKey, conn); } catch {}
    if (prev && prev !== conn) c.publish(T('c/' + prev), EMPTY, { retain: true });
    publishPresence();
    sSubscribed = true;
    try { await c.subscribe([T('c/+'), T('s'), T('to/' + conn)]); } catch { if (mq === c) retry(); return; }
    if (mq !== c) return;
    settleTimer = setTimeout(() => {
      sSettled = true;
      ready = true;
      elect();
    }, SETTLE);
    pingTimer = setInterval(tick, PING_EVERY);
    presTimer = setInterval(publishPresence, PRES_REFRESH);
  };
  c.onpong = () => {
    mqLastPong = Date.now();
    if (mqAwait) { const ms = performance.now() - mqAwait; noteMqRtt(ms); if (leading) setRtt(Math.round(ms)); mqAwait = 0; }
  };
  c.onmessage = (topic, payload) => {
    // descifrar es asíncrono: encadenado para no cambiar el orden de llegada
    recvQ = recvQ.then(() => inbound(c, topic, payload)).catch((e) => console.warn(e));
  };
  c.onclose = () => {
    if (mq !== c) return;
    if (!closedOnPurpose) retry();
  };
}

async function inbound(c, topic, payload) {
  if (mq !== c || !keys || !topic.startsWith(keys.root + '/')) return;
  const sub = topic.slice(keys.root.length + 1);
  if (sub.startsWith('c/')) {
    const id = sub.slice(2);
    const p = payload.length ? await unseal(keys, payload) : null;
    if (mq !== c) return;
    onPresence(id, p);
  } else if (sub === 's') {
    if (!payload.length) { retained = null; return; }
    const s = await unseal(keys, payload);
    if (mq !== c || !sSubscribed) return; // llegó tarde: ya no es de esta conexión o ya no lo sigo
    // (las versiones solo se comparan dentro de un mismo turno de líder; si cambió el turno,
    // lo último que mandó el repetidor es lo que vale)
    if (s && (!retained || s.term !== retained.term || s.sv >= retained.sv)) retained = s;
    if (s?.lt > turn) turn = s.lt;
    for (const w of snapWaiters) w();
  } else if (sub === 'to/' + conn) {
    const e = await unseal(keys, payload);
    if (!e || mq !== c) return;
    if (e.k === 'up') {
      if (!leading || resigning || !core) return;
      if (e.m?.t === 'hello' || core.playerOf(e.from)) { core.message(e.from, e.m); return; }
      // se cree dentro de la sala, pero este árbitro no lo conoce (el turno de líder cambió
      // sin que se enterara): que salude otra vez en lugar de hablarle a la pared
      const t = Date.now();
      if (e.from !== rehelloTo || t - rehelloAt > 1000) {
        rehelloTo = e.from; rehelloAt = t;
        pubEnc(T('to/' + e.from), { k: 'down', from: conn, m: { t: 'rehello' } });
      }
    } else if (e.k === 'down') {
      if (e.from === leader || e.m?.t === 'err') handleDown(e.m, e);
    } else if (e.k === 'kick') onKick(e.code);
  }
}

/* ───────────── presencia y líder ───────────── */

function myPres() {
  // sv: la versión del estado que ya está en el repetidor (o va en camino, si soy quien lo guarda)
  // lt: número de mi turno de líder (o el más alto que he visto, si no llevo la sala)
  return {
    conn, born, vis: !document.hidden, lead: leading && !resigning,
    sv: Math.max(flushedSv, leading ? sentSv : 0), lt: leading ? myTurn : turn, ts: Date.now(),
  };
}
function publishPresence() {
  if (!mq?.connected) return Promise.resolve();
  const p = myPres();
  pres.set(conn, p);
  return pubEnc(T('c/' + conn), p, { retain: true });
}

/** Suelto la sala de golpe y sin guardar: otro ya la lleva con un estado que vale más que el
    mío. (Lo que este turno tuviera a medio subir ya no sale: pisaría lo del nuevo líder.) */
function abdicate() {
  if (leading) { leading = false; core = null; clearTimeout(saveTimer); saveTimer = null; deadTerm = term; }
  welcomed = false;
  publishPresence();
}

function onPresence(id, p) {
  if (!p || p.conn !== id) {
    pres.delete(id);
    // alguien borró mi presencia: me creyeron muerto. Dejo de ser líder (el otro ya tomó el
    // estado) y vuelvo a anunciarme. Si era invitado, el líder también me dio por
    // desconectado: hay que saludarlo otra vez (lo hace elect()).
    if (id === conn && mq?.connected && !closedOnPurpose) abdicate();
    else if (leading && core) core.disconnect(id);
  } else {
    if (id === conn) return; // eco de mi propia presencia
    p.rx = Date.now(); // la vigencia se mide con mi reloj, no con el del otro teléfono
    pres.set(id, p);
    if (p.lt > turn) turn = p.lt;
    // otro tomó la sala después que yo (típico: el teléfono durmió mi página, me dieron por
    // ausente y desperté creyéndome líder). Su estado es el bueno.
    if (leading && p.lead && p.lt > myTurn) abdicate();
  }
  elect();
}

const byBorn = (a, b) => a.born - b.born || (a.conn < b.conn ? -1 : 1);
const byTurn = (a, b) => (b.lt || 0) - (a.lt || 0) || byBorn(a, b);
/** El líder: si hay alguien visible que ya lleva la sala, sigue él (sin traspasos inútiles; si
    dos dicen llevarla, el del turno más reciente); si no, la conexión visible más antigua.
    Si nadie está visible, lo mismo entre todos. */
function computeLeader() {
  const now = Date.now();
  const live = [...pres.values()].filter((p) => p.conn !== conn && now - p.rx < PRES_STALE);
  live.push(myPres());
  const vis = live.filter((p) => p.vis);
  const pool = vis.length ? vis : live;
  const claim = pool.filter((p) => p.lead).sort(byTurn)[0];
  return (claim || pool.sort(byBorn)[0]).conn;
}

function elect() {
  if (!ready || !mq?.connected || becoming || resigning) return;
  const L = computeLeader();
  if (L === conn) {
    leader = conn;
    if (!leading) becomeLeader();
    return;
  }
  if (leading) {
    // otro debe llevar la sala: le dejo el estado guardado (salvo que él ya la lleve con un
    // turno igual o más nuevo que el mío: entonces el suyo es el que vale)
    const other = pres.get(L);
    stepDown(!(other?.lead && (other.lt || 0) >= myTurn));
    return;
  }
  if (sSubscribed && sSettled) {
    // como invitado no necesito bajar cada guardado del estado (ahorra datos)
    sSubscribed = sSettled = false;
    retained = null;
    mq.unsubscribe([T('s')]);
  }
  if (L !== leader) {
    leader = L; welcomed = false; helloTries = 0; helloLead = false;
    clearTimeout(helloTimer); helloTimer = null;
    unhold();
  }
  if (welcomed) return;
  // un solo "hola" a la vez (cada uno le cuesta al líder una bienvenida y un guardado, y los
  // reintentos son los que deciden si el líder murió)
  if (!helloTimer) { sendHello(); return; }
  if (!helloLead && pres.get(L)?.lead) {
    // el líder acaba de anunciarse; antes de eso no podía atender mi "hola". Se repite ya,
    // salvo que haya salido hace nada (quizá sí le llegó): entonces se le da un momento.
    helloLead = true;
    const wait = HELLO_FAST - (Date.now() - helloAt);
    if (wait <= 0) { sendHello(); return; }
    clearTimeout(helloTimer);
    helloTimer = setTimeout(() => { helloTimer = null; if (!welcomed && !leading) sendHello(); }, wait);
  }
}

async function stepDown(flush) {
  if (!leading || resigning) return;
  const c = mq;
  resigning = true;
  clearTimeout(saveTimer); saveTimer = null;
  if (flush) {
    try { await Promise.race([flushRemote(), new Promise((r) => setTimeout(r, 2500))]); } catch {}
    if (mq !== c) return; // se cayó la conexión mientras tanto: ya se limpió todo y esto es de otra
  } else deadTerm = term; // el otro ya la lleva: lo que yo tuviera a medio subir no debe pisar lo suyo
  leading = false; resigning = false; core = null;
  welcomed = false; leader = null;
  await publishPresence().catch(() => {});
  elect();
}

/** Espera el estado guardado en el repetidor con versión ≥ want (o se rinde).
    `again`: pedirlo otra vez aunque ya estemos suscritos, y esperar con más calma. */
async function freshestSnapshot(want, again) {
  const c = mq;
  const have = () => retained && retained.sv >= want;
  if (!sSubscribed || again) {
    // sin suscripción no sé qué hay en el repetidor, y lo que recuerde de antes ya es viejo
    // (otro pudo llevar la sala desde entonces): se pide de nuevo. Al (re)suscribirse el
    // repetidor vuelve a mandar lo retenido.
    if (!sSubscribed) retained = null;
    sSubscribed = true; sSettled = false;
    c.subscribe([T('s')]).catch(() => {});
  }
  if (!have() && !(sSettled && want === 0)) {
    await new Promise((res) => {
      let t = null;
      const done = () => { clearTimeout(t); snapWaiters.delete(check); res(); };
      const check = () => { if (have() || mq !== c) done(); };
      snapWaiters.add(check);
      t = setTimeout(done, again ? 2500 : want ? 3000 : SETTLE + 600);
    });
  }
  // lo que ya llegó por la red pero sigue en fila para descifrarse también cuenta (al
  // despertar la página, los relojes vencidos se adelantan a los mensajes atrasados)
  await recvQ;
  if (mq !== c) return null;
  sSettled = true;
  const local = loadLocalSnap(keys.code);
  let snap = retained;
  // la copia local gana solo si es del mismo turno de líder y más nueva (el repetidor
  // no alcanzó a recibir lo último). Si otro llevó la sala después, gana el repetidor.
  if (local && (!snap || (local.term === snap.term && local.sv > snap.sv))) snap = local;
  return snap;
}

async function becomeLeader() {
  if (becoming || leading) return;
  becoming = true;
  const c = mq;
  try {
    // las reglas del billar se bajan aparte; si la red las tiene atoradas no deben dejar
    // a la sala sin árbitro (siguen bajando por su cuenta)
    await Promise.race([loadGames(), new Promise((r) => setTimeout(r, 4000))]);
    if (mq !== c || !c.connected) return;
    let want = 0;
    for (const p of pres.values()) if (p.conn !== conn) want = Math.max(want, p.sv || 0);
    let snap = await freshestSnapshot(want);
    if (mq !== c || !c.connected) return;
    if (computeLeader() !== conn) return;
    if (!retained && !joinReq.create) {
      // el repetidor no mandó ningún estado. Antes de dar la sala por inexistente, de empezar
      // una vacía encima de la que quizá sí existe, o de fiarme de mi copia local (que es
      // vieja si otro llevó la sala después), se pide otra vez y se espera con calma: hay
      // repetidores que mandan lo retenido un buen rato después de confirmar la suscripción
      snap = await freshestSnapshot(want, true);
      if (mq !== c || !c.connected) return;
      if (computeLeader() !== conn) return;
    }
    let room = snap;
    if (!room) {
      const others = [...pres.values()].some((p) => p.conn !== conn);
      if (!joinReq.create && !session && !others) { fail('noroom'); return; }
      room = newRoom(keys.code);
    }
    term = randomId(6);
    myTurn = turn = Math.max(turn, room.lt || 0) + 1;
    sv = room.sv || 0;
    flushedSv = sentSv = retained?.sv ?? 0;
    latest = null; flushing = null;
    unhold(); // lo que aceptó un árbitro anterior: este dirá si lo tiene
    core = new Core(room, coreOut);
    leading = true;
    // como líder no sigo el estado guardado (lo escribo yo); lo que recuerdo deja de valer
    if (sSubscribed) { sSubscribed = sSettled = false; retained = null; c.unsubscribe([T('s')]); }
    publishPresence();
    leader = conn;
    welcomed = false; helloTries = 0;
    sendHello();
    if (!snap) save(); // que la sala exista en el repetidor desde ya
  } finally {
    becoming = false;
    if (mq === c && c.connected && !leading) elect();
  }
}

/* el room-core del líder habla por aquí */
const coreOut = {
  send(to, o) {
    // copia en el momento: el core sigue mutando su estado (p. ej. room.game en cada jugada) y la
    // interfaz del líder necesita el "antes" intacto para animar el tiro del otro, igual que el
    // otro teléfono, que recibe una copia por la red
    if (to === conn) { const c = structuredClone(o); queueMicrotask(() => handleDown(c)); return; }
    // fv: hasta qué versión está guardado el estado en el repetidor. hv: la versión que incluye
    // (o va a incluir) lo que confirma este mensaje. Con eso el otro sabe cuándo su mensaje
    // de chat ya no depende de que este teléfono siga vivo.
    const e = { k: 'down', from: conn, m: o };
    if (o.t !== 'g:aim') e.fv = flushedSv; // (la puntería va muchas veces por segundo: sin extras)
    if (o.t === 'chat') e.hv = latest && latest.seq >= o.m.id ? sv : sv + 1;
    else if (o.t === 'welcome') e.hv = sv + 1; // tras cada "hola" viene un guardado
    pubEnc(T('to/' + to), e);
  },
  kick(to, code) {
    if (to === conn) queueMicrotask(() => onKick(code));
    else pubEnc(T('to/' + to), { k: 'kick', code });
  },
  save,
  empty() {
    clearTimeout(saveTimer); saveTimer = null;
    latest = null; // la sala ya no existe: que ningún guardado pendiente la reviva
    const c = mq, topic = T('s');
    // por la cola, para que salga después de cualquier guardado que ya iba de camino
    sendQ = sendQ.then(() => { if (c?.connected) c.publish(topic, EMPTY, { retain: true, qos: 1 }).catch(() => {}); });
    localStorage.removeItem(snapKey(keys.code));
  },
};

let latest = null;
/** level: 'soon' | 'later' | 'lazy' (lazy = "visto": se sube con lo siguiente o al salir) */
function save(level = 'later') {
  if (!core) return;
  latest = { ...core.snapshot(), sv: ++sv, term, lt: myTurn };
  try { localStorage.setItem(snapKey(keys.code), JSON.stringify(latest)); } catch {}
  if (level !== 'lazy') scheduleFlush(level === 'soon' ? SAVE_SOON : SAVE_LATER);
}
let saveDue = 0;
/** Sube la sala en `ms`, salvo que ya haya una subida programada antes (esa se lleva lo último). */
function scheduleFlush(ms) {
  const due = Date.now() + ms;
  if (saveTimer && saveDue <= due) return;
  clearTimeout(saveTimer);
  saveDue = due;
  saveTimer = setTimeout(() => { saveTimer = null; flushRemote().catch(() => {}); }, ms);
}
/** Sube el estado al repetidor (si hay algo nuevo). La promesa se cumple cuando lo confirma. */
function flushRemote() {
  clearTimeout(saveTimer); saveTimer = null;
  const s = latest;
  if (!s || !mq?.connected || s.code !== keys?.code || s.sv <= flushedSv) return Promise.resolve();
  if (s.sv <= sentSv && flushing) return flushing; // esa versión ya va en camino
  const c = mq;
  sentSv = s.sv;
  const p = pubEnc(T('s'), s, { retain: true, qos: 1, zip: true, when: () => s.term !== deadTerm }).then(() => {
    if (mq !== c || s.term !== term) return; // confirmación de otra conexión o de un turno anterior
    if (s.sv > flushedSv) flushedSv = s.sv;
    // (si ya estoy entregando el turno no cuenta: el que sigue pudo tomar un estado anterior
    // a este, y entonces mis mensajes se le reenvían)
    if (leading && !resigning) settleHeld(flushedSv);
  }, (e) => {
    if (mq === c && s.term === term) {
      if (sentSv === s.sv) sentSv = flushedSv;
      // no se confirmó pero la conexión sigue: reintentar en un momento (si no, lo último
      // se quedaría solo en este teléfono hasta el siguiente cambio)
      if (leading) scheduleFlush(2000);
    }
    throw e;
  });
  flushing = p;
  return p;
}

/* ───────────── mensajes ───────────── */

/** Manda un mensaje "al servidor": al room-core local si soy líder, o al líder por el repetidor. */
function up(m) {
  if (!mq?.connected) return false;
  if (leading && !resigning && core) { core.message(conn, m); return true; }
  if (!leader || leader === conn) return false;
  pubEnc(T('to/' + leader), { k: 'up', from: conn, m });
  return true;
}

function sendHello() {
  clearTimeout(helloTimer); helloTimer = null;
  if (!joinReq || !mq?.connected) return;
  const p = joinReq.profile;
  helloAt = Date.now();
  helloLead = leading || !!pres.get(leader)?.lead;
  up({
    t: 'hello',
    token: TOKEN,
    gen: Date.now() * 1000 + (++gen % 1000), // el líder ignora "holas" viejos que lleguen tarde
    last: epoch ? lastId : 0,
    lc: epoch && lastId ? lastC ?? undefined : undefined, // para que el líder vea si mi historial es el suyo
    epoch,
    name: p.name, look: p.look,
    away: document.hidden,
  });
  helloTimer = setTimeout(() => {
    helloTimer = null;
    if (welcomed || !mq?.connected || leading) return;
    // el líder no contesta (3 intentos) pero el repetidor sí: lo damos por muerto y borramos su presencia
    if (++helloTries >= 3 && leader && Date.now() - mqLastPong < 25_000) { evict(leader); return; }
    sendHello();
  }, slow(HELLO_RETRY, 4));
}

function evict(id) {
  if (!mq?.connected || id === conn) return;
  helloTries = 0; leaderMiss = 0;
  mq.publish(T('c/' + id), EMPTY, { retain: true });
}

function fail(code) {
  handleDown({ t: 'err', code });
}

/** Llega un mensaje del árbitro. `e`: el sobre en que venía, si el árbitro es otro. */
function handleDown(m, e) {
  if (!m || typeof m.t !== 'string') return;
  if (m.t !== 'welcome') settleNow(e); // (una bienvenida primero vuelve a confirmar lo pendiente)
  if (m.t === 'pong') {
    if (pingAwait) { setRtt(Math.round(performance.now() - pingAwait)); pingAwait = 0; leaderMiss = 0; }
    return;
  }
  if (m.t === 'rehello') {
    // el líder no me tiene registrado: saludar de nuevo (sin repetir un "hola" recién mandado)
    if (!leading && (welcomed || Date.now() - helloAt > 1000)) { welcomed = false; sendHello(); }
    return;
  }
  if (m.t === 'welcome') {
    if (!joinReq) return; // llegó cuando ya había salido de la sala
    welcomed = true; helloTries = 0;
    clearTimeout(helloTimer); helloTimer = null;
    session = { room: m.room, you: m.you };
    joinReq.create = false;
    joinReq.room = m.room;
    epoch = m.epoch;
    saveSession();
    attempt = 0;
    setStatus('on');
    if (m.reset) {
      lastId = 0; lastC = null;
      // mi historial se reemplaza por el del líder: lo mío que no venga ahí vuelve a estar pendiente
      for (const o of outbox) delete o.held;
    } else unhold(); // bienvenida nueva: lo que estaba por guardarse se confirma otra vez con este árbitro
    for (const q of m.msgs) noteMsg(q);
    // lo que el líder ya tiene no hay que reenviarlo
    const mine = new Set(m.msgs.filter((q) => q.f === m.you).map((q) => q.c));
    ackChats((cid) => mine.has(cid), e?.hv);
    settleNow(e);
    saveOutbox();
    emit('welcome', m);
    resendOutbox(true);
    if (!leading) ping(true);
    return;
  }
  if (m.t === 'chat') {
    noteMsg(m.m);
    if (m.m.f === session?.you) { ackChats((cid) => cid === m.m.c, e?.hv); settleNow(e); }
  }
  if (m.t === 'err') {
    closedOnPurpose = true;
    if (m.code === 'noroom' || m.code === 'full') {
      clearSession();
      const room = joinReq?.room; if (room) localStorage.removeItem(outboxKey(room));
      outbox = [];
    }
    joinReq = null;
    teardown(true);
    setStatus('off');
  }
  emit(m.t, m);
}

function onKick(code) {
  if (code === 4002) {
    // el líder tomó mi "hola" por uno viejo, pero esta conexión sigue viva (reloj que se
    // atrasó, etc.): en vez de quedarme apagado sin avisar, empiezo otra conexión
    if (!closedOnPurpose) retry();
    return;
  }
  if (code === 4000) {
    // otra pestaña / otro dispositivo tomó la sesión
    const wasLeading = leading;
    closedOnPurpose = true;
    const done = () => { teardown(true); setStatus('off'); emit('replaced'); };
    if (wasLeading) { resigning = true; Promise.race([flushRemote(), new Promise((r) => setTimeout(r, 2000))]).catch(() => {}).finally(done); }
    else done();
  }
}

function noteMsg(q) {
  if (q && q.id > lastId) { lastId = q.id; lastC = q.c ?? null; }
}

function resendOutbox(all) {
  if (status !== 'on') return;
  const now = Date.now();
  let n = 0;
  for (const o of outbox) {
    if (n >= 6) break;
    if (o.held) continue; // el árbitro actual ya lo tiene; solo falta que se guarde
    if (all || now - o.sent > RESEND_AFTER) {
      o.sent = now;
      up({ t: 'chat', cid: o.cid, x: o.x });
      n++;
    }
  }
}

function tick() {
  ping();
  resendOutbox(false);
  elect(); // por si alguna presencia caducó
}

function ping(force) {
  if (!mq?.connected) return;
  const now = performance.now();
  // al repetidor: siempre (mantiene viva la conexión), es un paquete de 2 bytes
  if (mqAwait && now - mqAwait > slow(PONG_GRACE, 4)) { retry(); return; }
  if (!mqAwait) { mqAwait = now; mq.ping(); }
  // al líder: solo con la app visible (latencia real entre los dos y detectar si se murió)
  if (leading || !welcomed || !leader || (document.hidden && !force)) return;
  if (pingAwait && now - pingAwait > slow(PONG_GRACE, 8)) {
    pingAwait = 0;
    if (++leaderMiss >= 2 && Date.now() - mqLastPong < 25_000) evict(leader);
  }
  if (!pingAwait) { pingAwait = now; up({ t: 'ping', n: ++pingN & 0xffff }); }
}

function retry() {
  teardown();
  if (closedOnPurpose || !joinReq) return;
  setStatus('connecting');
  setRtt(null);
  const base = BACKOFF[Math.min(attempt, BACKOFF.length - 1)];
  const delay = base * (0.8 + Math.random() * 0.4); // con un poco de azar
  attempt++;
  retryTimer = setTimeout(connect, delay);
}

let kickTimer = null;
function kick() {
  // varios eventos llegan juntos (online + focus + visible): los agrupamos
  clearTimeout(kickTimer);
  kickTimer = setTimeout(doKick, 60);
}
function doKick() {
  if (closedOnPurpose || !joinReq) return;
  if (!mq?.connected) {
    // un intento recién abierto merece unos segundos; si estábamos esperando el backoff, ya no
    if (mq && Date.now() - born < 3000) return;
    attempt = 0;
    connect();
    return;
  }
  // la página estuvo dormida más de lo que el repetidor espera sin oírme: ya me dio por
  // muerto, no hace falta sondear
  if (Date.now() - mqLastPong > KEEPALIVE * 1500) { retry(); return; }
  // sondeo rápido: si en 2.5 s el repetidor no contesta, la conexión está muerta (típico al cambiar de red)
  const c = mq;
  mqAwait = performance.now();
  c.ping();
  const probe = mqAwait;
  setTimeout(() => { if (mq === c && mqAwait === probe) retry(); }, slow(2500, 3));
}
window.addEventListener('online', kick);
window.addEventListener('focus', kick);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) kick();
  if (status === 'on') up({ t: 'away', on: document.hidden });
  if (!mq?.connected) return;
  // me voy a segundo plano siendo líder: el estado y el aviso salen ya, uno tras otro y sin
  // esperar confirmaciones (el teléfono puede dormir la página en cualquier momento). Si hay
  // alguien visible, elect() entrega el turno en este mismo instante.
  if (document.hidden && leading) flushRemote().catch(() => {});
  // (la presencia se publica aunque la conexión esté recién abierta y aún no elija líder: si
  // no, el otro se queda con un "visible" o "en segundo plano" que ya no es cierto)
  publishPresence();
  elect();
});
// al cerrar o recargar: lo último ya está en la copia local; el repetidor borra mi presencia solo
window.addEventListener('pagehide', () => { if (leading) flushRemote().catch(() => {}); });
navigator.connection?.addEventListener?.('change', kick);

/** Para depurar desde la consola: (await import('./js/net.js'))._debug() */
export const _debug = () => ({
  conn, born, status, ready, leading, becoming, resigning, leader, welcomed, helloTries,
  broker: BROKERS[brokerIdx % BROKERS.length], connected: !!mq?.connected, sv, sentSv, flushedSv, term, turn, myTurn,
  retainedSv: retained?.sv ?? null, pres: [...pres.values()], outbox: outbox.length,
});
