import test from 'node:test';
import assert from 'node:assert/strict';
import { createUnityCanvas, createUnityPlayer } from '../src/unity/loader.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

// A small document model exercises the generated runtime's actual dependency:
// document.querySelector must still find the original canvas after route removal.
function documentHarness() {
  const nodes = new Set();
  class Element {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.style = {}; this.attributes = {}; nodes.add(this); }
    setAttribute(name, value) { this.attributes[name] = value; }
    appendChild(child) { child.remove(); child.parentNode = this; this.children.push(child); if (this === doc.head) queueMicrotask(() => child.onload()); return child; }
    remove() { if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null; }
    get isConnected() { return this === doc.body || this === doc.head || Boolean(this.parentNode?.isConnected); }
    getBoundingClientRect() { return this.isConnected ? { width: 480, height: 300 } : { width: 0, height: 0 }; }
  }
  const doc = { createElement: tag => new Element(tag), querySelector: selector => [...nodes].find(n => n.isConnected && selector === '#' + n.id) ?? null };
  doc.body = new Element('body'); doc.head = new Element('head');
  return doc;
}

function environment(origin, factory) {
  const original = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
  const document = documentHarness();
  globalThis.document = document;
  globalThis.window = { location: { origin }, devicePixelRatio: 1, createUnityInstance: factory };
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ protocolVersion: 1, loaderUrl: './game.loader.js', dataUrl: './game.data', frameworkUrl: './game.framework.js', codeUrl: './game.wasm' }) });
  return {
    document,
    mount() { const host = document.createElement('div'); document.body.appendChild(host); return { host, canvas: createUnityCanvas(host, 'Athlete preview') }; },
    restore() { for (const key of Object.keys(original)) { if (original[key] === undefined) delete globalThis[key]; else globalThis[key] = original[key]; } },
  };
}

test('unmount during Unity startup retains its selector until late startup and Quit finish before reacquiring', async () => {
  const startup = deferred(), quitting = deferred();
  const calls = [];
  let quitCalls = 0;
  const env = environment('https://unity-canvas-retention.example', async canvas => {
    calls.push(canvas);
    if (calls.length === 1) {
      await startup.promise;
      assert.equal(env.document.querySelector('#' + canvas.id), canvas, 'late _main still resolves its own connected canvas');
      return { Quit: async () => { quitCalls += 1; await quitting.promise; assert.equal(env.document.querySelector('#' + canvas.id), canvas, 'Quit can still use the canvas selector'); } };
    }
    return { Quit: async () => { quitCalls += 1; } };
  });
  const first = env.mount(), controller = new AbortController();
  const pending = createUnityPlayer(first.canvas, { signal: controller.signal });
  const aborted = assert.rejects(pending, { name: 'AbortError' });
  let replacement;
  try {
    await tick(); assert.equal(calls.length, 1);
    const firstId = first.canvas.id;
    controller.abort(); first.host.remove();
    assert.equal(env.document.querySelector('#' + firstId), first.canvas, 'layout cleanup retains the canvas before React removes its host');
    assert.equal(first.canvas.parentNode.attributes['aria-hidden'], 'true');
    assert.equal(first.canvas.parentNode.inert, true);
    assert.equal(first.canvas.className, 'unity-retained-canvas');
    assert.equal(first.canvas.parentNode.style.width, '480px');
    const second = env.mount();
    second.canvas.id = firstId; // React may reuse an id during StrictMode/remount.
    const next = createUnityPlayer(second.canvas);
    assert.notEqual(second.canvas.id, firstId, 'queued runtime gets a unique selector');
    await tick(); assert.equal(calls.length, 1);
    startup.resolve(); await tick();
    assert.equal(quitCalls, 1); assert.equal(calls.length, 1, 'next factory must wait for asynchronous Quit');
    quitting.resolve(); await aborted; replacement = await next;
    assert.equal(env.document.querySelector('#' + firstId), null);
    assert.equal(calls.length, 2);
    await replacement.dispose(); await replacement.dispose();
    assert.equal(quitCalls, 2);
    assert.equal(env.document.body.children.some(n => 'data-unity-retained' in n.attributes), false);
  } finally { startup.resolve(); quitting.resolve(); await aborted; await replacement?.dispose(); env.restore(); }
});

test('startup timeout retains the active canvas and a factory rejection removes it before retry', async () => {
  const startup = deferred(); let calls = 0;
  const env = environment('https://unity-canvas-rejection.example', async () => {
    calls += 1; if (calls === 1) return startup.promise;
    return { Quit: async () => {} };
  });
  const first = env.mount(), controller = new AbortController();
  const pending = createUnityPlayer(first.canvas, { signal: controller.signal });
  const rejected = assert.rejects(pending, /actual startup failure/);
  try {
    await tick(); controller.abort(); // Same abort used by the initial load deadline.
    assert.equal(env.document.querySelector('#' + first.canvas.id), first.canvas);
    startup.reject(new Error('actual startup failure')); await rejected;
    assert.equal(first.canvas.isConnected, false);
    assert.equal(env.document.body.children.some(n => 'data-unity-retained' in n.attributes), false);
    const next = env.mount(); const player = await createUnityPlayer(next.canvas);
    assert.equal(calls, 2); await player.dispose();
  } finally { startup.reject(new Error('actual startup failure')); await rejected; env.restore(); }
});

test('an aborted queued mount creates neither runtime nor retained host', async () => {
  const env = environment('https://unity-canvas-queued.example', async () => ({ Quit: async () => {} }));
  try {
    const first = env.mount(), player = await createUnityPlayer(first.canvas);
    const queued = env.mount(), controller = new AbortController();
    const pending = createUnityPlayer(queued.canvas, { signal: controller.signal });
    const rejected = assert.rejects(pending, { name: 'AbortError' });
    controller.abort(); queued.host.remove(); await player.dispose(); await rejected;
    assert.equal(queued.canvas.isConnected, false);
    assert.equal(env.document.body.children.some(n => 'data-unity-retained' in n.attributes), false);
  } finally { env.restore(); }
});

test('unmount of a ready runtime keeps its canvas connected through deferred Quit', async () => {
  const quitting = deferred(); let calls = 0;
  const env = environment('https://unity-canvas-ready.example', async () => {
    calls += 1; return { Quit: () => calls === 1 ? quitting.promise : Promise.resolve() };
  });
  let next;
  try {
    const first = env.mount(), controller = new AbortController();
    const player = await createUnityPlayer(first.canvas, { signal: controller.signal });
    controller.abort(); first.host.remove();
    const disposal = player.dispose();
    assert.equal(player.dispose(), disposal, 'all disposal callers await the same Quit completion');
    assert.equal(env.document.querySelector('#' + first.canvas.id), first.canvas);
    assert.equal(first.canvas.className, 'unity-retained-canvas');
    const second = env.mount(); const pending = createUnityPlayer(second.canvas);
    await tick(); assert.equal(calls, 1);
    assert.equal(first.canvas.isConnected, true);
    quitting.resolve(); await disposal; next = await pending;
    assert.equal(first.canvas.isConnected, false); assert.equal(calls, 2);
    await next.dispose();
    assert.equal(env.document.body.children.some(n => 'data-unity-retained' in n.attributes), false);
  } finally { quitting.resolve(); await next?.dispose(); env.restore(); }
});
