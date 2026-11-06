// Capture the actual local Unity player, never a substitute renderer or pose.
// JIUQUEST_CAPTURE_BUILD=<generatedUtc> node tools/capture_game_graphics.mjs
// Optional: JIUQUEST_PREVIEW_URL, JIUQUEST_CAPTURE_DIR, JIUQUEST_BROWSER_CHANNEL,
// JIUQUEST_BROWSER_EXECUTABLE, JIUQUEST_CAPTURE_DEVICE (desktop or phone).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const base = (process.env.JIUQUEST_PREVIEW_URL || 'http://127.0.0.1:4173').replace(/\/$/, '');
const expectedBuild = process.env.JIUQUEST_CAPTURE_BUILD;
assert.ok(expectedBuild, 'Set JIUQUEST_CAPTURE_BUILD to the new build-manifest generatedUtc.');
const output = resolve(process.env.JIUQUEST_CAPTURE_DIR || 'tmp/game-graphics');
await mkdir(output, { recursive: true });
const response = await fetch(`${base}/unity/build-manifest.json`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
assert.equal(response.status, 200);
const manifestText = await response.text(), manifest = JSON.parse(manifestText);
assert.equal(manifest.generatedUtc, expectedBuild, 'The server is serving a different Unity build.');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const report = { startedUtc: new Date().toISOString(), status: 'running', base, manifest,
  manifestSha256: hash(manifestText), screenshots: [], devices: [], playback: [], hairstyles: [], focusPoses: [], pageErrors: [], assetFailures: [] };
const devices = [
  { name: 'desktop', viewport: { width: 1440, height: 1000 } },
  { name: 'phone', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
].filter((device) => !process.env.JIUQUEST_CAPTURE_DEVICE || device.name === process.env.JIUQUEST_CAPTURE_DEVICE);
assert.ok(devices.length, 'JIUQUEST_CAPTURE_DEVICE must be desktop or phone.');
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'],
  ...(process.env.JIUQUEST_BROWSER_CHANNEL ? { channel: process.env.JIUQUEST_BROWSER_CHANNEL } : {}),
  ...(process.env.JIUQUEST_BROWSER_EXECUTABLE ? { executablePath: process.env.JIUQUEST_BROWSER_EXECUTABLE } : {}) });
let page, device;
const save = () => writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
const count = () => page.evaluate(() => window.__graphicsEvents.length);
async function bounded(promise, ms, label) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms`)), ms); })]); }
  finally { clearTimeout(timer); }
}
async function state(since, expected = {}) {
  await page.waitForFunction(({ since, expected }) => window.__graphicsEvents.slice(since).some((event) =>
    event.type === 'error' || ['state', 'completed'].includes(event.type) && Object.entries(expected).every(([key, value]) => event[key] === value)),
  { since, expected }, { timeout: 90000 });
  const error = await page.evaluate((since) => window.__graphicsEvents.slice(since).find((event) => event.type === 'error'), since);
  assert.ok(!error, error?.message || 'The Unity runtime emitted an error.');
  return page.evaluate(({ since, expected }) => window.__graphicsEvents.slice(since).findLast((event) =>
    ['state', 'completed'].includes(event.type) && Object.entries(expected).every(([key, value]) => event[key] === value)), { since, expected });
}
async function ready() {
  await page.waitForFunction(() => ['ready', 'error'].includes(document.querySelector('.unity-stage')?.dataset.unityStatus), null, { timeout: 95000 });
  assert.equal(await page.locator('.unity-stage').getAttribute('data-unity-status'), 'ready', await page.locator('.unity-stage').innerText());
}
async function select(name, value) {
  if (['Gi colors', 'Your hairstyle'].includes(name)) {
    const detail = page.locator('.unity-preview-options details');
    if (await detail.getAttribute('open') === null) await detail.locator('summary').click();
  }
  const field = page.getByRole('combobox', { name, exact: true });
  if (await field.inputValue() === value) return;
  const since = await count();
  const moveId = name === 'Technique' ? value : await page.getByRole('combobox', { name: 'Technique', exact: true }).inputValue();
  await field.selectOption(value);
  // A ready DOM marker from the prior scene alone is not sufficient evidence.
  const accepted = await state(since, { moveId, playing: false });
  await ready();
  return accepted;
}
async function camera(view, moveId) {
  const label = view === 'focus' ? 'Close-up' : view === 'orbit' ? 'Free rotate' : view[0].toUpperCase() + view.slice(1);
  const button = page.getByRole('group', { name: 'Camera view' }).getByRole('button', { name: label, exact: true });
  const since = await count();
  await button.click();
  const accepted = await state(since, { moveId, playing: false });
  assert.equal(await button.getAttribute('aria-pressed'), 'true');
  return accepted;
}
async function seek(progress, requireFresh = false) {
  const slider = page.getByRole('slider', { name: 'Review movement', exact: true });
  if (Math.abs(Number(await slider.inputValue()) - progress * 1000) < 5) {
    if (!requireFresh) return;
    // An unchanged range value produces no React event. Move through a distinct
    // real pose first so every framing checkpoint has a fresh Unity acknowledgment.
    await seek(progress === 1 ? 0 : 1);
  }
  const since = await count();
  if (progress === 0) await slider.press('Home');
  else if (progress === 1) await slider.press('End');
  else {
    const box = await slider.boundingBox();
    await slider.click({ position: { x: box.width * progress, y: box.height / 2 } });
  }
  const observed = await state(since, { playing: false });
  assert.ok(Math.abs(observed.progress - progress) < 0.03, `Seek returned ${observed.progress} instead of ${progress}`);
  return observed;
}
async function capture(name, fullPage = false) {
  await bounded(page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))), 30000, 'render wait');
  const path = resolve(output, `${name}.png`);
  const bytes = fullPage ? await page.screenshot({ path, fullPage: true, timeout: 30000 }) : await page.locator('.unity-canvas').screenshot({ path, timeout: 30000 });
  const evidence = { name, path, bytes: bytes.length, sha256: hash(bytes), device: device.name };
  report.screenshots.push(evidence);
  await save();
  console.log(`Captured ${name}`);
  return evidence;
}
async function playThrough(moveId) {
  await seek(0);
  const since = await count();
  await page.getByRole('button', { name: 'Play animation', exact: true }).click();
  const began = await state(since, { moveId, playing: true });
  const ended = await state(since, { moveId, type: 'completed', playing: false });
  assert.equal(ended.progress, 1);
  report.playback.push({ device: device.name, moveId, began, ended });
}

try {
  for (device of devices) {
    const context = await browser.newContext({ viewport: device.viewport, deviceScaleFactor: 1,
      isMobile: Boolean(device.isMobile), hasTouch: Boolean(device.hasTouch), reducedMotion: 'reduce' });
    await context.addInitScript(() => {
      window.__graphicsEvents = []; window.__graphicsProgressWrites = [];
      window.addEventListener('jiuquest:unity', (event) => window.__graphicsEvents.push({ ...event.detail, at: performance.now() }));
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key.startsWith('jiuquest:')) window.__graphicsProgressWrites.push(key);
        return original.call(this, key, value);
      };
    });
    page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.on('pageerror', (error) => report.pageErrors.push({ device: device.name, message: error.message }));
    page.on('response', (res) => { if (res.status() >= 400 && /\/(unity|animations)\//.test(res.url())) report.assetFailures.push({ device: device.name, url: res.url(), status: res.status() }); });
    await page.goto(`${base}/?preview=unity`); await ready();
    await state(0, { playing: false });
    const firstReady = await page.evaluate(() => window.__graphicsEvents.find((event) => event.type === 'ready'));
    assert.ok(firstReady?.instanceId);
    const pausedAt = await page.getByRole('slider', { name: 'Review movement', exact: true }).inputValue();
    await page.waitForTimeout(800);
    assert.equal(await page.getByRole('slider', { name: 'Review movement', exact: true }).inputValue(), pausedAt, 'Reduced-motion preview must not autoplay.');
    assert.equal(await page.getByRole('button', { name: 'Play animation', exact: true }).count(), 1);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    assert.equal(overflow, false, 'Preview must fit the device width.');
    const observed = { ...device, reducedMotionPaused: true, noHorizontalOverflow: true, instanceId: firstReady.instanceId,
      canvas: await page.locator('.unity-canvas').boundingBox() };
    const cameraButtons = page.getByRole('group', { name: 'Camera view' }).getByRole('button');
    assert.equal(await cameraButtons.count(), 5);
    observed.cameraButtons = await cameraButtons.evaluateAll((buttons) => buttons.map((button) => {
      const rect = button.getBoundingClientRect();
      return { label: button.textContent, x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }));
    if (device.name === 'phone') {
      const rows = Object.groupBy(observed.cameraButtons, (button) => Math.round(button.y));
      assert.equal(Object.keys(rows).length, 2, 'The five phone camera controls must fit two rows.');
      assert.deepEqual(Object.values(rows).map((row) => row.length).sort(), [2, 3]);
    }
    report.devices.push(observed);
    for (const kit of ['classic', 'night']) {
      await select('Gi colors', kit);
      for (const moveId of ['standing_stance', 'double_leg', 'rear_naked_choke']) {
        await select('Technique', moveId);
        for (const view of ['front', 'side']) {
          const button = page.getByRole('group', { name: 'Camera view' }).getByRole('button', { name: view === 'front' ? 'Front' : 'Side', exact: true });
          if (await button.getAttribute('aria-pressed') !== 'true') {
            const since = await count(); await button.click(); await state(since, { moveId, playing: false });
          }
          await seek(moveId === 'double_leg' ? 1 : 0.5);
          await page.waitForTimeout(650); // The real camera eases toward its new orientation.
          await capture(`${device.name}-${kit}-${moveId}-${view}`);
        }
        if (kit === 'classic' && moveId !== 'standing_stance') await playThrough(moveId);
      }
    }
    await select('Gi colors', 'classic'); await select('Technique', 'standing_stance'); await seek(0.5);
    const front = page.getByRole('group', { name: 'Camera view' }).getByRole('button', { name: 'Front', exact: true });
    if (await front.getAttribute('aria-pressed') !== 'true') {
      const since = await count(); await front.click(); await state(since, { moveId: 'standing_stance', playing: false });
    }
    await page.waitForTimeout(650);
    if (device.name === 'desktop') {
      await select('Gi colors', 'summit'); await seek(0.5);
      await capture('desktop-summit-standing_stance-front');
      await select('Gi colors', 'classic');
      // Begin with a deliberately different style so every requested option is
      // accepted by a fresh real Unity state event, including the default spikes.
      await select('Your hairstyle', 'bald'); await seek(0.5);
      await page.waitForTimeout(650);
      let previous = await capture('desktop-hair-baseline-bald');
      for (const style of ['shadow spikes', 'short fade', 'slicked back', 'long hair', 'mohawk', 'bald']) {
        const accepted = await select('Your hairstyle', style);
        assert.ok(accepted?.requestId, `No fresh Unity acknowledgment for ${style}`);
        await seek(0.5); await page.waitForTimeout(650);
        const current = await capture(`desktop-hair-${style.replaceAll(' ', '-')}`);
        assert.notEqual(current.sha256, previous.sha256, `${style} did not change the rendered canvas`);
        report.hairstyles.push({ value: style, accepted, previousSha256: previous.sha256,
          renderedSha256: current.sha256, changed: true });
        previous = current;
      }
      await select('Your hairstyle', 'shadow spikes'); await seek(0.5); await page.waitForTimeout(650);
    }
    await capture(`${device.name}-page`, true);
    // Keep the original front/side evidence above, then inspect every supported
    // clip at close-up endpoints and midpoint. Ground exchanges also get an 80%
    // checkpoint. These images require visual silhouette review; a successful
    // state event alone is not a claim that no toe, hand or hairstyle is cropped.
    assert.equal(manifest.supportedMoves.length, 16);
    for (const moveId of manifest.supportedMoves) {
      await select('Technique', moveId);
      const acceptedCamera = await camera('focus', moveId);
      const grounded = !['standing_stance', 'grip_fighting', 'reset_neutral'].includes(moveId);
      for (const progress of grounded ? [0, 0.5, 0.8, 1] : [0, 0.5, 1]) {
        const acceptedPose = await seek(progress, true);
        assert.equal(acceptedPose.moveId, moveId);
        assert.ok(acceptedPose.requestId);
        await page.waitForTimeout(650);
        await page.locator('.unity-canvas').scrollIntoViewIfNeeded();
        const image = await capture(`${device.name}-focus-${moveId}-${Math.round(progress * 100)}`);
        report.focusPoses.push({ device: device.name, moveId, progress, acceptedCamera, acceptedPose,
          screenshot: image.path, sha256: image.sha256, visualClippingReview: 'Pending human or visual-agent inspection of this actual rendered image' });
      }
    }
    await capture(`${device.name}-focus-page`, true);
    const progressWrites = await page.evaluate(() => window.__graphicsProgressWrites);
    assert.deepEqual(progressWrites, [], 'Preview must not write player progression.');
    observed.progressionWrites = progressWrites;
    await bounded(context.close(), 30000, `${device.name} browser context close`);
  }
  assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.assetFailures, []);
  report.status = 'passed'; report.completedUtc = new Date().toISOString();
} catch (error) {
  report.status = 'failed'; report.failure = error.stack || String(error);
  if (page && !page.isClosed()) await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true, timeout: 15000 }).catch(() => {});
  process.exitCode = 1;
} finally {
  await bounded(browser.close(), 30000, 'browser shutdown').catch((error) => { report.shutdownError = error.message; process.exitCode = 1; });
  await save();
  console.log(JSON.stringify({ status: report.status, screenshots: report.screenshots.length, playbackChecks: report.playback.length,
    build: manifest.generatedUtc, report: resolve(output, 'report.json'), failure: report.failure }, null, 2));
}
