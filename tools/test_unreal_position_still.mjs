// Verifies the Unreal position still in the built site in a real browser: where
// it appears (Training, Arena, Overview), where the classic picture stays, that
// each athlete is painted in their own gi and belt colors exactly as the layer
// arithmetic says, that a missing layer falls back to the classic picture, and
// that the page fits phones. It checks still images composited by the browser.
// It does not run Unreal or any stream.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { chromium } from 'playwright';
import { findUnrealPositionStill } from '../src/unreal/positionStills.js';

const root = resolve('dist');
const artifacts = resolve(process.env.JIUQUEST_BROWSER_ARTIFACTS || 'tmp/browser', 'unreal-position-still');
await mkdir(artifacts, { recursive: true });
const checks = [], images = [], errors = [], consoleErrors = [], expectedConsoleErrors = [], failedResponses = [], layouts = [], samples = [], stillRequests = [];
const browserOptions = { headless: true, args: ['--enable-unsafe-swiftshader'], ...(process.env.JIUQUEST_BROWSER_CHANNEL ? { channel: process.env.JIUQUEST_BROWSER_CHANNEL } : {}), ...(process.env.JIUQUEST_BROWSER_EXECUTABLE ? { executablePath: process.env.JIUQUEST_BROWSER_EXECUTABLE } : {}) };
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.mp4': 'video/mp4' };
const report = { startedAtUtc: new Date().toISOString(), status: 'running', scope: 'Still layers composited in desktop Chromium, with phone viewport emulation. No Unreal runtime, stream or physical device.' };
const STORAGE_KEY = 'jiuquest:v1';
const WHITE = '#f8fbff', BLACK = '#151922';
const STILL = findUnrealPositionStill('standing');
// The player: white jacket, black pants, so all four gi halves in the picture differ.
const PLAYER = { selectedFighterId: 'tinted', fighters: [{ id: 'tinted', name: 'Tinted', look: 'unreal', giTop: WHITE, giPants: BLACK }] };
const DESIGNED = { selectedFighterId: 'designed', fighters: [{ id: 'designed', name: 'Designed', gender: 'girl', hairStyle: 'braided top', skinTone: '#a86b4d', hairColor: '#3b251b', emblem: 'lion', giTop: '#1d7d68', giPants: WHITE }] };
// Places on the still, as fractions of its width and height: the middle of each
// gi half and belt, and the lead athlete's cheek, which no color touches.
const POINTS = { leadJacket: [0.3105, 0.3657], leadPants: [0.3019, 0.5583], leadBelt: [0.3117, 0.475], otherJacket: [0.7068, 0.2083], otherPants: [0.7198, 0.5333], otherBelt: [0.7241, 0.4685], leadFace: [0.3463, 0.1537] };
let browser, server, page, blockedLayer = null;

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

// A browser profile. `saved` is what a returning visitor already has on the device.
async function open(options, saved) {
  const context = await browser.newContext({ reducedMotion: 'reduce', deviceScaleFactor: 1, ...options });
  if (saved) {
    await context.addInitScript(({ key, value }) => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem(key, value);
    }, { key: STORAGE_KEY, value: JSON.stringify(saved) });
  }
  page = await context.newPage();
  // One context below removes a layer on purpose; its load error is expected.
  if (blockedLayer) await page.route(`**${blockedLayer}`, (route) => route.abort());
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    (blockedLayer ? expectedConsoleErrors : consoleErrors).push({ text: message.text(), location: message.location() });
  });
  page.on('request', (request) => { const { pathname } = new URL(request.url()); if (pathname.startsWith('/assets/unreal-positions/')) stillRequests.push(pathname); });
  page.on('response', (response) => { if (response.status() >= 400) failedResponses.push({ url: response.url(), status: response.status() }); });
  return context;
}

const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const nav = async (name) => { await page.getByRole('button', { name, exact: true }).click(); };
const technique = async (name) => { await page.getByRole('button', { name: new RegExp(name) }).first().click(); };
const hex = (color) => [1, 3, 5].map((index) => parseInt(color.slice(index, index + 2), 16));
const near = (left, right, tolerance) => left.every((value, index) => Math.abs(value - right[index]) <= tolerance);
const box = async (locator) => { const found = await locator.boundingBox(); return { x: found.x, y: found.y, width: found.width, height: found.height }; };

async function capture(name) {
  const file = resolve(artifacts, `${name}.png`);
  const data = await page.screenshot({ path: file });
  images.push({ name, path: file, bytes: data.length });
}

// The stage inside `scope` has settled on one picture and painted it.
async function settled(scope, picture) {
  const stage = page.locator(`${scope} .grappling-snapshot-stage`);
  await page.waitForFunction(({ selector, wanted }) => {
    const element = document.querySelector(selector);
    return element?.dataset.ready === 'ready' && element.dataset.picture === wanted;
  }, { selector: `${scope} .grappling-snapshot-stage`, wanted: picture }, { timeout: 30000 });
  const [stills, canvases] = [await stage.locator('.unreal-position-still').count(), await stage.locator('canvas.snapshot-canvas').count()];
  assert.deepEqual([stills, canvases], picture === 'unreal' ? [1, 0] : [0, 1], `${picture} picture only`);
  return stage;
}

// What the still is made of, as the browser sees it.
async function inspect(stage) {
  const state = await stage.locator('.unreal-position-still').evaluate(async (element) => {
    const style = getComputedStyle(element);
    const base = element.querySelector('img');
    const layers = [...element.querySelectorAll('.unreal-position-layer')].map((layer) => {
      const layerStyle = getComputedStyle(layer);
      return { name: layer.dataset.layer, image: layerStyle.backgroundImage, color: layerStyle.backgroundColor, blend: layerStyle.backgroundBlendMode, mix: layerStyle.mixBlendMode, opacity: layerStyle.opacity };
    });
    const rect = element.getBoundingClientRect();
    return { role: element.getAttribute('role'), label: element.getAttribute('aria-label'), isolation: style.isolation, ready: element.classList.contains('is-ready'), base: { src: new URL(base.currentSrc || base.src).pathname, natural: [base.naturalWidth, base.naturalHeight], opacity: getComputedStyle(base).opacity }, layers, aspect: rect.width / rect.height, width: rect.width };
  });
  assert.equal(state.role, 'img');
  assert.equal(state.isolation, 'isolate', 'layers add to the picture only, never to the page behind');
  assert.equal(state.ready, true);
  assert.deepEqual([state.base.src, state.base.natural, state.base.opacity], [STILL.layers.base, [STILL.width, STILL.height], '1']);
  assert.deepEqual(state.layers.map((layer) => layer.name), ['leadJacket', 'leadPants', 'leadBelt', 'otherJacket', 'otherPants', 'otherBelt']);
  for (const layer of state.layers) {
    assert.ok(layer.image.includes(STILL.layers[layer.name]), `${layer.name} paints its own file`);
    assert.deepEqual([layer.blend, layer.opacity], ['multiply', '1']);
    assert.ok(['plus-lighter', 'screen'].includes(layer.mix), `${layer.name} is added to the picture (${layer.mix})`);
  }
  assert.ok(Math.abs(state.aspect - 1.5) < 0.01, `the picture is three to two (${state.aspect})`);
  return state;
}

// Average color of a small patch at each named place: what the browser painted,
// and what base + layer x color says it should be, read from the same files.
async function painted(stage, label) {
  const data = (await stage.locator('.unreal-position-still').screenshot()).toString('base64');
  const colors = await page.evaluate(async ({ data, points, layers }) => {
    const pixelsOf = async (source) => {
      const image = new Image();
      image.src = source;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      // A square patch around the point, `reach` screenshot pixels each way,
      // scaled so it covers the same part of the picture in every image.
      return ([x, y], reach) => {
        const half = Math.max(1, Math.round(reach * canvas.width / shotWidth));
        const pixels = context.getImageData(Math.round(x * canvas.width) - half, Math.round(y * canvas.height) - half, half * 2 + 1, half * 2 + 1).data;
        const sum = [0, 0, 0];
        for (let index = 0; index < pixels.length; index += 4) for (let channel = 0; channel < 3; channel += 1) sum[channel] += pixels[index + channel];
        return sum.map((value) => value / (pixels.length / 4));
      };
    };
    const probe = new Image();
    probe.src = `data:image/png;base64,${data}`;
    await probe.decode();
    const shotWidth = probe.naturalWidth;
    const shot = await pixelsOf(probe.src);
    const files = Object.fromEntries(await Promise.all(Object.entries(layers).map(async ([name, url]) => [name, await pixelsOf(url)])));
    return Object.fromEntries(Object.entries(points).map(([name, point]) => [name, {
      painted: shot(point, 2).map(Math.round),
      base: files.base(point, 2),
      layers: Object.fromEntries(Object.keys(layers).filter((layer) => layer !== 'base').map((layer) => [layer, files[layer](point, 2)])),
    }]));
  }, { data, points: POINTS, layers: STILL.layers });
  samples.push({ label, colors: Object.fromEntries(Object.entries(colors).map(([name, value]) => [name, value.painted])) });
  return colors;
}

// base + sum(layer x color), the arithmetic in src/unreal/positionStills.js.
function expected(sample, tints) {
  return sample.base.map((value, channel) => Math.min(255, Math.round(value + Object.entries(tints).reduce((sum, [layer, color]) => sum + sample.layers[layer][channel] * hex(color)[channel] / 255, 0))));
}

try {
  const base = process.env.JIUQUEST_PREVIEW_URL?.replace(/\/$/, '') || await staticSite();
  browser = await chromium.launch(browserOptions);
  report.browserVersion = browser.version();

  // ---- Training, a player with the Unreal athlete ----
  const desktop = await open({ viewport: { width: 1440, height: 900 } }, PLAYER);
  await page.goto(`${base}/`);
  await nav('Training');
  await technique('Guillotine choke');
  let stage = await settled('main', 'unreal');
  const state = await inspect(stage);
  assert.match(state.label, /^Standing\. Both athletes are in a neutral position\. Rendered in Unreal Engine\. Each athlete wears their own gi and belt colors\.$/);
  assert.match(await stage.locator('.snapshot-position').innerText(), /^Standing\s+Unreal Engine · your gi and belt colors$/);
  const opponentName = (await stage.locator('.snapshot-athlete').nth(1).innerText()).split('\n')[0];
  const opponentKit = await stage.locator('.snapshot-athlete').nth(1).locator('.snapshot-kit i').evaluateAll((swatches) => swatches.map((swatch) => {
    const [red, green, blue] = getComputedStyle(swatch).backgroundColor.match(/\d+/g).map(Number);
    return `#${[red, green, blue].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
  }));
  const colors = await painted(stage, 'training standing');
  // The player is the lead athlete on the left; the training partner is on the right.
  const tints = { leadJacket: WHITE, leadPants: BLACK, leadBelt: WHITE, otherJacket: opponentKit[0], otherPants: opponentKit[1], otherBelt: WHITE };
  for (const name of Object.keys(POINTS)) {
    const want = expected(colors[name], tints);
    assert.ok(near(colors[name].painted, want, 12), `${name}: painted ${colors[name].painted}, arithmetic ${want}`);
  }
  // The gi halves really are four different colors, and skin takes none of them.
  assert.ok(colors.leadJacket.painted[1] > 170 && colors.leadPants.painted[1] < 70, 'the player wears a white jacket over black pants');
  assert.ok(near(colors.leadFace.painted, colors.leadFace.base.map(Math.round), 8), 'skin is untouched by the gi colors');
  assert.notDeepEqual([opponentKit[0], opponentKit[1]], [WHITE, BLACK], `${opponentName} wears a different kit from the player`);
  layouts.push({ viewport: page.viewportSize(), where: 'training', still: await box(stage.locator('.unreal-position-still')) });
  await stage.scrollIntoViewIfNeeded();
  await capture('desktop-training-standing');
  checks.push('Training shows the Unreal standing picture for a standing technique, with the player and the partner each in their own jacket, pants and belt colors, matching the layer arithmetic.');

  // Neither picture shows a rear clinch, so the still stands in as a general reference.
  await technique('Rear Takedown');
  stage = await settled('main', 'unreal');
  assert.match(await stage.locator('.snapshot-position').innerText(), /General reference · exact setup not pictured$/);
  assert.match((await inspect(stage)).label, /^General grappling reference\. The exact .+ setup is not pictured\./);
  // The classic picture shows the clinch grips, and every ground position, so those stay.
  for (const name of ['Leg Hook Takedown', 'Americana Armlock']) {
    await technique(name);
    stage = await settled('main', 'classic');
    assert.doesNotMatch(await stage.locator('.snapshot-position').innerText(), /Unreal Engine/);
  }
  checks.push('A rear clinch uses the still as a labeled general reference; the clinch and ground positions keep the classic picture that shows them.');

  // ---- Overview teaser and the Lab ----
  await nav('Overview');
  stage = await settled('main', 'unreal');
  await inspect(stage);
  await nav('Lab');
  stage = await settled('main', 'classic');
  checks.push('The Overview teaser shows the still; the Lab, whose text describes a grip exchange, keeps the classic picture.');

  // ---- Arena, with position pictures instead of the Unity player ----
  await page.goto(`${base}/?engine=snapshot`);
  await nav('Arena');
  await page.getByLabel('Your starting position', { exact: true }).selectOption('standing-headlock');
  await page.getByRole('button', { name: 'Position Start', exact: true }).click();
  stage = await settled('.mat-window', 'unreal');
  assert.match(await stage.locator('.snapshot-position').innerText(), /General reference · exact setup not pictured$/);
  await page.reload();
  await nav('Arena');
  await page.getByRole('button', { name: 'Standing Start', exact: true }).click();
  await page.locator('.combat-moves .combat-group').first().locator('button:not([disabled])').first().click();
  await page.locator('.sequence-panel .order-stack').waitFor();
  await page.getByRole('button', { name: 'Submit sequence', exact: true }).click();
  await page.locator('.arena-outcome').waitFor();
  // The exchange can settle anywhere. If both athletes are still on their feet
  // in a neutral stance, the settled picture must be the still.
  await page.locator('.mat-window .snapshot-position > span').first().waitFor();
  const settledLabel = (await page.locator('.mat-window .snapshot-position > span').first().innerText()).trim();
  if (settledLabel === 'Standing') {
    stage = await settled('.mat-window', 'unreal');
    assert.match(await stage.locator('.snapshot-round').innerText(), /^Exchange 1 settled$/);
    await stage.getByRole('button', { name: 'Review the settled position', exact: true }).click();
    stage = await settled('.mat-window', 'unreal');
    await inspect(stage);
    await stage.scrollIntoViewIfNeeded();
    await capture('desktop-arena-settled');
  }
  report.arenaSettled = { label: settledLabel, stillChecked: settledLabel === 'Standing' };
  checks.push('In the Arena a standing headlock start uses the still as a general reference; when an exchange settles on the feet the still shows it, and Review repaints it.');
  await desktop.close();
  assert.deepEqual([...new Set(stillRequests)].sort(), Object.values(STILL.layers).sort(), 'exactly the seven layer files were requested');

  // ---- A fighter someone designed keeps the classic picture ----
  stillRequests.length = 0;
  const designed = await open({ viewport: { width: 1440, height: 900 } }, DESIGNED);
  await page.goto(`${base}/`);
  await nav('Training');
  await technique('Guillotine choke');
  stage = await settled('main', 'classic');
  assert.match(await stage.locator('.snapshot-position').innerText(), /Position snapshot · your appearance$/);
  assert.deepEqual(stillRequests, [], 'no still layer is downloaded for a classic fighter');
  checks.push('A fighter with the classic look keeps the classic picture, and no still file is downloaded.');
  await designed.close();

  // ---- A layer that cannot load ----
  blockedLayer = STILL.layers.otherPants;
  const broken = await open({ viewport: { width: 1440, height: 900 } }, PLAYER);
  await page.goto(`${base}/`);
  await nav('Training');
  await technique('Guillotine choke');
  stage = await settled('main', 'classic');
  assert.match(await stage.locator('.snapshot-position').innerText(), /^Standing\s+Position snapshot · your appearance$/);
  checks.push('If any layer cannot load, the stage shows the classic picture, never a half-colored athlete.');
  await broken.close();
  blockedLayer = null;

  // ---- Phones ----
  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 640 }]) {
    const phone = await open({ viewport, isMobile: true, hasTouch: true }, PLAYER);
    await page.goto(`${base}/`);
    await nav('Training');
    await technique('Guillotine choke');
    stage = await settled('main', 'unreal');
    const phoneState = await inspect(stage);
    assert.equal(await fits(), true, `${viewport.width}-pixel Training must not scroll sideways`);
    assert.ok(phoneState.width >= viewport.width * 0.75, `the picture uses most of the phone's width (${Math.round(phoneState.width)})`);
    const phoneColors = await painted(stage, `${viewport.width}px`);
    assert.ok(phoneColors.leadJacket.painted[1] > 170 && phoneColors.leadPants.painted[1] < 70, 'the colors hold at phone size');
    layouts.push({ viewport, where: 'training', still: await box(stage.locator('.unreal-position-still')) });
    await stage.scrollIntoViewIfNeeded();
    await capture(`phone-${viewport.width}`);
    await phone.close();
  }
  checks.push('At 390 and 320 pixels the picture fills the width, keeps its colors, and nothing scrolls sideways.');

  assert.deepEqual(errors, []);
  assert.deepEqual(consoleErrors, [], 'Unexpected browser console errors');
  assert.deepEqual(failedResponses, [], 'Every asset must load');
  report.status = 'passed';
  console.log(JSON.stringify({ checks, layouts, samples, arenaSettled: report.arenaSettled, images: images.length, artifacts }, null, 2));
} catch (error) {
  report.status = 'failed'; report.failure = error.stack || String(error);
  if (page && !page.isClosed()) await page.screenshot({ path: resolve(artifacts, 'failure.png'), fullPage: true, timeout: 10000 }).catch(() => {});
  console.error(error); process.exitCode = 1;
} finally {
  Object.assign(report, { checkedAtUtc: new Date().toISOString(), checks, layouts, samples, images, pageErrors: errors, consoleErrors, expectedConsoleErrors, failedResponses });
  await writeFile(resolve(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  if (browser) await browser.close().catch(() => {});
  if (server) { server.closeAllConnections(); await new Promise((resolveClose) => server.close(resolveClose)); }
}
