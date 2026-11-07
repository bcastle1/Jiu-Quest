import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, mkdir, stat, writeFile, rename } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { arch, cpus, platform, release, totalmem } from 'node:os';
import { chromium } from 'playwright';
import { installUnityStartupTelemetry } from './unity_startup_telemetry.mjs';

const artifacts = resolve(process.env.JIUQUEST_BROWSER_ARTIFACTS || 'tmp/browser');
await mkdir(artifacts, { recursive: true });
const checks = [], images = [], moves = [], errors = [], consoleErrors = [], expectedConsoleErrors = [], renderQualityLogs = [], assetFailures = [], dimensions = [], pauses = [];
const startedAtUtc = new Date().toISOString(), startedAt = Date.now(), checkpoints = [];
const pageContexts = new WeakMap();
let contextSequence = 0;
let browser, server, page, manifest, networkMeasurement, speedMeasurement, trainingLifecycle;
let expectedMissingManifest = false;
const browserOptions = { headless: true, args: ['--enable-unsafe-swiftshader'], ...(process.env.JIUQUEST_BROWSER_CHANNEL ? { channel: process.env.JIUQUEST_BROWSER_CHANNEL } : {}), ...(process.env.JIUQUEST_BROWSER_EXECUTABLE ? { executablePath: process.env.JIUQUEST_BROWSER_EXECUTABLE } : {}) };
const environment = { platform: platform(), osRelease: release(), architecture: arch(), node: process.version,
  cpuModel: cpus()[0]?.model ?? null, logicalCpuCount: cpus().length, totalMemoryBytes: totalmem(),
  browserChannel: process.env.JIUQUEST_BROWSER_CHANNEL || 'playwright-chromium', browserVersions: [], renderers: [] };

async function recordRenderer(phase, requireObservedRuntime = false) {
  // Normal probes run after rendered readiness. Failure probes additionally
  // require an observed live runtime; never create or presume a GPU/renderer.
  const renderer = await bounded(page.evaluate((requireObservedRuntime) => {
    // On failure the player may not have created its graphics context yet.
    // Do not create one merely to collect diagnostics.
    if (requireObservedRuntime && !window.__unityLifecycle?.some(runtime => Number.isFinite(runtime.createdAt) && !runtime.quitStarted))
      return { available: false, reason: 'No observed live Unity runtime; existing context was not queried' };
    const canvas = document.querySelector('.unity-canvas');
    const gl = canvas?.getContext('webgl2');
    if (!gl) return { available: false, reason: 'Existing WebGL2 context unavailable' };
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return { available: true, vendor: gl.getParameter(gl.VENDOR), renderer: gl.getParameter(gl.RENDERER),
      version: gl.getParameter(gl.VERSION), shadingLanguage: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
      unmaskedVendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : null,
      unmaskedRenderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null,
      drawingBuffer: { width: gl.drawingBufferWidth, height: gl.drawingBufferHeight }, userAgent: navigator.userAgent };
  }, requireObservedRuntime), 10000, 'Renderer diagnostics');
  const entry = { phase, context: pageContexts.get(page), atUtc: new Date().toISOString(), ...renderer };
  environment.renderers.push(entry);
  return entry;
}

async function bounded(promise, timeoutMs, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} exceeded ${timeoutMs}ms`)), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

function evidence(extra = {}) {
  return { startedAtUtc, checkedAtUtc: new Date().toISOString(), elapsedMs: Date.now() - startedAt, manifest, checkpoints,
    checks, moves, images, dimensions, pauses, trainingLifecycle, speedMeasurement, networkMeasurement,
    pageErrors: errors, consoleErrors, expectedConsoleErrors, renderQualityLogs, assetFailures, environment, ...extra };
}

async function checkpoint(stage, detail = {}) {
  const entry = { stage, atUtc: new Date().toISOString(), elapsedMs: Date.now() - startedAt, ...detail };
  checkpoints.push(entry);
  // Keep the last complete checkpoint if the workflow kills the process while
  // writing the next one. No browser round trip is needed to retain evidence.
  const pending = resolve(artifacts, 'checkpoint.next.json');
  await writeFile(pending, JSON.stringify(evidence({ status: 'in_progress', currentStage: stage }), null, 2));
  await rename(pending, resolve(artifacts, 'checkpoint.json'));
  console.log(`Checkpoint ${stage} at ${entry.atUtc} (${Math.round(entry.elapsedMs / 1000)}s)`);
}

async function closeContext(context, label) {
  await checkpoint(`${label}:closing`);
  await bounded(context.close(), 30000, `${label} context shutdown`);
  await checkpoint(`${label}:closed`);
}

async function staticSite() {
  const root = resolve('dist');
  await stat(resolve(root, 'index.html'));
  server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const file = resolve(root, `.${pathname.endsWith('/') ? `${pathname}index.html` : pathname}`);
      if (!file.startsWith(`${root}${sep}`)) { response.writeHead(403); response.end(); return; }
      let extension = extname(file);
      if (extension === '.gz' || extension === '.br') {
        response.setHeader('Content-Encoding', extension === '.gz' ? 'gzip' : 'br');
        extension = extname(file.slice(0, -extension.length));
      }
      const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
      const body = await readFile(file);
      response.setHeader('Content-Type', types[extension] || 'application/octet-stream');
      response.setHeader('Content-Length', body.length);
      response.setHeader('Cache-Control', 'public, max-age=60');
      response.writeHead(200); response.end(body);
    } catch { response.writeHead(404); response.end('Not found'); }
  });
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  return `http://127.0.0.1:${server.address().port}`;
}

async function context(options = {}) {
  const next = await browser.newContext(options);
  const contextIdentity = { id: ++contextSequence, createdPhase: checkpoints.at(-1)?.stage ?? 'starting' };
  await next.addInitScript(installUnityStartupTelemetry, { moveId: 'double_leg' });
  await next.addInitScript(() => {
    window.__unityEvents = [];
    window.__unityLifecycle = [];
    window.__progressWrites = [];
    window.__documentId = crypto.randomUUID();
    window.addEventListener('jiuquest:unity', (event) => {
      window.__unityEvents.push({ ...event.detail, at: performance.now() });
      if (event.detail.type === 'ready') {
        const runtime = window.__unityLifecycle.findLast((entry) => !entry.quitStarted);
        if (runtime) runtime.instanceId = event.detail.instanceId;
      }
    });
    // Observe real factory/Quit promises without substituting their results.
    // Capture runs before the loader's onload handler reads the factory.
    document.addEventListener('load', (event) => {
      if (event.target.tagName !== 'SCRIPT' || !event.target.src.includes('/unity/')) return;
      const factory = window.createUnityInstance;
      if (typeof factory !== 'function' || factory.__observedForTest) return;
      const observed = function (...args) {
        return factory.apply(this, args).then((instance) => {
          const runtime = { createdAt: performance.now(), quitStarted: false, quitCompleted: false };
          window.__unityLifecycle.push(runtime);
          const quit = instance.Quit.bind(instance);
          instance.Quit = (...quitArgs) => {
            runtime.quitStarted = true;
            return quit(...quitArgs).then((result) => {
              runtime.quitCompleted = true; runtime.quitCompletedAt = performance.now(); return result;
            });
          };
          return instance;
        });
      };
      observed.__observedForTest = true;
      window.createUnityInstance = observed;
    }, true);
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) { if (key.startsWith('jiuquest:')) window.__progressWrites.push(key); return original.call(this, key, value); };
  });
  page = await next.newPage();
  pageContexts.set(page, contextIdentity);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', message => {
    const text = message.text(), qualityDiagnostic = text.startsWith('JiuQuest render quality: ');
    if (message.type() !== 'error' && !qualityDiagnostic) return;
    const entry = { text, type: message.type(), location: message.location(), atUtc: new Date().toISOString(),
      phase: checkpoints.at(-1)?.stage ?? 'starting', context: contextIdentity };
    // Keep the actual C# diagnostic independent of JavaScript renderer identity.
    // Recording a profile does not select it or alter the rendered-ready gate.
    if (qualityDiagnostic) renderQualityLogs.push(entry);
    if (message.type() !== 'error') return;
    // Only the explicit unavailable-build test may log its manifest's 404.
    // Unity runtime errors can be console messages rather than pageerror events.
    if (expectedMissingManifest && entry.location.url.endsWith('/unity/build-manifest.json')
        && /Failed to load resource.*404/.test(entry.text)) expectedConsoleErrors.push(entry);
    else consoleErrors.push(entry);
  });
  page.on('response', (response) => {
    if (expectedMissingManifest && response.status() === 404 && response.url().endsWith('/unity/build-manifest.json')) return;
    if (response.status() >= 400 && /\/unity\//.test(response.url())) assetFailures.push({ url: response.url(), status: response.status() });
  });
  return next;
}

const count = () => page.evaluate(() => window.__unityEvents.length);
async function state(since, expected = {}) {
  await page.waitForFunction(({ since, expected }) => window.__unityEvents.slice(since).some((event) => ['state', 'completed'].includes(event.type) && Object.entries(expected).every(([key, value]) => event[key] === value)), { since, expected }, { timeout: 90000 });
  return page.evaluate(({ since, expected }) => window.__unityEvents.slice(since).findLast((event) => ['state', 'completed'].includes(event.type) && Object.entries(expected).every(([key, value]) => event[key] === value)), { since, expected });
}

async function ready() {
  await page.waitForFunction(() => ['error', 'ready'].includes(document.querySelector('.unity-stage')?.dataset.unityStatus), null, { timeout: 95000 });
  assert.equal(await page.locator('.unity-stage').getAttribute('data-unity-status'), 'ready', await page.locator('.unity-stage').innerText());
}

async function select(name, value) {
  if (['Performing athlete', 'Gi colors', 'Your hairstyle'].includes(name)) {
    const detail = page.locator('.unity-preview-options details');
    if (await detail.getAttribute('open') === null) await detail.locator('summary').click();
  }
  const field = page.getByRole('combobox', { name, exact: true });
  if (await field.inputValue() === value) return;
  const since = await count();
  await field.selectOption(value);
  await state(since, name === 'Technique' ? { moveId: value } : {}); await ready();
}

async function camera(value) {
  const label = value === 'orbit' ? 'Free rotate' : value === 'focus' ? 'Close-up' : value[0].toUpperCase() + value.slice(1);
  const button = page.getByRole('group', { name: 'Camera view' }).getByRole('button', { name: label, exact: true });
  const since = await count(); await button.click(); await state(since);
  assert.equal(await button.getAttribute('aria-pressed'), 'true');
  await page.waitForTimeout(350); // Let the deliberately eased camera reach its preset before pixel evidence.
}

async function selectedCamera(label) {
  const group = page.getByRole('group', { name: 'Camera view' });
  assert.equal(await group.getByRole('button', { name: label, exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await group.locator('button[aria-pressed="true"]').count(), 1);
}

async function pause() {
  const since = await count();
  // Check and invoke the currently displayed transport control in one browser
  // task. A short clip can otherwise finish during locator scrolling on a slow
  // software renderer, leaving Playwright waiting for an obsolete Pause label.
  const clicked = await page.evaluate(() => {
    const button = document.querySelector('button[aria-label="Pause animation"]');
    if (!button || button.disabled) return false;
    button.click(); return true;
  });
  if (clicked) await state(since, { playing: false });
  await page.waitForFunction(() => {
    const current = window.__unityEvents.findLast((event) => ['state', 'completed'].includes(event.type));
    return current?.playing === false && Boolean(document.querySelector('button[aria-label="Play animation"]'));
  }, null, { timeout: 30000 });
  const observed = await page.evaluate(() => window.__unityEvents.findLast((event) => ['state', 'completed'].includes(event.type)));
  assert.equal(observed.playing, false);
  pauses.push({ moveId: observed.moveId, type: observed.type, progress: observed.progress, clicked });
  return observed;
}

async function seek(progress) {
  const slider = page.getByRole('slider', { name: 'Review movement', exact: true });
  // Pointer/track geometry can map a midpoint click to 504. An unchanged thumb does
  // not fire React's change handler, so confirm this already-settled position.
  if (Math.abs(Number(await slider.inputValue()) - progress * 1000) < 5) {
    const observed = await pause();
    assert.ok(Math.abs(observed.progress - progress) < 0.005);
    return;
  }
  const previousValue = await slider.inputValue();
  const since = await count();
  if (progress === 0) await slider.press('Home');
  else if (progress === 1) await slider.press('End');
  else { const box = await slider.boundingBox(); await slider.click({ position: { x: box.width * progress, y: box.height / 2 } }); }
  // At quarter positions the native thumb inset can exceed five range units.
  // Clicking that same track position again emits no change event. Verify the
  // already-rendered paused state against the existing pointer seek tolerance.
  if (await slider.inputValue() === previousValue) {
    const current = await pause();
    assert.ok(Math.abs(current.progress - progress) < 0.05, `Unchanged seek ${progress} is at ${current.progress}`);
    return;
  }
  const observed = await state(since, { playing: false });
  assert.ok(Math.abs(observed.progress - progress) < 0.05, `Seek ${progress} returned ${observed.progress}`);
}

async function capture(name, fullPage = false) {
  await checkpoint(`capture:${name}:starting`);
  // evaluate() has no Playwright timeout. A stalled renderer must fail clearly,
  // rather than wait forever for frames that never arrived.
  await bounded(page.evaluate(() => new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)))), 30000, `${name} two-frame render wait`);
  const file = resolve(artifacts, `${name}.png`);
  const data = fullPage ? await page.screenshot({ path: file, fullPage: true }) : await page.locator('.unity-canvas').screenshot({ path: file });
  const evidence = { name, path: file, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') };
  images.push(evidence);
  await checkpoint(`capture:${name}:saved`);
  return evidence;
}

async function measureRate(speed) {
  await select('Speed', String(speed)); await seek(0);
  const since = await count(); await page.getByRole('button', { name: 'Play animation', exact: true }).click();
  await page.waitForFunction((start) => window.__unityEvents.slice(start).filter((event) => event.type === 'state' && event.playing).length >= 5, since);
  const samples = await page.evaluate((start) => window.__unityEvents.slice(start).filter((event) => event.type === 'state' && event.playing), since);
  await pause();
  const elapsedMs = samples.at(-1).at - samples[0].at;
  return { progressPerMs: (samples.at(-1).progress - samples[0].progress) / elapsedMs, elapsedMs, samples: samples.length };
}

let report;
try {
  await checkpoint('starting');
  const base = process.env.JIUQUEST_PREVIEW_URL?.replace(/\/$/, '') || await staticSite();
  browser = await chromium.launch(browserOptions);
  environment.browserVersions.push({ phase: 'inventory', version: browser.version() });
  // Inventory is deliberately paused, including on slow CI software rendering.
  // Separate transport checks below start and stop the actual playing runtime.
  const desktop = await context({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const manifestResponse = await desktop.request.get(`${base}/unity/build-manifest.json`);
  assert.equal(manifestResponse.status(), 200);
  manifest = await manifestResponse.json();
  assert.equal(manifest.protocolVersion, 1); assert.equal(manifest.supportedMoves.length, 16);
  await page.goto(`${base}/?preview=unity`); await ready(); await pause();
  await selectedCamera('Side');
  await recordRenderer('inventory');
  await checkpoint('desktop:ready');
  const firstSession = await page.evaluate(() => window.__unityEvents.find((event) => event.type === 'ready').instanceId);
  // Reduced-motion startup must freeze the whole scene, including ambient wind.
  // Inspect the rendered canvas, not only the transport's playing flag.
  await select('Technique', 'standing_stance'); await pause();
  await seek(0);
  const stillStance = await capture('stance-paused-start');
  await page.waitForTimeout(650);
  const heldStance = await capture('stance-paused-held');
  assert.equal(heldStance.sha256, stillStance.sha256, 'Paused fighters and scenery must remain visually still.');
  await seek(0.25);
  const shiftedStance = await capture('stance-weight-shift');
  assert.notEqual(shiftedStance.sha256, stillStance.sha256, 'Seeking the standing loop must change the actual rendered pose.');
  checks.push('Standing weight shift renders while paused fighters and ambient scenery remain visually still.');
  // The website opens side-on, while a deliberate view selection belongs to
  // this mounted stage and survives technique, appearance and replay changes.
  await camera('front');
  const selectedFront = await capture('stance-front-selected');
  assert.notEqual(selectedFront.sha256, shiftedStance.sha256, 'Choosing Front must visibly change the default Side presentation.');
  await select('Technique', 'grip_fighting'); await selectedCamera('Front');
  await select('Gi colors', 'night'); await selectedCamera('Front');
  const replayFromFront = await count();
  await page.getByRole('button', { name: 'Replay', exact: true }).click();
  await state(replayFromFront, { moveId: 'grip_fighting', playing: true }); await pause(); await selectedCamera('Front');
  await select('Technique', 'standing_stance'); await select('Gi colors', 'classic'); await seek(0.25); await selectedCamera('Front');
  checks.push('Side is the default website view; a selected Front view changes rendered pixels and persists through technique, appearance and replay.');
  await camera('focus');
  const hairstyles = [];
  for (const style of ['shadow spikes', 'short fade', 'slicked back', 'long hair', 'mohawk', 'bald']) {
    await select('Your hairstyle', style); await pause(); await seek(0.25);
    hairstyles.push(await capture(`hair-${style.replaceAll(' ', '-')}`));
  }
  assert.equal(new Set(hairstyles.map(image => image.sha256)).size, hairstyles.length,
    'Each hairstyle must visibly change the paused rendered athlete.');
  await select('Your hairstyle', 'shadow spikes');
  const colorways = [];
  for (const kit of ['classic', 'night', 'summit']) {
    await select('Gi colors', kit); await pause(); await seek(0.25);
    colorways.push(await capture(`textured-gi-${kit}`));
  }
  assert.equal(new Set(colorways.map(image => image.sha256)).size, colorways.length,
    'Textured clothing must retain all three distinct selectable colorways.');
  await select('Gi colors', 'classic'); await camera('front');
  checks.push('All six hairstyles and three textured clothing colorways produce distinct paused renders.');
  for (const moveId of manifest.supportedMoves) {
    await checkpoint('clip:starting', { moveId });
    await select('Technique', moveId); await pause(); await seek(0.5);
    const image = await capture(`move-${moveId}`);
    assert.ok(image.bytes > 10000, `${moveId} has no substantial rendered output`);
    moves.push({ moveId, midpoint: Number(await page.getByRole('slider', { name: 'Review movement' }).inputValue()) / 1000, sha256: image.sha256 });
    console.log(`Rendered ${moveId}`);
    await checkpoint('clip:rendered', { moveId });
  }
  checks.push('All 16 actual clips render and seek to their shared paired midpoint.');
  await checkpoint('desktop:visual-controls');
  await select('Technique', 'rear_naked_choke'); await pause(); await camera('front'); await seek(0.5); await capture('review-rnc-front');
  await select('Technique', 'double_leg'); await pause(); await camera('front'); await seek(1); const wideFinish = await capture('review-doubleleg-finish');
  await camera('focus'); const closeFinish = await capture('review-doubleleg-close-up');
  assert.notEqual(closeFinish.sha256, wideFinish.sha256, 'Close-up must change the actual ground-pose framing.');
  assert.equal(await page.getByRole('group', { name: 'Camera view' }).getByRole('button').count(), 5);
  checks.push('Close-up uses the real camera control and changes the rendered ground-pose framing.');
  await select('Technique', 'trap_roll_escape'); await pause(); await camera('front');
  await seek(1); const finish = await capture('escape-finish'); await seek(0); const start = await capture('escape-start'); await seek(0.5); const middle = await capture('escape-middle');
  assert.equal(new Set([start.sha256, middle.sha256, finish.sha256]).size, 3);
  await select('Performing athlete', 'opponent'); await pause(); await seek(0.5); const reversed = await capture('escape-opponent'); assert.notEqual(reversed.sha256, middle.sha256);
  await select('Gi colors', 'night'); await pause(); await seek(0.5); const kits = await capture('escape-night-kits'); assert.notEqual(kits.sha256, reversed.sha256);
  await camera('side'); const side = await capture('escape-side'); await camera('overhead'); const overhead = await capture('escape-overhead'); assert.notEqual(side.sha256, overhead.sha256);
  await camera('orbit'); const beforeDrag = await capture('orbit-before-drag');
  const box = await page.locator('.unity-canvas').boundingBox(); await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5); await page.mouse.down(); await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.4, { steps: 10 }); await page.mouse.up();
  assert.notEqual((await capture('orbit-after-drag')).sha256, beforeDrag.sha256);
  checks.push('Seeks, reversed performer, kits, presets and manual orbit change the actual rendered canvas.');
  await checkpoint('desktop:playback-controls');
  const rapidStart = await count();
  for (const moveId of ['armbar', 'guard_pass', 'double_leg', 'triangle_choke', 'trap_roll_escape']) await page.getByRole('combobox', { name: 'Technique', exact: true }).selectOption(moveId);
  await state(rapidStart, { moveId: 'trap_roll_escape' }); await ready(); await pause();
  assert.deepEqual(await page.evaluate(() => [...new Set(window.__unityEvents.map((event) => event.instanceId))]), [firstSession]);
  assert.equal(await page.evaluate(() => window.__unityEvents.filter((event) => event.type === 'error').length), 0);
  await select('Technique', 'double_leg'); await pause(); await select('Speed', '0.25'); await seek(0);
  const playStart = await count(); await page.getByRole('button', { name: 'Play animation', exact: true }).click(); await state(playStart, { playing: true });
  const pauseStart = await count(); await page.getByRole('button', { name: 'Pause animation', exact: true }).click({ timeout: 30000 }); await state(pauseStart, { playing: false });
  checks.push('A real Playwright click on Play and Pause controls starts and stops actual runtime playback.');
  const normal = await measureRate(1); const slow = await measureRate(0.25); speedMeasurement = { normal, slow, ratio: slow.progressPerMs / normal.progressPerMs }; assert.ok(speedMeasurement.ratio > 0.1 && speedMeasurement.ratio < 0.5);
  checks.push('Rapid selections keep one runtime; measured quarter-speed playback is slower than normal.');
  await select('Technique', 'trap_roll_escape'); await pause(); await camera('front'); await seek(0.5); await capture('desktop-page', true);
  assert.deepEqual(await page.evaluate(() => window.__progressWrites), []);
  checks.push('Standalone playback does not write saved progression.');
  await checkpoint('training:starting');
  await page.goto(base); await page.getByRole('button', { name: 'Training', exact: true }).click(); await ready();
  await selectedCamera('Side');
  assert.equal(new URL(page.url()).searchParams.has('engine'), false);
  const priorTrainingInstance = await page.evaluate(() => window.__unityEvents.findLast((event) => event.type === 'ready').instanceId);
  await page.getByRole('button', { name: /Kimura Armlock/ }).click(); await page.getByRole('region', { name: 'Unity preview unavailable' }).waitFor();
  assert.equal(await page.locator('.unity-canvas').count(), 0);
  await page.waitForFunction((id) => window.__unityLifecycle.some((entry) => entry.instanceId === id && entry.quitCompleted), priorTrainingInstance, { timeout: 90000 });
  await checkpoint('training:prior-instance-disposed');
  await page.getByRole('button', { name: /Rear Naked Choke/ }).click();
  // React may briefly retain the preceding phase='ready' before its new effect.
  // Require a fresh actual handshake and move state, not that transient label.
  await page.waitForFunction((prior) => window.__unityEvents.some((event) => event.type === 'ready' && event.instanceId !== prior)
    && window.__unityEvents.some((event) => event.type === 'state' && event.instanceId !== prior && event.moveId === 'rear_naked_choke'), priorTrainingInstance, { timeout: 95000 });
  await ready();
  assert.equal(await page.evaluate(() => new Set(window.__unityEvents.filter((event) => event.type === 'ready').map((event) => event.instanceId)).size), 2);
  await selectedCamera('Side');
  trainingLifecycle = await page.evaluate(() => window.__unityLifecycle);
  assert.equal(trainingLifecycle.length, 2);
  assert.equal(trainingLifecycle[0].quitCompleted, true);
  assert.ok(trainingLifecycle[0].quitCompletedAt <= trainingLifecycle[1].createdAt);
  assert.equal(trainingLifecycle[1].quitStarted, false);
  await checkpoint('training:fresh-instance-ready');
  await page.goto(`${base}/?engine=snapshot`); await page.getByRole('button', { name: 'Training', exact: true }).click(); await page.getByRole('heading', { name: 'Position reference', exact: true }).waitFor(); assert.equal(await page.locator('.unity-stage').count(), 0);
  checks.push('Release default enables supported Training animations; unsupported lessons dispose the player; explicit snapshot rollback works.');
  await closeContext(desktop, 'desktop');

  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 740 }, { width: 844, height: 390 }]) {
    await checkpoint('mobile:starting', { viewport });
    const phone = await context({ viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    await page.goto(`${base}/?preview=unity`); await ready(); await state(0, { moveId: 'double_leg', playing: false });
    await selectedCamera('Side');
    assert.equal(await page.evaluate(() => window.__unityEvents.some((event) => event.type === 'state' && event.playing)), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    const stage = await page.locator('.unity-viewport').boundingBox(); dimensions.push({ viewport, stage });
    assert.ok(stage.width >= viewport.width - 60);
    assert.ok(stage.height >= (viewport.height > viewport.width ? 360 : 210));
    assert.ok(stage.y < 410, 'combat must appear near the top of the phone page');
    for (const button of await page.getByRole('group', { name: 'Camera view' }).getByRole('button').all()) assert.ok((await button.boundingBox()).height >= 44);
    if (viewport.width === 390) {
      for (const moveId of ['double_leg', 'trap_roll_escape']) {
        await select('Technique', moveId);
        for (const view of ['front', 'focus', 'side', 'overhead']) {
          await camera(view);
          for (const progress of [0, 0.5, 1]) { await seek(progress); await capture(`phone-framing-${moveId}-${view}-${progress}`); }
        }
      }
      await camera('orbit'); await seek(0.5);
      const beforeTouch = await capture('phone-orbit-before-touch');
      await page.locator('.unity-canvas').scrollIntoViewIfNeeded();
      const touchBox = await page.locator('.unity-canvas').boundingBox();
      const touchSession = await phone.newCDPSession(page);
      const x = touchBox.x + touchBox.width * 0.35, y = touchBox.y + touchBox.height * 0.5;
      await touchSession.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
      for (let step = 1; step <= 8; step += 1) await touchSession.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + touchBox.width * 0.3 * step / 8, y: y - 20 * step / 8, id: 1 }] });
      await touchSession.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(350);
      assert.notEqual((await capture('phone-orbit-after-touch')).sha256, beforeTouch.sha256, 'Touch drag must rotate the actual paused scene');
      await touchSession.detach();
      const instanceBeforeResize = await page.evaluate(() => window.__unityEvents.find((event) => event.type === 'ready').instanceId);
      await page.setViewportSize({ width: 844, height: 390 });
      await page.waitForFunction(() => document.querySelector('.unity-canvas').getBoundingClientRect().width > 640);
      await ready(); await capture('phone-orientation-change', true);
      await page.setViewportSize(viewport);
      await page.waitForFunction(() => document.querySelector('.unity-canvas').getBoundingClientRect().width < 640);
      assert.deepEqual(await page.evaluate(() => [...new Set(window.__unityEvents.map((event) => event.instanceId))]), [instanceBeforeResize]);
    }
    await select('Technique', 'trap_roll_escape'); await seek(0.5); await camera('side'); await capture(`mobile-${viewport.width}x${viewport.height}`, true);
    if (viewport.width > viewport.height && await page.getByRole('button', { name: 'Enter full screen', exact: true }).count()) {
      await page.getByRole('button', { name: 'Enter full screen', exact: true }).click();
      await page.waitForFunction(() => Boolean(document.fullscreenElement));
      await capture('mobile-landscape-fullscreen', true);
      await page.getByRole('button', { name: 'Exit full screen', exact: true }).click();
      await page.waitForFunction(() => !document.fullscreenElement);
    }
    const since = await count(); await page.getByRole('button', { name: 'Play animation', exact: true }).click(); await state(since, { playing: true }); await pause();
    assert.deepEqual(await page.evaluate(() => window.__progressWrites), []);
    await closeContext(phone, `mobile-${viewport.width}x${viewport.height}`);
  }
  checks.push('Portrait, small-width and landscape mobile viewports have large readable stages, 44px camera controls, touch-drag orbit, no overflow, reduced-motion pause and explicit playback.');

  // A fresh context alone still shares the preceding inventory's long-lived
  // software GPU process. Start this cold benchmark in a fresh browser too.
  assert.equal(browser.contexts().length, 0, 'Earlier test contexts must be closed before the cold benchmark');
  await checkpoint('cold-network:browser-closing');
  await bounded(browser.close(), 30000, 'Pre-benchmark browser shutdown');
  browser = undefined; page = undefined;
  await checkpoint('cold-network:browser-closed');
  await checkpoint('cold-network:browser-launching');
  browser = await chromium.launch(browserOptions);
  environment.browserVersions.push({ phase: 'cold-network', version: browser.version() });
  await checkpoint('cold-network:browser-launched');
  await checkpoint('cold-network:starting');
  const cold = await context({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const cdp = await cold.newCDPSession(page); await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true }); await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 500000, uploadThroughput: 150000 });
  const began = Date.now();
  await page.goto(`${base}/?preview=unity`);
  // Numeric polling avoids adding another render-frame wait to the controller.
  // The unchanged 90s gate measures the page's genuine settled-and-rendered
  // milestone, not the cost of later CDP/DOM round trips on a software GPU.
  await page.waitForFunction(() => Number.isFinite(window.__unityStartupTelemetry?.renderedReadyMs)
    || document.querySelector('.unity-stage')?.dataset.unityStatus === 'error', null, { polling: 100, timeout: 95000 });
  const telemetry = await bounded(page.evaluate(() => ({
    startup: window.__unityStartupTelemetry,
    stage: document.querySelector('.unity-stage')?.dataset.unityStatus,
    resources: performance.getEntriesByType('resource').filter((entry) => /\/(unity|animations)\//.test(entry.name)).map((entry) => ({
      name: new URL(entry.name).pathname, startTime: entry.startTime, responseEnd: entry.responseEnd,
      duration: entry.duration, transferSize: entry.transferSize, encodedBodySize: entry.encodedBodySize,
    })),
    factoryCreatedMs: window.__unityLifecycle[0]?.createdAt ?? null,
  })), 10000, 'Cold startup telemetry');
  const controllerElapsedMs = Date.now() - began;
  networkMeasurement = { downloadMbps: 4, latencyMs: 150, cacheDisabled: true, freshBrowserProcess: true,
    readyMs: telemetry.startup?.renderedReadyMs, readyClock: 'page performance.now, navigation-relative, after matching paused initial move and two rendered frames',
    controllerElapsedMs, navigationCommandDelayMs: telemetry.startup.navigationTimeOrigin - began,
    automationDelayMs: controllerElapsedMs - (telemetry.startup.renderedReadyMs ?? 0) - (telemetry.startup.navigationTimeOrigin - began),
    ...telemetry, physicalPhone: false };
  await recordRenderer('cold-network-after-measurement');
  await checkpoint('cold-network:measured');
  assert.equal(telemetry.stage, 'ready');
  assert.equal(telemetry.startup.error, null);
  assert.equal(telemetry.startup.renderedFrames, 2);
  assert.ok(Number.isFinite(networkMeasurement.readyMs) && networkMeasurement.readyMs < 90000);
  await ready(); await state(0, { moveId: 'double_leg', playing: false, progress: 0 });
  await capture('mobile-cold-network', true); await closeContext(cold, 'cold-network');
  checks.push('A fresh emulated mobile viewport reaches actual rendered readiness under 4Mbps/150ms network emulation within 90 seconds.');

  // This is an explicit negative test of a real missing-manifest response, never a substitute renderer.
  expectedMissingManifest = true;
  await checkpoint('missing-build-fallback:starting');
  const failed = await context({ viewport: { width: 390, height: 844 } });
  await page.route('**/unity/build-manifest.json', (route) => route.fulfill({ status: 404, body: 'Deliberate unavailable-build test' }));
  await page.goto(`${base}/?engine=unity&view=training#keep`); await page.getByRole('button', { name: 'Training', exact: true }).click(); await page.locator('.unity-stage[data-unity-status="error"]').waitFor();
  const beforeFallback = await page.evaluate(() => ({ documentId: window.__documentId, progress: localStorage.getItem('jiuquest:v1') }));
  await page.getByRole('button', { name: 'Use position snapshots', exact: true }).click(); await page.getByRole('region', { name: 'Position snapshot view' }).waitFor();
  assert.deepEqual(await page.evaluate(() => ({ documentId: window.__documentId, progress: localStorage.getItem('jiuquest:v1') })), beforeFallback);
  assert.equal(new URL(page.url()).searchParams.get('engine'), 'snapshot'); assert.equal(new URL(page.url()).searchParams.get('view'), 'training'); assert.equal(new URL(page.url()).hash, '#keep');
  await closeContext(failed, 'missing-build-fallback');
  checks.push('Missing-build fallback changes to snapshots in-place, preserves saved progression/document state, and retains other URL settings.');
  assert.deepEqual(errors, []);
  assert.deepEqual(consoleErrors, [], 'Unexpected browser or Unity console errors');
  assert.deepEqual(assetFailures, []);
  await checkpoint('verification:passed');
  report = evidence({ status: 'passed', scope: 'Actual Unity WebGL in desktop Chromium with mobile viewport/network emulation, not a physical-device performance benchmark. Only the final negative test mocks a 404 manifest.' });
  console.log(JSON.stringify({ checks, moveCount: moves.length, dimensions, speedMeasurement, networkMeasurement, artifacts }, null, 2));
} catch (error) {
  const failurePhase = checkpoints.at(-1)?.stage ?? 'starting';
  report = evidence({ status: 'failed', failure: error.stack || String(error), failurePhase, failureContext: pageContexts.get(page) });
  // Persist the original failure before querying a possibly unresponsive page.
  await writeFile(resolve(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  if (page && !page.isClosed()) {
    const diagnostics = await Promise.allSettled([
      bounded(page.evaluate(() => ({
        url: location.href, observedAtMs: performance.now(), navigationTimeOrigin: performance.timeOrigin,
        documentVisibility: document.visibilityState,
        stage: document.querySelector('.unity-stage')?.dataset.unityStatus,
        stageText: document.querySelector('.unity-stage')?.innerText,
        visibleTransport: [...document.querySelectorAll('button[aria-label="Play animation"],button[aria-label="Pause animation"]')].map((button) => ({ label: button.getAttribute('aria-label'), disabled: button.disabled })),
        recentUnityEvents: window.__unityEvents?.slice(-20), unityLifecycle: window.__unityLifecycle,
        latestReady: window.__unityEvents?.findLast(event => event.type === 'ready') ?? null,
        latestState: window.__unityEvents?.findLast(event => event.type === 'state' || event.type === 'completed') ?? null,
        startup: window.__unityStartupTelemetry,
        resources: performance.getEntriesByType('resource').map((entry) => ({ ...entry.toJSON(), name: new URL(entry.name).pathname })),
        navigation: performance.getEntriesByType('navigation').map((entry) => ({ ...entry.toJSON(), name: new URL(entry.name).pathname })),
        paints: performance.getEntriesByType('paint').map((entry) => entry.toJSON()),
        canvas: [...document.querySelectorAll('.unity-canvas')].map((canvas) => ({
          width: canvas.width, height: canvas.height, bounds: canvas.getBoundingClientRect().toJSON(),
          visibility: getComputedStyle(canvas).visibility, display: getComputedStyle(canvas).display,
          opacity: getComputedStyle(canvas).opacity,
          checkVisibility: canvas.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }),
        })),
      })), 10000, 'Failure diagnostics'),
      recordRenderer(`failure:${failurePhase}`, true),
    ]);
    report.diagnostics = diagnostics[0].status === 'fulfilled' ? diagnostics[0].value : { unavailable: String(diagnostics[0].reason) };
    report.failureRenderer = diagnostics[1].status === 'fulfilled' ? diagnostics[1].value : { unavailable: String(diagnostics[1].reason) };
    report.diagnosticErrors = diagnostics.filter((result) => result.status === 'rejected').map((result) => String(result.reason));
    if (failurePhase.startsWith('cold-network:')) {
      report.failedColdStartup = { observedAfterFailure: true, renderedStartupGateMs: 90000, controllerWaitMs: 95000,
        startup: report.diagnostics.startup ?? null, stage: report.diagnostics.stage ?? null,
        latestReady: report.diagnostics.latestReady ?? null, latestState: report.diagnostics.latestState ?? null,
        observedAtMs: report.diagnostics.observedAtMs ?? null };
    }
    // Save lightweight telemetry before a screenshot can occupy a slow renderer.
    // Diagnostic failures must never replace the original test failure.
    await writeFile(resolve(artifacts, 'report.json'), JSON.stringify(report, null, 2)).catch(failure => report.diagnosticErrors.push(`Diagnostic evidence save: ${failure}`));
    await bounded(page.screenshot({ path: resolve(artifacts, 'failure.png'), fullPage: true, timeout: 10000 }), 12000, 'Failure screenshot')
      .catch(failure => report.diagnosticErrors.push(String(failure)));
  }
  console.error(error); process.exitCode = 1;
} finally {
  await writeFile(resolve(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  const shutdownErrors = [];
  try { if (browser) await bounded(browser.close(), 30000, 'Browser shutdown'); } catch (error) { shutdownErrors.push(String(error)); }
  try { if (server) { server.closeAllConnections(); await bounded(new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose())), 5000, 'Static server shutdown'); } } catch (error) { shutdownErrors.push(String(error)); }
  report.shutdown = { completedAtUtc: new Date().toISOString(), errors: shutdownErrors };
  if (shutdownErrors.length) {
    process.exitCode = 1; report.status = 'failed'; report.failure ??= shutdownErrors.join('\n');
  }
  await writeFile(resolve(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  // If the browser transport remains stuck, exit only this harness process
  // after saving evidence. Playwright's process-exit hook cleans up its own child.
  if (shutdownErrors.length) setTimeout(() => process.exit(1), 1000).unref();
}
