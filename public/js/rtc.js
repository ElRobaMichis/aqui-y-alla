// Conexión directa entre los dos teléfonos (WebRTC DataChannel), sin servidor propio.
// El repetidor MQTT sirve para presentarlos (oferta/respuesta cifradas con la clave de la
// sala) y sigue siendo el camino seguro: si la conexión directa no se logra (algunas redes
// celulares no la permiten) o se cae, todo sigue por el repetidor como siempre.
//
// Dos canales: "r" confiable y en orden (jugadas, chat…) y "l" sin reenvíos ni orden
// (puntería en vivo y pings: si uno se pierde, el siguiente ya es más nuevo).

const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
const SETUP_TIMEOUT = 8000;
const GATHER_WAIT = 1200;

/** Quita candidatos ".local" (mDNS): entre ciudades no sirven y algunos navegadores piden
 *  permiso de "red local" por ellos. En localhost sí se usan (pruebas con dos pestañas). */
const useful = (cand) => LOCAL || !/\.local\b/.test(cand);
const stripSdp = (sdp) => (LOCAL ? sdp : sdp.split('\r\n').filter((l) => !l.startsWith('a=candidate:') || useful(l)).join('\r\n'));

export const supported = () => typeof RTCPeerConnection === 'function';

export class Peer {
  /**
   * @param {{ initiator: boolean, signal: (msg: object) => void, onmessage: (obj: object, lossy: boolean) => void,
   *           onopen: () => void, onclose: (failed: boolean) => void, ondegraded?: (bad: boolean) => void }} o
   */
  constructor(o) {
    this.o = o;
    this.open = false;
    this.closed = false;
    this.degraded = false;
    this.sentDesc = false;
    this.pendingCands = [];
    const pc = new RTCPeerConnection({ iceServers: ICE });
    this.pc = pc;
    // negociados de antemano (id fijo): no hace falta otra ida y vuelta para abrirlos
    this.r = pc.createDataChannel('r', { negotiated: true, id: 0, ordered: true });
    this.l = pc.createDataChannel('l', { negotiated: true, id: 1, ordered: false, maxRetransmits: 0 });
    let opened = 0;
    const onOpen = () => { if (++opened === 2 && !this.closed) { this.open = true; clearTimeout(this.setupT); this.o.onopen(); } };
    for (const [ch, lossy] of [[this.r, false], [this.l, true]]) {
      ch.onopen = onOpen;
      ch.onclose = () => this.close(!this.open);
      ch.onmessage = (ev) => {
        let obj = null;
        try { obj = JSON.parse(ev.data); } catch {}
        if (obj && !this.closed) this.o.onmessage(obj, lossy);
      };
    }
    pc.onicecandidate = (ev) => {
      // los que salen antes de mandar la oferta/respuesta van dentro de ella
      if (ev.candidate && this.sentDesc && useful(ev.candidate.candidate)) this.o.signal({ t: 'cand', c: ev.candidate.toJSON() });
    };
    pc.oniceconnectionstatechange = () => {
      const s = pc.iceConnectionState;
      if (s === 'failed' || s === 'closed') { this.close(!this.open); return; }
      // "disconnected": puede volver solo, pero mientras tanto lo urgente va por el repetidor;
      // si en 5 s no vuelve, se cierra
      const bad = s === 'disconnected';
      if (bad !== this.degraded) {
        this.degraded = bad;
        this.o.ondegraded?.(bad);
        clearTimeout(this.badT);
        if (bad) this.badT = setTimeout(() => this.close(false), 5000);
      }
    };
    this.setupT = setTimeout(() => this.close(true), SETUP_TIMEOUT);
    if (o.initiator) this.offer();
  }

  async describe(desc) {
    await this.pc.setLocalDescription(desc);
    // esperar a juntar candidatos (o 1.2 s) para mandar todo en un solo mensaje; lo que
    // llegue después se manda suelto
    if (this.pc.iceGatheringState !== 'complete') {
      await new Promise((res) => {
        const t = setTimeout(res, GATHER_WAIT);
        this.pc.addEventListener('icegatheringstatechange', () => { if (this.pc.iceGatheringState === 'complete') { clearTimeout(t); res(); } });
      });
    }
    if (this.closed) return null;
    this.sentDesc = true;
    return stripSdp(this.pc.localDescription.sdp);
  }

  async offer() {
    try {
      const sdp = await this.describe(await this.pc.createOffer());
      if (sdp) this.o.signal({ t: 'offer', sdp });
    } catch { this.close(true); }
  }

  /** Mensaje de señalización del otro lado (oferta, respuesta o candidato). */
  async handle(m) {
    if (this.closed) return;
    try {
      if (m.t === 'offer' || m.t === 'answer') {
        await this.pc.setRemoteDescription({ type: m.t, sdp: m.sdp });
        for (const c of this.pendingCands.splice(0)) await this.pc.addIceCandidate(c).catch(() => {});
        if (m.t === 'offer') {
          const sdp = await this.describe(await this.pc.createAnswer());
          if (sdp) this.o.signal({ t: 'answer', sdp });
        }
      } else if (m.t === 'cand' && m.c) {
        if (this.pc.remoteDescription) await this.pc.addIceCandidate(m.c).catch(() => {});
        else this.pendingCands.push(m.c);
      }
    } catch { this.close(true); }
  }

  /** Confiable y en orden. false si el canal no está listo. */
  send(obj) {
    if (!this.open || this.degraded || this.r.readyState !== 'open') return false;
    try { this.r.send(JSON.stringify(obj)); return true; } catch { return false; }
  }
  /** Sin reenvíos: para lo que se reemplaza solo (puntería, pings). */
  sendLossy(obj) {
    if (!this.open || this.degraded || this.l.readyState !== 'open') return false;
    try { this.l.send(JSON.stringify(obj)); return true; } catch { return false; }
  }
  get usable() { return this.open && !this.degraded && !this.closed; }
  get buffered() { return Math.max(this.r.bufferedAmount || 0, this.l.bufferedAmount || 0); }

  close(failed = false) {
    if (this.closed) return;
    this.closed = true;
    const wasOpen = this.open;
    this.open = false;
    clearTimeout(this.setupT); clearTimeout(this.badT);
    try { this.r.close(); this.l.close(); this.pc.close(); } catch {}
    this.o.onclose(failed && !wasOpen);
  }
}

/**
 * Prueba qué tan "directa" puede ser la red de este teléfono, preguntándole a dos servidores
 * STUN desde el mismo puerto: si los dos ven la misma dirección pública, se puede conectar
 * directo; si ven puertos distintos (NAT simétrico), solo con IPv6 o por el repetidor.
 * @returns {Promise<{ v4: 'directa' | 'simétrica' | 'sin respuesta', v6: boolean, ms: number }>}
 */
export async function probeNat() {
  const t0 = performance.now();
  const servers = ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'];
  const pc = new RTCPeerConnection({ iceServers: servers.map((urls) => ({ urls })) });
  pc.createDataChannel('x');
  const seen = [];
  await new Promise(async (res) => {
    const t = setTimeout(res, 5000);
    pc.onicecandidate = (ev) => {
      if (!ev.candidate) { clearTimeout(t); res(); return; }
      const c = ev.candidate;
      if (c.type === 'srflx') seen.push({ ip: c.address, port: c.port, v6: (c.address || '').includes(':') });
    };
    try { await pc.setLocalDescription(await pc.createOffer()); } catch { res(); }
  });
  pc.close();
  const v4 = seen.filter((s) => !s.v6);
  const v4ports = new Set(v4.map((s) => `${s.ip}:${s.port}`));
  return {
    v4: !v4.length ? 'sin respuesta' : v4ports.size === 1 ? 'directa' : 'simétrica',
    v6: seen.some((s) => s.v6),
    ms: Math.round(performance.now() - t0),
  };
}
