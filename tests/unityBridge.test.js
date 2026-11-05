import assert from 'node:assert/strict';
import test from 'node:test';
import { allMoves } from '../src/data/curriculum.js';
import { createUnityBridge, isUnityEnabled, resolveArenaUnityPlayback, resolveUnityMove, toUnityAthlete, UNITY_PREVIEWS } from '../src/unity/bridge.js';
import { createUnityPlayer, validateManifest } from '../src/unity/loader.js';
import { createUnityLoadState, describeUnityError } from '../src/unity/loadState.js';

const event = (instanceId, requestId, type = 'state', extra = {}) => ({ protocolVersion: 1, instanceId, requestId, type, ...extra });
function setup() {
  const sent = [];
  const received = [];
  const bridge = createUnityBridge({ instanceId: 'player-a', onEvent: (value) => received.push(value) });
  const attach = () => bridge.attach((object, method, json) => sent.push({ object, method, ...JSON.parse(json) }));
  const ready = () => bridge.receive(event('player-a', 'player-a:setup', 'ready'));
  return { bridge, sent, received, attach, ready };
}

test('Unity stays opt-in and preview query is exact', () => {
  assert.equal(isUnityEnabled(''), false);
  assert.equal(isUnityEnabled('?engine=three'), false);
  assert.equal(isUnityEnabled('?engine=unity'), true);
  assert.equal(isUnityEnabled('?preview=unity'), true);
});

test('curriculum mappings are explicit and never substitute armbar for kimura or generic passes', () => {
  for (const id of ['trap-roll-escape', 'double-leg-takedown', 'triangle-choke', 'rear-naked-choke']) {
    assert.ok(allMoves.some((move) => move.id === id));
    assert.ok(resolveUnityMove(id));
  }
  for (const id of ['kimura-guard', 'straight-armlock-guard', 'double-underhook-guard-pass', 'brown-pressure-pass', 'some-armbar', 'constructor', 'toString']) assert.equal(resolveUnityMove(id), null);
  for (const move of UNITY_PREVIEWS) assert.equal(resolveUnityMove(move.id, { canonical: true }), move.id);
});

test('only explicit successful exchanges play and the NPC winner remains the performer', () => {
  const result = { move: { id: 'double-leg-takedown' }, actorIsPlayer: false, animationSucceeded: true, playerWins: true };
  assert.deepEqual(resolveArenaUnityPlayback(result), { moveId: 'double_leg', performerSide: 'opponent' });
  assert.deepEqual(resolveArenaUnityPlayback({ ...result, actorIsPlayer: true }), { moveId: 'double_leg', performerSide: 'fighter' });
  assert.equal(resolveArenaUnityPlayback({ ...result, animationSucceeded: false }), null);
  assert.equal(resolveArenaUnityPlayback({ ...result, animationSucceeded: undefined }), null);
  assert.equal(resolveArenaUnityPlayback({ ...result, actorIsPlayer: undefined }), null);
  assert.equal(resolveArenaUnityPlayback({ ...result, move: { id: 'kimura-guard' } }), null);
  assert.equal(resolveArenaUnityPlayback(null), null);
});

test('configure handshake sends only the latest pending scene with current appearance', () => {
  const { bridge, sent, attach, ready } = setup();
  bridge.setScene({ moveId: 'double_leg', performerSide: 'fighter' });
  attach();
  bridge.setScene({ moveId: 'triangle_choke', performerSide: 'opponent', fighter: { name: 'New name' } }, false);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'configure');
  assert.equal(sent[0].object, 'JiuQuestBridge');
  assert.equal(sent[0].method, 'ReceiveCommand');
  ready();
  assert.equal(sent.length, 2);
  assert.equal(sent[1].type, 'play');
  assert.equal(sent[1].moveId, 'triangle_choke');
  assert.equal(sent[1].performerSide, 'opponent');
  assert.equal(sent[1].fighter.name, 'New name');
  assert.equal(sent[1].paused, true);
  assert.equal(ready(), false);
  assert.equal(sent.length, 2);
});

test('startup pause, speed, camera and seek preserve the requested scene as a single paused play', () => {
  const { bridge, sent, attach, ready } = setup();
  bridge.setScene({ moveId: 'double_leg', speed: 1, camera: 'front' });
  attach();
  bridge.command('pause');
  bridge.command('setSpeed', { speed: 0.25 });
  bridge.command('setCamera', { camera: 'side' });
  bridge.command('seek', { progress: 0.5 });
  ready();
  assert.equal(sent.length, 2);
  assert.deepEqual({ type: sent[1].type, moveId: sent[1].moveId, paused: sent[1].paused, speed: sent[1].speed, camera: sent[1].camera, progress: sent[1].progress }, { type: 'play', moveId: 'double_leg', paused: true, speed: 0.25, camera: 'side', progress: 0.5 });
});

test('stale session, move, request and protocol events cannot control the active preview', () => {
  const { bridge, attach, ready, received } = setup();
  const old = bridge.setScene({ moveId: 'double_leg' });
  attach(); ready();
  const current = bridge.setScene({ moveId: 'triangle_choke' });
  assert.equal(bridge.receive(event('another', current)), false);
  assert.equal(bridge.receive(event('player-a', old)), false);
  assert.equal(bridge.receive(event('player-a', current, 'state', { moveId: 'double_leg' })), false);
  assert.equal(bridge.receive({ ...event('player-a', current), protocolVersion: 2 }), false);
  assert.equal(bridge.receive(event('player-a', current, 'state', { moveId: 'triangle_choke', progress: 9 })), true);
  assert.equal(received.at(-1).progress, 1);
  bridge.dispose();
  assert.equal(bridge.receive(event('player-a', current)), false);
  assert.equal(bridge.command('resume'), null);
});

test('speed and camera selections persist across later pause and seek commands', () => {
  const { bridge, attach, ready, sent } = setup();
  bridge.setScene({ moveId: 'double_leg', speed: 1, camera: 'front' }); attach(); ready();
  bridge.command('setSpeed', { speed: 0.5 });
  bridge.command('setCamera', { camera: 'overhead' });
  bridge.command('pause');
  assert.equal(sent.at(-1).speed, 0.5);
  assert.equal(sent.at(-1).camera, 'overhead');
});

test('appearance maps only approved cosmetic fields, including earned belt, stripes and selected hair', () => {
  const athlete = toUnityAthlete({ name: 'Athlete', giTop: '#abcdef', giPants: 'url(invalid)', hairStyle: '  Short Fade  ', stripes: 1, secret: 'not forwarded' }, { belt: 'purple', stripes: 4 });
  assert.equal(athlete.giTop, '#abcdef');
  assert.equal(athlete.giPants, '#112a58');
  assert.equal(athlete.belt, '#8b3ffc');
  assert.equal(athlete.stripes, 4);
  assert.equal(athlete.hairStyle, 'short fade');
  assert.equal('secret' in athlete, false);
});

test('appearance honors explicit zero stripes, NPC fallback, bald selection and malformed saved values', () => {
  assert.equal(toUnityAthlete({ stripes: 4 }, { belt: 'white', stripes: 0 }).stripes, 0);
  assert.equal(toUnityAthlete({ stripes: 2, hairStyle: 'bald' }).stripes, 2);
  assert.equal(toUnityAthlete({ stripes: 2, hairStyle: 'bald' }).hairStyle, 'bald');
  assert.equal(toUnityAthlete({ stripes: 3 }, { belt: 'blue' }).stripes, 3);
  assert.equal(toUnityAthlete({ stripes: 99 }).stripes, 4);
  assert.equal(toUnityAthlete({ stripes: -1 }).stripes, 0);
  assert.equal(toUnityAthlete({ stripes: 2.8 }).stripes, 2);
  assert.equal(toUnityAthlete({ stripes: 'all', hairStyle: {} }).stripes, 0);
  assert.equal(toUnityAthlete({ hairStyle: {} }).hairStyle, 'shadow spikes');
  assert.equal(toUnityAthlete({ hairStyle: '   ' }).hairStyle, 'shadow spikes');
});

test('build manifest requires real local runtime URLs and rejects remote scripts', () => {
  const raw = { protocolVersion: 1, loaderUrl: './Build/game.loader.js', dataUrl: './Build/game.data', frameworkUrl: './Build/game.framework.js', codeUrl: './Build/game.wasm' };
  const manifest = validateManifest(raw, 'https://jiuquest.com/unity/build-manifest.json', 'https://jiuquest.com');
  assert.equal(manifest.loaderUrl, 'https://jiuquest.com/unity/Build/game.loader.js');
  assert.throws(() => validateManifest({ ...raw, loaderUrl: 'https://other.example/game.js' }, 'https://jiuquest.com/unity/build-manifest.json', 'https://jiuquest.com'), /this website/);
  assert.throws(() => validateManifest({ protocolVersion: 1 }, 'https://jiuquest.com/unity/build-manifest.json', 'https://jiuquest.com'), /missing loaderUrl/);
  assert.throws(() => validateManifest({ ...raw, protocolVersion: 2 }, 'https://jiuquest.com/unity/build-manifest.json', 'https://jiuquest.com'), /incompatible combat protocol/);
  assert.throws(() => validateManifest({ ...raw, protocolVersion: undefined }, 'https://jiuquest.com/unity/build-manifest.json', 'https://jiuquest.com'), /incompatible combat protocol/);
});

test('Unity lifecycle waits for Quit, cancels queued mounts, and releases a failed initialization', async () => {
  const original = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  let releaseQuit;
  let shouldFail = false;
  let createCount = 0;
  let quitCount = 0;
  globalThis.window = {
    location: { origin: 'https://unity-lifecycle.example' }, devicePixelRatio: 2,
    createUnityInstance: async (_canvas, config) => {
      createCount += 1;
      assert.equal(config.devicePixelRatio, 1.5);
      assert.match(_canvas.id, /^[A-Za-z][\w-]*$/, 'Unity receives a canvas with a CSS-safe id');
      if (shouldFail) throw new Error('simulated creation failure');
      const index = createCount;
      return { Quit: () => {
        quitCount += 1;
        return index === 1 ? new Promise((resolve) => { releaseQuit = resolve; }) : Promise.resolve();
      } };
    },
  };
  globalThis.document = { createElement: () => ({ remove() {} }), head: { appendChild: (script) => queueMicrotask(() => script.onload()) } };
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ protocolVersion: 1, loaderUrl: './game.loader.js', dataUrl: './game.data', frameworkUrl: './game.framework.js', codeUrl: './game.wasm' }) });
  try {
    const first = await createUnityPlayer({ id: ':react:id:' });
    const abort = new AbortController();
    const canceled = createUnityPlayer({}, { signal: abort.signal });
    const canceledAssertion = assert.rejects(canceled, { name: 'AbortError' });
    abort.abort();
    const thirdPending = createUnityPlayer({});
    await tick();
    assert.equal(createCount, 1, 'route replacements cannot create another WebGL runtime before Quit');
    const disposed = first.dispose();
    await tick();
    assert.equal(createCount, 1, 'Quit must finish before the next instance starts');
    releaseQuit();
    await disposed;
    await canceledAssertion;
    const third = await thirdPending;
    assert.equal(createCount, 2, 'the canceled mount never initializes');
    await third.dispose();
    await third.dispose();
    assert.equal(quitCount, 2, 'each instance quits exactly once');
    shouldFail = true;
    await assert.rejects(createUnityPlayer({}), /simulated creation failure/);
    shouldFail = false;
    const next = await createUnityPlayer({});
    await next.dispose();
    assert.equal(createCount, 4, 'a failed loader does not block subsequent retry');
  } finally {
    for (const key of ['window', 'document', 'fetch']) {
      if (original[key] === undefined) delete globalThis[key]; else globalThis[key] = original[key];
    }
  }
});

function loadStateHarness(options = {}) {
  const changes = [];
  const callbacks = [];
  const cleared = [];
  const state = createUnityLoadState({
    onChange: (next) => changes.push(next),
    setTimer: (callback, milliseconds) => { assert.ok(milliseconds === 30000 || milliseconds === 90000); callbacks.push(callback); return callbacks.length; },
    clearTimer: (id) => cleared.push(id),
    ...options,
  });
  return { state, changes, callbacks, cleared };
}

test('selection after a failed manifest preserves the initialization error until Retry', () => {
  const { state, changes, callbacks } = loadStateHarness();
  state.progress(0.3);
  state.fail('The Unity preview build is not installed on this website yet.');
  const originalError = changes.at(-1);
  assert.equal(state.requestScene(), false);
  state.progress(1);
  assert.equal(changes.at(-1), originalError, 'selection and late download progress cannot invent a scene load');
  assert.equal(state.settled(), false, 'no selected move can settle without the engine handshake');
  assert.equal(callbacks.length, 0, 'a failed player does not start a doomed move watchdog');
  state.dispose();
  const retry = loadStateHarness();
  retry.state.playerCreated(); retry.state.ready(); retry.state.settled();
  assert.equal(retry.changes.at(-1).phase, 'ready', 'a fresh successful initialization is independent of the failed one');
  retry.state.dispose();
});

test('every subsequent selection and replay gets a watchdog; queued old timeouts cannot fail a newer move', () => {
  const { state, changes, callbacks, cleared } = loadStateHarness();
  state.playerCreated();
  const handshakeTimeout = callbacks.at(-1);
  state.ready();
  const initialMoveTimeout = callbacks.at(-1);
  state.settled();
  assert.equal(changes.at(-1).phase, 'ready');
  handshakeTimeout(); initialMoveTimeout();
  assert.equal(changes.at(-1).phase, 'ready', 'already queued initialization callbacks remain invalid after ready');
  state.requestScene();
  const secondMoveTimeout = callbacks.at(-1);
  state.requestScene();
  const thirdMoveTimeout = callbacks.at(-1);
  secondMoveTimeout();
  assert.equal(changes.at(-1).phase, 'loading-move', 'a rapid later selection cannot inherit the previous timer failure');
  thirdMoveTimeout();
  assert.equal(changes.at(-1).phase, 'error', 'the latest genuinely stalled move times out');
  state.requestScene();
  const replayTimeout = callbacks.at(-1);
  assert.equal(changes.at(-1).phase, 'loading-move', 'a functioning engine can retry a failed move without relaunching Unity');
  state.settled(); replayTimeout();
  assert.equal(changes.at(-1).phase, 'ready');
  assert.ok(cleared.length >= 6);
  state.dispose();
});

test('disposed preview sessions ignore all late progress, ready, errors and timer callbacks', () => {
  const { state, changes, callbacks } = loadStateHarness();
  state.playerCreated(); state.ready(); state.requestScene();
  const count = changes.length;
  state.dispose();
  callbacks.forEach((callback) => callback());
  state.progress(1); state.ready(); state.settled(); state.fail('stale error'); state.requestScene();
  assert.equal(changes.length, count);
});

test('initial watchdog covers manifest, script and factory wait without inventing readiness', () => {
  let abortCount = 0;
  const { state, changes, callbacks } = loadStateHarness({ onInitialTimeout: () => { abortCount += 1; } });
  state.startPlayerLoad();
  state.progress(0.8);
  callbacks.at(-1)();
  assert.equal(changes.at(-1).phase, 'error');
  assert.equal(changes.at(-1).reloadRequired, true);
  assert.match(changes.at(-1).message, /Reload this page/);
  assert.equal(abortCount, 1);
  assert.equal(state.requestScene(), false);
  assert.equal(state.settled(), false);
  callbacks.at(-1)();
  assert.equal(abortCount, 1, 'a queued duplicate timeout cannot abort a newer session');
  state.dispose();
  const valid = loadStateHarness({ onInitialTimeout: () => { throw new Error('stale initialization watchdog fired'); } });
  valid.state.startPlayerLoad();
  const oldInitialTimer = valid.callbacks.at(-1);
  valid.state.playerCreated(); valid.state.ready(); valid.state.settled();
  oldInitialTimer();
  assert.equal(valid.changes.at(-1).phase, 'ready');
  valid.state.dispose();
});

test('Unity string, Error and missing rejections always produce meaningful user-facing messages', () => {
  assert.equal(describeUnityError('WebGL context unavailable'), 'WebGL context unavailable');
  assert.equal(describeUnityError(new Error('Wasm download failed')), 'Wasm download failed');
  for (const value of [null, undefined, '', '   ', 'undefined', {}]) assert.match(describeUnityError(value), /could not initialize/);
});

test('a hung Unity factory reports reload guidance but keeps its lease until eventual Quit finishes', async () => {
  const original = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  let resolveFactory;
  let resolveQuit;
  let createCount = 0;
  let quitCount = 0;
  globalThis.window = {
    location: { origin: 'https://unity-hung-factory.example' }, devicePixelRatio: 1,
    createUnityInstance: () => {
      createCount += 1;
      if (createCount === 1) return new Promise((resolve) => { resolveFactory = resolve; });
      return Promise.resolve({ Quit: async () => { quitCount += 1; } });
    },
  };
  globalThis.document = { createElement: () => ({ remove() {} }), head: { appendChild: (script) => queueMicrotask(() => script.onload()) } };
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ protocolVersion: 1, loaderUrl: './game.loader.js', dataUrl: './game.data', frameworkUrl: './game.framework.js', codeUrl: './game.wasm' }) });
  const abort = new AbortController();
  const { state, changes, callbacks } = loadStateHarness({ onInitialTimeout: () => abort.abort() });
  try {
    state.startPlayerLoad();
    const initialPlayer = createUnityPlayer({}, { signal: abort.signal });
    const canceledAssertion = assert.rejects(initialPlayer, { name: 'AbortError' });
    for (let count = 0; count < 10 && createCount === 0; count += 1) await tick();
    assert.equal(createCount, 1);
    callbacks.at(-1)();
    assert.equal(changes.at(-1).phase, 'error');
    assert.equal(changes.at(-1).reloadRequired, true);
    const replacement = createUnityPlayer({});
    await tick();
    assert.equal(createCount, 1, 'the timed-out but unresolved factory still owns the runtime lease');
    assert.equal(quitCount, 0, 'there is no instance to Quit while the factory is unresolved');
    resolveFactory({ Quit: () => { quitCount += 1; return new Promise((resolve) => { resolveQuit = resolve; }); } });
    await tick();
    assert.equal(createCount, 1, 'the late instance must finish Quit before a replacement starts');
    assert.equal(quitCount, 1);
    resolveQuit();
    await canceledAssertion;
    const next = await replacement;
    assert.equal(createCount, 2);
    await next.dispose();
    assert.equal(quitCount, 2);
    assert.equal(changes.at(-1).phase, 'error', 'completion of a canceled factory does not mark the old UI ready');
  } finally {
    state.dispose();
    for (const key of ['window', 'document', 'fetch']) {
      if (original[key] === undefined) delete globalThis[key]; else globalThis[key] = original[key];
    }
  }
});
