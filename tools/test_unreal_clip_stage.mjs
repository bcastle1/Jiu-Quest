// Verifies the pre-rendered Unreal clips in the built site in a real browser.
// The stance: the Arena shows the standing-stance clip while both athletes are
// on their feet and nothing has settled, it plays, loops, pauses and changes
// camera, people who ask for reduced motion start paused, a clip that cannot
// load gives way to the usual picture, and the page fits phones.
// Techniques switch themselves on: every curriculum technique that has a
// published clip for every performer it needs (techniqueClipReady: both, or the
// fighter alone for a technique the rival never performs from its clip start)
// is checked in Training and in a player's Arena win against the real files,
// with its poster compared to frame 0. Each
// one that has not shows what it showed before on the release default: the
// Unity stage where Unity animates it, the position picture otherwise, in
// Training, or in the Arena for the white-belt starters Training does not list.
// It checks video files played by the browser. It does not run Unreal or any
// stream.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { chromium } from 'playwright';
import { resolveUnityMove } from '../src/unity/bridge.js';
import { findUnrealClip, unrealClipViews } from '../src/unreal/techniqueClips.js';
import { techniqueClipReady } from '../src/unreal/techniquePicture.js';
import { CARD, MAT, TECHNIQUE_IDS, arenaStart, checkArenaWin, checkTraining, curriculumMove, inTraining, openTrainingTechnique, playArena, techniqueStage, watchUnity } from './unreal_technique_checks.mjs';

const root = resolve('dist');
const artifacts = resolve(process.env.JIUQUEST_BROWSER_ARTIFACTS || 'tmp/browser', 'unreal-clip-stage');
await mkdir(artifacts, { recursive: true });
const checks = [], images = [], errors = [], consoleErrors = [], expectedConsoleErrors = [], failedResponses = [], layouts = [], playback = [];
const browserOptions = { headless: true, args: ['--enable-unsafe-swiftshader'], ...(process.env.JIUQUEST_BROWSER_CHANNEL ? { channel: process.env.JIUQUEST_BROWSER_CHANNEL } : {}), ...(process.env.JIUQUEST_BROWSER_EXECUTABLE ? { executablePath: process.env.JIUQUEST_BROWSER_EXECUTABLE } : {}) };
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.mp4': 'video/mp4' };
const report = { startedAtUtc: new Date().toISOString(), status: 'running', scope: 'Pre-rendered video files (stance loops, and any published technique clips) played in desktop Chromium, with phone viewport emulation. No Unreal runtime, stream or physical device.' };
const SIDE = findUnrealClip('standing_stance', 'fighter', 'side');
const FRONT = findUnrealClip('standing_stance', 'fighter', 'front');
let browser, server, page, blockClips = false, quietUnity = false;

async function staticSite() {
  await stat(resolve(root, 'index.html'));
  server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const file = resolve(root, `.${pathname.endsWith('/') ? `${pathname}index.html` : pathname}`);
      if (!file.startsWith(`${root}${sep}`)) { response.writeHead(403); response.end(); return; }
      const body = await readFile(file);
      const headers = { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes' };
      // Byte ranges, as the real host serves them: a browser can only seek in
      // a video whose server answers them (the technique scrubber does).
      const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? '');
      if (range && (range[1] || range[2])) {
        const start = range[1] ? Number(range[1]) : Math.max(0, body.length - Number(range[2]));
        const end = range[1] && range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
        if (start > end || start >= body.length) { response.writeHead(416, { 'Content-Range': `bytes */${body.length}` }); response.end(); return; }
        response.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${body.length}`, 'Content-Length': end - start + 1 });
        response.end(body.subarray(start, end + 1));
        return;
      }
      response.writeHead(200, { ...headers, 'Content-Length': body.length });
      response.end(body);
    } catch { response.writeHead(404); response.end('Not found'); }
  });
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  return `http://127.0.0.1:${server.address().port}`;
}

async function open(options) {
  const context = await browser.newContext({ deviceScaleFactor: 1, reducedMotion: 'no-preference', ...options });
  page = await context.newPage();
  // One context below cuts the clips off on purpose; its load errors are expected.
  if (blockClips) await page.route('**/assets/unreal-clips/**/*.mp4', (route) => route.abort());
  // The technique steps below look at which stage shows, not at Unity itself,
  // so Unity's build manifest answers 404 there and WebGL never starts.
  const unityOff = quietUnity;
  if (unityOff) await page.route('**/unity/build-manifest.json', (route) => route.fulfill({ status: 404, body: 'Unity is not started by this step' }));
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const entry = { text: message.text(), location: message.location() };
    (blockClips || (unityOff && /unity|build-manifest/i.test(`${entry.text} ${entry.location?.url ?? ''}`)) ? expectedConsoleErrors : consoleErrors).push(entry);
  });
  page.on('response', (response) => {
    if (response.status() < 400 || (unityOff && new URL(response.url()).pathname === '/unity/build-manifest.json')) return;
    failedResponses.push({ url: response.url(), status: response.status() });
  });
  return context;
}

// A context for the Arena: a returning player who has learned `move` and the
// four techniques Unity animates, with the matches behind them that it takes
// to win with a white-belt starter now and then. Math.random is seeded so the
// run repeats.
async function seededFight(move) {
  const fight = await open({ viewport: { width: 1440, height: 900 } });
  await fight.addInitScript(({ key, value }) => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem(key, value); } }, { key: 'jiuquest:v1', value: JSON.stringify({ selectedFighterId: 'clipper', fighters: [{ id: 'clipper', name: 'Clipper', matches: 1000, progress: { 'double-leg-takedown': 50, 'rear-naked-choke': 50, 'triangle-choke': 50, 'trap-roll-escape': 50, [move.id]: 50 } }] }) });
  await fight.addInitScript(() => {
    let state = 20261113;
    Math.random = () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let value = Math.imul(state ^ (state >>> 15), state | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  });
  return fight;
}

const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const nav = async (name) => { await page.getByRole('button', { name, exact: true }).click(); };
// The stance clip. A technique clip is the same component with data-kind="technique".
const stage = () => page.locator('.mat-window .unreal-clip-stage[data-kind="stance"]');
const video = () => stage().locator('video');
const watch = () => video().evaluate((element) => ({
  path: new URL(element.currentSrc || element.src).pathname, poster: new URL(element.poster).pathname,
  paused: element.paused, time: element.currentTime, ready: element.readyState, size: [element.videoWidth, element.videoHeight],
  muted: element.muted, loop: element.loop, inline: element.playsInline, controls: element.controls, error: element.error?.code ?? null,
}));
const box = async (locator) => { const found = await locator.boundingBox(); return { x: found.x, y: found.y, width: found.width, height: found.height, right: found.x + found.width, bottom: found.y + found.height }; };

async function capture(name) {
  const file = resolve(artifacts, `${name}.png`);
  const data = await page.screenshot({ path: file });
  images.push({ name, path: file, bytes: data.length });
}

// The clip is on screen, decoded at its real size, and moving.
async function playing(clip, label) {
  await page.waitForFunction((path) => {
    const element = document.querySelector('.mat-window .unreal-clip-stage[data-kind="stance"] video');
    return element && new URL(element.currentSrc || element.src).pathname === path && element.readyState >= 2 && !element.paused && element.currentTime > 0.05;
  }, clip.video, { timeout: 30000 });
  const state = await watch();
  assert.deepEqual([state.path, state.poster, state.size, state.error], [clip.video, clip.poster, [clip.width, clip.height], null]);
  assert.deepEqual([state.muted, state.loop, state.inline, state.controls], [true, clip.loops, true, false], 'silent, looping as its clip says, inline, with the page\'s own controls');
  playback.push({ label, ...state });
  return state;
}

try {
  const base = process.env.JIUQUEST_PREVIEW_URL?.replace(/\/$/, '') || await staticSite();
  browser = await chromium.launch(browserOptions);
  report.browserVersion = browser.version();

  // ---- Desktop, default renderer ----
  const desktop = await open({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${base}/`);
  report.canPlayH264 = await page.evaluate(() => document.createElement('video').canPlayType('video/mp4; codecs="avc1.640028"') !== '');
  assert.equal(report.canPlayH264, true, 'This browser cannot play H.264, so the clip cannot be checked here');
  await nav('Arena');
  await stage().waitFor();
  assert.deepEqual([await stage().getAttribute('data-move'), await stage().getAttribute('data-camera')], ['standing_stance', 'side']);
  assert.equal(await stage().getAttribute('aria-label'), 'Standing stance, Unreal Engine clip');
  await playing(SIDE, 'side');
  // A 1.8 second loop: within a few seconds the clock must have gone back to the start.
  await page.waitForFunction(() => {
    const element = document.querySelector('.mat-window .unreal-clip-stage[data-kind="stance"] video');
    window.__clipPeak = Math.max(window.__clipPeak ?? 0, element.currentTime);
    return window.__clipPeak > 1 && element.currentTime < window.__clipPeak - 0.5;
  }, null, { timeout: 15000, polling: 50 });
  assert.equal(await page.locator('.mat-window .grappling-snapshot-stage, .mat-window .unity-stage').count(), 0, 'the clip replaces the settled-position picture while it shows');
  checks.push('The Arena opens on the Unreal standing-stance clip: 1280 by 720, silent, playing and looping.');

  const legend = await stage().locator('.unreal-clip-legend').innerText();
  const [fighterName, opponentName] = await page.locator('.arena-top .fighter-card strong').allTextContents();
  assert.ok(legend.includes(`${fighterName} (you): white gi`) && legend.includes(`${opponentName}: navy gi`), legend);
  assert.match(legend, /Gi and belt colors are fixed in this clip\./);
  assert.match(await video().getAttribute('aria-label'), /^Standing stance\. .+ in the white gi and .+ in the navy gi, seen from the side\.$/);
  checks.push('The legend says who wears which gi and that the clip\'s colors are fixed.');

  // Wide stage: the words sit on the picture, so the start buttons stay in view.
  const [stageBox, pictureBox] = [await box(stage()), await box(stage().locator('.unreal-clip-viewport'))];
  assert.ok(Math.abs(stageBox.height - pictureBox.height) <= 1, 'on a wide stage nothing adds to the picture\'s height');
  assert.ok(Math.abs(pictureBox.width / pictureBox.height - 2) < 0.02, 'the wide picture is trimmed to two to one');
  for (const part of ['.unreal-clip-heading', '.unreal-clip-controls', '.unreal-clip-legend']) {
    const partBox = await box(stage().locator(part));
    assert.ok(partBox.x >= pictureBox.x - 1 && partBox.right <= pictureBox.right + 1 && partBox.y >= pictureBox.y - 1 && partBox.bottom <= pictureBox.bottom + 1, `${part} sits on the picture`);
  }
  const start = await box(page.getByRole('button', { name: 'Standing Start', exact: true }));
  assert.ok(start.bottom <= 900, `Standing Start is visible without scrolling (${Math.round(start.bottom)})`);
  layouts.push({ viewport: page.viewportSize(), stage: stageBox, picture: pictureBox, standingStartBottom: start.bottom });
  await capture('desktop-arena-side');

  // Camera and pause.
  const cameras = page.getByRole('group', { name: 'Camera view', exact: true });
  assert.deepEqual(await cameras.getByRole('button').allInnerTexts(), ['Side', 'Front']);
  assert.deepEqual([await cameras.getByRole('button', { name: 'Side' }).getAttribute('aria-pressed'), await cameras.getByRole('button', { name: 'Front' }).getAttribute('aria-pressed')], ['true', 'false']);
  await cameras.getByRole('button', { name: 'Front' }).click();
  await playing(FRONT, 'front');
  assert.equal(await stage().getAttribute('data-camera'), 'front');
  assert.equal(await cameras.getByRole('button', { name: 'Front' }).getAttribute('aria-pressed'), 'true');
  await capture('desktop-arena-front');
  await stage().getByRole('button', { name: 'Pause', exact: true }).focus(); await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.mat-window .unreal-clip-stage[data-kind="stance"] video').paused);
  const held = (await watch()).time;
  await page.waitForTimeout(400);
  assert.equal((await watch()).time, held, 'a paused clip does not move');
  await stage().getByRole('button', { name: 'Play', exact: true }).click();
  await playing(FRONT, 'front after play');
  await cameras.getByRole('button', { name: 'Side' }).click();
  await playing(SIDE, 'side again');
  checks.push('Side and Front switch the clip, and Pause and Play work by keyboard and pointer.');
  await desktop.close();

  // ---- A match: the clip gives way once an exchange settles ----
  const match = await open({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${base}/?engine=snapshot`);
  await nav('Arena');
  await playing(SIDE, 'position snapshots renderer');
  await page.getByRole('button', { name: 'Standing Start', exact: true }).click();
  await stage().waitFor();
  await page.locator('.combat-moves .combat-group').first().locator('button:not([disabled])').first().click();
  await page.locator('.sequence-panel .order-stack').waitFor();
  assert.equal(await stage().count(), 1, 'the stance stays while the sequence is arranged');
  await page.getByRole('button', { name: 'Submit sequence', exact: true }).click();
  await page.locator('.arena-outcome').waitFor();
  assert.equal(await stage().count(), 0, 'a settled exchange shows the settled position, not the stance clip');
  assert.equal(await page.locator('.mat-window .unreal-clip-stage[data-kind="technique"]').count(), 0, '?engine=snapshot turns technique clips off');
  assert.equal(await page.locator('.mat-window .grappling-snapshot-stage').count(), 1);
  // A start that is not on the feet never shows the stance.
  await page.reload();
  await nav('Arena');
  await stage().waitFor();
  await page.getByLabel('Your starting position', { exact: true }).selectOption('mount-bottom');
  await page.getByRole('button', { name: 'Position Start', exact: true }).click();
  assert.equal(await stage().count(), 0);
  assert.equal(await page.locator('.mat-window .grappling-snapshot-stage').count(), 1);
  checks.push('The stance stays through the first sequence, then gives way to the settled position; a start off the feet never shows it.');
  await match.close();

  // ---- Reduced motion: paused until asked ----
  const calm = await open({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await page.goto(`${base}/?engine=snapshot`);
  await nav('Arena');
  await stage().waitFor();
  await page.waitForFunction(() => document.querySelector('.mat-window .unreal-clip-stage[data-kind="stance"] video')?.readyState >= 1);
  await page.waitForTimeout(600);
  const still = await watch();
  assert.deepEqual([still.paused, still.time], [true, 0], 'reduced motion starts on the still poster');
  await stage().getByRole('button', { name: 'Play', exact: true }).click();
  await playing(SIDE, 'reduced motion after Play');
  checks.push('With reduced motion the clip waits on its poster until Play is pressed.');
  await calm.close();

  // ---- A clip that cannot load ----
  blockClips = true;
  const broken = await open({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${base}/?engine=snapshot`);
  await nav('Arena');
  await page.locator('.mat-window .grappling-snapshot-stage').waitFor();
  assert.equal(await stage().count(), 0, 'a clip that cannot load gives way to the usual picture');
  assert.match(await page.locator('.snapshot-position').innerText(), /Standing/);
  await page.getByRole('button', { name: 'Standing Start', exact: true }).click();
  assert.equal(await page.locator('.combat-moves .combat-group button:not([disabled])').count() > 0, true, 'the match still starts');
  checks.push('If the video cannot load, the Arena shows the position snapshot and the match still starts.');
  await broken.close();
  blockClips = false;

  // ---- Phones ----
  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 640 }]) {
    const phone = await open({ viewport, isMobile: true, hasTouch: true });
    await page.goto(`${base}/`);
    await nav('Arena');
    await playing(SIDE, `${viewport.width}px`);
    assert.equal(await fits(), true, `${viewport.width}-pixel Arena must not scroll sideways`);
    const [stageBox, pictureBox] = [await box(stage()), await box(stage().locator('.unreal-clip-viewport'))];
    assert.ok(stageBox.width >= viewport.width - 48, `the stage uses the phone's width (${Math.round(stageBox.width)})`);
    assert.ok(Math.abs(pictureBox.width / pictureBox.height - 16 / 9) < 0.02, 'a narrow stage shows the whole picture');
    for (const part of ['.unreal-clip-heading', '.unreal-clip-controls', '.unreal-clip-legend']) {
      const partBox = await box(stage().locator(part));
      assert.ok(partBox.bottom <= pictureBox.y + 1 || partBox.y >= pictureBox.bottom - 1, `${part} is stacked clear of the picture`);
    }
    for (const button of await stage().getByRole('button').all()) assert.ok((await button.boundingBox()).height >= 44, 'controls are easy to tap');
    await page.getByRole('group', { name: 'Camera view', exact: true }).getByRole('button', { name: 'Front' }).tap();
    await playing(FRONT, `${viewport.width}px front`);
    assert.equal(await fits(), true);
    layouts.push({ viewport, stage: stageBox, picture: pictureBox });
    await stage().scrollIntoViewIfNeeded();
    await capture(`phone-${viewport.width}`);
    await phone.close();
  }
  checks.push('At 390 and 320 pixels the clip plays at full width with its controls stacked below, and nothing scrolls sideways.');

  // ---- Techniques: each one switches itself on once every performer it needs has clips ----
  // Every curriculum technique has a clip id, so any of them can be ready.
  const ready = TECHNIQUE_IDS.filter((moveId) => techniqueClipReady(moveId, unrealClipViews));
  const waiting = TECHNIQUE_IDS.filter((moveId) => !ready.includes(moveId));
  report.techniqueClips = { ready, waiting };
  quietUnity = true;
  if (!ready.length) checks.push('No technique clip is published; technique steps did not run.');
  for (const moveId of ready) {
    const views = { fighter: unrealClipViews(moveId, 'fighter'), opponent: unrealClipViews(moveId, 'opponent') };
    const move = curriculumMove(moveId);
    const title = move.name;
    // The poster of a clip that plays once is its first frame.
    const posters = await open({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${base}/`);
    for (const clip of [...views.fighter, ...views.opponent]) {
      const difference = await page.evaluate(async ({ video: src, poster: posterSrc }) => {
        const canvas = Object.assign(document.createElement('canvas'), { width: 160, height: 90 });
        const context = canvas.getContext('2d', { willReadFrequently: true });
        const pixels = (source) => { context.drawImage(source, 0, 0, 160, 90); return context.getImageData(0, 0, 160, 90).data; };
        const element = Object.assign(document.createElement('video'), { src, muted: true, preload: 'auto' });
        await new Promise((done, fail) => { element.addEventListener('loadeddata', done, { once: true }); element.addEventListener('error', fail, { once: true }); });
        if (element.currentTime !== 0) { element.currentTime = 0; await new Promise((done) => element.addEventListener('seeked', done, { once: true })); }
        const frame = pixels(element);
        const image = new Image(); image.src = posterSrc; await image.decode();
        const still = pixels(image);
        let total = 0;
        for (let index = 0; index < frame.length; index += 4) total += Math.abs(frame[index] - still[index]) + Math.abs(frame[index + 1] - still[index + 1]) + Math.abs(frame[index + 2] - still[index + 2]);
        return total / (frame.length / 4) / 3;
      }, clip);
      assert.ok(difference < 8, `${clip.poster} is frame 0 of ${clip.video} (mean difference ${difference.toFixed(2)})`);
    }
    await posters.close();
    checks.push(`${title}: every poster matches frame 0 of its video.`);

    // Training lists every technique but the white-belt starters.
    if (inTraining(move)) {
      const training = await open({ viewport: { width: 1440, height: 900 } });
      await checkTraining(page, { base, moveId, views: views.fighter, unity: watchUnity(page), capture, checks });
      await training.close();
    } else checks.push(`${title}: Training does not list this white-belt starter, so its clip is checked in the Arena only.`);

    // A technique that starts only from the top of the guard has no start of
    // its own in the Arena. Its clips play by the same rule as every other's.
    if (!arenaStart(move)) {
      checks.push(`${title}: the Arena offers no start in a position it starts from, so its Arena win was not checked here.`);
      continue;
    }
    // The player, who has learned it, wins with it in the Arena.
    const fight = await seededFight(move);
    const unity = watchUnity(page);
    await playArena(page, {
      base, moveId, unity,
      want: (seen) => seen.fighter >= 1,
      onWin: async (win) => { if (win.performer === 'fighter') await checkArenaWin(page, { win, moveId, views, unity, title }); },
    });
    await fight.close();
    checks.push(`${title}: the player's Arena win plays the real clip, labelled as theirs, with no Unity request.`);
  }

  // A technique still without clips of every performer it needs shows what it
  // showed before on the release default: the Unity stage where Unity animates
  // it, and the position picture, under "Position reference", everywhere else.
  const shown = { unity: [], picture: [], arenaOnly: [] };
  const unityStage = (scope) => page.locator(`${scope} .unity-stage[data-engine="unity"]`);
  const positionPicture = (scope) => page.locator(`${scope} .unity-unavailable .grappling-snapshot-stage`);
  if (waiting.length) {
    const training = await open({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${base}/`);
    await page.getByRole('button', { name: 'Training', exact: true }).click();
    for (const moveId of waiting) {
      const move = curriculumMove(moveId);
      // Training does not list the white-belt starters. They follow below.
      if (!inTraining(move)) { shown.arenaOnly.push(moveId); continue; }
      const unity = resolveUnityMove(move.id) !== null;
      await openTrainingTechnique(page, move);
      await (unity ? unityStage(CARD) : positionPicture(CARD)).waitFor({ timeout: 15000 });
      assert.equal(await techniqueStage(page, CARD).count(), 0, `${moveId} has no Unreal clips of every performer it needs, so it shows none`);
      if (!unity) assert.equal(await page.locator(`${CARD} .unity-stage`).count(), 0, `Unity has no animation of ${moveId}, so it shows the position picture`);
      assert.equal(await page.locator(`${CARD} .training-animation-head h3`).textContent(), unity ? 'Movement preview' : 'Position reference', moveId);
      shown[unity ? 'unity' : 'picture'].push(moveId);
    }
    assert.equal(new URL(page.url()).searchParams.has('engine'), false, 'the release default sets no engine in the address');
    await training.close();
    checks.push(`On the release default, Training shows the Unity stage for ${shown.unity.join(', ') || 'no technique'} and the position picture for the other ${shown.picture.length} techniques that do not have clips of every performer they need.`);
  }
  // Training does not list the white-belt starters; the Arena offers them to
  // every player. The player chooses one until both the player and the rival
  // have won an exchange with it, and each of those wins shows the Unity stage
  // only if Unity animates the technique (it animates no starter), otherwise the
  // position picture.
  for (const moveId of shown.arenaOnly) {
    const move = curriculumMove(moveId);
    const unity = resolveUnityMove(move.id) !== null;
    const fight = await seededFight(move);
    const seen = await playArena(page, {
      base, moveId,
      want: (counts) => counts.fighter >= 1 && counts.opponent >= 1,
      onWin: async (win) => {
        await (unity ? unityStage(MAT) : positionPicture(MAT)).waitFor({ timeout: 15000 });
        assert.equal(await techniqueStage(page, MAT).count(), 0, `${moveId} has no Unreal clips of every performer it needs, so the Arena shows none (${win.headline})`);
        if (!unity) assert.equal(await page.locator(`${MAT} .unity-stage`).count(), 0, `Unity has no animation of ${moveId}, so the Arena shows the position picture (${win.headline})`);
      },
    });
    assert.equal(new URL(page.url()).searchParams.has('engine'), false, 'the release default sets no engine in the address');
    await fight.close();
    checks.push(`Training does not list ${move.name}. In the Arena, the wins with it by the player and by the rival (${seen.headlines.join('; ')}) show the ${unity ? 'Unity stage' : 'position picture'} and no clip.`);
  }
  report.techniqueClips.shown = shown;
  quietUnity = false;

  assert.deepEqual(errors, []);
  assert.deepEqual(consoleErrors, [], 'Unexpected browser console errors');
  assert.deepEqual(failedResponses, [], 'Every clip asset must load');
  report.status = 'passed';
  console.log(JSON.stringify({ checks, layouts, playback: playback.length, images: images.length, artifacts }, null, 2));
} catch (error) {
  report.status = 'failed'; report.failure = error.stack || String(error);
  if (page && !page.isClosed()) await page.screenshot({ path: resolve(artifacts, 'failure.png'), fullPage: true, timeout: 10000 }).catch(() => {});
  console.error(error); process.exitCode = 1;
} finally {
  Object.assign(report, { checkedAtUtc: new Date().toISOString(), checks, layouts, playback, images, pageErrors: errors, consoleErrors, expectedConsoleErrors, failedResponses });
  await writeFile(resolve(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  if (browser) await browser.close().catch(() => {});
  if (server) { server.closeAllConnections(); await new Promise((resolveClose) => server.close(resolveClose)); }
}
