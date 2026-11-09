import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalUnrealSession } from '../src/unreal/localSession.js';
import { localMessage, UNREAL_APP_ORIGIN, UNREAL_LOCAL_ORIGIN } from '../src/unreal/localTransport.js';
import { unrealEnvelope } from '../src/unreal/contract.js';

function harness() {
  const listeners = new Set(), timers = new Map(), changes = []; let nextTimer = 0;
  const hostWindow = { location: { origin: UNREAL_APP_ORIGIN }, addEventListener(_type, callback) { listeners.add(callback); }, removeEventListener(_type, callback) { listeners.delete(callback); } };
  const session = createLocalUnrealSession({ instanceId: 'local', hostWindow, onChange: state => changes.push(state), setTimer: (callback, ms) => { const id = ++nextTimer; timers.set(id, { callback, ms }); return id; }, clearTimer: id => timers.delete(id) });
  const frame = digit => {
    const nonce = `12345678-1234-1234-1234-123456789ab${digit}`, messages = [];
    const window = { postMessage(json) { messages.push(JSON.parse(json)); } };
    const emit = (type, values = {}) => { for (const callback of [...listeners]) callback({ origin: UNREAL_LOCAL_ORIGIN, source: window, data: localMessage(nonce, type, values) }); };
    const reply = (command, type, values) => emit('response', { response: JSON.stringify(unrealEnvelope(command.instanceId, command.sessionId, command.requestId, type, values)) });
    const latest = () => messages.filter(message => message.type === 'command').at(-1).command;
    const open = (moves = ['standing_stance', 'rear_naked_choke']) => { emit('transport-open'); reply(latest(), 'ready', { capabilities: { moves } }); return latest(); };
    const presented = command => { reply(command, 'state', { moveId: command.moveId, progress: command.progress, playing: !command.paused }); emit('video-frame', { requestId: command.requestId, frames: 2, width: 960, height: 600 }); };
    return { nonce, iframe: { contentWindow: window }, emit, reply, latest, open, presented, messages };
  };
  return { session, frame, timers, changes, listeners };
}

test('manual iframe Retry retains confirmed progress, uses a fresh session and waits for newly presented video', () => {
  const h = harness(), first = h.frame('a');
  h.session.setScene({ moveId: 'rear_naked_choke' }, true);
  const unbind = h.session.bind(first.iframe, first.nonce), play = first.open();
  assert.equal(play.paused, false); assert.equal(h.session.getState().ready, false);
  assert.equal(h.session.command('resume'), null);
  first.reply(play, 'state', { moveId: play.moveId, progress: 0.37, playing: true });
  assert.equal(h.session.getState().ready, false);
  first.emit('video-frame', { requestId: play.requestId, frames: 2, width: 960, height: 600 });
  assert.equal(h.session.getState().ready, true);
  unbind(); assert.equal(h.session.getState().progress, 0.37); assert.equal(h.session.getState().playing, false);
  const retry = h.frame('b'); h.session.bind(retry.iframe, retry.nonce); const resumed = retry.open();
  assert.notEqual(resumed.sessionId, play.sessionId); assert.equal(resumed.progress, 0.37); assert.equal(resumed.paused, true);
  first.presented(play); assert.equal(h.session.getState().ready, false); assert.equal(h.session.getState().progress, 0.37);
  retry.presented(resumed); assert.equal(h.session.getState().ready, true); assert.equal(h.session.getState().playing, false);
  assert.ok(h.session.command('resume')); assert.equal(retry.latest().type, 'resume');
  h.session.dispose(); assert.equal(h.listeners.size, 0); assert.equal(h.timers.size, 0);
});

test('matching playback state without actual video still times out and never enables controls', () => {
  const h = harness(), frame = h.frame('a'); h.session.setScene({ moveId: 'rear_naked_choke' }, false); h.session.bind(frame.iframe, frame.nonce);
  const play = frame.open(); frame.reply(play, 'state', { moveId: play.moveId, progress: 0.5, playing: false });
  assert.equal(h.session.getState().ready, false);
  const startup = [...h.timers.values()].find(timer => timer.ms === 45000); assert.ok(startup); startup.callback();
  assert.match(h.session.getState().error, /video stream/); assert.equal(h.session.getState().ready, false); assert.equal(h.session.getState().progress, 0.5);
  const count = h.changes.length; h.session.dispose(); startup.callback(); frame.presented(play); assert.equal(h.changes.length, count);
});

test('unsupported exact lessons do not play an unrelated clip or turn lack of support into fabricated readiness', () => {
  const h = harness(), frame = h.frame('a'); h.session.setScene({ moveId: 'double_leg' }, true); h.session.bind(frame.iframe, frame.nonce); frame.open();
  assert.equal(h.session.getState().reason, 'unsupported-move'); assert.equal(h.session.getState().ready, false);
  assert.equal(h.timers.size, 0); assert.equal(frame.messages.filter(message => message.command?.type === 'play').length, 0);
  h.session.dispose();
});

test('startup pause and narrow framing queue before handshake without sending commands or resetting reconnect progress', () => {
  const h = harness(), first = h.frame('a'); h.session.setScene({ moveId: 'rear_naked_choke' }, true); const unbind = h.session.bind(first.iframe, first.nonce);
  h.session.command('pause'); h.session.command('setViewport', { compactViewport: true });
  assert.equal(first.messages.filter(message => message.type === 'command').length, 0);
  const play = first.open(); assert.equal(play.paused, true); assert.equal(play.compactViewport, true); first.presented(play);
  h.session.command('seek', { progress: 0.6 }); const seek = first.latest(); first.reply(seek, 'state', { moveId: seek.moveId, progress: 0.6, playing: false });
  unbind(); h.session.command('setViewport', { compactViewport: false });
  const retry = h.frame('b'); h.session.bind(retry.iframe, retry.nonce); const restored = retry.open();
  assert.equal(restored.progress, 0.6); assert.equal(restored.paused, true); assert.equal(restored.compactViewport, false);
  h.session.dispose();
});
