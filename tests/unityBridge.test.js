import assert from 'node:assert/strict';
import test from 'node:test';
import { allMoves } from '../src/data/curriculum.js';
import { createUnityBridge, isUnityEnabled, resolveArenaUnityPlayback, resolveUnityMove, snapshotFallbackUrl, toUnityAthlete, UNITY_PREVIEWS } from '../src/unity/bridge.js';
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

test('release build flag enables Unity with an explicit snapshot rollback and preview override', () => {
  assert.equal(isUnityEnabled('', 'unity'), true);
  assert.equal(isUnityEnabled('', 'snapshot'), false);
  assert.equal(isUnityEnabled('?engine=snapshot', 'unity'), false);
  assert.equal(isUnityEnabled('?engine=unity', 'snapshot'), true);
  assert.equal(isUnityEnabled('?preview=unity', 'snapshot'), true);
  assert.equal(isUnityEnabled('?engine=snapshot&preview=unity', 'unity'), false);
  assert.equal(isUnityEnabled('?engine=UNItY', 'snapshot'), false);
});

test('snapshot rollback preserves current preview, other query settings and hash while replacing only engine', () => {
  const fallback = snapshotFallbackUrl('https://jiuquest.com/play?preview=unity&engine=unity&view=training#lesson');
  const parsed = new URL(fallback, 'https://jiuquest.com');
  assert.equal(parsed.pathname, '/play');
  assert.equal(parsed.searchParams.get('engine'), 'snapshot');
  assert.equal(parsed.searchParams.get('preview'), 'unity');
  assert.equal(parsed.searchParams.get('view'), 'training');
  assert.equal(parsed.hash, '#lesson');
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

test('viewport resize preserves scene intent during startup and does not reload an active move', () => {
  const { bridge, attach, ready, sent } = setup();
  bridge.setScene({ moveId: 'double_leg', compactViewport: false }); attach();
  bridge.command('setViewport', { compactViewport: true }); ready();
  assert.equal(sent.at(-1).type, 'play');
  assert.equal(sent.at(-1).compactViewport, true);
  const scenePlays = sent.filter((item) => item.type === 'play').length;
  bridge.command('setViewport', { compactViewport: false });
  assert.equal(sent.at(-1).type, 'setViewport');
  assert.equal(sent.filter((item) => item.type === 'play').length, scenePlays);
  bridge.command('pause');
  assert.equal(sent.at(-1).compactViewport, false);
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
    const first = await createUnityPlayer({ id: ':react:id:', remove() {} });
    const abort = new AbortController();
    const canceled = createUnityPlayer({ remove() {} }, { signal: abort.signal });
    const canceledAssertion = assert.rejects(canceled, { name: 'AbortError' });
    abort.abort();
    const thirdPending = createUnityPlayer({ remove() {} });
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
    await assert.rejects(createUnityPlayer({ remove() {} }), /simulated creation failure/);
    shouldFail = false;
    const next = await createUnityPlayer({ remove() {} });
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
  retry.state.startPlayerLoad(); retry.state.playerCreated(); retry.state.ready(); retry.state.settled();
  assert.equal(retry.changes.at(-1).phase, 'ready', 'a fresh successful initialization is independent of the failed one');
  retry.state.dispose();
});

test('every subsequent selection and replay gets a watchdog; queued old timeouts cannot fail a newer move', () => {
  const { state, changes, callbacks, cleared } = loadStateHarness();
  state.startPlayerLoad();
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
  state.startPlayerLoad();
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
  state.playerCreated(); state.ready(); state.progress(1);
  assert.equal(state.settled(), false, 'late factory or handshake completion cannot revive an expired startup');
  assert.equal(changes.at(-1).phase, 'error');
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

function loadDeadlineHarness() {
  let now = 0, nextId = 0;
  const scheduled = new Map(), history = [], changes = [];
  let aborts = 0;
  const state = createUnityLoadState({
    onChange: (value) => changes.push(value),
    onInitialTimeout: () => { aborts += 1; },
    setTimer: (callback, milliseconds) => {
      const timer = { id: ++nextId, due: now + milliseconds, callback };
      scheduled.set(timer.id, timer); history.push(timer); return timer.id;
    },
    clearTimer: (id) => scheduled.delete(id),
  });
  const advanceTo = (target) => {
    while (true) {
      const timer = [...scheduled.values()].filter((value) => value.due <= target).sort((a, b) => a.due - b.due)[0];
      if (!timer) break;
      now = timer.due; scheduled.delete(timer.id); timer.callback();
    }
    now = target;
  };
  return { state, changes, history, advanceTo, aborts: () => aborts };
}

test('factory completion and initial handshake preserve one original 90-second deadline through first scene', () => {
  const f = loadDeadlineHarness();
  f.state.startPlayerLoad();
  f.advanceTo(10000); f.state.startPlayerLoad();
  f.advanceTo(22649); f.state.playerCreated();
  f.advanceTo(52650);
  assert.notEqual(f.changes.at(-1).phase, 'error', 'a first GLB import is not cut off 30 seconds after factory completion');
  f.advanceTo(80000); f.state.ready(); f.state.requestScene();
  f.advanceTo(89999);
  assert.equal(f.changes.at(-1).phase, 'loading-move');
  assert.equal(f.history.length, 1, 'initial selection or duplicate start cannot extend or shorten the startup deadline');
  f.advanceTo(90000);
  assert.equal(f.changes.at(-1).phase, 'error');
  assert.equal(f.changes.at(-1).reloadRequired, true);
  assert.equal(f.aborts(), 1);
  f.state.ready(); f.state.settled(); f.history[0].callback();
  assert.equal(f.changes.at(-1).phase, 'error', 'late readiness and an already queued timeout cannot revive or abort again');
  assert.equal(f.aborts(), 1);
  f.state.dispose();
});

test('first settled scene ends startup budget, while each later scene gets its own 30-second deadline', () => {
  const f = loadDeadlineHarness();
  f.state.startPlayerLoad(); f.advanceTo(22000); f.state.playerCreated();
  f.advanceTo(80000); f.state.ready(); f.advanceTo(88000); f.state.settled();
  f.advanceTo(90000); f.history[0].callback();
  assert.equal(f.changes.at(-1).phase, 'ready');
  assert.equal(f.aborts(), 0);
  f.advanceTo(100000); f.state.requestScene();
  assert.equal(f.history.at(-1).due, 130000);
  f.advanceTo(110000); f.state.requestScene();
  f.history[1].callback(); f.advanceTo(139999);
  assert.equal(f.changes.at(-1).phase, 'loading-move', 'stale selection deadlines do not fail the newest request');
  f.advanceTo(140000);
  assert.equal(f.changes.at(-1).phase, 'error');
  assert.equal(f.changes.at(-1).reloadRequired, undefined);
  assert.equal(f.aborts(), 0, 'a later move timeout is not a whole-player startup failure');
  f.state.requestScene(); f.state.settled();
  f.history.at(-1).callback();
  assert.equal(f.changes.at(-1).phase, 'ready');
  f.state.dispose();
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
  globalThis.document = {
    createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, remove() {} }),
    body: { appendChild() {} }, head: { appendChild: (script) => queueMicrotask(() => script.onload()) },
  };
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ protocolVersion: 1, loaderUrl: './game.loader.js', dataUrl: './game.data', frameworkUrl: './game.framework.js', codeUrl: './game.wasm' }) });
  const abort = new AbortController();
  const { state, changes, callbacks } = loadStateHarness({ onInitialTimeout: () => abort.abort() });
  try {
    state.startPlayerLoad();
    const initialPlayer = createUnityPlayer({ style: {}, remove() {}, getBoundingClientRect: () => ({ width: 960, height: 600 }) }, { signal: abort.signal });
    const canceledAssertion = assert.rejects(initialPlayer, { name: 'AbortError' });
    for (let count = 0; count < 10 && createCount === 0; count += 1) await tick();
    assert.equal(createCount, 1);
    callbacks.at(-1)();
    assert.equal(changes.at(-1).phase, 'error');
    assert.equal(changes.at(-1).reloadRequired, true);
    const replacement = createUnityPlayer({ remove() {} });
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
