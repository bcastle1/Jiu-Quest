// Verifies the Arena's starting-stance picker in the built site in a real
// browser: the seven stances are offered as pictures while both athletes are on
// their feet, choosing one changes the fighter's stance and is remembered, the
// clip above is the one that stance leads to (with a plain note when Unreal has
// not rendered that stance yet), the keyboard works, the picker leaves once an
// exchange settles, and the page fits phones. It checks the page. It does not
// run Unreal or any stream.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { chromium } from 'playwright';
import { defaultNpcs } from '../src/storage.js';
import { UNREAL_STANCES, findStance, stanceLoop } from '../src/unreal/stances.js';
import { findUnrealClip } from '../src/unreal/techniqueClips.js';

const root = resolve('dist');
const artifacts = resolve(process.env.JIUQUEST_BROWSER_ARTIFACTS || 'tmp/browser', 'stance-picker');
await mkdir(artifacts, { recursive: true });
const checks = [], images = [], errors = [], consoleErrors = [], failedResponses = [], layouts = [];
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
  return `http://127.0.0.1:${server.address().port}`;
}

async function open(options) {
  const context = await browser.newContext({ deviceScaleFactor: 1, reducedMotion: 'no-preference', ...options });
  page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push({ text: message.text(), location: message.location() }); });
  page.on('response', (response) => { if (response.status() >= 400) failedResponses.push({ url: response.url(), status: response.status() }); });
  return context;
}

const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const nav = async (name) => { await page.getByRole('button', { name, exact: true }).click(); };
const picker = () => page.locator('.arena-panel .stance-picker');
const group = () => page.getByRole('radiogroup', { name: 'Starting stance', exact: true });
const radio = (label) => group().getByRole('radio', { name: label, exact: true });
const stage = () => page.locator('.mat-window .unreal-clip-stage');
const box = async (locator) => { const found = await locator.boundingBox(); return { x: found.x, y: found.y, width: found.width, height: found.height, right: found.x + found.width, bottom: found.y + found.height }; };
const chosen = () => group().getByRole('radio', { checked: true }).getAttribute('aria-label');
const notReady = (stance) => `The ${findStance(stance).label} animation is not ready yet, so standing animations start from the standard wrestling stance for now. Your choice is saved.`;

async function capture(name) {
  // Let the highlight finish moving to the new choice before the picture is taken.
  await page.waitForTimeout(400);
  const file = resolve(artifacts, `${name}.png`);
  const data = await page.screenshot({ path: file });
  images.push({ name, path: file, bytes: data.length });
}

// The clip on the stage is the one this stance leads to, it is playing, and the
// note is there exactly when the clip cannot show the stance asked for.
async function shows(stance, label) {
  const choice = stanceLoop(stance, RIVAL_STANCE);
  const clip = findUnrealClip(choice.moveId, choice.performerSide);
  assert.ok(clip, `${stance} leads to a published clip`);
  await page.waitForFunction((path) => {
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
  return choice;
}

try {
  const base = process.env.JIUQUEST_PREVIEW_URL?.replace(/\/$/, '') || await staticSite();
  browser = await chromium.launch(browserOptions);
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
  await desktop.close();

  // ---- A match: the picker stays through the first sequence, then leaves ----
  const match = await open({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${base}/?engine=snapshot`);
  await nav('Arena');
  await picker().waitFor();
  await page.getByRole('button', { name: 'Standing Start', exact: true }).click();
  assert.equal(await picker().count(), 1, 'still on their feet with nothing settled: the stance can change');
  await radio('Sumo Base').check();
  await shows('sumo base', 'sumo chosen during the first exchange');
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
  checks.push('The picker stays while the athletes are on their feet, and leaves once an exchange settles or a start is off the feet.');
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
  Object.assign(report, { checkedAtUtc: new Date().toISOString(), checks, layouts, images, pageErrors: errors, consoleErrors, failedResponses });
  await writeFile(resolve(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  if (browser) await browser.close().catch(() => {});
  if (server) { server.closeAllConnections(); await new Promise((resolveClose) => server.close(resolveClose)); }
}
