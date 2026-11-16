// Verifies the head choices of the Unreal athlete in the built site in a real
// browser: the Fighter Creator offers the faces, hairstyles, hair colours and
// beards; each choice paints its own Unreal picture over the athlete; gi colors
// still repaint only the gi; the choices are saved, and they show on the
// player's athlete in the top bar, the Overview, Training and the Arena
// (the scoreboard portrait and the standing position still); the classic
// position picture follows the chosen hair; a picture that cannot load never
// leaves a head painted in part, and is tried again. It checks still images
// composited by the browser. It does not run Unreal or any stream.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { chromium } from 'playwright';
import { UNREAL_ATHLETE } from '../src/unreal/athlete.js';
import { ATHLETE_BEARDS, ATHLETE_FACES, ATHLETE_HAIRS, ATHLETE_HAIR_COLORS, athleteFace, athleteHeadKey } from '../src/unreal/athleteHeadOptions.js';
import { ATHLETE_HEADS, athleteBaseUrl, athleteHeadThumb, athleteHeadUrl, athleteJacketUrl, standingBaseUrl, standingHeadUrl, standingJacketUrl } from '../src/unreal/athleteHeads.js';
import { findUnrealPositionStill } from '../src/unreal/positionStills.js';

const root = resolve('dist');
const artifacts = resolve(process.env.JIUQUEST_BROWSER_ARTIFACTS || 'tmp/browser', 'unreal-athlete-heads');
await mkdir(artifacts, { recursive: true });
const checks = [], images = [], errors = [], consoleErrors = [], expectedConsoleErrors = [], failedResponses = [], layouts = [], samples = [];
const browserOptions = { headless: true, args: ['--enable-unsafe-swiftshader'], ...(process.env.JIUQUEST_BROWSER_CHANNEL ? { channel: process.env.JIUQUEST_BROWSER_CHANNEL } : {}), ...(process.env.JIUQUEST_BROWSER_EXECUTABLE ? { executablePath: process.env.JIUQUEST_BROWSER_EXECUTABLE } : {}) };
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.wav': 'audio/wav' };
const report = { startedAtUtc: new Date().toISOString(), status: 'running', scope: 'Still pictures composited in desktop Chromium, with phone viewport emulation. No Unreal runtime, stream or physical device.' };
const STORAGE_KEY = 'jiuquest:v1';
const NAVY = '#112a58', BLACK = '#151922';
const STILL = findUnrealPositionStill('standing');
const { athlete: FRONT, standing: STANDING } = ATHLETE_HEADS;
const PUBLISHED_KEY = 'original/fringe/black/none';
// Places on the front-view figure, as fractions of its width and height.
// `face` is beside the nose, where the two faces have another shape; `hand` is on the back of a hand.
const POINTS = { crown: [0.472, 0.03], cheek: [0.44, 0.085], face: [0.515, 0.07], chest: [0.48, 0.25], belt: [0.58, 0.43], thigh: [0.33, 0.63], hand: [0.78, 0.49] };
const headFile = athleteHeadUrl;
const fields = (face, hair, hairColor, beard) => ({ athleteFace: face, athleteHair: hair, athleteHairColor: hairColor, athleteBeard: beard });
const savedFighter = (head, extra = {}) => ({ selectedFighterId: 'fighter-heads', fighters: [{ id: 'fighter-heads', name: 'Head Tester', country: 'Brazil', look: 'unreal', giTop: '#f8fbff', giPants: '#f8fbff', stance: 'wrestling stance', aura: 'void violet', startPose: 'standing', ...head, ...extra }] });
let browser, server, page, blocked = null;

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
  // One profile below removes a head file on purpose; its load error is expected.
  if (blocked) await page.route(`**${blocked}`, (route) => route.abort());
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') (blocked ? expectedConsoleErrors : consoleErrors).push({ text: message.text(), location: message.location() }); });
  page.on('response', (response) => { if (response.status() >= 400) failedResponses.push({ url: response.url(), status: response.status() }); });
  return context;
}

const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const nav = async (name) => { await page.getByRole('button', { name, exact: true }).click(); };
const technique = async (name) => { await page.getByRole('button', { name: new RegExp(name) }).first().click(); };
const stageFigure = () => page.locator('.profile-stage .unreal-athlete-stage-figure');
const group = (name) => page.locator('.athlete-head-picker').getByRole('group', { name, exact: true });
const choice = (name, label) => group(name).getByRole('button', { name: new RegExp(`^${label}`) });
const colorChoice = (label) => group('Hair color').getByRole('button', { name: `Hair color: ${label}`, exact: true });
const swatch = (label, color) => page.getByRole('button', { name: `${label}: ${color}`, exact: true });
const savedState = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
const pressed = async (name) => group(name).locator('button[aria-pressed="true"]').evaluateAll((buttons) => buttons.map((button) => button.dataset.option));
const near = (a, b, tolerance) => a.every((value, index) => Math.abs(value - b[index]) <= tolerance);
const rgb = (hex) => `rgb(${[1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)).join(', ')})`;

async function capture(name, options = {}) {
  const file = resolve(artifacts, `${name}.png`);
  const data = await page.screenshot({ path: file, fullPage: true, ...options });
  images.push({ name, path: file, bytes: data.length });
}

// The athlete shows the head named by `key`: the right base, and the right picture over it in the right place.
async function athleteShows(figure, key) {
  await figure.and(page.locator(`.is-ready[data-head="${key}"]`)).waitFor({ timeout: 30000 });
  const [face, hair, hairColor, beard] = key.split('/');
  const isBase = key === athleteHeadKey({ face, ...athleteFace(face).base });
  const state = await figure.evaluate(async (element) => {
    const [base, head] = [element.querySelector(':scope > img:not(.unreal-athlete-head)'), element.querySelector(':scope > img.unreal-athlete-head')];
    await Promise.all([base, head].filter(Boolean).map((image) => image.decode()));
    // The gi layers are backgrounds: wait until each of their files can be painted too, then for a frame.
    const layerFiles = [...element.querySelectorAll('.unreal-athlete-layer')].map((layer) => getComputedStyle(layer).backgroundImage.replace(/^url\(["']?|["']?\)$/g, ''));
    await Promise.all(layerFiles.map((url) => { const image = new Image(); image.src = url; return image.decode(); }));
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    // The head is placed against the base picture, which fills the figure inside its border (some figures have
    // one). Sizes read from the figure itself are whole pixels, too coarse for a figure 27 pixels wide.
    const box = base.getBoundingClientRect();
    const place = (image) => { const r = image.getBoundingClientRect(); return [(r.x - box.x) / box.width, (r.y - box.y) / box.height, r.width / box.width, r.height / box.height]; };
    return {
      base: [new URL(base.currentSrc).pathname, base.naturalWidth, base.naturalHeight],
      head: head ? { src: new URL(head.currentSrc).pathname, natural: [head.naturalWidth, head.naturalHeight], place: place(head), opacity: getComputedStyle(head).opacity, blend: getComputedStyle(head).mixBlendMode } : null,
      // the head lies over the base and under every gi layer
      order: [...element.children].map((child) => (child.tagName === 'IMG' ? (child.classList.contains('unreal-athlete-head') ? 'head' : 'base') : child.dataset.layer)),
      layers: Object.fromEntries([...element.querySelectorAll('.unreal-athlete-layer')].map((layer) => [layer.dataset.layer, new URL(getComputedStyle(layer).backgroundImage.replace(/^url\(["']?|["']?\)$/g, '')).pathname])),
    };
  });
  assert.deepEqual(state.base, [athleteBaseUrl(face), FRONT.width, FRONT.height], `${key}: base picture`);
  // the jacket layer fits the neck of the face in the base; pants and belt are the published layers
  assert.deepEqual(state.layers, { jacket: athleteJacketUrl(face), pants: UNREAL_ATHLETE.layers.pants, belt: UNREAL_ATHLETE.layers.belt }, `${key}: gi layers`);
  if (isBase) {
    assert.equal(state.head, null, `${key} is what its base shows: nothing is laid over it`);
    assert.deepEqual(state.order, ['base', 'jacket', 'pants', 'belt']);
  } else {
    const [left, top, width, height] = FRONT.headBox;
    assert.deepEqual([state.head.src, state.head.natural], [headFile(key), [width, height]], `${key}: head picture`);
    const want = [left / FRONT.width, top / FRONT.height, width / FRONT.width, height / FRONT.height];
    assert.ok(state.head.place.every((value, index) => Math.abs(value - want[index]) < 0.004), `${key}: the head lies on the head (${state.head.place.map((value) => value.toFixed(4))} against ${want.map((value) => value.toFixed(4))})`);
    assert.deepEqual([state.head.opacity, state.head.blend], ['1', 'normal']);
    assert.deepEqual(state.order, ['base', 'head', 'jacket', 'pants', 'belt']);
  }
  return { face, hair, hairColor, beard };
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
      const pixels = context.getImageData(Math.round(x * canvas.width) - 3, Math.round(y * canvas.height) - 3, 7, 7).data;
      const sum = [0, 0, 0];
      for (let index = 0; index < pixels.length; index += 4) for (let channel = 0; channel < 3; channel += 1) sum[channel] += pixels[index + channel];
      return [name, sum.map((value) => Math.round(value / (pixels.length / 4)))];
    }));
  }, { data, points: POINTS });
  samples.push({ label, colors });
  return colors;
}

// The standing still shows the player's head in the player's place: on the
// athlete that wears the player's pants color (`playerPants`, which the rival
// does not wear).
async function stillShows(scope, key, playerPants) {
  await page.waitForFunction((selector) => {
    const element = document.querySelector(selector);
    return element?.dataset.ready === 'ready' && element.dataset.picture === 'unreal';
  }, `${scope} .grappling-snapshot-stage`, { timeout: 30000 });
  const [face] = key.split('/');
  const isBase = key === athleteHeadKey({ face, ...athleteFace(face).base });
  const state = await page.locator(`${scope} .unreal-position-still`).evaluate(async (element) => {
    const base = element.querySelector(':scope > img:not(.unreal-position-head)');
    const heads = [...element.querySelectorAll(':scope > img.unreal-position-head')];
    await Promise.all([base, ...heads].map((image) => image.decode()));
    const box = element.getBoundingClientRect();
    return {
      base: [new URL(base.currentSrc).pathname, base.naturalWidth, base.naturalHeight],
      heads: heads.map((head) => { const r = head.getBoundingClientRect(); return { role: head.dataset.head, src: new URL(head.currentSrc).pathname, natural: [head.naturalWidth, head.naturalHeight], place: [(r.x - box.x) / box.width, (r.y - box.y) / box.height, r.width / box.width, r.height / box.height] }; }),
      order: [...element.children].map((child) => (child.tagName === 'IMG' ? (child.classList.contains('unreal-position-head') ? 'head' : 'base') : 'layer')),
      layers: Object.fromEntries([...element.querySelectorAll('.unreal-position-layer')].map((layer) => [layer.dataset.layer, new URL(getComputedStyle(layer).backgroundImage.replace(/^url\(["']?|["']?\)$/g, '')).pathname])),
      colors: Object.fromEntries([...element.querySelectorAll('.unreal-position-layer')].map((layer) => [layer.dataset.layer, getComputedStyle(layer).backgroundColor])),
    };
  });
  // The player's place is where a head is laid, or, for a face with a base of its own, which base is shown.
  const roles = ['lead', 'other'];
  const baseOf = (role) => standingBaseUrl(STILL, role, face);
  const role = isBase ? roles.find((candidate) => state.base[0] === baseOf(candidate)) : state.heads[0]?.role;
  assert.ok(roles.includes(role), `${key}: the player's athlete was found in the still (${JSON.stringify(state)})`);
  // The chosen head is on the player's athlete, not on the rival's.
  const wearsPlayerPants = roles.filter((candidate) => state.colors[`${candidate}Pants`] === rgb(playerPants));
  assert.deepEqual(wearsPlayerPants, [role], `${key}: the head is on the athlete in the player's gi (${JSON.stringify(state.colors)})`);
  assert.deepEqual(state.base, [baseOf(role), STANDING.width, STANDING.height], `${key}: base of the still`);
  // six gi layers: the published ones, except the jacket of an athlete with another face
  const jacketLayer = role === 'lead' ? 'leadJacket' : 'otherJacket';
  const wantLayers = Object.fromEntries(Object.entries(STILL.layers).filter(([name]) => name !== 'base').map(([name, url]) => [name, name === jacketLayer ? standingJacketUrl(STILL, role, face) : url]));
  assert.deepEqual(state.layers, wantLayers, `${key}: gi layers of the still`);
  if (isBase) assert.deepEqual(state.heads, []);
  else {
    assert.equal(state.heads.length, 1, 'only the player has a chosen head');
    const [left, top, width, height] = STANDING[role].headBox;
    assert.deepEqual([state.heads[0].src, state.heads[0].natural], [standingHeadUrl(role, key), [width, height]]);
    const want = [left / STANDING.width, top / STANDING.height, width / STANDING.width, height / STANDING.height];
    assert.ok(state.heads[0].place.every((value, index) => Math.abs(value - want[index]) < 0.004), `${key}: the head lies on the ${role} athlete's head`);
    assert.deepEqual(state.order.slice(0, 3), ['base', 'head', 'layer'], 'the head lies under the gi layers');
  }
  return role;
}

try {
  const base = process.env.JIUQUEST_PREVIEW_URL?.replace(/\/$/, '') || await staticSite();
  browser = await chromium.launch(browserOptions);
  report.browserVersion = browser.version();

  // ---- A first visit on a desktop: the Fighter Creator ----
  const desktop = await open({ viewport: { width: 1440, height: 1000 } });
  await page.goto(`${base}/?engine=snapshot`);
  await nav('Profile');
  await page.getByRole('heading', { level: 1, name: 'Fighter Creator', exact: true }).waitFor();
  await athleteShows(stageFigure(), PUBLISHED_KEY);
  const note = await page.locator('.fighter-look-note').innerText();
  assert.match(note, /face, hair and beard/);
  // It says where the look shows and where it does not.
  assert.match(note, /Your portrait and the Unreal standing picture show this look in Training and the Arena\./);
  assert.match(note, /Clips and stance pictures show the standard athlete, and classic position pictures follow your hair color and haircut\./);
  assert.deepEqual(await group('Face').getByRole('button').evaluateAll((buttons) => buttons.map((button) => button.querySelector('strong').textContent)), ['Standard', 'Dean']);
  assert.equal(await page.locator('.athlete-head-preview').isVisible(), false, 'beside the stage the picker needs no second head');
  assert.deepEqual(await group('Face').getByRole('button').evaluateAll((buttons) => buttons.map((button) => button.dataset.option)), ATHLETE_FACES.map((option) => option.id));
  assert.deepEqual(await group('Hair').getByRole('button').evaluateAll((buttons) => buttons.map((button) => button.dataset.option)), ATHLETE_HAIRS.map((option) => option.id));
  assert.deepEqual(await group('Hair color').getByRole('button').evaluateAll((buttons) => buttons.map((button) => button.dataset.option)), ATHLETE_HAIR_COLORS.map((option) => option.id));
  assert.deepEqual(await group('Beard').getByRole('button').evaluateAll((buttons) => buttons.map((button) => button.dataset.option)), ATHLETE_BEARDS.map((option) => option.id));
  assert.deepEqual([await pressed('Face'), await pressed('Hair'), await pressed('Hair color'), await pressed('Beard')], [['original'], ['fringe'], ['black'], ['none']]);
  // every button with a picture shows a published 128 pixel head
  await page.waitForFunction(() => [...document.querySelectorAll('.athlete-head-options img')].every((image) => image.complete && image.naturalWidth > 0));
  const thumbs = await page.locator('.athlete-head-options img').evaluateAll((pictures) => pictures.map((picture) => [new URL(picture.currentSrc || picture.src).pathname, picture.naturalWidth, picture.naturalHeight]));
  assert.deepEqual(thumbs, [...ATHLETE_FACES.map((face) => [athleteHeadThumb(face.id, 'fringe'), 128, 128]), ...ATHLETE_HAIRS.map((hair) => [athleteHeadThumb('original', hair.id), 128, 128])]);
  const start = await painted(stageFigure(), 'published athlete');
  assert.ok(start.crown.every((value) => value < 90), `the first athlete has dark hair on the crown (${start.crown})`);
  checks.push('The Fighter Creator opens on the published athlete and offers two faces, five hairstyles, four hair colors and two beards, each picture button showing its own rendered head.');

  // Hair: another hairstyle is a picture laid over the head; a shaved head shows skin on the crown.
  await choice('Hair', 'Buzz cut, skin fade').click();
  await athleteShows(stageFigure(), 'original/skin-fade/black/none');
  await choice('Hair', 'Shaved').click();
  await athleteShows(stageFigure(), 'original/shaved/black/none');
  const shaved = await painted(stageFigure(), 'shaved');
  assert.ok(shaved.crown[0] > start.crown[0] + 60, `a shaved head shows skin where the hair was (${shaved.crown} against ${start.crown})`);
  assert.ok(near(shaved.chest, start.chest, 6) && near(shaved.thigh, start.thigh, 6) && near(shaved.hand, start.hand, 6), 'a hairstyle changes nothing below the head');
  // A shaved head without a beard has no hair to color. The colors stay in use, each with a note that says so,
  // and a color chosen now is kept: it shows as soon as there is a beard.
  const described = () => group('Hair color').getByRole('button').evaluateAll((buttons) => buttons.map((button) => [button.disabled, document.getElementById(button.getAttribute('aria-describedby') ?? '')?.textContent ?? null]));
  assert.deepEqual(await described(), ATHLETE_HAIR_COLORS.map(() => [false, 'Shows once you add hair or a beard.']));
  await colorChoice('Brown').click();
  assert.deepEqual(await pressed('Hair color'), ['brown']);
  await athleteShows(stageFigure(), 'original/shaved/black/none');
  await choice('Beard', 'Stubble').click();
  await athleteShows(stageFigure(), 'original/shaved/brown/stubble');
  assert.deepEqual(await described(), ATHLETE_HAIR_COLORS.map(() => [false, null]));
  await colorChoice('Grey').click();
  await athleteShows(stageFigure(), 'original/shaved/grey/stubble');
  await choice('Hair', 'Side-swept fringe').click();
  await colorChoice('Blond').click();
  await choice('Beard', 'Clean-shaven').click();
  await athleteShows(stageFigure(), 'original/fringe/blond/none');
  const blond = await painted(stageFigure(), 'blond fringe');
  assert.ok(blond.crown[0] > start.crown[0] + 80 && blond.crown[0] > blond.crown[2] + 25, `blond hair is much lighter than black hair, and warm (${blond.crown} against ${start.crown})`);
  assert.ok(near(blond.cheek, start.cheek, 10), 'the face is the same face');
  await capture('desktop-original-blond-fringe');
  checks.push('Hairstyle, hair color and beard each paint their own picture over the head, in place, under the gi layers; for a shaved head without a beard the hair colors stay in use with a note, and the color chosen shows once there is a beard.');

  // Face: another face is a base picture of its own (hands and feet too), with the same choices over it.
  await choice('Face', 'Dean').click();
  await athleteShows(stageFigure(), 'dean/fringe/blond/none');
  const dean = await painted(stageFigure(), 'Dean, blond fringe');
  assert.ok(!near(dean.hand, start.hand, 15) && !near(dean.face, start.face, 30), `another face is another face, with another skin on the hands (${JSON.stringify(dean)} against ${JSON.stringify(start)})`);
  assert.ok(near(dean.chest, start.chest, 8) && near(dean.thigh, start.thigh, 8) && near(dean.belt, start.belt, 8), 'the gi is the same gi');
  const deanThumbs = await group('Hair').locator('img').evaluateAll((pictures) => pictures.map((picture) => new URL(picture.currentSrc || picture.src).pathname));
  assert.deepEqual(deanThumbs, ATHLETE_HAIRS.map((hair) => athleteHeadThumb('dean', hair.id)), 'the hairstyle buttons show the chosen face');
  await choice('Hair', 'Coil buzz cut').click();
  await colorChoice('Black').click();
  await choice('Beard', 'Stubble').click();
  await athleteShows(stageFigure(), 'dean/coil-buzz/black/stubble');
  await choice('Hair', 'Short coily, low fade').click();
  await colorChoice('Grey').click();
  const chosen = 'dean/coily-fade/grey/stubble';
  await athleteShows(stageFigure(), chosen);
  await capture('desktop-dean-coily-grey-stubble');
  checks.push('Choosing the other face changes the whole athlete to that face\'s base picture, hands and feet included, and every hairstyle, color and beard is laid over it the same way.');

  // Gi colors still repaint only the gi, whatever the head.
  const whiteGi = await painted(stageFigure(), 'Dean, white gi');
  assert.ok(whiteGi.chest.every((value) => value >= 180) && whiteGi.thigh.every((value) => value >= 150), `a white gi paints white (${JSON.stringify(whiteGi)})`);
  await swatch('Gi Jacket', NAVY).click();
  const navy = await painted(stageFigure(), 'Dean, navy jacket');
  assert.ok(navy.chest[2] - navy.chest[0] >= 30 && navy.chest[0] <= 110, `the jacket turns navy (${navy.chest})`);
  assert.ok(near(navy.thigh, whiteGi.thigh, 6) && near(navy.belt, whiteGi.belt, 6), 'the jacket color leaves the pants and belt alone');
  await swatch('Gi Pants', BLACK).click();
  const black = await painted(stageFigure(), 'Dean, navy jacket, black pants');
  assert.ok(black.thigh.every((value) => value <= 80), `the pants turn black (${black.thigh})`);
  assert.ok(near(black.chest, navy.chest, 6) && near(black.belt, whiteGi.belt, 6), 'the pants color leaves the jacket and belt alone');
  for (const point of ['crown', 'cheek', 'hand']) assert.ok(near(black[point], whiteGi[point], 5) && near(navy[point], whiteGi[point], 5), `gi colors never tint the ${point}`);
  await athleteShows(stageFigure(), chosen);
  await capture('desktop-dean-navy-jacket-black-pants');
  checks.push('With another face and hairstyle chosen, a jacket color and a pants color still repaint only that garment; head, hands and belt are unchanged.');

  // Saved on the device, and still there after a reload.
  await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key) ?? '{}').fighters?.[0]?.athleteBeard === 'stubble' && JSON.parse(localStorage.getItem(key)).fighters[0].giPants === '#151922', STORAGE_KEY);
  const first = (await savedState()).fighters[0];
  assert.deepEqual([first.look, first.athleteFace, first.athleteHair, first.athleteHairColor, first.athleteBeard, first.giTop, first.giPants], ['unreal', 'dean', 'coily-fade', 'grey', 'stubble', NAVY, BLACK]);
  await page.reload();
  await nav('Profile');
  await athleteShows(stageFigure(), chosen);
  assert.deepEqual([await pressed('Face'), await pressed('Hair'), await pressed('Hair color'), await pressed('Beard')], [['dean'], ['coily-fade'], ['grey'], ['stubble']]);
  assert.equal(await swatch('Gi Pants', BLACK).getAttribute('aria-pressed'), 'true');
  assert.ok(near((await painted(stageFigure(), 'after reload')).chest, black.chest, 6));
  checks.push('Face, hair, hair color, beard and gi colors are saved on the device and return after a reload.');

  // The same athlete everywhere the player's athlete is drawn.
  await athleteShows(page.locator('.fighter-select .mini-portrait .unreal-athlete'), chosen);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await nav('Overview');
  await athleteShows(page.locator('.hero-stage.has-athlete .hero-athlete .unreal-athlete'), chosen);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await stillShows('main', chosen, BLACK);
  await nav('Training');
  await athleteShows(page.locator('.belt-mini .unreal-athlete.mini-fighter'), chosen);
  await technique('Guillotine choke');
  const trainingRole = await stillShows('main', chosen, BLACK);
  assert.equal(trainingRole, 'lead', 'in Training the player is the athlete on the left');
  const trainingStage = page.locator('main .grappling-snapshot-stage');
  assert.match(await trainingStage.locator('.snapshot-position').innerText(), /^Standing\s+Unreal Engine · your face, hair, gi and belt colors$/);
  await trainingStage.scrollIntoViewIfNeeded();
  await capture('desktop-training-standing', { fullPage: false });
  await nav('Insights');
  await athleteShows(page.locator('.progress-profile-art .unreal-athlete'), chosen);
  checks.push('The top bar portrait, the Overview hero and scenario teaser, the Training figure and standing position picture, and the Insights rank path all show the chosen head.');

  // The Arena: the player's portrait in the scoreboard, the standing position picture, and an honest note on the clip.
  await nav('Arena');
  const scoreboard = page.locator('.arena-top');
  await athleteShows(scoreboard.locator('.fighter-card.has-portrait .mini-portrait .unreal-athlete'), chosen);
  const portrait = await scoreboard.locator('.mini-portrait').evaluateAll((portraits) => portraits.map((element) => { const box = element.getBoundingClientRect(); return { width: box.width, height: box.height, radius: getComputedStyle(element).borderRadius, hidden: element.getAttribute('aria-hidden'), reverse: element.closest('.fighter-card').classList.contains('reverse') }; }));
  assert.equal(portrait.length, 1, 'the player has a portrait; the rival keeps the gi swatches');
  assert.ok(portrait[0].width >= 40 && Math.abs(portrait[0].width - portrait[0].height) < 0.5 && portrait[0].radius === '50%' && !portrait[0].reverse, `a round portrait on the player's side (${JSON.stringify(portrait[0])})`);
  assert.equal(portrait[0].hidden, 'true', 'the name beside it says who it is');
  assert.deepEqual(await scoreboard.locator('.fighter-card').evaluateAll((cards) => cards.map((card) => card.querySelectorAll('.snapshot-kit').length)), [0, 1]);
  await scoreboard.scrollIntoViewIfNeeded();
  await capture('desktop-arena-scoreboard', { fullPage: false });
  await page.getByLabel('Your starting position', { exact: true }).selectOption('standing-headlock');
  await page.getByRole('button', { name: 'Position Start', exact: true }).click();
  const arenaRole = await stillShows('.mat-window', chosen, BLACK);
  await page.locator('.mat-window').scrollIntoViewIfNeeded();
  await capture('desktop-arena-standing-headlock', { fullPage: false });
  report.arena = { playerPlaceInStandingHeadlock: arenaRole };
  await page.reload();
  await nav('Arena');
  await page.getByRole('button', { name: 'Standing Start', exact: true }).click();
  const legend = page.locator('.unreal-clip-legend').first();
  await legend.waitFor();
  assert.match(await legend.innerText(), /Athletes and colors are fixed in this clip\./);
  checks.push('In the Arena the scoreboard shows the player as a round portrait with the chosen head, the standing position picture shows that head on the player\'s athlete, and the moving stance clip says that its athletes and colors are fixed.');
  await desktop.close();

  // ---- Where the Unreal athlete cannot be shown: the classic picture follows the chosen hair ----
  // Under mount has no Unreal picture, so the classic one is drawn; it takes the nearest classic hairstyle and hair
  // color from the chosen head (src/unreal/athleteStandIn.js). A beard has no classic counterpart.
  const classicPicture = async (head) => {
    const context = await open({ viewport: { width: 1440, height: 1000 } }, savedFighter(head));
    await page.goto(`${base}/?engine=snapshot`);
    await nav('Arena');
    await page.getByLabel('Your starting position', { exact: true }).selectOption('mount-bottom');
    await page.getByRole('button', { name: 'Position Start', exact: true }).click();
    const stage = page.locator('.mat-window .grappling-snapshot-stage[data-picture="classic"][data-ready="ready"]');
    await stage.waitFor({ timeout: 30000 });
    assert.match(await stage.locator('.snapshot-position').innerText(), /Classic art · your gi colors, hair color and a similar haircut$/);
    const picture = await stage.locator('canvas.snapshot-canvas').evaluate((canvas) => canvas.toDataURL('image/png'));
    await context.close();
    return picture;
  };
  const classicBlack = await classicPicture(fields('original', 'fringe', 'black', 'none'));
  assert.ok(classicBlack.length > 20000, 'the classic picture was drawn');
  assert.notEqual(await classicPicture(fields('original', 'fringe', 'blond', 'none')), classicBlack, 'another hair color repaints the classic picture');
  assert.notEqual(await classicPicture(fields('original', 'shaved', 'black', 'none')), classicBlack, 'another hairstyle repaints the classic picture');
  assert.notEqual(await classicPicture(fields('dean', 'fringe', 'black', 'none')), classicBlack, 'another face repaints the classic picture (its skin tone)');
  assert.equal(await classicPicture(fields('original', 'fringe', 'black', 'stubble')), classicBlack, 'a beard has no classic counterpart: the same picture');
  checks.push('Where only the classic picture exists (under mount), it is drawn with the chosen hair color, the nearest hairstyle and the face\'s skin tone, and its caption says so.');

  // ---- A head whose picture cannot load is never painted in part ----
  // Only the picture laid over the head is missing: the chosen face stays, as its base picture shows it.
  const deanBase = athleteHeadKey({ face: 'dean', ...athleteFace('dean').base });
  blocked = headFile('dean/skin-fade/brown/none');
  const broken = await open({ viewport: { width: 1440, height: 1000 } }, savedFighter(fields('dean', 'skin-fade', 'brown', 'none')));
  await page.goto(`${base}/?engine=snapshot`);
  await nav('Profile');
  await athleteShows(stageFigure(), deanBase);
  assert.equal(await stageFigure().locator('img.unreal-athlete-head').count(), 0, 'no part of the missing head is painted');
  assert.deepEqual([await pressed('Face'), await pressed('Hair'), await pressed('Hair color')], [['dean'], ['skin-fade'], ['brown']], 'the choice itself is kept');
  // The file is tried again by itself: once it can load, the chosen head shows without another press.
  await page.unroute(`**${blocked}`);
  await athleteShows(stageFigure(), 'dean/skin-fade/brown/none');
  await athleteShows(page.locator('.fighter-select .mini-portrait .unreal-athlete'), 'dean/skin-fade/brown/none');
  checks.push('If only the picture over a chosen head cannot load, the chosen face shows as its base picture has it and the choice is kept; the picture is tried again and shows once it loads.');
  await broken.close();
  // The face's own base is missing: the published athlete stands in, whole.
  blocked = athleteBaseUrl('dean');
  const noBase = await open({ viewport: { width: 1440, height: 1000 } }, savedFighter(fields('dean', 'skin-fade', 'brown', 'none')));
  await page.goto(`${base}/?engine=snapshot`);
  await nav('Profile');
  await stageFigure().and(page.locator('.is-ready[data-head="published"]')).waitFor({ timeout: 30000 });
  const standIn = await stageFigure().evaluate((element) => ({
    base: new URL(element.querySelector(':scope > img:not(.unreal-athlete-head)').currentSrc).pathname,
    heads: element.querySelectorAll('img.unreal-athlete-head').length,
    jacket: new URL(getComputedStyle(element.querySelector('[data-layer="jacket"]')).backgroundImage.replace(/^url\(["']?|["']?\)$/g, '')).pathname,
  }));
  assert.deepEqual(standIn, { base: UNREAL_ATHLETE.layers.base, heads: 0, jacket: UNREAL_ATHLETE.layers.jacket }, 'the published athlete with its own jacket layer, and no head of the other face');
  assert.deepEqual(await pressed('Face'), ['dean'], 'the choice itself is kept');
  checks.push('If the base picture of a chosen face cannot load, the published athlete stands in whole and the choice is kept.');
  await noBase.close();
  // The published base fails, for the page's own image too (its address is the same before and after). Once it can
  // load, the next try paints the whole chosen athlete: the body is not left blank under a head.
  blocked = UNREAL_ATHLETE.layers.base;
  const noBody = await open({ viewport: { width: 1440, height: 1000 } }, savedFighter(fields('original', 'skin-fade', 'brown', 'stubble')));
  await page.goto(`${base}/?engine=snapshot`);
  await nav('Profile');
  await stageFigure().and(page.locator('.is-ready[data-head="published"]')).waitFor({ timeout: 30000 });
  assert.equal(await stageFigure().locator(':scope > img:not(.unreal-athlete-head)').evaluate((image) => image.naturalWidth), 0, 'the base picture did not load');
  await page.unroute(`**${blocked}`);
  await athleteShows(stageFigure(), 'original/skin-fade/brown/stubble');
  assert.ok(await stageFigure().locator(':scope > img:not(.unreal-athlete-head)').evaluate((image) => image.complete && image.naturalWidth === 900), 'the body is painted again under the chosen head');
  checks.push('A base picture that failed in the page is painted again by the next try that succeeds, so a head never stays over a blank body.');
  await noBody.close();
  blocked = standingHeadUrl('lead', 'original/skin-fade/brown/stubble');
  const brokenStill = await open({ viewport: { width: 1440, height: 1000 } }, savedFighter(fields('original', 'skin-fade', 'brown', 'stubble')));
  await page.goto(`${base}/`);
  await nav('Training');
  await technique('Guillotine choke');
  await page.waitForFunction(() => { const element = document.querySelector('main .grappling-snapshot-stage'); return element?.dataset.ready === 'ready' && element.dataset.picture === 'classic'; }, null, { timeout: 30000 });
  checks.push('If the head of the standing picture cannot load, the stage shows the classic picture, never another face.');
  await brokenStill.close();
  blocked = null;

  // ---- A fighter saved before the choices existed is the published athlete ----
  const older = await open({ viewport: { width: 1440, height: 1000 } }, savedFighter({}, { giTop: '#b61f2b' }));
  await page.goto(`${base}/?engine=snapshot`);
  await nav('Profile');
  await athleteShows(stageFigure(), PUBLISHED_KEY);
  assert.deepEqual([await pressed('Face'), await pressed('Hair'), await pressed('Hair color'), await pressed('Beard')], [['original'], ['fringe'], ['black'], ['none']]);
  const red = await painted(stageFigure(), 'older save, red jacket');
  assert.ok(red.chest[0] > red.chest[2] + 60, `its saved gi color is kept (${red.chest})`);
  checks.push('A fighter saved before the head choices loads as the published athlete with its saved gi colors.');
  await older.close();

  // ---- Phones ----
  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 700 }]) {
    const phone = await open({ viewport, isMobile: true, hasTouch: true }, savedFighter(fields('dean', 'skin-fade', 'brown', 'none')));
    await page.goto(`${base}/?engine=snapshot`);
    await nav('Profile');
    await athleteShows(stageFigure(), 'dean/skin-fade/brown/none');
    const picker = page.locator('.athlete-head-picker');
    await picker.scrollIntoViewIfNeeded();
    const buttons = await picker.getByRole('button').evaluateAll((all) => all.map((button) => { const box = button.getBoundingClientRect(); return { option: button.dataset.option, width: box.width, height: box.height, right: box.right, left: box.left }; }));
    assert.equal(buttons.length, ATHLETE_FACES.length + ATHLETE_HAIRS.length + ATHLETE_HAIR_COLORS.length + ATHLETE_BEARDS.length);
    for (const button of buttons) {
      assert.ok(button.height >= 44 && button.width >= 44, `${button.option} is easy to tap (${Math.round(button.width)} by ${Math.round(button.height)})`);
      assert.ok(button.left >= 0 && button.right <= viewport.width + 0.5, `${button.option} is on screen`);
    }
    await choice('Hair', 'Coil buzz cut').tap();
    await athleteShows(stageFigure(), 'dean/coil-buzz/brown/none');
    // The stage is out of sight by here: a copy of the head sits with hair color and beard, and follows a tap.
    const preview = page.locator('.athlete-head-preview');
    await preview.scrollIntoViewIfNeeded();
    assert.equal(await preview.isVisible(), true);
    await athleteShows(preview.locator('.unreal-athlete'), 'dean/coil-buzz/brown/none');
    await choice('Beard', 'Stubble').tap();
    await athleteShows(preview.locator('.unreal-athlete'), 'dean/coil-buzz/brown/stubble');
    await colorChoice('Blond').tap();
    await athleteShows(preview.locator('.unreal-athlete'), 'dean/coil-buzz/blond/stubble');
    const previewBox = await preview.boundingBox();
    assert.ok(previewBox.width >= 70 && Math.abs(previewBox.width - previewBox.height) < 1 && previewBox.x >= 0 && previewBox.x + previewBox.width <= viewport.width, `the head preview is a square on screen (${JSON.stringify(previewBox)})`);
    // the four hair colors keep one line
    const colorTops = await group('Hair color').getByRole('button').evaluateAll((all) => all.map((button) => Math.round(button.getBoundingClientRect().top)));
    assert.equal(new Set(colorTops).size, 1, `the hair colors are on one line (${colorTops})`);
    // the small copy beside the gi swatches shows the same head
    const copy = page.locator('.gi-colors-athlete');
    await copy.scrollIntoViewIfNeeded();
    await athleteShows(copy, 'dean/coil-buzz/blond/stubble');
    assert.equal(await fits(), true, `${viewport.width}-pixel Profile must not scroll sideways`);
    layouts.push({ viewport, picker: await picker.boundingBox(), buttons: buttons.length });
    await picker.scrollIntoViewIfNeeded();
    await capture(`phone-${viewport.width}`, { fullPage: false });
    await nav('Training');
    await athleteShows(page.locator('.belt-mini .unreal-athlete.mini-fighter'), 'dean/coil-buzz/blond/stubble');
    assert.equal(await fits(), true, `${viewport.width}-pixel Training must not scroll sideways`);
    // The Arena scoreboard: the portrait stands above the name, and both names end on the same line.
    await nav('Arena');
    await athleteShows(page.locator('.arena-top .fighter-card.has-portrait .mini-portrait .unreal-athlete'), 'dean/coil-buzz/blond/stubble');
    const cards = await page.locator('.arena-top .fighter-card').evaluateAll((all) => all.map((card) => {
      const name = card.querySelector('strong'), belt = card.querySelector('small'), picture = card.querySelector('.mini-portrait');
      const lineHeight = parseFloat(getComputedStyle(name).lineHeight);
      return { left: card.getBoundingClientRect().left, right: card.getBoundingClientRect().right, nameTop: name.getBoundingClientRect().top, nameLines: Math.round(name.getBoundingClientRect().height / lineHeight), nameFits: name.scrollWidth <= name.clientWidth + 1, beltBottom: belt.getBoundingClientRect().bottom, portrait: picture ? picture.getBoundingClientRect().width : null, portraitAbove: picture ? picture.getBoundingClientRect().bottom <= name.getBoundingClientRect().top + 0.5 : null };
    }));
    assert.ok(cards[0].portrait >= 32 && cards[0].portraitAbove === true, `the portrait stands above the player's name (${JSON.stringify(cards[0])})`);
    assert.ok(Math.abs(cards[0].beltBottom - cards[1].beltBottom) < 1, `both sides end on the same line (${cards[0].beltBottom} and ${cards[1].beltBottom})`);
    for (const card of cards) assert.ok(card.nameFits && card.left >= 0 && card.right <= viewport.width + 0.5, `a name in the scoreboard is on screen and not cut (${JSON.stringify(card)})`);
    assert.equal(await fits(), true, `${viewport.width}-pixel Arena must not scroll sideways`);
    await page.locator('.arena-top').scrollIntoViewIfNeeded();
    await capture(`phone-${viewport.width}-arena`, { fullPage: false });
    await phone.close();
  }
  checks.push('At 390 and 320 pixels every head button is at least 44 pixels each way and on screen, a tap changes the athlete and the head preview beside hair color and beard, the hair colors keep one line, the Arena scoreboard shows the portrait above the name, and nothing scrolls sideways.');

  // ---- A tablet held upright ----
  // From 761 pixels the Arena has two columns, and its scoreboard is narrower than on a wide phone.
  for (const width of [768, 820]) {
    const tablet = await open({ viewport: { width, height: 1024 } }, savedFighter(fields('dean', 'skin-fade', 'brown', 'stubble'), { name: 'New Challenger' }));
    await page.goto(`${base}/?engine=snapshot`);
    await nav('Profile');
    await athleteShows(stageFigure(), 'dean/skin-fade/brown/stubble');
    const tops = await group('Hair color').getByRole('button').evaluateAll((all) => all.map((button) => Math.round(button.getBoundingClientRect().top)));
    assert.equal(new Set(tops).size, 1, `at ${width} pixels the hair colors are on one line (${tops})`);
    const beardLines = await group('Beard').locator('button strong').evaluateAll((all) => all.map((label) => Math.round(label.getBoundingClientRect().height / parseFloat(getComputedStyle(label).lineHeight))));
    assert.deepEqual(beardLines, [1, 1], 'each beard name is on one line');
    await nav('Arena');
    await athleteShows(page.locator('.arena-top .fighter-card.has-portrait .mini-portrait .unreal-athlete'), 'dean/skin-fade/brown/stubble');
    const names = await page.locator('.arena-top .fighter-card strong').evaluateAll((all) => all.map((name) => ({ text: name.textContent.trim(), lines: Math.round(name.getBoundingClientRect().height / parseFloat(getComputedStyle(name).lineHeight)) })));
    // a name may take one line per word; more lines than words means a word broke inside
    for (const name of names) assert.ok(name.lines <= name.text.split(/\s+/).length, `at ${width} pixels "${name.text}" breaks between words, not inside one (${name.lines} lines)`);
    assert.equal(await fits(), true, `${width}-pixel Arena must not scroll sideways`);
    if (width === 768) { await page.locator('.arena-top').scrollIntoViewIfNeeded(); await capture('tablet-768-arena', { fullPage: false }); }
    await tablet.close();
  }
  checks.push('At 768 and 820 pixels, where the Arena has two columns, a two-word name in the scoreboard breaks between its words, and the four hair colors and both beard names keep one line.');

  assert.deepEqual(errors, []);
  assert.deepEqual(consoleErrors, [], 'Unexpected browser console errors');
  assert.deepEqual(failedResponses, [], 'Every head picture must load');
  report.status = 'passed';
  console.log(JSON.stringify({ checks, layouts, samples: samples.length, images: images.length, artifacts }, null, 2));
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
