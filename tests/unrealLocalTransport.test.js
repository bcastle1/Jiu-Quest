import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmbeddedUnrealClient, localMessage, parseLocalMessage, UNREAL_APP_ORIGIN, UNREAL_LOCAL_ORIGIN } from '../src/unreal/localTransport.js';
import { createUnrealBridge } from '../src/unreal/bridge.js';
import { unrealEnvelope } from '../src/unreal/contract.js';
import { localUnrealAllowed, resolveCombatRenderer } from '../src/unreal/renderer.js';

const nonce = '12345678-1234-1234-1234-123456789abc';
function harness() {
  const posted = [], opens = [], videos = [], errors = [];
  const handlers = new Set();
  const frame = { postMessage(message, origin) { posted.push({ message: JSON.parse(message), origin }); } };
  const host = { location: { origin: UNREAL_APP_ORIGIN }, addEventListener(type, callback) { assert.equal(type, 'message'); handlers.add(callback); }, removeEventListener(type, callback) { handlers.delete(callback); } };
  const surface = createEmbeddedUnrealClient({ iframe: { contentWindow: frame }, nonce, hostWindow: host, onOpen: client => opens.push(client), onVideo: value => videos.push(value), onError: message => errors.push(message) });
  const receive = (type, values = {}, override = {}) => { const event = { origin: UNREAL_LOCAL_ORIGIN, source: frame, data: localMessage(nonce, type, values), ...override }; for (const callback of [...handlers]) callback(event); };
  return { posted, opens, videos, errors, surface, receive, handlers, frame, host };
}
const command = (type = 'play', requestId = 'fighter:1:1') => unrealEnvelope('fighter', 'fighter:1', requestId, type, { moveId: 'rear_naked_choke', fighter: {}, opponent: {}, progress: 0, paused: false });

test('Unreal renderer is explicit, development-only, and restricted to the exact app origin', () => {
  const href = UNREAL_APP_ORIGIN + '/?engine=unreal';
  assert.equal(resolveCombatRenderer(href, { development: true, configuredEngine: 'unity' }), 'unreal');
  for (const address of ['https://jiuquest.com', 'http://localhost:5178', 'http://127.0.0.1:5179', 'https://127.0.0.1:5178', 'http://127.0.0.1.evil.test:5178']) {
    assert.equal(localUnrealAllowed(address, true), false);
    assert.equal(resolveCombatRenderer(address + '/?engine=unreal', { development: true, configuredEngine: 'unity' }), 'unity');
  }
  assert.equal(resolveCombatRenderer(href, { development: false, configuredEngine: 'unity' }), 'unity');
  assert.equal(resolveCombatRenderer(UNREAL_APP_ORIGIN, { development: true, configuredEngine: 'unity' }), 'unity');
  assert.equal(resolveCombatRenderer(UNREAL_APP_ORIGIN + '/?engine=snapshot', { development: true, configuredEngine: 'unity' }), 'snapshot');
});

test('proxy rejects wrong nonce, excessive UTF8, malformed payload and unlisted controls', () => {
  assert.equal(parseLocalMessage('{}'), null);
  assert.equal(parseLocalMessage('a'.repeat(24577)), null);
  assert.equal(parseLocalMessage(JSON.stringify({ channel: 'jiuquest.unreal.local', nonce, type: 'error', message: '😀'.repeat(7000) })), null);
  assert.equal(parseLocalMessage(localMessage(nonce, 'connect'), '12345678-0000-0000-0000-123456789abc'), null);
  assert.throws(() => localMessage(nonce, 'command', { command: command('emitCommand') }));
  assert.throws(() => localMessage(nonce, 'video-frame', { frames: 1, width: 960, height: 600, requestId: 'fighter:1:1' }));
  assert.throws(() => localMessage(nonce, 'response', { response: JSON.stringify({ score: 999 }) }));
});

test('only exact iframe source/origin/nonce can open the transport', () => {
  const h = harness(); h.surface.start();
  assert.deepEqual(h.posted[0], { message: { channel: 'jiuquest.unreal.local', nonce, type: 'connect' }, origin: UNREAL_LOCAL_ORIGIN });
  h.receive('transport-open', {}, { origin: 'http://localhost:49080' });
  h.receive('transport-open', {}, { source: {} });
  h.receive('transport-open', {}, { data: localMessage('12345678-0000-0000-0000-123456789abc', 'transport-open') });
  assert.equal(h.opens.length, 0);
  h.receive('transport-open'); h.receive('transport-open'); assert.equal(h.opens.length, 1);
  h.surface.dispose(); assert.equal(h.handlers.size, 0);
});

test('video is accepted only after current play acknowledgement identity, never from a previous clip', () => {
  const h = harness(); const frame = { requestId: 'fighter:1:1', frames: 2, width: 960, height: 600 };
  h.receive('video-frame', frame); assert.equal(h.videos.length, 0);
  h.receive('transport-open'); h.receive('video-frame', frame); assert.equal(h.videos.length, 0);
  assert.equal(h.opens[0].emitUIInteraction(command()), true);
  h.receive('video-frame', frame); assert.equal(h.videos.at(-1).requestId, frame.requestId);
  assert.equal(h.opens[0].emitUIInteraction(command('play', 'fighter:1:2')), true);
  assert.equal(h.videos.at(-1), null);
  h.receive('video-frame', frame); assert.equal(h.videos.at(-1), null);
  h.receive('video-frame', { ...frame, requestId: 'fighter:1:2' }); assert.equal(h.videos.at(-1).requestId, 'fighter:1:2');
  h.receive('transport-closed'); assert.equal(h.videos.at(-1), null);
  h.receive('video-frame', { ...frame, requestId: 'fighter:1:2' }); assert.equal(h.videos.at(-1), null);
  h.surface.dispose();
});

test('proxy and real bridge preserve session isolation, capabilities and paused reconnect', () => {
  const h = harness(), events = [];
  const bridge = createUnrealBridge({ instanceId: 'test', onEvent: event => events.push(event) });
  bridge.setScene({ moveId: 'rear_naked_choke' }); h.receive('transport-open'); bridge.attach(h.opens[0]);
  const setup = h.posted.at(-1).message.command;
  const reply = (type, requestId, values = {}, sessionId = setup.sessionId) => h.receive('response', { response: JSON.stringify(unrealEnvelope('test', sessionId, requestId, type, values)) });
  reply('ready', setup.requestId, { capabilities: { moves: ['standing_stance', 'rear_naked_choke', 'armbar'] } });
  const play = h.posted.at(-1).message.command; assert.equal(play.type, 'play');
  reply('state', play.requestId, { moveId: 'rear_naked_choke', progress: 0.4, playing: true });
  assert.equal(bridge.getState().progress, 0.4);
  h.receive('transport-closed'); assert.equal(bridge.getState().controlsEnabled, false);
  h.receive('transport-open'); bridge.attach(h.opens.at(-1));
  const next = h.posted.at(-1).message.command; assert.notEqual(next.sessionId, setup.sessionId);
  reply('state', play.requestId, { moveId: 'rear_naked_choke', progress: 1, playing: false });
  assert.equal(bridge.getState().progress, 0.4);
  reply('ready', next.requestId, { capabilities: { moves: ['rear_naked_choke'] } }, next.sessionId);
  const resumed = h.posted.at(-1).message.command; assert.equal(resumed.paused, true); assert.equal(resumed.progress, 0.4);
  bridge.setScene({ moveId: 'double_leg' }); assert.equal(bridge.getState().controlsEnabled, false);
  assert.ok(h.posted.some(item => item.message.command?.type === 'pause'));
  bridge.dispose(); h.surface.dispose();
});

test('sanitized command payload drops foreign fields and disposed surfaces reject callbacks', () => {
  const h = harness(); h.receive('transport-open'); const client = h.opens[0];
  client.emitUIInteraction({ ...command(), score: 500, url: 'https://invalid.test', fighter: { name: 'Fighter', giTop: 'url(bad)' } });
  const sent = h.posted.at(-1).message.command;
  assert.equal(sent.score, undefined); assert.equal(sent.url, undefined); assert.equal(sent.fighter.giTop, '#f8fbff');
  h.receive('error', { message: 'Real send rejected' }); assert.equal(client.emitUIInteraction(command()), false); assert.deepEqual(h.errors, ['Real send rejected']);
  h.surface.dispose(); h.receive('transport-open'); assert.equal(h.opens.length, 1); assert.equal(client.emitUIInteraction(command()), false);
});

test('a detached frame throwing during shutdown cannot retain host listeners', () => {
  const h = harness(); h.receive('transport-open');
  h.frame.postMessage = () => { throw new Error('Frame was detached'); };
  assert.doesNotThrow(() => h.surface.dispose()); assert.equal(h.handlers.size, 0);
  assert.equal(h.opens[0].emitUIInteraction(command()), false);
});
