import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { installUnityStartupTelemetry } from '../tools/unity_startup_telemetry.mjs';

function fixture() {
  let now = 0, observer;
  const frames = [], events = new EventTarget();
  const canvas = { width: 960, height: 600, visible: true, getBoundingClientRect() { return { width: this.width, height: this.height }; }, checkVisibility() { return this.visible; } };
  const play = { disabled: false };
  const stage = { dataset: { unityStatus: 'ready' }, querySelector(selector) { return selector === '.unity-canvas' ? canvas : play; } };
  const window = { addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events), getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }) };
  vm.runInNewContext(`(${installUnityStartupTelemetry.toString()})({moveId:'double_leg'})`, {
    window, document: { querySelector: () => stage }, performance: { timeOrigin: 100000, now: () => now },
    requestAnimationFrame: (callback) => frames.push(callback),
    MutationObserver: class { constructor(callback) { observer = callback; } observe() {} disconnect() {} },
  });
  const emit = (detail) => events.dispatchEvent(new CustomEvent('jiuquest:unity', { detail: { protocolVersion: 1, instanceId: 'a', requestId: 'a:2', progress: 0, playing: false, moveId: 'double_leg', ...detail } }));
  const tick = (milliseconds = 16) => { now += milliseconds; frames.splice(0).forEach((callback) => callback(now)); };
  return { result: window.__unityStartupTelemetry, emit, tick, canvas, play, stage, change: () => observer(), advance: (milliseconds) => { now += milliseconds; } };
}

test('bootstrap alone, wrong move, wrong instance, playing or noninitial progress cannot report rendered readiness', () => {
  for (const invalid of [null, { moveId: 'standing_stance' }, { instanceId: 'other' }, { playing: true }, { progress: 1 }, { type: 'completed' }]) {
    const f = fixture(); f.emit({ type: 'ready' });
    if (invalid) f.emit({ type: 'state', ...invalid });
    f.tick(); f.tick();
    assert.equal(f.result.renderedReadyMs, null);
  }
});

test('ready UI, visible nonzero canvas and enabled Play are all required', () => {
  for (const invalidate of [f => { f.stage.dataset.unityStatus = 'loading-move'; }, f => { f.canvas.width = 0; }, f => { f.canvas.visible = false; }, f => { f.play.disabled = true; }]) {
    const f = fixture(); invalidate(f); f.emit({ type: 'ready' }); f.emit({ type: 'state' }); f.tick(); f.tick();
    assert.equal(f.result.renderedReadyMs, null);
  }
});

test('matching paused initial clip records only after two frames and is independent of late controller polling', () => {
  const f = fixture(); f.advance(80000); f.emit({ type: 'ready' }); f.advance(50); f.emit({ type: 'state' });
  assert.equal(f.result.renderedReadyMs, null); f.tick(20);
  assert.equal(f.result.renderedReadyMs, null); assert.equal(f.result.renderedFrames, 1);
  f.tick(20); assert.equal(f.result.renderedReadyMs, 80090); assert.equal(f.result.renderedFrames, 2);
  assert.equal(f.result.firstUnityReadyMs, 80000); assert.equal(f.result.firstMoveStateMs, 80050);
  f.advance(12000); f.change(); f.tick();
  assert.equal(f.result.renderedReadyMs, 80090, '12 seconds of later controller delay cannot change the already observed milestone');
});

test('a state, UI, instance or error change between rendered frames cannot produce a stale success', () => {
  for (const invalidate of [f => f.emit({ type: 'state', playing: true }), f => { f.stage.dataset.unityStatus = 'loading-move'; f.change(); }, f => f.emit({ type: 'ready', instanceId: 'new' }), f => f.emit({ type: 'error', message: 'Real load failure' })]) {
    const f = fixture(); f.emit({ type: 'ready' }); f.emit({ type: 'state' }); f.tick(); invalidate(f); f.tick(); f.tick();
    assert.equal(f.result.renderedReadyMs, null);
  }
});

test('a later eligible scene gets its own two frames after an interrupted candidate', () => {
  const f = fixture(); f.emit({ type: 'ready' }); f.emit({ type: 'state' }); f.tick();
  f.stage.dataset.unityStatus = 'loading-move'; f.change(); f.tick();
  f.stage.dataset.unityStatus = 'ready'; f.change(); f.tick(); assert.equal(f.result.renderedReadyMs, null);
  f.tick(); assert.equal(f.result.renderedReadyMs, 64); assert.equal(f.result.renderedFrames, 2);
});
