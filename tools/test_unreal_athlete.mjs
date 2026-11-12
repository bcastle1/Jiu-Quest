// Verifies the Unreal athlete in the built site in a real browser: the four
// still layers decode and are added together in the chosen gi and belt colors,
// the Fighter Creator shows only the choices the athlete can wear, saved
// fighters load with the right look, and the page fits phones. It checks still
// images composited by the browser. It does not run Unreal or any stream.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { chromium } from 'playwright';
import { UNREAL_ATHLETE } from '../src/unreal/athlete.js';
import unrealStancePictures from '../src/unreal/stancePictures.data.js';
import { beltColors, moves } from '../src/data/curriculum.js';

const root = resolve('dist');
const artifacts = resolve(process.env.JIUQUEST_BROWSER_ARTIFACTS || 'tmp/browser', 'unreal-athlete');
await mkdir(artifacts, { recursive: true });
const checks = [], images = [], errors = [], consoleErrors = [], failedResponses = [], layouts = [], samples = [];
const browserOptions = { headless: true, args: ['--enable-unsafe-swiftshader'], ...(process.env.JIUQUEST_BROWSER_CHANNEL ? { channel: process.env.JIUQUEST_BROWSER_CHANNEL } : {}), ...(process.env.JIUQUEST_BROWSER_EXECUTABLE ? { executablePath: process.env.JIUQUEST_BROWSER_EXECUTABLE } : {}) };
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const report = { startedAtUtc: new Date().toISOString(), status: 'running', scope: 'Still layers composited in desktop Chromium, with phone viewport emulation. No Unreal runtime, stream or physical device.' };
const STORAGE_KEY = 'jiuquest:v1';
const NAVY = '#112a58', BLACK = '#151922';
const ASPECT = UNREAL_ATHLETE.width / UNREAL_ATHLETE.height;
// Places on the figure, as fractions of its width and height.
const POINTS = { face: [0.478, 0.08], chest: [0.48, 0.25], belt: [0.58, 0.43], thigh: [0.33, 0.63] };
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
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push({ text: message.text(), location: message.location() }); });
  page.on('response', (response) => { if (response.status() >= 400) failedResponses.push({ url: response.url(), status: response.status() }); });
  return context;
}

const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const nav = async (name) => { await page.getByRole('button', { name, exact: true }).click(); };
const stage = () => page.locator('.profile-stage .profile-art');
const stageFigure = () => page.locator('.profile-stage .unreal-athlete-stage-figure');
const look = (name) => page.getByRole('group', { name: 'Athlete', exact: true }).getByRole('button', { name: new RegExp(`^${name}`) });
const swatch = (label, color) => page.getByRole('button', { name: `${label}: ${color}`, exact: true });
const savedState = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
const stanceField = () => page.locator('.builder-panel .field').filter({ hasText: 'Fighting Stance' });
const stancePicture = (stance) => unrealStancePictures.find((picture) => picture.stance === stance);
const heroArt = () => page.locator('.hero-stage').evaluate((element) => getComputedStyle(element).backgroundImage);
const formLabels = () => page.evaluate(() => ({
  fields: [...document.querySelectorAll('.builder-panel .field > span:first-child')].map((label) => label.textContent),
  swatches: [...document.querySelectorAll('.builder-panel .swatch-row > span')].map((label) => label.textContent),
}));

async function capture(name, options = {}) {
  const file = resolve(artifacts, `${name}.png`);
  const data = await page.screenshot({ path: file, fullPage: true, ...options });
  images.push({ name, path: file, bytes: data.length });
}

// Every layer of one athlete has loaded, is in order, and blends by addition.
async function athleteReady(figure) {
  await figure.waitFor();
  // The athlete marks itself ready only when the body and all three gi layers have loaded.
  await figure.and(page.locator('.is-ready')).waitFor();
  await figure.locator('img').evaluate((image) => image.decode());
  await page.waitForFunction((element) => [element.querySelector('img'), ...element.querySelectorAll('.unreal-athlete-layer')].every((part) => getComputedStyle(part).opacity === '1'), await figure.elementHandle());
  const state = await figure.evaluate(async (element) => {
    const base = element.querySelector('img');
    const layers = [...element.querySelectorAll('.unreal-athlete-layer')];
    const decoded = await Promise.all(layers.map(async (layer) => {
      const image = new Image();
      image.src = getComputedStyle(layer).backgroundImage.replace(/^url\(["']?|["']?\)$/g, '');
      await image.decode();
      return [new URL(image.src).pathname, image.naturalWidth, image.naturalHeight];
    }));
    const box = element.getBoundingClientRect();
    return {
      base: [new URL(base.currentSrc).pathname, base.naturalWidth, base.naturalHeight],
      order: layers.map((layer) => layer.dataset.layer),
      decoded,
      blend: layers.map((layer) => [getComputedStyle(layer).backgroundBlendMode, getComputedStyle(layer).mixBlendMode]),
      isolation: getComputedStyle(element).isolation,
      role: element.getAttribute('role'),
      label: element.getAttribute('aria-label'),
      aspect: box.width / box.height,
    };
  });
  const size = [UNREAL_ATHLETE.width, UNREAL_ATHLETE.height];
  assert.deepEqual(state.base, [UNREAL_ATHLETE.layers.base, ...size]);
  assert.deepEqual(state.order, ['jacket', 'pants', 'belt']);
  assert.deepEqual(state.decoded, ['jacket', 'pants', 'belt'].map((name) => [UNREAL_ATHLETE.layers[name], ...size]));
  for (const blend of state.blend) assert.deepEqual(blend, ['multiply', 'plus-lighter'], 'each layer is multiplied by its color and added');
  assert.equal(state.isolation, 'isolate', 'layers add to the athlete only, never to the page behind');
  assert.equal(state.role, 'img');
  assert.ok(state.label, 'the athlete has a text alternative');
  assert.ok(Math.abs(state.aspect / ASPECT - 1) < 0.01, `the athlete keeps its proportions (${state.aspect})`);
  return state;
}

// Average color of a small patch at each named place, read from what the browser painted.
async function painted(figure, label) {
  const data = (await figure.screenshot()).toString('base64');
  const colors = await page.evaluate(async ({ data, points }) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    return Object.fromEntries(Object.entries(points).map(([name, [x, y]]) => {
      const pixels = context.getImageData(Math.round(x * canvas.width) - 4, Math.round(y * canvas.height) - 4, 9, 9).data;
      const sum = [0, 0, 0];
      for (let index = 0; index < pixels.length; index += 4) for (let channel = 0; channel < 3; channel += 1) sum[channel] += pixels[index + channel];
      return [name, sum.map((value) => Math.round(value / (pixels.length / 4)))];
    }));
  }, { data, points: POINTS });
  samples.push({ label, colors });
  return colors;
}

const near = (a, b, tolerance) => a.every((value, index) => Math.abs(value - b[index]) <= tolerance);
const bright = (color, floor) => color.every((value) => value >= floor);
const dark = (color, ceiling) => color.every((value) => value <= ceiling);

async function insideStage() {
  const [outer, inner] = [await stage().boundingBox(), await stageFigure().boundingBox()];
  assert.ok(inner.y >= outer.y - 1 && inner.y + inner.height <= outer.y + outer.height + 1, 'the whole athlete stands inside the stage');
  assert.ok(inner.x >= outer.x - 1 && inner.x + inner.width <= outer.x + outer.width + 1, 'the athlete is not cut off at the sides');
  return { stage: outer, figure: inner };
}

// The athlete's box must meet the black stage without a line of light down
// either side. Beside the head both are plain background, so each pixel column
// there should sit between its two neighbours.
async function noHairline(label) {
  const [outer, inner] = [await stage().boundingBox(), await stageFigure().boundingBox()];
  const data = (await stage().screenshot()).toString('base64');
  const worst = await page.evaluate(async ({ data, box }) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const [top, bottom] = [Math.round(box.y + box.height * 0.02), Math.round(box.y + box.height * 0.12)];
    const column = (x) => {
      const pixels = context.getImageData(x, top, 1, bottom - top).data;
      let sum = 0;
      for (let index = 0; index < pixels.length; index += 4) sum += pixels[index] + pixels[index + 1] + pixels[index + 2];
      return sum / (bottom - top);
    };
    let worst = 0;
    for (const edge of [Math.round(box.x), Math.round(box.x + box.width)]) {
      for (let x = edge - 3; x <= edge + 3; x += 1) worst = Math.max(worst, Math.abs(column(x) - (column(x - 1) + column(x + 1)) / 2));
    }
    return worst;
  }, { data, box: { x: inner.x - outer.x, y: inner.y - outer.y, width: inner.width, height: inner.height } });
  samples.push({ label, edgeStep: Math.round(worst * 10) / 10 });
  assert.ok(worst <= 6, `${label}: a line of light shows at the edge of the athlete (${worst.toFixed(1)})`);
}

try {
  const base = process.env.JIUQUEST_PREVIEW_URL?.replace(/\/$/, '') || await staticSite();
  browser = await chromium.launch(browserOptions);
  report.browserVersion = browser.version();

  // ---- A first visit on a desktop ----
  const desktop = await open({ viewport: { width: 1440, height: 1000 } });
  await page.goto(`${base}/?engine=snapshot`);

  // The Overview hero shows the athlete beside the headline when it has room.
  // A wide window keeps this clear of the 700-pixel threshold whether or not
  // the browser reserves space for a scrollbar.
  await page.setViewportSize({ width: 1600, height: 1000 });
  const heroAthlete = page.locator('.hero-stage.has-athlete .hero-athlete .unreal-athlete');
  await athleteReady(heroAthlete);
  const hero = await page.evaluate(() => {
    const right = (node) => { const range = document.createRange(); range.selectNodeContents(node); return range.getBoundingClientRect().right; };
    const figure = document.querySelector('.hero-athlete .unreal-athlete').getBoundingClientRect();
    const stage = document.querySelector('.hero-stage').getBoundingClientRect();
    return {
      width: stage.width,
      words: Math.max(right(document.querySelector('.hero-content h1')), right(document.querySelector('.hero-content p')), document.querySelector('.hero-metrics').getBoundingClientRect().right),
      // The arms begin about a sixth of the way into the figure's box.
      body: figure.x + figure.width * 0.15,
      insideRight: figure.x + figure.width * 0.85 <= stage.right,
    };
  });
  assert.ok(hero.body >= hero.words, `the headline, summary and totals stay clear of the athlete (${JSON.stringify(hero)})`);
  assert.equal(hero.insideRight, true, 'the athlete is not cut off at the right edge of the hero');
  assert.equal(await fits(), true);
  await capture('desktop-overview-hero', { fullPage: false });
  await page.setViewportSize({ width: 1024, height: 1000 });
  assert.equal(await page.locator('.hero-athlete').isVisible(), false, 'a hero without room beside the headline does not squeeze the athlete in');
  const narrowHero = await heroArt();
  assert.match(narrowHero, /unreal-clips\/standing_stance\/fighter-side\.webp/, 'a narrow hero shows the Unreal athletes behind the headline');
  assert.doesNotMatch(narrowHero, /side-control\.png/);
  await capture('desktop-overview-hero-narrow', { fullPage: false });
  await page.setViewportSize({ width: 1440, height: 1000 });
  checks.push('The Overview hero shows the athlete clear of the headline when the hero is wide enough, and the Unreal standing-stance picture behind the headline when it is not.');

  await nav('Profile');
  await page.getByRole('heading', { level: 1, name: 'Fighter Creator', exact: true }).waitFor();
  assert.equal(await look('Unreal athlete').getAttribute('aria-pressed'), 'true');
  assert.equal(await look('Classic').getAttribute('aria-pressed'), 'false');
  await athleteReady(stageFigure());
  assert.deepEqual(await formLabels(), { fields: ['Name', 'Country', 'Start Position', 'Fighting Stance', 'Aura'], swatches: ['Gi Jacket', 'Gi Pants'] });
  assert.match(await page.locator('.fighter-look-note').innerText(), /one face, build and hairstyle for now/);
  const desktopLayout = await insideStage();
  assert.ok(desktopLayout.figure.height >= 480, 'the athlete is shown large beside the Fighter Creator');
  layouts.push({ viewport: page.viewportSize(), ...desktopLayout });
  assert.equal(await page.locator('.gi-colors-athlete').isVisible(), false, 'the small copy beside the swatches is for one-column pages only');
  checks.push('A first visit opens the Fighter Creator on the Unreal athlete: four 900 by 1760 layers decode, blend by addition and keep their proportions.');

  const white = await painted(stageFigure(), 'white gi, white belt');
  assert.ok(bright(white.chest, 180) && bright(white.thigh, 150) && bright(white.belt, 180), `a white gi and belt paint white (${JSON.stringify(white)})`);
  // White layers at sizes that land between whole pixels are where a seam would show.
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 1280, height: 933 }, { width: 1440, height: 1000 }]) {
    await page.setViewportSize(viewport);
    await noHairline(`${viewport.width} by ${viewport.height}`);
  }
  await swatch('Gi Jacket', NAVY).click();
  const navy = await painted(stageFigure(), 'navy jacket, white pants');
  assert.ok(navy.chest[2] - navy.chest[0] >= 30 && navy.chest[0] <= 110, `the jacket turns navy (${navy.chest})`);
  assert.ok(near(navy.thigh, white.thigh, 6) && near(navy.belt, white.belt, 6), 'the jacket color leaves the pants and belt alone');
  await swatch('Gi Pants', BLACK).click();
  const black = await painted(stageFigure(), 'navy jacket, black pants');
  assert.ok(dark(black.thigh, 80), `the pants turn black (${black.thigh})`);
  assert.ok(near(black.chest, navy.chest, 6) && near(black.belt, white.belt, 6), 'the pants color leaves the jacket and belt alone');
  assert.ok(near(black.face, white.face, 4) && near(navy.face, white.face, 4), 'gi colors never tint the face');
  assert.equal(await swatch('Gi Jacket', NAVY).getAttribute('aria-pressed'), 'true');
  await capture('desktop-navy-jacket-black-pants');
  checks.push('Choosing a jacket color and a pants color repaints only that garment; the belt and face are unchanged.');

  // The stance picker shows the Unreal athlete in each stance.
  const trigger = stanceField().locator('.image-select-trigger');
  const pictureIn = (locator) => locator.locator('img').evaluate((image) => {
    const box = image.getBoundingClientRect();
    return { src: new URL(image.currentSrc || image.src).pathname, natural: [image.naturalWidth, image.naturalHeight], shape: box.width / box.height };
  });
  assert.equal(await stanceField().locator('.image-select.unreal-stances').count(), 1);
  await page.waitForFunction(() => { const image = document.querySelector('.image-select.unreal-stances .image-select-trigger img'); return image?.complete && image.naturalWidth > 0; });
  const chosenStance = await pictureIn(trigger);
  assert.deepEqual([chosenStance.src, chosenStance.natural], [stancePicture('wrestling stance').src, [480, 600]]);
  assert.ok(Math.abs(chosenStance.shape - 0.8) < 0.03, `the stance picture keeps its four-by-five shape (${chosenStance.shape})`);
  await trigger.click();
  const stanceOptions = stanceField().getByRole('option');
  assert.equal(await stanceOptions.count(), unrealStancePictures.length);
  await page.waitForFunction(() => [...document.querySelectorAll('.image-select.unreal-stances .image-select-menu img')].every((image) => image.complete && image.naturalWidth > 0));
  assert.deepEqual(await stanceOptions.locator('img').evaluateAll((pictures) => pictures.map((picture) => new URL(picture.currentSrc || picture.src).pathname)), unrealStancePictures.map((picture) => picture.src));
  assert.equal(await stanceField().locator('.image-select-fighter').count(), 0, 'the Unreal picker shows no classic figure');
  await capture('desktop-stance-picker', { fullPage: false });
  await stanceOptions.filter({ hasText: 'Karate Stance' }).click();
  assert.equal((await pictureIn(trigger)).src, stancePicture('karate stance').src);
  await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key) ?? '{}').fighters?.[0]?.stance === 'karate stance', STORAGE_KEY);
  checks.push('The stance picker shows the Unreal athlete in each of the seven stances, and the chosen stance is saved.');

  // The round portrait in the top bar shows the head-and-collar square.
  const portrait = page.locator('.fighter-select .mini-portrait');
  await athleteReady(portrait.locator('.unreal-athlete'));
  // Measured inside the portrait's border, which is where the figure is placed.
  const circle = await portrait.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { x: box.x + element.clientLeft, y: box.y + element.clientTop, width: element.clientWidth, height: element.clientHeight };
  });
  const figure = await portrait.locator('.unreal-athlete').boundingBox();
  const { left, top, size } = UNREAL_ATHLETE.portrait;
  assert.ok(Math.abs(figure.width / circle.width - UNREAL_ATHLETE.width / size) < 0.08, 'the portrait is scaled to the head-and-collar square');
  assert.ok(Math.abs((circle.x - figure.x) / figure.width - left / UNREAL_ATHLETE.width) < 0.02, 'the portrait is centered on the face');
  assert.ok(Math.abs((circle.y - figure.y) / figure.height - top / UNREAL_ATHLETE.height) < 0.02, 'the portrait starts above the hair');
  checks.push('The round portrait in the top bar is the same athlete, cropped to the head and collar.');

  // Classic and back: the choices the Unreal athlete cannot wear appear and disappear.
  await look('Classic').click();
  assert.equal(await look('Classic').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('.app-shell .unreal-athlete').count(), 0, 'the classic look shows no Unreal athlete anywhere');
  assert.equal(await page.locator('.profile-stage .profile-art:not(.unreal-athlete-stage)').count(), 1);
  assert.deepEqual(await formLabels(), { fields: ['Name', 'Country', 'Gender', 'Start Position', 'Hair Style', 'Fighting Stance', 'Aura', 'Patch Emblem'], swatches: ['Skin Tone', 'Hair Color', 'Gi Jacket', 'Gi Pants'] });
  assert.equal(await page.locator('.fighter-look-note').count(), 0);
  assert.deepEqual([await stanceField().locator('.image-select.unreal-stances').count(), await stanceField().locator('.image-select-trigger .image-select-fighter').count()], [0, 1], 'the classic look keeps its own stance figures');
  await capture('desktop-classic');
  await nav('Overview');
  assert.equal(await page.locator('.app-shell .unreal-athlete, .hero-stage.has-athlete').count(), 0, 'a classic fighter keeps the classic hero and portraits');
  assert.match(await heroArt(), /side-control\.png/, 'a classic fighter keeps the classic hero art');
  await nav('Profile');
  await look('Unreal athlete').focus(); await page.keyboard.press('Enter');
  assert.equal(await look('Unreal athlete').getAttribute('aria-pressed'), 'true');
  await athleteReady(stageFigure());
  assert.ok(near((await painted(stageFigure(), 'back from classic')).chest, navy.chest, 6), 'the gi colors survive a change of look');
  checks.push('Classic and Unreal athlete switch by pointer and keyboard; each shows only the appearance choices it can wear.');

  // Saved on the device, and still there after a reload.
  await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key) ?? '{}').fighters?.[0]?.look === 'unreal', STORAGE_KEY);
  const first = (await savedState()).fighters[0];
  assert.deepEqual([first.look, first.giTop, first.giPants], ['unreal', NAVY, BLACK]);
  await page.reload();
  await nav('Profile');
  await athleteReady(stageFigure());
  assert.equal(await look('Unreal athlete').getAttribute('aria-pressed'), 'true');
  assert.equal(await swatch('Gi Pants', BLACK).getAttribute('aria-pressed'), 'true');
  assert.ok(near((await painted(stageFigure(), 'after reload')).thigh, black.thigh, 6));
  checks.push('The look and gi colors are saved on the device and return after a reload.');

  // A new fighter starts as the Unreal athlete.
  await page.getByRole('button', { name: 'New Slot', exact: true }).click();
  await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key) ?? '{}').fighters?.length === 2, STORAGE_KEY);
  assert.deepEqual((await savedState()).fighters.map((fighter) => fighter.look), ['unreal', 'unreal']);
  await athleteReady(stageFigure());
  assert.equal(await look('Unreal athlete').getAttribute('aria-pressed'), 'true');

  // The same athlete beside the proficiency test and on the rank path.
  await nav('Training');
  await athleteReady(page.locator('.belt-mini .unreal-athlete.mini-fighter'));
  await nav('Insights');
  await athleteReady(page.locator('.progress-profile-art.unreal-athlete-stage .unreal-athlete'));
  await capture('desktop-insights');
  checks.push('A new fighter starts as the Unreal athlete, which also appears in Training and on the rank path in Insights.');
  await desktop.close();

  // ---- A returning visitor ----
  const blueMoves = Object.fromEntries(moves.filter((move) => move.belt === 'blue' && !move.preview).map((move) => [move.id, 5]));
  const returning = await open({ viewport: { width: 1440, height: 1000 } }, {
    selectedFighterId: 'designed',
    fighters: [
      { id: 'designed', name: 'Designed', gender: 'girl', hairStyle: 'braided top', skinTone: '#a86b4d', hairColor: '#3b251b', emblem: 'lion', giTop: '#1d7d68', giPants: '#f8fbff' },
      { id: 'stock-blue', name: 'Stock Blue', giTop: '#f8fbff', giPants: '#f8fbff', progress: blueMoves },
    ],
  });
  await page.goto(`${base}/?engine=snapshot`);
  await nav('Profile');
  assert.equal(await look('Classic').getAttribute('aria-pressed'), 'true', 'a fighter someone designed keeps its classic art');
  assert.equal(await page.locator('.app-shell .unreal-athlete').count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Gender: girl', exact: true }).getAttribute('aria-pressed'), 'true');
  await look('Unreal athlete').click();
  await athleteReady(stageFigure());
  await look('Classic').click();
  assert.equal(await page.locator('.builder-panel .field').filter({ hasText: 'Hair Style' }).locator('select').inputValue(), 'braided top', 'the hair style is kept while the Unreal athlete is worn');
  assert.equal(await page.getByRole('button', { name: 'Gender: girl', exact: true }).getAttribute('aria-pressed'), 'true');

  await page.getByLabel('Active fighter').selectOption('stock-blue');
  await athleteReady(stageFigure());
  assert.equal(await look('Unreal athlete').getAttribute('aria-pressed'), 'true', 'a stock fighter moves to the Unreal athlete');
  assert.match(await page.locator('.profile-stage .profile-art-tags').innerText(), /BLUE BELT/i);
  const blue = await painted(stageFigure(), 'white gi, blue belt');
  assert.equal(beltColors.blue, '#2368ff');
  assert.ok(blue.belt[2] >= 150 && blue.belt[2] - blue.belt[0] >= 80, `the belt follows the rank (${blue.belt})`);
  assert.ok(bright(blue.chest, 180) && bright(blue.thigh, 150), 'the belt color leaves the gi alone');
  await capture('returning-blue-belt');
  checks.push('A returning visitor keeps a designed fighter in classic art with every saved choice; a stock fighter moves to the Unreal athlete, whose belt follows the rank.');
  await returning.close();

  // ---- Phones ----
  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 640 }]) {
    const phone = await open({ viewport, isMobile: true, hasTouch: true });
    await page.goto(`${base}/?engine=snapshot`);
    await nav('Profile');
    await athleteReady(stageFigure());
    assert.equal(await fits(), true, `${viewport.width}-pixel Profile must not scroll sideways`);
    const layout = await insideStage();
    assert.ok(layout.figure.height >= 380, 'an upright phone shows a tall athlete');
    for (const name of ['Unreal athlete', 'Classic']) assert.ok((await look(name).boundingBox()).height >= 44, `${name} is easy to tap`);
    const copy = page.locator('.gi-colors-athlete');
    await copy.scrollIntoViewIfNeeded();
    await athleteReady(copy);
    const copyBox = await copy.boundingBox();
    assert.ok(copyBox.height >= 120, 'a copy of the athlete sits beside the gi swatches');
    await swatch('Gi Jacket', NAVY).tap();
    const beside = await painted(copy, `${viewport.width}px copy beside the swatches`);
    assert.ok(beside.chest[2] - beside.chest[0] >= 30, 'the copy beside the swatches repaints as a color is tapped');
    const swatchBox = await swatch('Gi Jacket', NAVY).boundingBox();
    assert.ok(swatchBox.y < copyBox.y + copyBox.height && swatchBox.y + swatchBox.height > copyBox.y, 'the swatches and the copy are on screen together');
    assert.equal(await fits(), true);
    layouts.push({ viewport, ...layout, copy: copyBox });
    await capture(`phone-${viewport.width}`);
    await nav('Training');
    await athleteReady(page.locator('.belt-mini .unreal-athlete.mini-fighter'));
    assert.equal(await fits(), true, `${viewport.width}-pixel Training must not scroll sideways`);
    await phone.close();
  }
  checks.push('At 390 and 320 pixels the athlete is tall, nothing scrolls sideways, and a copy beside the gi swatches repaints as colors are tapped.');

  assert.deepEqual(errors, []);
  assert.deepEqual(consoleErrors, [], 'Unexpected browser console errors');
  assert.deepEqual(failedResponses, [], 'Every athlete asset must load');
  report.status = 'passed';
  console.log(JSON.stringify({ checks, layouts, samples, images: images.length, artifacts }, null, 2));
} catch (error) {
  report.status = 'failed'; report.failure = error.stack || String(error);
  if (page && !page.isClosed()) await page.screenshot({ path: resolve(artifacts, 'failure.png'), fullPage: true, timeout: 10000 }).catch(() => {});
  console.error(error); process.exitCode = 1;
} finally {
  Object.assign(report, { checkedAtUtc: new Date().toISOString(), checks, layouts, samples, images, pageErrors: errors, consoleErrors, failedResponses });
  await writeFile(resolve(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  if (browser) await browser.close().catch(() => {});
  if (server) { server.closeAllConnections(); await new Promise((resolveClose) => server.close(resolveClose)); }
}
