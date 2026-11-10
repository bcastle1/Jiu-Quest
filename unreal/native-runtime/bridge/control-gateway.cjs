'use strict';
// Local-only candidate. Never logs tokens or message contents; no listener starts on import.
const { randomBytes, timingSafeEqual } = require('node:crypto');
const { TextDecoder } = require('node:util');
const HOST = '127.0.0.1', PORT = 49081, ORIGIN = 'http://127.0.0.1:49080';
const MAX_DESCRIPTOR = 8192, MAX_WIRE = 8300, MAX_BUFFER = 32768;
const hex = (n) => randomBytes(n).toString('hex');
const token = (s) => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
const peer = (s) => typeof s === 'string' && /^[a-f0-9]{32}$/.test(s);
const equal = (a, b) => token(a) && token(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const loopback = (s) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(s);
const descriptor = (s) => typeof s === 'string' && Buffer.byteLength(s, 'utf8') <= MAX_DESCRIPTOR
  && s.length > 1 && s.startsWith('{') && s.endsWith('}') && !s.includes('\0');
function validRequest(req, role) {
  return loopback(req.socket?.remoteAddress) && req.headers.host === `${HOST}:${PORT}`
    && req.url === `/${role}` && req.method === 'GET'
    && (role === 'browser' ? req.headers.origin === ORIGIN
      : (!req.headers.origin || req.headers.origin === 'http://127.0.0.1'));
}
class ControlGateway {
  constructor(nativeToken, { clock = () => Date.now(), random = hex } = {}) {
    if (!token(nativeToken)) throw new TypeError('A fresh native process token is required.');
    this.nativeToken = nativeToken; this.clock = clock; this.random = random;
    this.native = null; this.browser = null; this.pending = null; this.closed = false;
    this.connections = new Set();
  }
  // Called only after exact Host, loopback, POST, Origin and empty-body checks below.
  issue() {
    if (this.closed || !this.native) return { status: 503 };
    if (this.pending && this.pending.expires <= this.clock()) this.pending = null;
    if (this.browser || this.pending) return { status: 409 };
    const value = this.random(32);
    this.pending = { token: value, expires: this.clock() + 10000 };
    return { status: 200, body: { token: value, expiresInMs: 10000 } };
  }
  send(c, value) {
    if (!c || c.closed || c.socket.readyState !== 1 || c.socket.bufferedAmount > MAX_BUFFER) return false;
    try { c.socket.send(value); return true; } catch { return false; }
  }
  connect(role, socket) {
    if (this.closed || !['native', 'browser'].includes(role) || this.connections.size >= 4) {
      if (socket.terminate) socket.terminate(); else socket.close(1008, 'Control unavailable'); return null;
    }
    const c = { role, socket, authenticated: false, closed: false, born: this.clock(),
      count: 0, window: this.clock(), lastPong: this.clock() };
    this.connections.add(c);
    socket.on('message', (data, binary) => this.receive(c, data, binary));
    socket.on('close', () => this.drop(c));
    socket.on('error', () => this.drop(c));
    socket.on('pong', () => { c.lastPong = this.clock(); });
    return c;
  }
  drop(c) {
    if (!c || c.closed) return;
    c.closed = true; this.connections.delete(c);
    if (this.browser === c) {
      this.browser = null; this.pending = null;
      if (this.native && !this.send(this.native, `DETACH\n${c.peer}`)) this.drop(this.native);
    }
    if (this.native === c) {
      this.native = null; this.pending = null;
      if (this.browser) this.drop(this.browser);
    }
    // No accumulating close-handshake sockets after a policy violation.
    try { if (c.socket.terminate) c.socket.terminate(); else c.socket.close(1008, 'Control closed'); } catch { /* already closed */ }
  }
  receive(c, bytes, binary) {
    if (c.closed || this.closed) return;
    let text;
    try {
      if (binary || bytes.byteLength > MAX_WIRE) throw new Error();
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (text.includes('\0')) throw new Error();
    } catch { this.drop(c); return; }
    const now = this.clock();
    if (now - c.window >= 1000) { c.window = now; c.count = 0; }
    if (++c.count > (c.role === 'native' ? 60 : 40)) { this.drop(c); return; }
    if (!c.authenticated) {
      if (now - c.born > 5000) { this.drop(c); return; }
      if (c.role === 'native') {
        if (this.native || !text.startsWith('NATIVE\n') || !equal(text.slice(7), this.nativeToken)) { this.drop(c); return; }
        c.authenticated = true; c.epoch = this.random(16); this.native = c;
        if (!this.send(c, `READY\n${c.epoch}`)) this.drop(c);
      } else {
        if (!this.native || this.browser || !this.pending || this.pending.expires <= now
          || !text.startsWith('BROWSER\n') || !equal(text.slice(8), this.pending.token)) { this.drop(c); return; }
        this.pending = null; c.authenticated = true; c.peer = this.random(16); this.browser = c;
        // Native receives the server-generated identity before any descriptor.
        if (!this.send(this.native, `ATTACH\n${c.peer}`) || !this.send(c, 'READY')) this.drop(c);
      }
      return;
    }
    if (c.role === 'browser') {
      if (c !== this.browser || !descriptor(text) || !this.send(this.native, `COMMAND\n${c.peer}\n${text}`)) this.drop(c);
    } else {
      const parts = text.split('\n');
      const id = parts[1], body = parts.slice(2).join('\n');
      if (c !== this.native || parts[0] !== 'RESPONSE' || !peer(id) || !descriptor(body)) { this.drop(c); return; }
      // A late response for a detached generation is discarded, never retargeted.
      if (this.browser?.peer === id && !this.send(this.browser, body)) this.drop(this.browser);
    }
  }
  tick() {
    const now = this.clock();
    if (this.pending && this.pending.expires <= now) this.pending = null;
    for (const c of [...this.connections]) {
      if ((!c.authenticated && now - c.born > 5000) || now - c.lastPong > 20000) { this.drop(c); continue; }
      try { c.socket.ping(); } catch { this.drop(c); }
    }
  }
  close() {
    this.closed = true; this.pending = null; this.nativeToken = '';
    for (const c of [...this.connections]) this.drop(c);
  }
}
function attach(server, WebSocketServer, nativeToken) {
  const gateway = new ControlGateway(nativeToken);
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_WIRE, perMessageDeflate: false });
  server.on('request', (req, res) => {
    const permitted = loopback(req.socket.remoteAddress) && req.headers.host === `${HOST}:${PORT}`
      && req.url === '/session' && req.headers.origin === ORIGIN && req.method === 'POST'
      && !req.headers['transfer-encoding'] && (!req.headers['content-length'] || req.headers['content-length'] === '0');
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!permitted) { res.writeHead(403); res.end(); return; }
    res.setHeader('Access-Control-Allow-Origin', ORIGIN); res.setHeader('Vary', 'Origin');
    const result = gateway.issue();
    res.writeHead(result.status, { 'Content-Type': 'application/json' });
    res.end(result.body ? JSON.stringify(result.body) : '{}');
  });
  server.on('upgrade', (req, socket, head) => {
    const role = req.url === '/native' ? 'native' : 'browser';
    if (!validRequest(req, role)) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => gateway.connect(role, ws));
  });
  const timer = setInterval(() => gateway.tick(), 5000); timer.unref();
  return { gateway, close: () => { clearInterval(timer); gateway.close(); wss.close(); } };
}
module.exports = { HOST, PORT, ORIGIN, MAX_DESCRIPTOR, MAX_WIRE, ControlGateway, validRequest, attach };
