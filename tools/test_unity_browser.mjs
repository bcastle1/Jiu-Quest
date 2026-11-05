import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { chromium } from 'playwright';

const artifacts = resolve(process.env.JIUQUEST_BROWSER_ARTIFACTS || 'tmp/browser');
await mkdir(artifacts, { recursive: true });
const checks = [], images = [], moves = [], errors = [], assetFailures = [], dimensions = [];
let browser, server, page, networkMeasurement, speedMeasurement;
let expectedMissingManifest = false;

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
  await next.addInitScript(() => {
    window.__unityEvents = [];
    window.__progressWrites = [];
    window.__documentId = crypto.randomUUID();
    window.addEventListener('jiuquest:unity', (event) => window.__unityEvents.push({ ...event.detail, at: performance.now() }));
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) { if (key.startsWith('jiuquest:')) window.__progressWrites.push(key); return original.call(this, key, value); };
  });
  page = await next.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
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
  if (['Performing athlete', 'Gi colors'].includes(name)) {
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
  const label = value === 'orbit' ? 'Free rotate' : value[0].toUpperCase() + value.slice(1);
  const button = page.getByRole('group', { name: 'Camera view' }).getByRole('button', { name: label, exact: true });
  const since = await count(); await button.click(); await state(since);
  assert.equal(await button.getAttribute('aria-pressed'), 'true');
  await page.waitForTimeout(350); // Let the deliberately eased camera reach its preset before pixel evidence.
}

async function pause() {
  const button = page.getByRole('button', { name: 'Pause animation', exact: true });
  if (!await button.count()) return;
  const since = await count(); await button.click(); await state(since, { playing: false });
}

async function seek(progress) {
  const slider = page.getByRole('slider', { name: 'Review movement', exact: true });
  if (Number(await slider.inputValue()) === progress * 1000) return;
  const since = await count();
  if (progress === 0) await slider.press('Home');
  else if (progress === 1) await slider.press('End');
  else { const box = await slider.boundingBox(); await slider.click({ position: { x: box.width * progress, y: box.height / 2 } }); }
  const observed = await state(since, { playing: false });
  assert.ok(Math.abs(observed.progress - progress) < 0.05, `Seek ${progress} returned ${observed.progress}`);
}

async function capture(name, fullPage = false) {
  await page.evaluate(() => new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame))));
  const file = resolve(artifacts, `${name}.png`);
  const data = fullPage ? await page.screenshot({ path: file, fullPage: true }) : await page.locator('.unity-canvas').screenshot({ path: file });
  const evidence = { name, path: file, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') };
  images.push(evidence); return evidence;
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
  const base = process.env.JIUQUEST_PREVIEW_URL?.replace(/\/$/, '') || await staticSite();
  browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'], ...(process.env.JIUQUEST_BROWSER_CHANNEL ? { channel: process.env.JIUQUEST_BROWSER_CHANNEL } : {}), ...(process.env.JIUQUEST_BROWSER_EXECUTABLE ? { executablePath: process.env.JIUQUEST_BROWSER_EXECUTABLE } : {}) });
  const desktop = await context({ viewport: { width: 1440, height: 1000 } });
  const manifestResponse = await desktop.request.get(`${base}/unity/build-manifest.json`);
  assert.equal(manifestResponse.status(), 200);
  const manifest = await manifestResponse.json();
  assert.equal(manifest.protocolVersion, 1); assert.equal(manifest.supportedMoves.length, 16);
  await page.goto(`${base}/?preview=unity`); await ready(); await pause();
  const firstSession = await page.evaluate(() => window.__unityEvents.find((event) => event.type === 'ready').instanceId);
  for (const moveId of manifest.supportedMoves) {
    await select('Technique', moveId); await pause(); await seek(0.5);
    const image = await capture(`move-${moveId}`);
    assert.ok(image.bytes > 10000, `${moveId} has no substantial rendered output`);
    moves.push({ moveId, midpoint: Number(await page.getByRole('slider', { name: 'Review movement' }).inputValue()) / 1000, sha256: image.sha256 });
    console.log(`Rendered ${moveId}`);
  }
  checks.push('All 16 actual clips render and seek to their shared paired midpoint.');
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
  const rapidStart = await count();
  for (const moveId of ['armbar', 'guard_pass', 'double_leg', 'triangle_choke', 'trap_roll_escape']) await page.getByRole('combobox', { name: 'Technique', exact: true }).selectOption(moveId);
  await state(rapidStart, { moveId: 'trap_roll_escape' }); await ready(); await pause();
  assert.deepEqual(await page.evaluate(() => [...new Set(window.__unityEvents.map((event) => event.instanceId))]), [firstSession]);
  assert.equal(await page.evaluate(() => window.__unityEvents.filter((event) => event.type === 'error').length), 0);
  await select('Technique', 'double_leg'); await pause(); const normal = await measureRate(1); const slow = await measureRate(0.25); speedMeasurement = { normal, slow, ratio: slow.progressPerMs / normal.progressPerMs }; assert.ok(speedMeasurement.ratio > 0.1 && speedMeasurement.ratio < 0.5);
  checks.push('Rapid selections keep one runtime; measured quarter-speed playback is slower than normal.');
  await select('Technique', 'trap_roll_escape'); await pause(); await camera('front'); await seek(0.5); await capture('desktop-page', true);
  assert.deepEqual(await page.evaluate(() => window.__progressWrites), []);
  checks.push('Standalone playback does not write saved progression.');
  await page.goto(base); await page.getByRole('button', { name: 'Training', exact: true }).click(); await ready();
  assert.equal(new URL(page.url()).searchParams.has('engine'), false);
  await page.getByRole('button', { name: /Kimura Armlock/ }).click(); await page.getByRole('region', { name: 'Unity preview unavailable' }).waitFor();
  await page.getByRole('button', { name: /Rear Naked Choke/ }).click(); await ready();
  assert.equal(await page.evaluate(() => new Set(window.__unityEvents.filter((event) => event.type === 'ready').map((event) => event.instanceId)).size), 2);
  await page.goto(`${base}/?engine=snapshot`); await page.getByRole('button', { name: 'Training', exact: true }).click(); await page.getByRole('heading', { name: 'Position reference', exact: true }).waitFor(); assert.equal(await page.locator('.unity-stage').count(), 0);
  checks.push('Release default enables supported Training animations; unsupported lessons dispose the player; explicit snapshot rollback works.');
  await desktop.close();

  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 740 }, { width: 844, height: 390 }]) {
    const phone = await context({ viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    await page.goto(`${base}/?preview=unity`); await ready(); await state(0, { moveId: 'double_leg', playing: false });
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
        for (const view of ['front', 'side', 'overhead']) {
          await camera(view);
          for (const progress of [0, 0.5, 1]) { await seek(progress); await capture(`phone-framing-${moveId}-${view}-${progress}`); }
        }
      }
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
    await phone.close();
  }
  checks.push('Portrait, small-width and landscape mobile viewports have large readable stages, 44px camera controls, no overflow, reduced-motion pause and explicit playback.');

  const cold = await context({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const cdp = await cold.newCDPSession(page); await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true }); await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 500000, uploadThroughput: 150000 });
  const began = Date.now(); await page.goto(`${base}/?preview=unity`); await ready(); await state(0, { playing: false }); networkMeasurement = { downloadMbps: 4, latencyMs: 150, cacheDisabled: true, readyMs: Date.now() - began, physicalPhone: false }; assert.ok(networkMeasurement.readyMs < 90000); await capture('mobile-cold-network', true); await cold.close();
  checks.push('A fresh emulated mobile viewport reaches actual rendered readiness under 4Mbps/150ms network emulation within 90 seconds.');

  // This is an explicit negative test of a real missing-manifest response, never a substitute renderer.
  expectedMissingManifest = true;
  const failed = await context({ viewport: { width: 390, height: 844 } });
  await page.route('**/unity/build-manifest.json', (route) => route.fulfill({ status: 404, body: 'Deliberate unavailable-build test' }));
  await page.goto(`${base}/?engine=unity&view=training#keep`); await page.getByRole('button', { name: 'Training', exact: true }).click(); await page.locator('.unity-stage[data-unity-status="error"]').waitFor();
  const beforeFallback = await page.evaluate(() => ({ documentId: window.__documentId, progress: localStorage.getItem('jiuquest:v1') }));
  await page.getByRole('button', { name: 'Use position snapshots', exact: true }).click(); await page.getByRole('region', { name: 'Position snapshot view' }).waitFor();
  assert.deepEqual(await page.evaluate(() => ({ documentId: window.__documentId, progress: localStorage.getItem('jiuquest:v1') })), beforeFallback);
  assert.equal(new URL(page.url()).searchParams.get('engine'), 'snapshot'); assert.equal(new URL(page.url()).searchParams.get('view'), 'training'); assert.equal(new URL(page.url()).hash, '#keep');
  await failed.close();
  checks.push('Missing-build fallback changes to snapshots in-place, preserves saved progression/document state, and retains other URL settings.');
  assert.deepEqual(errors, []);
  assert.deepEqual(assetFailures, []);
  report = { checkedAtUtc: new Date().toISOString(), scope: 'Actual Unity WebGL; desktop GPU with mobile viewport/network emulation, not a physical-device performance benchmark. Only the final negative test mocks a 404 manifest.', manifest, checks, moves, images, dimensions, speedMeasurement, networkMeasurement, pageErrors: errors, assetFailures };
  console.log(JSON.stringify({ checks, moveCount: moves.length, dimensions, speedMeasurement, networkMeasurement, artifacts }, null, 2));
} catch (error) {
  await page?.screenshot({ path: resolve(artifacts, 'failure.png'), fullPage: true }).catch(() => {});
  report = { checkedAtUtc: new Date().toISOString(), checks, moves, images, dimensions, speedMeasurement, networkMeasurement, pageErrors: errors, assetFailures, failure: error.stack };
  console.error(error); process.exitCode = 1;
} finally {
  await writeFile(resolve(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  await browser?.close();
  if (server) { server.closeAllConnections(); await new Promise((resolveClose) => server.close(resolveClose)); }
}
