// Verifies the five showcase fighter cards on the Overview page of the built
// site in a real browser: the pinned pictures load, in order, under their
// names, at the card shape, and the page fits phones.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { chromium } from 'playwright';
import showcaseCards from '../src/showcaseCards.data.js';

const root = resolve('dist');
const artifacts = resolve(process.env.JIUQUEST_BROWSER_ARTIFACTS || 'tmp/browser', 'showcase-cards');
await mkdir(artifacts, { recursive: true });
const checks = [], images = [], errors = [], consoleErrors = [], failedResponses = [], layouts = [];
const browserOptions = { headless: true, args: ['--enable-unsafe-swiftshader'], ...(process.env.JIUQUEST_BROWSER_CHANNEL ? { channel: process.env.JIUQUEST_BROWSER_CHANNEL } : {}), ...(process.env.JIUQUEST_BROWSER_EXECUTABLE ? { executablePath: process.env.JIUQUEST_BROWSER_EXECUTABLE } : {}) };
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.mp4': 'video/mp4' };
const report = { startedAtUtc: new Date().toISOString(), status: 'running', scope: 'Still pictures in desktop Chromium, with phone viewport emulation. No physical device.' };
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
  const context = await browser.newContext({ reducedMotion: 'reduce', deviceScaleFactor: 1, ...options });
  page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push({ text: message.text(), location: message.location() }); });
  page.on('response', (response) => { if (response.status() >= 400) failedResponses.push({ url: response.url(), status: response.status() }); });
  return context;
}

// The strip as the browser shows it, once every picture has arrived.
async function strip() {
  const region = page.getByLabel('Example JiuQuest fighter styles', { exact: true });
  await region.scrollIntoViewIfNeeded();
  await page.waitForFunction(() => {
    const pictures = [...document.querySelectorAll('.showcase-strip .showcase-card img')];
    return pictures.length === 5 && pictures.every((picture) => picture.complete && picture.naturalWidth > 0);
  }, null, { timeout: 30000 });
  // Arrived is not yet painted: wait until every picture is decoded.
  await page.evaluate(() => Promise.all([...document.querySelectorAll('.showcase-strip .showcase-card img')].map((picture) => picture.decode())));
  await page.evaluate(() => new Promise((painted) => requestAnimationFrame(() => requestAnimationFrame(painted))));
  return region.locator('.showcase-card').evaluateAll((cards) => cards.map((card) => {
    const picture = card.querySelector('img'), caption = card.querySelector('figcaption');
    const [cardBox, captionBox] = [card.getBoundingClientRect(), caption.getBoundingClientRect()];
    return {
      label: caption.textContent, alt: picture.alt, src: new URL(picture.currentSrc).pathname, natural: [picture.naturalWidth, picture.naturalHeight],
      width: cardBox.width, height: cardBox.height, left: cardBox.left, right: cardBox.right,
      captionInside: captionBox.left >= cardBox.left && captionBox.right <= cardBox.right + 0.5 && captionBox.bottom <= cardBox.bottom + 0.5 && captionBox.top >= cardBox.top + cardBox.height / 2,
    };
  }));
}

try {
  const base = process.env.JIUQUEST_PREVIEW_URL?.replace(/\/$/, '') || await staticSite();
  browser = await chromium.launch(browserOptions);
  report.browserVersion = browser.version();

  for (const viewport of [{ width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
    const desktop = await open({ viewport });
    await page.goto(`${base}/`);
    const cards = await strip();
    assert.deepEqual(cards.map((card) => [card.label, card.src, card.alt]), showcaseCards.map((card) => [card.label, card.src, `${card.label} fighter style`]));
    for (const card of cards) {
      assert.deepEqual(card.natural, [900, 1125], `${card.label} is the published picture`);
      assert.ok(card.width / card.height > 0.72 && card.width / card.height < 0.82, `${card.label} keeps the card shape (${card.width} x ${card.height})`);
      assert.ok(card.captionInside, `${card.label} is named on the lower half of its card`);
    }
    for (let index = 1; index < cards.length; index += 1) assert.ok(cards[index].left >= cards[index - 1].right, 'the cards sit side by side');
    layouts.push({ viewport, card: [Math.round(cards[0].width), Math.round(cards[0].height)] });
    const file = resolve(artifacts, `desktop-${viewport.width}.png`);
    images.push({ name: `desktop-${viewport.width}`, path: file, bytes: (await page.screenshot({ path: file })).length });
    await desktop.close();
  }
  checks.push('The Overview shows the five showcase cards in order, each the published 900 by 1125 picture with its name on the card.');

  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 640 }]) {
    const phone = await open({ viewport, isMobile: true, hasTouch: true });
    await page.goto(`${base}/`);
    const cards = await strip();
    assert.equal(cards.length, 5);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, `${viewport.width}-pixel Overview must not scroll sideways`);
    for (const card of cards) {
      assert.ok(card.left >= 0 && card.right <= viewport.width + 0.5, `${card.label} is inside the screen`);
      assert.ok(card.width >= 48 && card.height >= 60, `${card.label} is large enough to see (${Math.round(card.width)} x ${Math.round(card.height)})`);
    }
    layouts.push({ viewport, card: [Math.round(cards[0].width), Math.round(cards[0].height)] });
    const file = resolve(artifacts, `phone-${viewport.width}.png`);
    images.push({ name: `phone-${viewport.width}`, path: file, bytes: (await page.screenshot({ path: file })).length });
    await phone.close();
  }
  checks.push('At 390 and 320 pixels all five cards are on screen and nothing scrolls sideways.');

  assert.deepEqual(errors, []);
  assert.deepEqual(consoleErrors, [], 'Unexpected browser console errors');
  assert.deepEqual(failedResponses, [], 'Every picture must load');
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
