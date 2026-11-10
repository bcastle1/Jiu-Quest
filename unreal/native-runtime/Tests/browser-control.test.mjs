import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectControl } from '../bridge/browser-control.mjs';
const fake = () => {
  const events = [], sockets = [];
  class Socket {
    constructor(url) { this.url = url; this.readyState = 1; this.bufferedAmount = 0; this.sent = []; sockets.push(this); }
    send(s) { this.sent.push(s); }
    close() { this.readyState = 3; }
  }
  return { events, sockets, Socket, onOpen: () => events.push('open'), onClose: () => events.push('close'), onResponse: s => events.push(s),
    fetchFn: async (url, init) => { assert.equal(url, 'http://127.0.0.1:49081/session'); assert.equal(init.method, 'POST'); assert.equal(init.credentials, 'omit'); return { ok: true, json: async () => ({ token: 'a'.repeat(64), expiresInMs: 10000 }) }; },
  };
};
test('control open requires authorized READY; raw descriptor and response preserved', async () => {
  const f = fake(), c = connectControl(f); await c.connected;
  const s = f.sockets[0]; assert(!c.isOpen()); s.onopen();
  assert.deepEqual(s.sent, ['BROWSER\n' + 'a'.repeat(64)]);
  s.onmessage({ data: 'READY' }); assert(c.isOpen()); assert.deepEqual(f.events, ['open']);
  assert(c.send('{"type":"configure"}')); assert.equal(s.sent[1], '{"type":"configure"}');
  s.onmessage({ data: '{"type":"state"}' }); assert.equal(f.events[1], '{"type":"state"}');
  c.close(); assert(!c.isOpen()); assert.equal(f.events.at(-1), 'close');
});
test('close during bootstrap cannot create a late active connection', async () => {
  const f = fake(); let resolve;
  f.fetchFn = () => new Promise(r => { resolve = r; });
  const c = connectControl(f); c.close(); resolve({ ok: true }); await c.connected;
  assert.equal(f.sockets.length, 0); assert.deepEqual(f.events, ['close']);
});
test('malformed response and backpressure fail closed without reconnect', async () => {
  const f = fake(), c = connectControl(f); await c.connected;
  const s = f.sockets[0]; s.onopen(); s.onmessage({ data: 'READY' }); s.bufferedAmount = 40000;
  assert(!c.send('{}')); assert.equal(s.readyState, 3); assert.equal(f.sockets.length, 1);
});
test('unsolicited state before READY never reports open', async () => {
  const f = fake(), c = connectControl(f); await c.connected;
  f.sockets[0].onmessage({ data: '{}' }); assert.deepEqual(f.events, ['close']); assert(!c.isOpen());
});
