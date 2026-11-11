// Verifies the built Unreal character preview in a real browser: the pinned
// stills decode, every view can be selected, the page fits phones, and nothing
// starts a player, a stream or a saved-progress write. It checks still images
// only. It does not run Unreal, render characters or establish video.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { chromium } from 'playwright';
import { UNREAL_CHARACTER_RENDERS, UNREAL_PREVIEW_PATH, unrealRenderUrl } from '../src/unreal/characterPreview.js';

const root = resolve('dist');
const artifacts = resolve(process.env.JIUQUEST_BROWSER_ARTIFACTS || 'tmp/browser', 'unreal-character-preview');
await mkdir(artifacts, { recursive: true });
const checks = [], images = [], errors = [], consoleErrors = [], failedResponses = [], layouts = [];
const browserOptions = { headless: true, args: ['--enable-unsafe-swiftshader'], ...(process.env.JIUQUEST_BROWSER_CHANNEL ? { channel: process.env.JIUQUEST_BROWSER_CHANNEL } : {}), ...(process.env.JIUQUEST_BROWSER_EXECUTABLE ? { executablePath: process.env.JIUQUEST_BROWSER_EXECUTABLE } : {}) };
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const report = { startedAtUtc: new Date().toISOString(), status: 'running', scope: 'Captured still images in desktop Chromium with phone viewport emulation. No Unreal runtime, stream or physical device.' };
let browser, server, page;

async function staticSite() {
  await stat(resolve(root, 'index.html'));
  server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const file = resolve(root, `.${pathname.endsWith('/') ? `${pathname}index.html` : pathname}`);
      if (!file.startsWith(`${root}${sep}`)) { response.writeHead(403); response.end(); return; }
      const body = await readFile(file);
      response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
      response.end(body);
    } catch { response.writeHead(404); response.end('Not found'); }
  });
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  return `http://127.0.0.1:${server.address().port}`;
}

async function open(options) {
  const context = await browser.newContext({ reducedMotion: 'reduce', ...options });
  await context.addInitScript(() => {
    window.__progressWrites = [];
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) { if (key.startsWith('jiuquest:')) window.__progressWrites.push(key); return original.call(this, key, value); };
  });
  page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push({ text: message.text(), location: message.location() }); });
  page.on('response', (response) => { if (response.status() >= 400) failedResponses.push({ url: response.url(), status: response.status() }); });
  return context;
}

const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const mainImage = () => page.locator('.unreal-preview-frame img');
const viewButton = (render) => page.getByRole('group', { name: 'Character views', exact: true }).getByRole('button', { name: render.label, exact: true });

async function shown(render) {
  await page.waitForFunction((url) => {
    const image = document.querySelector('.unreal-preview-frame img');
    return image?.complete && image.naturalWidth > 0 && new URL(image.src).pathname === url;
  }, unrealRenderUrl(render));
  assert.deepEqual(await mainImage().evaluate((image) => [image.naturalWidth, image.naturalHeight]), [render.width, render.height], `${render.file} must decode at its captured size`);
  assert.equal(await mainImage().getAttribute('alt'), render.alt);
  assert.equal(await page.locator('.unreal-preview-viewer figcaption strong').innerText(), render.title);
  assert.equal(await page.locator('.unreal-preview-viewer figcaption a').getAttribute('href'), unrealRenderUrl(render));
  assert.equal(await viewButton(render).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('.unreal-preview-views button[aria-pressed="true"]').count(), 1);
}

async function capture(name) {
  const file = resolve(artifacts, `${name}.png`);
  const data = await page.screenshot({ path: file, fullPage: true });
  images.push({ name, path: file, bytes: data.length });
}

async function previewReady() {
  await page.getByRole('heading', { level: 1, name: 'A first look at the new fighter.', exact: true }).waitFor();
  await shown(UNREAL_CHARACTER_RENDERS[0]);
}

try {
  const base = process.env.JIUQUEST_PREVIEW_URL?.replace(/\/$/, '') || await staticSite();
  browser = await chromium.launch(browserOptions);
  report.browserVersion = browser.version();

  const desktop = await open({ viewport: { width: 1440, height: 1000 } });
  await page.goto(`${base}${UNREAL_PREVIEW_PATH}`); await previewReady();
  assert.match(await page.locator('.unreal-preview-intro').innerText(), /UNREAL CHARACTER PREVIEW/);
  assert.match(await page.locator('.unreal-preview-intro').innerText(), /CAPTURED STILLS\s+Not live gameplay/);
  assert.match(await page.locator('.unreal-preview-intro').innerText(), /Technique animations in Arena and Training still play with the current characters\./);
  assert.equal(await page.locator('.unreal-preview-badge').innerText(), 'Unreal Engine capture · still image');
  assert.equal(await page.title(), 'Unreal character preview · JiuQuest');
  assert.equal(await page.getByRole('link', { name: /^Return to JiuQuest/ }).getAttribute('href'), '/');
  checks.push('The page is labeled as captured Unreal stills, not live gameplay, and says technique animations in Arena and Training keep the current characters.');

  await capture('desktop-white-gi');
  for (const render of [...UNREAL_CHARACTER_RENDERS.slice(1), UNREAL_CHARACTER_RENDERS[0]]) {
    await viewButton(render).click(); await shown(render);
    if (render !== UNREAL_CHARACTER_RENDERS[0]) await capture(`desktop-${render.id}`);
  }
  assert.equal(await page.locator('.unreal-preview-views button').count(), UNREAL_CHARACTER_RENDERS.length);
  await page.waitForFunction(() => [...document.querySelectorAll('.unreal-preview-views img')].every((thumb) => thumb.complete && thumb.naturalWidth > 0));
  const frame = await page.locator('.unreal-preview-frame').boundingBox();
  assert.ok(Math.abs(frame.width / frame.height - 1018 / 556) < 0.01, 'Desktop shows the whole capture, uncropped.');
  await viewButton(UNREAL_CHARACTER_RENDERS[2]).focus(); await page.keyboard.press('Enter'); await shown(UNREAL_CHARACTER_RENDERS[2]);
  checks.push('All three pinned captures decode at 1018 by 556 and can be selected by pointer and keyboard; desktop shows each one uncropped.');

  assert.equal(await page.locator('canvas, iframe, video, .unity-stage, .app-shell').count(), 0);
  assert.deepEqual(await page.evaluate(() => window.__progressWrites), []);
  assert.equal(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('jiuquest:')).length), 0);
  checks.push('The preview mounts no player, stream or game shell and reads or writes no saved progress.');

  await page.goto(base);
  const card = page.getByRole('link', { name: /^Unreal Character Preview/ });
  await card.waitFor();
  assert.equal(await card.getAttribute('href'), UNREAL_PREVIEW_PATH);
  await page.waitForFunction(() => { const thumb = document.querySelector('.unreal-preview-card img'); return thumb?.complete && thumb.naturalWidth === 224; });
  await capture('overview-desktop');
  await page.setViewportSize({ width: 320, height: 740 });
  assert.equal(await fits(), true, 'Overview with the preview card must fit a 320-pixel viewport.');
  assert.ok((await card.boundingBox()).height >= 44);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await card.click(); await previewReady();
  assert.equal(new URL(page.url()).searchParams.get('preview'), 'unreal');
  await page.getByRole('link', { name: /^Return to JiuQuest/ }).click();
  await page.getByRole('button', { name: 'Training', exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.has('preview'), false);
  checks.push('The Overview card opens the preview, fits a 320-pixel viewport, and Return to JiuQuest reopens the game.');
  await desktop.close();

  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 740 }, { width: 844, height: 390 }]) {
    const phone = await open({ viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    await page.goto(`${base}${UNREAL_PREVIEW_PATH}`); await previewReady();
    assert.equal(await fits(), true, `${viewport.width}x${viewport.height} must not scroll sideways`);
    const stage = await page.locator('.unreal-preview-frame').boundingBox();
    layouts.push({ viewport, stage });
    assert.ok(stage.width >= viewport.width - 40, 'the capture uses the phone width');
    if (viewport.height > viewport.width) assert.ok(stage.height >= 340, 'an upright phone shows a tall capture');
    else assert.ok(stage.height <= viewport.height, 'a sideways phone shows the whole capture at once');
    for (const button of await page.locator('.unreal-preview-views button').all()) assert.ok((await button.boundingBox()).height >= 44);
    for (const render of UNREAL_CHARACTER_RENDERS.slice(1)) {
      await viewButton(render).tap(); await shown(render);
      assert.equal(await fits(), true);
    }
    await capture(`phone-${viewport.width}x${viewport.height}`);
    assert.deepEqual(await page.evaluate(() => window.__progressWrites), []);
    await phone.close();
  }
  checks.push('Upright, small and sideways phone viewports show a large capture, 44-pixel view controls and no sideways scrolling.');

  assert.deepEqual(errors, []);
  assert.deepEqual(consoleErrors, [], 'Unexpected browser console errors');
  assert.deepEqual(failedResponses, [], 'Every preview asset must load');
  report.status = 'passed';
  console.log(JSON.stringify({ checks, layouts, images: images.length, artifacts }, null, 2));
} catch (error) {
  report.status = 'failed'; report.failure = error.stack || String(error);
  if (page && !page.isClosed()) await page.screenshot({ path: resolve(artifacts, 'failure.png'), fullPage: true, timeout: 10000 }).catch(() => {});
  console.error(error); process.exitCode = 1;
} finally {
  Object.assign(report, { checkedAtUtc: new Date().toISOString(), checks, layouts, images, pageErrors: errors, consoleErrors, failedResponses });
  await writeFile(resolve(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  if (browser) await browser.close().catch(() => {});
  if (server) { server.closeAllConnections(); await new Promise((resolveClose) => server.close(resolveClose)); }
}
