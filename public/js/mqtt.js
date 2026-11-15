// Cliente MQTT 3.1.1 mínimo sobre WebSocket: solo lo que usa la app
// (conectar con "testamento", publicar QoS 0/1 con retención, suscribirse, ping).
// ~3 KB en vez de los ~100 KB de una librería completa.

const te = new TextEncoder();
const td = new TextDecoder();
const EMPTY = new Uint8Array(0);

function cat(parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
const u16 = (n) => new Uint8Array([n >> 8, n & 255]);
const lp = (b) => cat([u16(b.length), b]);          // bytes con largo de 2 bytes
const str = (s) => lp(te.encode(s));
function packet(header, parts) {
  const body = cat(parts);
  const len = [];
  let n = body.length;
  do { let d = n % 128; n = Math.floor(n / 128); if (n) d |= 128; len.push(d); } while (n);
  return cat([new Uint8Array([header, ...len]), body]);
}

export class Mqtt {
  /**
   * @param {string} url  wss://…
   * @param {{ clientId: string, keepalive?: number, will?: { topic: string, payload?: Uint8Array, retain?: boolean } }} o
   */
  constructor(url, o) {
    this.connected = false;
    this.onconnect = this.onmessage = this.onclose = this.onpong = null;
    this.ids = 0;
    this.acks = new Map();   // packet id -> resolver (PUBACK/SUBACK/UNSUBACK)
    this.buf = EMPTY;
    this.closed = false;
    const ws = new WebSocket(url, ['mqtt']);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      const w = o.will;
      const flags = 0x02 /* sesión limpia */ | (w ? 0x04 | (w.retain ? 0x20 : 0) : 0);
      const parts = [str('MQTT'), new Uint8Array([4, flags]), u16(o.keepalive ?? 60), str(o.clientId)];
      if (w) parts.push(str(w.topic), lp(w.payload ?? EMPTY));
      this.raw(packet(0x10, parts));
    };
    ws.onmessage = (ev) => this.feed(new Uint8Array(ev.data));
    ws.onclose = () => this.down();
    ws.onerror = () => {};
  }

  raw(bytes) {
    if (this.ws.readyState !== 1) return false;
    try { this.ws.send(bytes); return true; } catch { return false; }
  }

  nextId() { this.ids = (this.ids % 65535) + 1; return this.ids; }
  waitAck(id, ms = 8000) {
    return new Promise((res, rej) => {
      const t = setTimeout(() => { this.acks.delete(id); rej(new Error('sin respuesta')); }, ms);
      this.acks.set(id, (err) => { clearTimeout(t); if (err) rej(err); else res(); });
    });
  }
  /** Manda un paquete que espera confirmación; si ni siquiera sale, falla de una vez. */
  rawAck(id, bytes) {
    const p = this.waitAck(id);
    if (!this.raw(bytes)) { const r = this.acks.get(id); this.acks.delete(id); r?.(new Error('sin conexión')); }
    return p;
  }

  /** Publica. Con qos 1 la promesa se cumple cuando el repetidor confirma. */
  publish(topic, payload = EMPTY, { qos = 0, retain = false } = {}) {
    const h = 0x30 | (qos << 1) | (retain ? 1 : 0);
    if (!qos) { this.raw(packet(h, [str(topic), payload])); return Promise.resolve(); }
    const id = this.nextId();
    return this.rawAck(id, packet(h, [str(topic), u16(id), payload]));
  }

  subscribe(topics) {
    const id = this.nextId();
    return this.rawAck(id, packet(0x82, [u16(id), ...topics.flatMap((t) => [str(t), new Uint8Array([0])])]));
  }

  unsubscribe(topics) {
    const id = this.nextId();
    return this.rawAck(id, packet(0xa2, [u16(id), ...topics.map(str)])).catch(() => {});
  }

  ping() { return this.raw(new Uint8Array([0xc0, 0])); }

  /** Salida limpia: el repetidor NO publica el testamento. */
  end() {
    this.raw(new Uint8Array([0xe0, 0]));
    this.kill();
  }
  /** Corte brusco: el repetidor publica el testamento. */
  kill() {
    try { this.ws.close(); } catch {}
    this.down();
  }

  down() {
    if (this.closed) return;
    this.closed = true;
    this.connected = false;
    // lo que esperaba confirmación falla ya (no a los 8 s): nadie se queda colgado de una conexión muerta
    const waiting = [...this.acks.values()];
    this.acks.clear();
    for (const r of waiting) r(new Error('conexión cerrada'));
    this.onclose?.();
  }

  // un mensaje de WebSocket puede traer varios paquetes (o un pedazo)
  feed(chunk) {
    let b = this.buf.length ? cat([this.buf, chunk]) : chunk;
    for (;;) {
      if (b.length < 2) break;
      let len = 0, mult = 1, i = 1, byte;
      do {
        if (i >= b.length) { byte = -1; break; }
        byte = b[i++];
        len += (byte & 127) * mult;
        mult *= 128;
      } while (byte & 128);
      if (byte === -1 || b.length < i + len) break;
      // si quien escucha truena, el resto del búfer debe seguir alineado con los paquetes
      try { this.handle(b[0], b.subarray(i, i + len)); } catch (e) { console.warn(e); }
      b = b.subarray(i + len);
    }
    this.buf = b.length ? b.slice() : EMPTY;
  }

  handle(h, d) {
    switch (h >> 4) {
      case 2: // CONNACK
        if (d[1] === 0) { this.connected = true; this.onconnect?.(); }
        else this.kill();
        return;
      case 3: { // PUBLISH
        const qos = (h >> 1) & 3;
        const tl = (d[0] << 8) | d[1];
        const topic = td.decode(d.subarray(2, 2 + tl));
        let p = 2 + tl;
        if (qos) {
          const id = (d[p] << 8) | d[p + 1];
          p += 2;
          this.raw(new Uint8Array([0x40, 2, id >> 8, id & 255]));
        }
        this.onmessage?.(topic, d.slice(p), !!(h & 1));
        return;
      }
      case 4: case 9: case 11: { // PUBACK, SUBACK, UNSUBACK
        const id = (d[0] << 8) | d[1];
        const r = this.acks.get(id);
        if (!r) return;
        this.acks.delete(id);
        // SUBACK: 0x80 = el repetidor rechazó la suscripción
        r((h >> 4) === 9 && d.subarray(2).includes(0x80) ? new Error('suscripción rechazada') : undefined);
        return;
      }
      case 13: this.onpong?.(); return; // PINGRESP
    }
  }
}

export { EMPTY };
