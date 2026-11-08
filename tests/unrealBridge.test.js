import assert from 'node:assert/strict';
import test from 'node:test';
import { createPixelStreamingTransport, createUnrealBridge } from '../src/unreal/bridge.js';
import { boundedUnrealCommand, normalizeUnrealScene, parseUnrealEvent, resolveUnrealMove, unrealEnvelope, UNREAL_MAX_MESSAGE_BYTES } from '../src/unreal/contract.js';

function fakeClient() {
  const sent = [];
  const responses = new Map();
  const events = new Map();
  return {
    sent, responses, events, accepts: true, throws: false,
    emitUIInteraction(value) {
      assert.equal(typeof value, 'object', 'Epic serializes the descriptor once');
      if (this.throws) throw new Error('Data channel closed');
      if (!this.accepts) return false;
      sent.push(structuredClone(value)); return true;
    },
    addResponseEventListener(name, callback) { responses.set(name, callback); },
    removeResponseEventListener(name) { responses.delete(name); },
    addEventListener(type, callback) { events.set(type, callback); },
    removeEventListener(type, callback) { if (events.get(type) === callback) events.delete(type); },
    respond(value) { for (const callback of responses.values()) callback(typeof value === 'string' ? value : JSON.stringify(value)); },
    lose(type = 'webRtcDisconnected') { events.get(type)?.(); },
  };
}
const reply = (command, type, values = {}) => unrealEnvelope(command.instanceId, command.sessionId, command.requestId, type, values);
function fixture() {
  const client = fakeClient();
  const received = [];
  const statuses = [];
  const timers = new Map();
  let timerId = 0;
  const bridge = createUnrealBridge({ instanceId: 'review-player', onEvent: (event) => received.push(event), onStatus: (state) => statuses.push(state),
    setTimer: (callback, delay) => { assert.equal(delay, 15000); timers.set(++timerId, callback); return timerId; },
    clearTimer: (id) => timers.delete(id),
  });
  const attach = () => bridge.attach(client);
  const ready = (moves = ['double_leg', 'triangle_choke']) => client.respond(reply(client.sent.findLast((item) => item.type === 'configure'), 'ready', { capabilities: { moves } }));
  return { client, bridge, received, statuses, timers, attach, ready };
}

test('Unreal uses exact curriculum mappings and keeps cosmetics separate from progress', () => {
  assert.equal(resolveUnrealMove('double-leg-takedown'), 'double_leg');
  for (const move of ['kimura-guard', 'straight-armlock-guard', 'double-underhook-guard-pass', 'constructor']) assert.equal(resolveUnrealMove(move), null);
  const scene = normalizeUnrealScene({ moveId: 'double_leg', performerSide: 'opponent', fighter: {
    name: 'A'.repeat(120), hairStyle: ' Bald ', giTop: 'url(evil)', belt: '#123456', progress: { reps: 99 }, secret: 'private',
  }, fighterBelt: { belt: 'purple', stripes: 0 }, opponent: { name: 'NPC', stripes: 4 } });
  assert.equal(scene.performerSide, 'opponent');
  assert.equal(scene.fighter.name.length, 100);
  assert.equal(scene.fighter.hairStyle, 'bald');
  assert.equal(scene.fighter.belt, '#8b3ffc');
  assert.equal(scene.fighter.stripes, 0);
  assert.equal(scene.opponent.stripes, 4);
  assert.equal(scene.fighter.giTop, '#f8fbff');
  assert.equal('progress' in scene.fighter, false);
  assert.equal('secret' in scene.fighter, false);
  assert.equal(normalizeUnrealScene({ moveId: 'unknown' }), null);
  assert.equal(normalizeUnrealScene({ moveId: 'double_leg', camera: 'javascript:' }), null);
});

test('an open Pixel Streaming transport is not receiver readiness; latest scene waits for exact handshake', () => {
  const { bridge, client, received, attach, ready, timers } = fixture();
  bridge.setScene({ moveId: 'double_leg' }); attach();
  bridge.setScene({ moveId: 'triangle_choke', performerSide: 'opponent', fighter: { name: 'Updated' } }, false);
  assert.equal(bridge.getState().receiverReady, false);
  assert.equal(bridge.command('resume'), null);
  assert.equal(client.sent.length, 1);
  assert.equal(client.sent[0].type, 'configure');
  assert.equal('fighter' in client.sent[0], false);
  ready();
  assert.equal(timers.size, 0);
  assert.equal(bridge.getState().receiverReady, true);
  assert.equal(client.sent.length, 2);
  assert.equal(client.sent[1].moveId, 'triangle_choke');
  assert.equal(client.sent[1].performerSide, 'opponent');
  assert.equal(client.sent[1].fighter.name, 'Updated');
  assert.equal(client.sent[1].paused, true);
  ready();
  assert.equal(client.sent.length, 2);
  assert.equal(received.length, 1);
});

test('capabilities limit playback to actually imported moves and pause a preceding unsupported scene', () => {
  const { bridge, client, attach, ready } = fixture();
  bridge.setScene({ moveId: 'triangle_choke' }); attach(); ready(['double_leg']);
  assert.equal(client.sent.length, 1);
  assert.equal(bridge.getState().controlsEnabled, false);
  assert.equal(bridge.getState().reason, 'unsupported-move');
  assert.equal(bridge.command('resume'), null);
  assert.ok(bridge.setScene({ moveId: 'double_leg' }));
  assert.equal(bridge.setScene({ moveId: 'triangle_choke' }), null);
  assert.equal(client.sent.at(-1).type, 'pause');
  assert.equal(client.sent.at(-1).moveId, 'double_leg');
  assert.equal(bridge.getState().controlsEnabled, false);
});

test('paired playback commands preserve scene identity, appearance and bounded controls', () => {
  const { bridge, client, attach, ready } = fixture();
  bridge.setScene({ moveId: 'double_leg', performerSide: 'opponent', fighter: { name: 'Player' }, opponent: { name: 'NPC' } }); attach(); ready();
  for (const [type, values] of [['setSpeed', { speed: 0.5 }], ['setCamera', { camera: 'overhead' }], ['setViewport', { compactViewport: true }], ['seek', { progress: 0.4 }], ['pause'], ['resume'], ['requestState']]) {
    assert.ok(bridge.command(type, values));
    assert.equal(client.sent.at(-1).type, type);
    assert.equal(client.sent.at(-1).performerSide, 'opponent');
    assert.equal(client.sent.at(-1).fighter.name, 'Player');
    assert.equal(client.sent.at(-1).opponent.name, 'NPC');
  }
  assert.equal(client.sent.at(-1).speed, 0.5);
  assert.equal(client.sent.at(-1).progress, 0.4);
  assert.equal(client.sent.at(-1).camera, 'overhead');
  assert.equal(client.sent.at(-1).compactViewport, true);
  const count = client.sent.length;
  for (const [type, values] of [['awardRep', {}], ['seek', { progress: NaN }], ['seek', { progress: 1.1 }], ['setSpeed', { speed: 2 }], ['setViewport', { compactViewport: 'true' }]]) assert.equal(bridge.command(type, values), null);
  assert.equal(client.sent.length, count);
  bridge.command('reset');
  assert.equal(client.sent.at(-1).progress, 0);
  assert.equal(client.sent.at(-1).paused, true);
});

test('stale requests, sessions, moves and protocols cannot change playback', () => {
  const { bridge, client, received, attach, ready } = fixture();
  bridge.setScene({ moveId: 'double_leg' }); attach(); ready();
  const old = client.sent.at(-1);
  bridge.setScene({ moveId: 'triangle_choke' });
  const command = client.sent.at(-1);
  const valid = reply(command, 'state', { moveId: 'triangle_choke', progress: 0.3, playing: true });
  const count = received.length;
  for (const event of [{ ...valid, requestId: old.requestId }, { ...valid, sessionId: 'prior' }, { ...valid, instanceId: 'other' }, { ...valid, protocolVersion: 2 }, { ...valid, moveId: 'double_leg' }]) client.respond(event);
  assert.equal(received.length, count);
  client.respond(valid);
  assert.equal(bridge.getState().progress, 0.3);
  assert.equal(bridge.getState().playing, true);
});

test('stream loss freezes confirmed progress, gates controls and reconnects paused with a new session', () => {
  const { bridge, client, received, attach, ready } = fixture();
  bridge.setScene({ moveId: 'double_leg' }); attach(); ready();
  const old = client.sent.at(-1);
  const staleListener = [...client.responses.values()][0];
  client.respond(reply(old, 'state', { moveId: 'double_leg', progress: 0.65, playing: true }));
  client.lose();
  assert.equal(bridge.getState().phase, 'offline');
  assert.equal(bridge.getState().progress, 0.65);
  assert.equal(bridge.getState().playing, false);
  assert.equal(bridge.command('resume'), null);
  assert.equal(client.responses.size, 0);
  assert.equal(client.events.size, 0);
  attach(); ready();
  assert.notEqual(client.sent.at(-1).sessionId, old.sessionId);
  assert.equal(client.sent.at(-1).paused, true);
  assert.equal(client.sent.at(-1).progress, 0.65);
  const count = received.length;
  staleListener(JSON.stringify(reply(old, 'completed', { moveId: 'double_leg', progress: 1, playing: false })));
  assert.equal(received.length, count);
  assert.equal(bridge.getState().progress, 0.65);
});

test('every registered stream-loss event invalidates receiver readiness', () => {
  for (const event of ['webRtcDisconnected', 'webRtcFailed', 'streamPreDisconnect', 'streamReconnect']) {
    const { bridge, client, attach, ready } = fixture();
    bridge.setScene({ moveId: 'double_leg' }); attach(); ready(); client.lose(event);
    assert.equal(bridge.getState().receiverReady, false, event);
  }
});

test('missing receiver, rejected sends and receiver errors fail closed without fabricated progress', () => {
  const timeout = fixture(); timeout.attach();
  const deadline = [...timeout.timers.values()][0]; deadline();
  assert.equal(timeout.bridge.getState().reason, 'receiver-timeout');
  assert.equal(timeout.client.responses.size, 0);
  for (const kind of ['accepts', 'throws']) {
    const { bridge, client, attach, timers } = fixture();
    client[kind] = kind === 'throws'; attach();
    assert.equal(bridge.getState().phase, 'offline');
    assert.equal(bridge.getState().progress, 0);
    assert.equal(timers.size, 0);
  }
  const failure = fixture(); failure.attach();
  failure.client.respond(reply(failure.client.sent[0], 'error', { message: 'Receiver assets unavailable' }));
  assert.equal(failure.bridge.getState().reason, 'receiver-error');
  assert.equal(failure.received.at(-1).type, 'error');
});

test('shutdown removes listeners and rejects late replies and all further controls', () => {
  const { bridge, client, received, attach, ready, timers } = fixture();
  bridge.setScene({ moveId: 'double_leg' }); attach(); ready();
  const command = client.sent.at(-1);
  const late = [...client.responses.values()][0];
  bridge.dispose(); bridge.dispose();
  const count = received.length;
  late(JSON.stringify(reply(command, 'completed', { moveId: 'double_leg', progress: 1, playing: false })));
  assert.equal(received.length, count);
  assert.equal(client.responses.size, 0);
  assert.equal(client.events.size, 0);
  assert.equal(timers.size, 0);
  assert.equal(bridge.getState().phase, 'disposed');
  assert.equal(bridge.command('resume'), null);
  assert.equal(bridge.setScene({ moveId: 'double_leg' }), null);
  assert.equal(attach(), null);
});

test('response parsing is bounded and strips gameplay mutations from legitimate playback events', () => {
  const base = unrealEnvelope('player', 'session', 'request', 'state', { moveId: 'double_leg', progress: 0.5, playing: true });
  assert.equal(parseUnrealEvent(JSON.stringify({ ...base, type: 'awardRep' })), null);
  assert.deepEqual(parseUnrealEvent(JSON.stringify({ ...base, points: 100, progressRecords: { reps: 99 }, command: 'saveState' })), base);
  const complete = { ...base, type: 'completed', progress: 1, playing: false };
  assert.deepEqual(parseUnrealEvent(JSON.stringify(complete)), complete);
  for (const value of ['invalid json', 'null', '[]', ' '.repeat(UNREAL_MAX_MESSAGE_BYTES + 1), JSON.stringify({ ...base, unused: '界'.repeat(3000) }), JSON.stringify({ ...complete, playing: true }), JSON.stringify({ ...base, progress: -1 })]) assert.equal(parseUnrealEvent(value), null);
  for (const moves of [['invented'], ['double_leg', 'double_leg'], Array(17).fill('double_leg'), 'all']) {
    assert.equal(parseUnrealEvent(JSON.stringify({ ...base, type: 'ready', capabilities: { moves } })), null);
  }
});

test('transport uses Epic response registration/removal and cannot emit arbitrary console or score commands', () => {
  const client = fakeClient();
  const transport = createPixelStreamingTransport({ pixelStreaming: client, listenerName: 'test', onResponse() {}, onDisconnect() {} });
  const configure = unrealEnvelope('player', 'session', 'setup', 'configure', { ConsoleCommand: 'quit', points: 100 });
  assert.equal(transport.send(configure), true);
  assert.equal('ConsoleCommand' in client.sent[0], false);
  assert.equal('points' in client.sent[0], false);
  assert.throws(() => transport.send({ ...configure, type: 'ConsoleCommand' }), /Invalid Unreal/);
  assert.throws(() => boundedUnrealCommand({ ...configure, instanceId: 'x'.repeat(161) }), /Invalid Unreal/);
  transport.dispose();
  assert.equal(transport.send(configure), false);
  assert.equal(client.responses.size, 0);
  assert.equal(client.events.size, 0);
});
