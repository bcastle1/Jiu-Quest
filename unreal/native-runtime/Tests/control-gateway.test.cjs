'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { ControlGateway, validRequest, ORIGIN, MAX_WIRE } = require('../bridge/control-gateway.cjs');
class Socket extends EventEmitter {
  constructor() { super(); this.readyState = 1; this.bufferedAmount = 0; this.sent = []; }
  send(value) { this.sent.push(value); }
  close() { this.readyState = 3; this.emit('close'); }
  terminate() { this.terminated = true; this.close(); }
  ping() { this.pings = (this.pings || 0) + 1; }
  message(value, binary = false) { this.emit('message', Buffer.isBuffer(value) ? value : Buffer.from(value), binary); }
}
const SECRET = '1'.repeat(64); // Test fixture only; never used by a launcher.
function setup() {
  let time = 0, serial = 0;
  const g = new ControlGateway(SECRET, { clock: () => time, random: n => (++serial).toString(16).padStart(n * 2, '0') });
  const n = new Socket(); g.connect('native', n); n.message('NATIVE\n' + SECRET);
  return { g, n, advance: ms => { time += ms; }, connect() {
    const issued = g.issue(); assert.equal(issued.status, 200);
    const b = new Socket(); g.connect('browser', b); b.message('BROWSER\n' + issued.body.token); return b;
  } };
}
test('request admission binds exact loopback Host, path, role and browser Origin', () => {
  const r = { url: '/browser', method: 'GET', socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:49081', origin: ORIGIN } };
  assert(validRequest(r, 'browser'));
  for (const bad of [undefined, 'null', 'https://evil.test', 'http://127.0.0.1:5178']) assert(!validRequest({ ...r, headers: { ...r.headers, origin: bad } }, 'browser'));
  assert(!validRequest({ ...r, headers: { ...r.headers, host: 'attacker.test:49081' } }, 'browser'));
  assert(!validRequest({ ...r, socket: { remoteAddress: '192.168.1.2' } }, 'browser'));
  assert(!validRequest({ ...r, url: '/browser?token=x' }, 'browser'));
  assert(!validRequest({ ...r, url: '/native' }, 'native'));
  assert(validRequest({ ...r, url: '/native', headers: { host: '127.0.0.1:49081' } }, 'native'));
});
test('no browser bootstrap before native authentication; wrong token cannot become native', () => {
  const g = new ControlGateway(SECRET); assert.equal(g.issue().status, 503);
  const s = new Socket(); g.connect('native', s); s.message('NATIVE\n' + '2'.repeat(64));
  assert.equal(s.readyState, 3); assert.equal(g.native, null);
});
test('owner identity is gateway-generated and raw duplicate-key descriptors are preserved for native strict parser', () => {
  const { g, n, connect } = setup(); const b = connect();
  assert.deepEqual(b.sent, ['READY']); assert.match(n.sent[1], /^ATTACH\n[a-f0-9]{32}$/);
  const raw = '{"type":"configure","type":"evil","peer":"attacker"}'; b.message(raw);
  assert.equal(n.sent[2], `COMMAND\n${g.browser.peer}\n${raw}`);
});
test('native/browser cannot steal existing connections with a second auth attempt', () => {
  const { g, n, connect } = setup(); const b = connect(), native = g.native, browser = g.browser;
  const s = new Socket(); g.connect('native', s); s.message('NATIVE\n' + SECRET);
  assert.equal(s.readyState, 3); assert.equal(g.native, native); assert.equal(g.browser, browser);
  assert.equal(g.issue().status, 409); assert.equal(n.readyState, 1); assert.equal(b.readyState, 1);
});
test('browser token is single-use; retired generation responses never reach new browser', () => {
  const { g, n, connect } = setup(); const first = connect(), old = g.browser.peer;
  first.close(); assert.equal(n.sent.at(-1), `DETACH\n${old}`);
  const second = connect(), current = g.browser.peer; assert.notEqual(current, old);
  n.message(`RESPONSE\n${old}\n{"type":"state"}`); assert.deepEqual(second.sent, ['READY']);
  n.message(`RESPONSE\n${current}\n{"type":"state"}`); assert.equal(second.sent[1], '{"type":"state"}');
});
test('browser token expires and auth handshake deadline is enforced', () => {
  const { g, advance } = setup(); const issued = g.issue(); advance(10001);
  const b = new Socket(); g.connect('browser', b); b.message('BROWSER\n' + issued.body.token); assert.equal(b.readyState, 3);
  const x = new Socket(); g.connect('browser', x); advance(5001); g.tick(); assert.equal(x.readyState, 3);
});
test('native disconnect invalidates browser and pending token; no synthetic ready or automatic reconnect', () => {
  const { g, n, connect } = setup(); const b = connect(); n.close();
  assert.equal(b.readyState, 3); assert.equal(g.issue().status, 503); assert.equal(g.pending, null);
});
for (const [name, payload, binary] of [
  ['binary', '{}', true], ['invalid UTF8', Buffer.from([0xc0, 0xaf]), false],
  ['oversize', 'x'.repeat(MAX_WIRE + 1), false], ['NUL', '{"x":"\0"}', false],
  ['multiplexed control text', 'Multiplexed\nowner\n{}', false], ['second authentication', 'BROWSER\n' + SECRET, false],
]) test(name + ' closes browser and delivers detach to native', () => {
  const { g, n, connect } = setup(); const b = connect(), id = g.browser.peer;
  b.message(payload, binary); assert.equal(b.readyState, 3); assert.equal(n.sent.at(-1), `DETACH\n${id}`);
});
test('bounded rate closes flooding browser and pauses through detach', () => {
  const { g, n, connect } = setup(); const b = connect(), id = g.browser.peer;
  for (let i = 0; i < 40; i++) b.message('{}');
  assert.equal(b.readyState, 3); assert.equal(n.sent.at(-1), `DETACH\n${id}`);
});
test('backpressure failure closes ownership instead of silently dropping control', () => {
  const { g, n, connect } = setup(); const b = connect(); n.bufferedAmount = 40000;
  b.message('{}'); assert.equal(b.readyState, 3); assert.equal(g.native, null);
});
test('response cannot redirect to a case-changed or injected owner', () => {
  const { g, n, connect } = setup(); const b = connect();
  n.message('RESPONSE\n' + 'F'.repeat(32) + '\n{}'); assert.equal(g.native, null); assert.equal(b.readyState, 3);
});
test('lease liveness and shutdown clear all ownership and native secret', () => {
  const { g, n, connect, advance } = setup(); const b = connect(); advance(20001); g.tick();
  assert.equal(n.readyState, 3); assert.equal(b.readyState, 3);
  g.close(); assert.equal(g.nativeToken, ''); assert.equal(g.connections.size, 0); assert.equal(g.issue().status, 503);
});
test('over-capacity and closed-gateway admissions terminate untracked sockets immediately', () => {
  const g = new ControlGateway(SECRET);
  for (let i = 0; i < 4; i++) g.connect('browser', new Socket());
  const extra = new Socket(); assert.equal(g.connect('browser', extra), null);
  assert.equal(extra.terminated, true); assert.equal(g.connections.size, 4);
  g.close(); const late = new Socket(); g.connect('native', late); assert.equal(late.terminated, true);
});
