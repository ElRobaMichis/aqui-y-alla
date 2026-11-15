// Prueba de la lógica de sala (room-core.js), la que corre en el navegador líder.
// Sin red: un "repetidor" falso entrega los mensajes al instante.  node test/core.mjs
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Core, newRoom, loadGames } from '../public/js/room-core.js';

await loadGames();
const tok = () => crypto.randomBytes(16).toString('base64url');

const inbox = new Map();   // conn -> mensajes
const kicked = new Map();  // conn -> código
let saves = 0, emptied = false;
const out = {
  send: (to, o) => { if (!inbox.has(to)) inbox.set(to, []); inbox.get(to).push(structuredClone(o)); },
  kick: (to, code) => kicked.set(to, code),
  save: () => saves++,
  empty: () => { emptied = true; },
};
let core = new Core(newRoom('ABCDEF'), out);

function client(conn) {
  inbox.set(conn, []);
  return {
    conn,
    send: (o) => core.message(conn, structuredClone(o)),
    next(pred) {
      const q = inbox.get(conn);
      const i = q.findIndex(pred);
      if (i < 0) throw new Error(`${conn}: no llegó el mensaje esperado. Tengo: ${q.map((m) => m.t).join(', ')}`);
      return q.splice(i, 1)[0];
    },
    none(pred) { assert.equal(inbox.get(conn).findIndex(pred), -1, `${conn}: llegó algo que no debía`); },
    clear() { inbox.set(conn, []); },
  };
}
const is = (t) => (m) => m.t === t;
const look = { k: 'gato', c: 2 };
let g = 1;
const hello = (o) => ({ t: 'hello', name: 'X', look, gen: g++, ...o });

const TA = tok(), TB = tok();

// 1. A entra (crea la sala)
const a = client('a1');
a.send(hello({ token: TA, name: 'A' }));
const wa = a.next(is('welcome'));
assert.equal(wa.room, 'ABCDEF');
assert.equal(wa.players.length, 1);
console.log('✓ A entra a la sala nueva');

// 2. B entra; se pierde su bienvenida; al reintentar en otra conexión sigue siendo B
const b0 = client('b0');
b0.send(hello({ token: TB, name: 'B' }));
const wb0 = b0.next(is('welcome'));
const b = client('b1');
b.send(hello({ token: TB, name: 'B' }));
const wb = b.next(is('welcome'));
assert.equal(wb.players.length, 2);
assert.equal(wb.you, wb0.you, 'misma identidad');
assert.equal(kicked.get('b0'), 4000, 'la conexión anterior se reemplaza');
console.log('✓ B entró aunque se perdió su primera bienvenida');

// 3. tercera persona rechazada; token inválido rechazado
const c = client('c1');
c.send(hello({ token: tok() }));
assert.equal(c.next(is('err')).code, 'full');
c.send(hello({ token: 'corto' }));
assert.equal(c.next(is('err')).code, 'badtoken');
console.log('✓ sala llena rechaza a un tercero; token inválido rechazado');

// 4. chat ida y vuelta
a.send({ t: 'chat', cid: 'x1', x: 'hola' });
const got = b.next(is('chat'));
assert.equal(got.m.x, 'hola');
a.next(is('chat'));
console.log('✓ chat entregado');

// 5. B se cae (cambio de red); A manda 2 mensajes mientras tanto
core.disconnect('b1');
a.next((m) => m.t === 'presence' && m.players.some((p) => p.id === wb.you && !p.on));
a.send({ t: 'chat', cid: 'x2', x: 'sigues ahí?' });
a.send({ t: 'chat', cid: 'x3', x: '¿?' });
a.next(is('chat')); a.next(is('chat'));
console.log('✓ presencia: B aparece desconectado');

// 6. B vuelve con su época y su último id => recibe solo lo nuevo
const b2 = client('b2');
b2.send(hello({ token: TB, last: got.m.id, epoch: wb.epoch }));
const wb2 = b2.next(is('welcome'));
assert.equal(wb2.you, wb.you, 'misma identidad');
assert.equal(wb2.reset, false);
assert.deepEqual(wb2.msgs.map((m) => m.x), ['sigues ahí?', '¿?']);
console.log('✓ reanudación con historial incremental (2 mensajes)');

// 6b. con otra época se manda el historial completo y la conexión anterior se reemplaza
const bx = client('b3');
bx.send(hello({ token: TB, last: got.m.id, epoch: 'otra' }));
const wbx = bx.next(is('welcome'));
assert.equal(wbx.reset, true);
assert.equal(wbx.msgs.length, 3);
assert.equal(kicked.get('b2'), 4000);
console.log('✓ época distinta => historial completo; la conexión anterior se reemplaza');

// 6c. mismo número pero otro mensaje (historial de un líder que se perdió) => historial completo
const by = client('b3');
by.send(hello({ token: TB, last: got.m.id, lc: 'otro-cid', epoch: wb.epoch }));
assert.equal(by.next(is('welcome')).reset, true);
by.send(hello({ token: TB, last: got.m.id, lc: got.m.c, epoch: wb.epoch }));
const wby = by.next(is('welcome'));
assert.equal(wby.reset, false);
assert.equal(wby.msgs.length, 2);
console.log('✓ último mensaje distinto (cid) => historial completo; si coincide, incremental');

// 7. reenvío del mismo cid no duplica
a.clear();
bx.send({ t: 'chat', cid: 'y1', x: 'aquí' });
const r1 = bx.next(is('chat'));
bx.send({ t: 'chat', cid: 'y1', x: 'aquí' });
const r2 = bx.next(is('chat'));
assert.equal(r1.m.id, r2.m.id);
a.next(is('chat'));
a.none(is('chat'));
console.log('✓ reenvío idempotente (sin duplicados)');

// 8. ping/pong, reacciones, zumbido, visto
bx.send({ t: 'ping', n: 'x'.repeat(5000) });
assert.equal(bx.next(is('pong')).n, 0, 'el pong no repite basura');
bx.send({ t: 'ping', n: 7 });
assert.equal(bx.next(is('pong')).n, 7);
bx.send({ t: 'react', e: 'love' });
assert.equal(a.next(is('react')).e, 'love');
bx.send({ t: 'react', e: '<script>' });
a.none(is('react'));
bx.send({ t: 'nudge' });
a.next(is('nudge'));
bx.send({ t: 'nudge' }); // muy seguido: se ignora
a.none(is('nudge'));
bx.send({ t: 'seen', id: r1.m.id });
assert.equal(a.next(is('seen')).id, r1.m.id);
console.log('✓ ping, reacción, zumbido y visto');

// 9. un "hola" viejo que llega tarde no expulsa a la conexión nueva
const stale = client('old');
stale.send(hello({ token: TB, gen: 0 }));
assert.equal(kicked.get('old'), 4002);
assert.equal(kicked.get('b3'), undefined);
console.log('✓ "hola" atrasado ignorado; la sesión actual sigue viva');

// 10. gato: invitar, aceptar, jugar, jugadas atrasadas, revancha
const B = bx;
a.send({ t: 'g:invite', game: 'gato', opts: { mode: 'classic' } });
assert.equal(B.next(is('g:invite')).inv.game, 'gato');
a.next(is('g:invite'));
B.send({ t: 'g:answer', ok: true });
let st = a.next(is('g:state')).g; B.next(is('g:state'));
B.next((m) => m.t === 'g:invite' && !m.inv);
a.next((m) => m.t === 'g:invite' && !m.inv);
assert.deepEqual(st.seats, [wa.you, wb.you], 'quien invita es X');
const mv = (who, other, cell) => {
  who.send({ t: 'g:move', v: st.v, m: { cell } });
  st = who.next(is('g:state')).g;
  other.next(is('g:state'));
  return st;
};
B.send({ t: 'g:move', v: st.v, m: { cell: 4 } });
assert.equal(B.next(is('g:state')).ev.err, 'turn');
mv(a, B, 0); mv(B, a, 4); mv(a, B, 1); mv(B, a, 8);
a.send({ t: 'g:move', v: st.v - 1, m: { cell: 2 } });
assert.equal(a.next(is('g:state')).ev.err, 'stale');
mv(a, B, 2);
assert.equal(st.round.winner, 0);
assert.deepEqual(st.round.line, [0, 1, 2]);
assert.equal(st.score[wa.you], 1);
console.log('✓ gato clásico: turnos, jugadas atrasadas rechazadas, X gana con la fila de arriba');

B.send({ t: 'g:mode', mode: 'inf' });
st = B.next(is('g:state')).g; a.next(is('g:state'));
a.send({ t: 'g:again' }); st = a.next(is('g:state')).g; B.next(is('g:state'));
assert.deepEqual(st.again, [wa.you]);
B.send({ t: 'g:again' }); st = B.next(is('g:state')).g; a.next(is('g:state'));
assert.equal(st.mode, 'inf');
assert.equal(st.round.turn, 1, 'en la revancha empieza el otro');
for (const [who, other, cell] of [[B, a, 0], [a, B, 3], [B, a, 1], [a, B, 4], [B, a, 6], [a, B, 8]]) mv(who, other, cell);
mv(B, a, 2);
assert.equal(st.round.vanished, 0, 'la ficha más vieja de O desaparece');
assert.equal(st.round.cells[0], -1);
assert.equal(st.round.winner, -1);
console.log('✓ gato infinito: la cuarta ficha borra la más vieja antes de revisar la línea');

// 10a. el líder cambia a mitad de partida: el estado guardado se retoma tal cual
const snap = JSON.parse(JSON.stringify(core.snapshot()));
assert.equal(snap.players[0].conn, undefined, 'lo guardado no lleva conexiones');
core = new Core(snap, out);
const a2 = client('a2'); const B2 = client('b4');
a2.send(hello({ token: TA, last: 0 }));
const wa2 = a2.next(is('welcome'));
assert.deepEqual(wa2.game.round.cells, st.round.cells);
assert.equal(wa2.game.v, st.v);
assert.equal(wa2.players.find((p) => p.id === wb.you).on, false, 'B todavía no saluda al nuevo líder');
B2.send(hello({ token: TB, last: 0 }));
B2.next(is('welcome'));
// el marcador sigue enlazado: una victoria nueva cuenta sobre lo anterior
const prevScore = wa2.game.score[wa.you];
const sA = core.room.game.score;
assert.equal(sA, core.room.scores.gato, 'marcador de la partida = marcador de la sala');
console.log(`✓ traspaso de líder: la partida y el marcador (${prevScore}) se retoman`);

a2.send({ t: 'g:quit' });
assert.equal(B2.next(is('g:state')).g, null);
a2.next(is('g:state'));
console.log('✓ salir de la partida regresa a los dos a la sala');

// 10b. billar: el líder simula el tiro y aplica las reglas; la puntería se retransmite
a2.send({ t: 'g:invite', game: 'billar', opts: { mode: '8' } });
B2.next(is('g:invite')); a2.next(is('g:invite'));
B2.send({ t: 'g:answer', ok: true });
B2.next((m) => m.t === 'g:invite' && !m.inv); a2.next((m) => m.t === 'g:invite' && !m.inv);
st = a2.next(is('g:state')).g; B2.next(is('g:state'));
assert.equal(st.type, 'billar');
assert.equal(st.round.balls.length, 16);
assert.equal(st.round.hand, 'kitchen');
a2.send({ t: 'g:aim', a: { dx: 1, dy: 0, p: 0.4, sx: 0.2, sy: -0.3, junk: 'x'.repeat(100) } });
const aimMsg = B2.next(is('g:aim'));
assert.deepEqual(Object.keys(aimMsg.a).filter((k) => aimMsg.a[k] !== undefined).sort(), ['dx', 'dy', 'p', 'sx', 'sy']);
B2.send({ t: 'g:aim', a: { dx: 1, dy: 0 } }); // no es su turno: no se retransmite
a2.none(is('g:aim'));
a2.send({ t: 'g:move', v: st.v, m: { shot: { dx: 1, dy: 0, power: 1, sx: 0, sy: 0 }, cue: { x: 2, y: 0.6 } } });
assert.equal(a2.next(is('g:state')).ev.err, 'cue', 'en el saque la blanca va detrás de la línea');
const brk = { shot: { dx: 1, dy: 0, power: 1, sx: 0, sy: 0 }, cue: { x: 0.4, y: 0.635 } };
a2.send({ t: 'g:move', v: st.v, m: brk });
const after = B2.next(is('g:state'));
a2.next(is('g:state'));
assert.equal(after.ev.k, 'move');
assert.deepEqual(after.ev.m, brk, 'el otro recibe el tiro para animarlo igual');
assert.equal(after.g.round.isBreak, false);
assert.equal(after.g.round.shots, 1);
a2.send({ t: 'g:quit' }); B2.next(is('g:state')); a2.next(is('g:state'));
console.log('✓ billar: invitación, puntería en vivo, blanca mal colocada rechazada, saque arbitrado');

// 11. salir libera el lugar; cuando se van los dos la sala se borra
B2.send({ t: 'leave' });
a2.next((m) => m.t === 'presence' && m.players.length === 1);
assert.equal(emptied, false);
a2.send({ t: 'leave' });
assert.equal(emptied, true);
assert.ok(saves > 10);
console.log('✓ salir libera el lugar; sala vacía => se borra');

console.log('\nTodo bien ♥');
