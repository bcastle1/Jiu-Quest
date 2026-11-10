import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { chromium } from 'playwright';
import { serveBrowserAsset } from './browser_asset_response.mjs';

const root = resolve('dist');
const artifacts = resolve(process.env.JIUQUEST_BROWSER_ARTIFACTS || 'tmp/browser', 'startup-unmount');
await mkdir(artifacts, { recursive: true });
const errors = [], consoleErrors = [];
let browser, context, server, page, releaseDownload;
let evidence = { startedAtUtc: new Date().toISOString(), status: 'running' };
const save = () => writeFile(resolve(artifacts, 'report.json'), JSON.stringify({ ...evidence, errors, consoleErrors }, null, 2));
try {
  await readFile(resolve(root, 'index.html'));
  server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const file = resolve(root, `.${pathname.endsWith('/') ? pathname + 'index.html' : pathname}`);
      if (!file.startsWith(root + sep)) { response.writeHead(403); response.end(); return; }
      const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
      serveBrowserAsset(response, { file, body: await readFile(file), contentType: types[extname(file)] || 'application/octet-stream', acceptEncoding: request.headers['accept-encoding'] });
    } catch { response.writeHead(404); response.end('Not found'); }
  });
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'],
    ...(process.env.JIUQUEST_BROWSER_CHANNEL ? { channel: process.env.JIUQUEST_BROWSER_CHANNEL } : {}),
    ...(process.env.JIUQUEST_BROWSER_EXECUTABLE ? { executablePath: process.env.JIUQUEST_BROWSER_EXECUTABLE } : {}) });
  context = await browser.newContext({ reducedMotion: 'reduce' });
  await context.addInitScript(() => {
    window.__canvasLifetimes = [];
    document.addEventListener('load', event => {
      if (event.target.tagName !== 'SCRIPT' || !event.target.src.includes('/unity/')) return;
      const factory = window.createUnityInstance;
      if (typeof factory !== 'function' || factory.__canvasObserved) return;
      const observed = (...args) => {
        const row = { canvasId: args[0].id, factoryStarted: performance.now() };
        window.__canvasLifetimes.push(row);
        return factory(...args).then(instance => {
          row.factoryCompleted = performance.now();
          const quit = instance.Quit.bind(instance);
          instance.Quit = (...values) => {
            row.quitStarted = performance.now();
            return quit(...values).then(value => { row.quitCompleted = performance.now(); return value; });
          };
          return instance;
        });
      };
      observed.__canvasObserved = true; window.createUnityInstance = observed;
    }, true);
  });
  page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole('button', { name: 'Training', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.unity-stage')?.dataset.unityStatus === 'ready', null, { timeout: 95000 });
  await page.getByRole('button', { name: /Trap and Roll Escape standard/ }).click();
  const before = await page.locator('.progress-orb').innerText();
  await page.getByRole('button', { name: /Trap and Roll Escape punch block variation/ }).click();
  await page.getByRole('region', { name: 'Unity preview unavailable' }).waitFor();
  await page.waitForFunction(() => window.__canvasLifetimes[0]?.quitCompleted, null, { timeout: 90000 });

  // Hold an actual Wasm request, not the factory result. Startup is genuinely
  // unresolved when navigation removes the React host; the original response
  // is subsequently delivered without altering any Unity bytes.
  let downloadHeld;
  const held = new Promise(resolveHeld => { downloadHeld = resolveHeld; });
  const gate = new Promise(resolveGate => { releaseDownload = resolveGate; });
  let first = true;
  await page.route('**/*.wasm.unityweb', async route => {
    if (first) { first = false; downloadHeld(); await gate; }
    await route.continue();
  });
  await page.getByRole('button', { name: /Trap and Roll Escape standard/ }).click();
  let timer;
  try { await Promise.race([held, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Real Wasm request was not observed')), 90000); })]); }
  finally { clearTimeout(timer); }
  const starting = await page.evaluate(() => window.__canvasLifetimes[1]);
  assert.ok(starting && !starting.factoryCompleted, 'second real factory must still be initializing');
  await page.getByRole('button', { name: 'Arena', exact: true }).click();
  evidence.retainedDuringArena = await page.evaluate(id => {
    const canvas = document.getElementById(id);
    return { connected: canvas?.isConnected, retained: Boolean(canvas?.closest('[data-unity-retained]')), width: canvas?.getBoundingClientRect().width, visibleStages: document.querySelectorAll('.unity-stage').length };
  }, starting.canvasId);
  assert.equal(evidence.retainedDuringArena.connected, true);
  assert.equal(evidence.retainedDuringArena.retained, true);
  assert.ok(evidence.retainedDuringArena.width > 0);
  assert.equal(evidence.retainedDuringArena.visibleStages, 0);
  assert.equal(await page.locator('.unity-canvas').count(), 0, 'retired canvases are not active preview surfaces');
  await page.getByRole('button', { name: 'Training', exact: true }).click();
  assert.equal(await page.evaluate(() => window.__canvasLifetimes.length), 2, 'replacement waits while previous factory owns its lease');
  assert.notEqual(await page.locator('.unity-stage canvas').getAttribute('id'), starting.canvasId);
  releaseDownload();
  await page.waitForFunction(() => document.querySelector('.unity-stage')?.dataset.unityStatus === 'ready', null, { timeout: 95000 });
  evidence.lifetimes = await page.evaluate(() => window.__canvasLifetimes);
  assert.equal(evidence.lifetimes.length, 3);
  assert.ok(evidence.lifetimes[1].factoryCompleted <= evidence.lifetimes[1].quitStarted);
  assert.ok(evidence.lifetimes[1].quitCompleted <= evidence.lifetimes[2].factoryStarted);
  assert.equal(await page.locator('[data-unity-retained]').count(), 0);
  assert.equal(await page.locator('.unity-canvas').count(), 1);
  assert.equal(await page.locator('.progress-orb').innerText(), before, 'lifecycle navigation does not award repetitions');
  await page.getByRole('button', { name: 'Play animation', exact: true }).click();
  await page.waitForFunction(() => Number(document.querySelector('[aria-label="Review movement"]')?.value) > 0, null, { timeout: 30000 });
  await page.getByRole('button', { name: 'Pause animation', exact: true }).click();
  assert.deepEqual(errors, []); assert.deepEqual(consoleErrors, []);
  await page.screenshot({ path: resolve(artifacts, 'reacquired-training.png'), fullPage: true });
  evidence.status = 'passed'; evidence.completedAtUtc = new Date().toISOString();
  evidence.scope = 'Real generated Unity factory and original Wasm response; delayed request, unsupported lesson, navigation during startup, queued reacquisition, real playback, no console/page errors.';
  await save();
  console.log('Unity startup/unmount/reacquire browser regression passed.');
} catch (error) {
  evidence.status = 'failed'; evidence.failure = error.stack || String(error);
  if (page && !page.isClosed()) {
    evidence.lifetimes = await page.evaluate(() => window.__canvasLifetimes).catch(() => null);
    await page.screenshot({ path: resolve(artifacts, 'failure.png'), fullPage: true }).catch(() => {});
  }
  await save(); throw error;
} finally {
  releaseDownload?.();
  await context?.close(); await browser?.close();
  if (server) { server.closeAllConnections(); await new Promise(resolveClose => server.close(resolveClose)); }
}
