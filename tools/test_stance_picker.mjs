// Verifies the Arena's starting-stance picker in the built site in a real
// browser: the seven stances are offered as pictures while both athletes are on
// their feet (also while the match greeting plays, which a new stance ends),
// choosing one changes the fighter's stance and is remembered, the clip above
// is the one that stance leads to (with a plain note when Unreal has not
// rendered that stance yet) and offers camera buttons exactly when that clip
// has more than one view, every stance whose loop has a front view (among them
// the motion-captured loops of the boxer shell and the Muay Thai guard) plays
// in both of its views, each starting again at its end, and on a wide stage
// shows its athletes whole in each view (the two motion-captured front views
// are trimmed from the top, so the near foot is whole), the keyboard works, the
// picker leaves once an exchange settles, and the page fits phones. It checks
// the page. It does not run Unreal or any stream.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { chromium, errors as playwrightErrors } from 'playwright';
import { defaultNpcs } from '../src/storage.js';
import { UNREAL_STANCES, findStance, stanceLoop } from '../src/unreal/stances.js';
import { findUnrealClip, unrealClipViews } from '../src/unreal/techniqueClips.js';
import { runnerNetwork } from './runner_network.mjs';

const root = resolve('dist');
const artifacts = resolve(process.env.JIUQUEST_BROWSER_ARTIFACTS || 'tmp/browser', 'stance-picker');
await mkdir(artifacts, { recursive: true });
const checks = [], images = [], errors = [], consoleErrors = [], failedResponses = [], layouts = [];
const runner = runnerNetwork('stance-picker');
const browserOptions = { headless: true, args: ['--enable-unsafe-swiftshader'], ...(process.env.JIUQUEST_BROWSER_CHANNEL ? { channel: process.env.JIUQUEST_BROWSER_CHANNEL } : {}), ...(process.env.JIUQUEST_BROWSER_EXECUTABLE ? { executablePath: process.env.JIUQUEST_BROWSER_EXECUTABLE } : {}) };
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.mp4': 'video/mp4' };
const report = { startedAtUtc: new Date().toISOString(), status: 'running', scope: 'The stance picker in desktop Chromium, with phone viewport emulation. No Unreal runtime, stream or physical device.' };
// The first rival is the one the Arena opens with.
const RIVAL_STANCE = defaultNpcs[0].stance;
const LABELS = UNREAL_STANCES.map((stance) => stance.label);
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
  runner.serving(server);
  return `http://127.0.0.1:${server.address().port}`;
}

async function open(options) {
  const context = await browser.newContext({ deviceScaleFactor: 1, reducedMotion: 'no-preference', ...options });
  page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() !== 'error') return; const entry = { text: message.text(), location: message.location() }; if (!runner.take(entry)) consoleErrors.push(entry); });
  page.on('response', (response) => { if (response.status() >= 400) failedResponses.push({ url: response.url(), status: response.status() }); });
  return context;
}

const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const nav = async (name) => { await page.getByRole('button', { name, exact: true }).click(); };
const picker = () => page.locator('.arena-panel .stance-picker');
const group = () => page.getByRole('radiogroup', { name: 'Starting stance', exact: true });
const radio = (label) => group().getByRole('radio', { name: label, exact: true });
const stage = () => page.locator('.mat-window .unreal-clip-stage');
// The stance loop's own stage, and its camera buttons when the loop has more than one view.
const loopStage = () => page.locator('.mat-window .unreal-clip-stage[data-kind="stance"]');
const cameras = () => loopStage().getByRole('group', { name: 'Camera view', exact: true });
const CAMERA_LABELS = { side: 'Side', front: 'Front' };
const box = async (locator) => { const found = await locator.boundingBox(); return { x: found.x, y: found.y, width: found.width, height: found.height, right: found.x + found.width, bottom: found.y + found.height }; };
const chosen = () => group().getByRole('radio', { checked: true }).getAttribute('aria-label');
const notReady = (stance) => `The ${findStance(stance).label} animation is not ready yet, so standing animations start from the standard wrestling stance for now. Your choice is saved.`;

// The rows of the 720 that the athletes reach in each published view of a stance loop with a front
// view, measured on the decoded frames of that exact file (named by its SHA-256) on November 18,
// 2026: `head`, the highest row with any pixel of a head over every frame (the backdrop above the
// athletes is black, so every pixel there of luminance 5 or more is the athlete), and `foot`, the
// lowest row of a foot (the feet stand planted; read on frames across the loop, with the shaded
// undersides of the toes counted). On a wide stage the picture box must show from 10 rows above
// `head` to 6 rows below `foot`. A new take is a new file: measure it and change this list (and, if
// its feet need it, the trim in src/components/UnrealClipStage.css) before this suite passes again.
const MEASURED_ROWS = Object.freeze({
  'standing_stance/fighter-side': { sha256: '3cd59069d4fb5864bd513ba9bb2866db4b5b3ea9a64778f0a2491aa55f6d8838', head: 172, foot: 626 },
  'standing_stance/fighter-front': { sha256: '4e5b43724bc6eae2bd6041e0b1b6581b739a595056ea2a181284a99ed366f1dd', head: 156, foot: 684 },
  'stance_sumo/fighter-side': { sha256: 'beb6c2b5010a2d8457578f9a5a5ee0f6c43d376bba0c5da3520c3bcb83abbc22', head: 172, foot: 637 },
  'stance_sumo/fighter-front': { sha256: 'b8e555fcba030ad569af052f76da0f18a525f7bd07fa50690b0ddd08c806938f', head: 181, foot: 657 },
  'stance_boxing/fighter-side': { sha256: '85cb3d4147b9c1c3c742f04ffc4074857ef0dcc41c9adfd28e3b4b8ac005bd53', head: 139, foot: 626 },
  'stance_boxing/fighter-front': { sha256: '3b22b13089a4eeb5ef1fde228e1b4667d03e54133d7c70092ee18e53e69697ae', head: 108, foot: 708 },
  'stance_muay_thai/fighter-side': { sha256: '1d80467b7b283d2556327b5337bc4040b02ae049d86da8319c205257b997d13b', head: 133, foot: 626 },
  'stance_muay_thai/fighter-front': { sha256: '9f1357a1df5f33d3f585f13184806bd72bc832090f32e4f48177af06e6efc70c', head: 100, foot: 709 },
  'stance_sambo/fighter-side': { sha256: '1d3eef4fd132eb7f7d007ed489a1526d382c3a0f80003bddf5abf8f77ad7dcf9', head: 172, foot: 626 },
  'stance_sambo/fighter-front': { sha256: '939daa4e7259065d0afe8a77f56a3c391fbdcc05a4fc5487f721497552a6c9d7', head: 181, foot: 636 },
});
// On a wide stage the usual trim shows rows 56 to 696; a view whose feet need more is trimmed from
// the top instead and shows rows 80 to 720.
const USUAL_TRIM = Object.freeze({ position: '50% 70%', lastRow: 696 });
const TOP_TRIM = '50% 100%';

async function capture(name) {
  // Let the highlight finish moving to the new choice before the picture is taken.
  await page.waitForTimeout(400);
  const file = resolve(artifacts, `${name}.png`);
  const data = await page.screenshot({ path: file });
  images.push({ name, path: file, bytes: data.length });
}

// Every video on the page as the browser has it: its stage, its file, how much of it has loaded,
// and whether it plays, is paused or has failed.
const videoStates = () => page.evaluate(() => [...document.querySelectorAll('video')].map((element) => {
  const stage = element.closest('.unreal-clip-stage');
  const round = (seconds) => Math.round(seconds * 1000) / 1000;
  return {
    stage: stage ? [stage.dataset.kind, stage.dataset.move, stage.dataset.camera].filter(Boolean).join(' ') : null,
    src: element.currentSrc || element.src,
    readyState: element.readyState,
    networkState: element.networkState,
    error: element.error ? element.error.code : null,
    paused: element.paused,
    ended: element.ended,
    currentTime: round(element.currentTime),
    buffered: Array.from({ length: element.buffered.length }, (_, index) => [round(element.buffered.start(index)), round(element.buffered.end(index))]),
  };
}));

// page.waitForFunction for a video. A wait that times out fails with the state of every video on
// the page, also kept in the report, so a failure (in CI too) says what the video was doing. The
// wait itself is as long as before.
async function waitForVideo(what, test, argument, options) {
  try {
    return await page.waitForFunction(test, argument, options);
  } catch (error) {
    if (!(error instanceof playwrightErrors.TimeoutError)) throw error;
    const videos = await videoStates().catch((reason) => `not readable (${reason.message})`);
    report.videoTimeouts = [...(report.videoTimeouts ?? []), { what, atUtc: new Date().toISOString(), videos }];
    throw new Error(`${what}: timed out after ${options.timeout} ms. The videos on the page: ${JSON.stringify(videos)}`, { cause: error });
  }
}

// The clip on the stage is the one this stance leads to, it is playing, and the
// note is there exactly when the clip cannot show the stance asked for.
async function shows(stance, label) {
  const choice = stanceLoop(stance, RIVAL_STANCE);
  const clip = findUnrealClip(choice.moveId, choice.performerSide);
  assert.ok(clip, `${stance} leads to a published clip`);
  await waitForVideo(`${label}: ${clip.video} playing on the stage`, (path) => {
    const element = document.querySelector('.mat-window .unreal-clip-stage video');
    return element && new URL(element.currentSrc || element.src).pathname === path && element.readyState >= 2 && !element.paused && element.currentTime > 0.05;
  }, clip.video, { timeout: 30000 });
  assert.equal(await stage().getAttribute('data-move'), choice.moveId, label);
  const heading = await picker().locator('.stance-picker-heading').innerText();
  assert.ok(heading.includes(findStance(stance).label) && heading.includes(findStance(stance).copy), heading);
  const note = picker().locator('.stance-picker-note');
  if (choice.exact) {
    assert.equal(await note.count(), 0, `${label}: nothing to explain when the clip shows the stance`);
  } else {
    assert.equal(await note.innerText(), notReady(stance));
    assert.equal(await note.getAttribute('role'), null, 'the note is plain text; the change is announced once, by the Arena');
  }
  // Camera buttons are there exactly when the loop has more than one published view, in view order.
  const views = unrealClipViews(choice.moveId, choice.performerSide);
  if (views.length > 1) {
    assert.deepEqual(await cameras().getByRole('button').allInnerTexts(), views.map((view) => CAMERA_LABELS[view.camera]), `${label}: a button for each view of ${choice.moveId}`);
  } else {
    assert.equal(await cameras().count(), 0, `${label}: ${choice.moveId} has one view, so there are no camera buttons`);
  }
  return choice;
}

// The stance loop's stage plays this file.
const untilPlaying = (path, label) => waitForVideo(`${label}: ${path} playing on the stance loop's stage`, (wanted) => {
  const element = document.querySelector('.mat-window .unreal-clip-stage[data-kind="stance"] video');
  return element && new URL(element.currentSrc || element.src).pathname === wanted && element.readyState >= 2 && !element.paused && element.currentTime > 0.05;
}, path, { timeout: 30000 });

// The loop on the stage is this file, set to loop, as long as its clip says,
// and it plays to its end and starts again: its clock passes the last half
// second of the loop, then goes back by more than half the loop.
async function playsThrough(clip, label) {
  const seen = await waitForVideo(`${label}: ${clip.video} playing to the end of its loop and on into the next`, ({ path, seconds }) => {
    const element = document.querySelector('.mat-window .unreal-clip-stage[data-kind="stance"] video');
    if (!element || new URL(element.currentSrc || element.src).pathname !== path || element.paused) return false;
    const watched = window.__loopWatch?.path === path ? window.__loopWatch : (window.__loopWatch = { path, peak: 0 });
    watched.peak = Math.max(watched.peak, element.currentTime);
    return watched.peak > seconds - 0.5 && element.currentTime < watched.peak - seconds / 2
      ? { peak: watched.peak, after: element.currentTime, duration: element.duration, loop: element.loop, size: [element.videoWidth, element.videoHeight] }
      : false;
  }, { path: clip.video, seconds: clip.durationSeconds }, { timeout: 20000 + clip.durationSeconds * 2000, polling: 40 });
  const state = await seen.jsonValue();
  await page.evaluate(() => { delete window.__loopWatch; });
  assert.equal(state.loop, true, `${label}: the stance clip loops`);
  assert.ok(Math.abs(state.duration - clip.durationSeconds) < 0.1, `${label}: the browser plays the ${clip.frames}-frame file (${state.duration} s)`);
  assert.deepEqual(state.size, [clip.width, clip.height], `${label}: decoded at its real size`);
  return state;
}

// The rows of the clip that the stance loop's picture box shows, worked out from the video's box
// and its computed style: object-fit: cover fills the box, a box flatter than the picture trims
// rows, and the second value of object-position says how much of the trim comes off the top.
const shownRows = () => loopStage().locator('.unreal-clip-viewport video').evaluate((element) => {
  const style = getComputedStyle(element);
  const { width, height } = element.getBoundingClientRect();
  const scale = Math.max(width / element.videoWidth, height / element.videoHeight);
  const y = style.objectPosition.split(' ')[1] ?? '';
  const first = (element.videoHeight - height / scale) * (parseFloat(y) / 100);
  const tenth = (value) => Math.round(value * 10) / 10;
  return { fit: style.objectFit, position: style.objectPosition, percent: y.endsWith('%'), first: tenth(first), last: tenth(first + height / scale) };
});

try {
  const base = process.env.JIUQUEST_PREVIEW_URL?.replace(/\/$/, '') || await staticSite();
  browser = runner.closingIdleFirst(await chromium.launch(browserOptions));
  report.browserVersion = browser.version();

  // ---- Desktop ----
  const desktop = await open({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${base}/`);
  await nav('Arena');
  await picker().waitFor();
  assert.deepEqual(await group().getByRole('radio').evaluateAll((inputs) => inputs.map((input) => input.getAttribute('aria-label'))), LABELS);
  assert.equal(await chosen(), 'Wrestling Stance', 'a new fighter starts in the standard stance');
  await shows('wrestling stance', 'standard stance');
  // The pictures load lazily and nothing above waits for them.
  await page.waitForFunction(() => [...document.querySelectorAll('.stance-picker-options img')].every((image) => image.complete && image.naturalWidth > 0));
  for (const image of await group().locator('img').all()) {
    assert.equal(await image.getAttribute('alt'), '', 'the radio button names the stance; its picture is decoration');
    assert.ok(await image.evaluate((element) => element.complete && element.naturalWidth === 480 && element.naturalHeight === 600), 'each picture loads at its real size');
  }
  // It sits between the stage and the start buttons without pushing them off screen.
  const [stageBox, pickerBox, start] = [await box(stage()), await box(picker()), await box(page.getByRole('button', { name: 'Standing Start', exact: true }))];
  assert.ok(pickerBox.y >= stageBox.bottom - 1 && pickerBox.bottom <= start.y + 1, 'the picker is under the stage and above the start buttons');
  assert.ok(start.bottom <= 900, `Standing Start is visible without scrolling (${Math.round(start.bottom)})`);
  checks.push('The Arena offers the seven stances as pictures under the stage, with the fighter\'s own stance chosen.');

  await radio('Karate Stance').check();
  assert.equal(await chosen(), 'Karate Stance');
  const karate = await shows('karate stance', 'karate chosen');
  // One announcement carries the change, and the note when there is one.
  assert.equal(await page.locator('.combat-grid .sr-only[role="status"]').innerText(), ['Karate Stance selected as your starting stance.', karate.exact ? null : notReady('karate stance')].filter(Boolean).join(' '));
  assert.equal(await page.locator('.app-feedback').count(), 0, 'the change is spoken, with no pop-up message to cover the picker');
  const startWithNote = await box(page.getByRole('button', { name: 'Standing Start', exact: true }));
  assert.ok(startWithNote.bottom <= 900, `Standing Start stays visible with the note showing (${Math.round(startWithNote.bottom)})`);
  layouts.push({ viewport: page.viewportSize(), stage: stageBox, picker: pickerBox, standingStartBottom: start.bottom, standingStartBottomWithNote: startWithNote.bottom });
  await capture('desktop-karate');
  checks.push(`Choosing the Karate Stance plays ${karate.moveId}${karate.exact ? '' : ' and says plainly that its own animation is not ready'}.`);

  // The same choice is the fighter's stance everywhere, and it is remembered.
  await nav('Profile');
  assert.match(await page.locator('.profile-preview, .profile-card, main').first().innerText(), /karate stance/i);
  await page.reload();
  await nav('Arena');
  await picker().waitFor();
  assert.equal(await chosen(), 'Karate Stance', 'the stance survives a reload');
  checks.push('The choice is the fighter\'s stance: the Profile shows it and a reload keeps it.');

  // Arrow keys move through the stances like any group of radio buttons.
  await radio('Karate Stance').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await chosen(), 'Muay Thai Guard');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await chosen(), 'Boxer Shell');
  await shows('boxer shell', 'boxer chosen by keyboard');
  checks.push('Arrow keys move the choice from stance to stance.');

  // Every stance whose loop has a front view, in the picker's order. The boxer shell's and the Muay
  // Thai guard's loops are motion-capture takes, longer than the others; all of them have a side
  // and a front view. For each, the stage offers both cameras, Front plays the front view and Side
  // brings the side view back, and each view is the published file, set to loop, and plays to the
  // end of its loop and on into the next. On this wide stage the picture box is two to one, so 640
  // of the clip's 720 rows show: each view must show its athletes whole, from 10 rows above the
  // highest head to 6 rows below the lowest foot (MEASURED_ROWS), with the usual trim, except a
  // view whose feet reach below that trim, which is trimmed from the top (UnrealClipStage.css).
  const withFront = UNREAL_STANCES.filter((stance) => {
    const loop = stanceLoop(stance.stance, RIVAL_STANCE);
    return findUnrealClip(loop.moveId, loop.performerSide, 'front');
  });
  assert.deepEqual(withFront.map((stance) => stance.label), ['Wrestling Stance', 'Sumo Base', 'Boxer Shell', 'Muay Thai Guard', 'Sambo Crouch'], 'the stances whose loops have a front view; the karate stance and the capoeira rhythm have the side view only');
  const viewsSeen = [];
  for (const stance of withFront) {
    await radio(stance.label).check();
    const choice = await shows(stance.stance, `${stance.label} chosen`);
    const views = unrealClipViews(choice.moveId, choice.performerSide);
    assert.deepEqual([choice.exact, views.map((view) => view.camera)], [true, ['side', 'front']], `${stance.label}: its own loop, published in the side and front views`);
    for (const [view, step] of [[views[0], 'opens on'], [views[1], 'Front plays'], [views[0], 'Side brings back']]) {
      const label = `${stance.label}, ${view.camera}`;
      const pressed = cameras().getByRole('button', { name: CAMERA_LABELS[view.camera], exact: true });
      if (step !== 'opens on') await pressed.click();
      await untilPlaying(view.video, `${stance.label}: ${step} the ${view.camera} view`);
      assert.deepEqual([await loopStage().getAttribute('data-move'), await loopStage().getAttribute('data-camera'), await pressed.getAttribute('aria-pressed')], [choice.moveId, view.camera, 'true'], `${stance.label}: ${step} the ${view.camera} view`);
      const name = `${view.moveId}/${view.performerSide}-${view.camera}`;
      const measured = MEASURED_ROWS[name];
      assert.ok(measured, `${name} has no measured rows: measure its highest head row and lowest foot row and add them to MEASURED_ROWS`);
      assert.equal(view.sha256, measured.sha256, `${name}: its rows were measured on another file; a new take has to be measured again`);
      const rows = await shownRows();
      assert.deepEqual([rows.fit, rows.percent], ['cover', true], `${label}: the picture covers the box (${rows.position})`);
      assert.ok(Math.abs(rows.last - rows.first - 640) < 2, `${label}: the wide stage trims the picture to two to one (rows ${rows.first} to ${rows.last})`);
      assert.ok(rows.first <= measured.head - 10 && rows.last >= measured.foot + 6, `${label}: the box shows rows ${rows.first} to ${rows.last}, so the heads (from row ${measured.head}) and the feet (down to row ${measured.foot}) are whole`);
      const position = measured.foot + 6 > USUAL_TRIM.lastRow ? TOP_TRIM : USUAL_TRIM.position;
      assert.equal(rows.position, position, `${label}: ${position === TOP_TRIM ? 'the feet reach below the usual trim, so the whole trim comes off the top' : 'the usual trim'}`);
      const through = await playsThrough(view, label);
      viewsSeen.push({ stance: stance.label, step, video: view.video, frames: view.frames, measured: { head: measured.head, foot: measured.foot }, rows, ...through });
      if (step === 'Front plays' && ['boxing', 'muay_thai'].includes(stance.id)) await capture(`desktop-${stance.id.replace('_', '-')}-front`);
    }
  }
  layouts.push({ stanceViews: viewsSeen });
  const fromTop = viewsSeen.filter((seen) => seen.rows.position === TOP_TRIM);
  const ranges = (seen) => [...new Set(seen.map(({ rows }) => `${rows.first} to ${rows.last}`))].join(' or ');
  checks.push(`Each stance with a front view (${withFront.map((stance) => { const loop = stanceLoop(stance.stance, RIVAL_STANCE); return `${stance.label}: ${unrealClipViews(loop.moveId, loop.performerSide).map((view) => `${view.camera} ${view.frames} frames`).join(', ')}`; }).join('; ')}) shows the Side and Front buttons; each view plays to the end of its loop and starts again, and Side brings the side view back. At 1440 by 900 every view shows its measured heads and feet whole: ${[...new Set(fromTop.map((seen) => `${seen.stance} ${seen.video.endsWith('-front.mp4') ? 'front' : 'side'}`))].join(' and ')} rows ${ranges(fromTop)} of 720, trimmed from the top for the near foot, and every other view the usual rows ${ranges(viewsSeen.filter((seen) => seen.rows.position !== TOP_TRIM))}.`);
  await desktop.close();

  // ---- A match: the picker stays through the first sequence, then leaves ----
  const match = await open({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${base}/?engine=snapshot`);
  await nav('Arena');
  await picker().waitFor();
  await page.getByRole('button', { name: 'Standing Start', exact: true }).click();
  // A match that starts on the feet opens with the match greeting in the stance clip's place
  // (tools/test_match_moments.mjs checks it). The picker stays beside it, and a new stance is
  // what the player asked to see: it ends the greeting and its clip shows.
  const greeting = page.locator('.mat-window .unreal-clip-stage[data-kind="moment"][data-move="match_greeting"]');
  await greeting.waitFor();
  assert.equal(await picker().count(), 1, 'still on their feet with nothing settled: the stance can change');
  await radio('Sumo Base').check();
  await shows('sumo base', 'sumo chosen during the first exchange');
  assert.equal(await greeting.count(), 0, 'choosing a stance ends the greeting');
  await page.locator('.combat-moves .combat-group').first().locator('button:not([disabled])').first().click();
  await page.locator('.sequence-panel .order-stack').waitFor();
  await page.getByRole('button', { name: 'Submit sequence', exact: true }).click();
  await page.locator('.arena-outcome').waitFor();
  assert.equal(await picker().count(), 0, 'a settled exchange is no longer a stance');
  // A start that is not on the feet never offers it.
  await page.reload();
  await nav('Arena');
  await picker().waitFor();
  await page.getByLabel('Your starting position', { exact: true }).selectOption('mount-bottom');
  await page.getByRole('button', { name: 'Position Start', exact: true }).click();
  assert.equal(await picker().count(), 0);
  checks.push('The picker stays while the athletes are on their feet, also beside the match greeting, which a new stance ends; it leaves once an exchange settles or a start is off the feet.');
  await match.close();

  // ---- Phones ----
  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 640 }]) {
    const phone = await open({ viewport, isMobile: true, hasTouch: true });
    await page.goto(`${base}/`);
    await nav('Arena');
    await picker().waitFor();
    assert.equal(await fits(), true, `${viewport.width}-pixel Arena must not scroll sideways`);
    const pickerBox = await box(picker());
    assert.ok(pickerBox.x >= 0 && pickerBox.right <= viewport.width + 1, 'the picker stays inside the screen');
    for (const label of await group().locator('label').all()) {
      const target = await label.boundingBox();
      assert.ok(target.width >= 44 && target.height >= 44, `each stance is easy to tap (${Math.round(target.width)} by ${Math.round(target.height)})`);
      assert.ok(target.x >= pickerBox.x - 1 && target.x + target.width <= pickerBox.right + 1, 'no stance is hidden off the side: a row too long for the phone wraps');
    }
    await radio('Capoeira Rhythm').scrollIntoViewIfNeeded();
    await group().locator('label', { has: page.getByRole('radio', { name: 'Capoeira Rhythm', exact: true }) }).tap();
    assert.equal(await chosen(), 'Capoeira Rhythm');
    await shows('capoeira rhythm', `${viewport.width}px capoeira`);
    assert.equal(await fits(), true);
    layouts.push({ viewport, picker: pickerBox });
    await picker().scrollIntoViewIfNeeded();
    await capture(`phone-${viewport.width}`);
    await phone.close();
  }
  checks.push('At 390 and 320 pixels every stance is a full-size tap target and nothing scrolls sideways.');

  // ---- In-between widths: the Arena panel is at its narrowest beside the technique list ----
  for (const viewport of [{ width: 768, height: 1024 }, { width: 1000, height: 800 }]) {
    const tablet = await open({ viewport });
    await page.goto(`${base}/`);
    await nav('Arena');
    await picker().waitFor();
    assert.equal(await fits(), true, `${viewport.width}-pixel Arena must not scroll sideways`);
    const [pickerBox, rowBox] = [await box(picker()), await box(group())];
    for (const label of await group().locator('label').all()) {
      const target = await label.boundingBox();
      assert.ok(target.x >= rowBox.x - 1 && target.x + target.width <= rowBox.right + 1, `${viewport.width}px: every stance is inside its row, none cut off at either side`);
    }
    await radio('Wrestling Stance').check();
    await radio('Capoeira Rhythm').check();
    assert.equal(await chosen(), 'Capoeira Rhythm');
    layouts.push({ viewport, picker: pickerBox, row: rowBox });
    await capture(`width-${viewport.width}`);
    await tablet.close();
  }
  checks.push('At 768 and 1000 pixels, where the panel is narrowest, all seven stances are still in view and can be chosen.');

  assert.deepEqual(errors, []);
  assert.deepEqual(consoleErrors, [], 'Unexpected browser console errors');
  assert.deepEqual(failedResponses, [], 'Every picture and clip must load');
  report.status = 'passed';
  console.log(JSON.stringify({ checks, layouts, images: images.length, artifacts }, null, 2));
} catch (error) {
  report.status = 'failed'; report.failure = error.stack || String(error);
  if (page && !page.isClosed()) await page.screenshot({ path: resolve(artifacts, 'failure.png'), fullPage: true, timeout: 10000 }).catch(() => {});
  console.error(error); process.exitCode = 1;
} finally {
  Object.assign(report, { checkedAtUtc: new Date().toISOString(), checks, layouts, images, pageErrors: errors, consoleErrors, runnerErrors: runner.errors, failedResponses });
  await writeFile(resolve(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  if (browser) await browser.close().catch(() => {});
  if (server) { server.closeAllConnections(); await new Promise((resolveClose) => server.close(resolveClose)); }
}
