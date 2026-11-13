// Verifies four small things in the built site in a real browser, with real key
// presses, mouse clicks and touch taps: the music track menu in the header
// closes on Escape and on a press outside it; keyboard focus stays inside the
// Admin access dialog while it is open and goes back to the Admin button when
// it closes; starting an Arena match or preparing the next action leaves focus
// on the technique heading instead of dropping it on the page, without
// scrolling; and the heading typeface is named in index.html so it is fetched
// with the page, once. It checks the page. It never types into the Admin
// access field, and it does not run Unity, Unreal or any stream.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { chromium } from 'playwright';
import { defaultMusicTracks } from '../src/storage.js';
import { fontPreloadTags, PRELOADED_FACES } from './vite_font_preload.mjs';

const root = resolve('dist');
const artifacts = resolve(process.env.JIUQUEST_BROWSER_ARTIFACTS || 'tmp/browser', 'keyboard-polish');
await mkdir(artifacts, { recursive: true });
const checks = [], images = [], errors = [], consoleErrors = [], failedResponses = [], layouts = [];
const browserOptions = { headless: true, args: ['--enable-unsafe-swiftshader'], ...(process.env.JIUQUEST_BROWSER_CHANNEL ? { channel: process.env.JIUQUEST_BROWSER_CHANNEL } : {}), ...(process.env.JIUQUEST_BROWSER_EXECUTABLE ? { executablePath: process.env.JIUQUEST_BROWSER_EXECUTABLE } : {}) };
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.mp4': 'video/mp4' };
const report = { startedAtUtc: new Date().toISOString(), status: 'running', scope: 'The track menu, the Admin access dialog, Arena focus and font preloading in desktop Chromium, with phone viewport and touch emulation. No physical device, screen reader or other browser.' };
// A wide screen with a mouse, and a phone with touch. Keys are pressed on both.
const SIZES = [
  { name: 'desktop', touch: false, options: { viewport: { width: 1440, height: 900 } } },
  { name: 'phone', touch: true, options: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
];
// The tracks a new player is offered, in menu order. The first is the one playing.
const TRACKS = defaultMusicTracks.filter((track) => track.playerEnabled !== false).map((track) => track.title);
// What the static server below was asked for, by path. Cleared before each font check.
const served = new Map();
let browser, server, page, size, base;

async function staticSite() {
  await stat(resolve(root, 'index.html'));
  server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      served.set(pathname, (served.get(pathname) || 0) + 1);
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

// Every check starts in a new browser context: nothing saved, nothing cached.
async function open(options) {
  const context = await browser.newContext({ deviceScaleFactor: 1, reducedMotion: 'no-preference', ...options });
  page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push({ text: message.text(), location: message.location() }); });
  page.on('response', (response) => { if (response.status() >= 400) failedResponses.push({ url: response.url(), status: response.status() }); });
  return context;
}

// A real press with the pointer this screen has: a mouse click or a touch tap.
const press = (locator) => (size.touch ? locator.tap() : locator.click());
const pressAt = (spot) => (size.touch ? page.touchscreen.tap(spot.x, spot.y) : page.mouse.click(spot.x, spot.y));
// Two painted frames: everything the last key or press set off has been drawn.
// Used before saying that something did NOT happen.
const painted = () => page.evaluate(() => new Promise((done) => { requestAnimationFrame(() => requestAnimationFrame(done)); }));
// Waits for something to happen, and says in plain words what did not if it never does.
const soon = (waiting, message) => waiting.catch((error) => assert.fail(`${message}: that did not happen (${error.name})`));
const scrollY = () => page.evaluate(() => Math.round(window.scrollY));
const navButton = (name) => page.getByRole('navigation', { name: 'Main', exact: true }).getByRole('button', { name, exact: true });
const currentView = () => page.getByRole('navigation', { name: 'Main', exact: true }).locator('[aria-current="page"]').getAttribute('aria-label');

// Where keyboard focus is, in words.
const focused = () => page.evaluate(() => {
  const element = document.activeElement;
  const words = (text) => (text || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!element || element === document.body) return 'the page body';
  if (element.matches('.player-track-trigger')) return 'the track menu button';
  if (element.closest('.player-track-menu')) return `track: ${words(element.querySelector('span')?.textContent)}`;
  if (element.matches('.corner-admin')) return 'the Admin button';
  if (element.closest('[role="dialog"]')) return `in the dialog: ${element.matches('input') ? 'access field' : words(element.getAttribute('aria-label') || element.textContent)}`;
  if (element.matches('aside[aria-label="Technique selection"] .section-heading')) return `the heading block: ${words(element.querySelector('h2')?.textContent)}`;
  if (element.closest('nav[aria-label="Main"]')) return `menu: ${words(element.getAttribute('aria-label'))}`;
  return `${element.tagName.toLowerCase()}: ${words(element.getAttribute('aria-label') || element.textContent)}`;
});

async function capture(name) {
  const file = resolve(artifacts, `${name}.png`);
  const data = await page.screenshot({ path: file });
  images.push({ name, path: file, bytes: data.length });
}

// ---- The track menu ----
const trigger = () => page.locator('.player-track-trigger');
const menu = () => page.locator('.player-track-menu');
const menuOpen = async (how) => { await soon(menu().waitFor(), `${how} opens the track menu`); assert.equal(await trigger().getAttribute('aria-expanded'), 'true'); };
const menuClosed = async (how) => { await soon(menu().waitFor({ state: 'detached' }), `${how} closes the track menu`); assert.equal(await trigger().getAttribute('aria-expanded'), 'false'); };
// Every time the menu opened or closed since the page loaded, and every click the trigger received.
const menuHistory = () => page.evaluate(() => ({ changes: [...window.__trackMenuChanges], clicks: window.__trackTriggerClicks }));
async function watchMenu() {
  await page.evaluate(() => {
    const button = document.querySelector('.player-track-trigger');
    window.__trackMenuChanges = [];
    window.__trackTriggerClicks = 0;
    new MutationObserver(() => window.__trackMenuChanges.push(button.getAttribute('aria-expanded'))).observe(button, { attributes: true, attributeFilter: ['aria-expanded'] });
    document.addEventListener('click', (event) => { if (button.contains(event.target)) window.__trackTriggerClicks += 1; }, true);
  });
}
// A spot on screen that is well clear of the menu and its button and is not on,
// or next to, anything that can be pressed. The furthest such spot is used.
const emptySpot = () => page.evaluate(() => {
  const keepOut = [...document.querySelectorAll('.player-track-select, .player-track-menu')].map((element) => element.getBoundingClientRect());
  const pressable = 'button, a, input, select, textarea, label, summary, details, video, audio, iframe, canvas, nav, [tabindex], [role], [contenteditable]';
  const plain = (x, y) => { const element = document.elementFromPoint(x, y); return Boolean(element) && !element.closest('.player-track-select') && !element.closest(pressable); };
  let best = null;
  for (let y = 32; y < window.innerHeight - 32; y += 8) {
    for (let x = 32; x < window.innerWidth - 32; x += 8) {
      const clear = Math.min(...keepOut.map((rect) => Math.max(rect.left - x, x - rect.right, rect.top - y, y - rect.bottom)));
      if (clear < 48 || (best && clear <= best.clear)) continue;
      if (![[0, 0], [-16, 0], [16, 0], [0, -16], [0, 16]].every(([dx, dy]) => plain(x + dx, y + dy))) continue;
      best = { x, y, clear: Math.round(clear), on: document.elementFromPoint(x, y).tagName.toLowerCase() };
    }
  }
  return best;
});

async function trackMenu() {
  const context = await open(size.options);
  await page.goto(`${base}/`);
  await trigger().waitFor();
  await watchMenu();
  assert.ok(TRACKS.length >= 2, 'a new player is offered more than one track');
  assert.equal((await trigger().locator('span').textContent()).trim(), TRACKS[0]);
  assert.equal(await menu().count(), 0, 'the menu starts closed');
  assert.equal(await trigger().getAttribute('aria-expanded'), 'false');

  // Closed: Escape is not for the menu, and it leaves focus alone.
  await trigger().focus();
  await page.keyboard.press('Escape');
  await painted();
  assert.equal(await menu().count(), 0, 'Escape does not open a closed menu');
  assert.equal(await focused(), 'the track menu button', 'Escape with the menu closed leaves focus where it was');

  // A press on the button opens it, Escape closes it and focus is on the button.
  await press(trigger());
  await menuOpen('a press on its button');
  assert.deepEqual(await menu().locator('button span').allTextContents(), TRACKS, 'the menu lists the tracks');
  await capture(`${size.name}-track-menu-open`);
  await page.keyboard.press('Escape');
  await menuClosed('Escape');
  assert.equal(await focused(), 'the track menu button', 'after Escape focus is on the button that opened the menu');

  // A press on an empty part of the page closes it, and does nothing else.
  await press(trigger());
  await menuOpen('a press on its button');
  const spot = await emptySpot();
  assert.ok(spot, 'there is an empty spot on screen away from the menu');
  await pressAt(spot);
  await menuClosed('a press on an empty part of the page');
  await painted();
  assert.equal(await menu().count(), 0, 'it stays closed after a press outside');
  assert.equal(await currentView(), 'Overview', 'the press outside landed on nothing');
  assert.equal(await page.getByRole('dialog').count(), 0);

  // Closed: the same press again changes nothing.
  const quiet = await menuHistory();
  const restingScroll = await scrollY();
  await pressAt(spot);
  await painted();
  assert.deepEqual((await menuHistory()).changes, quiet.changes, 'a press on the page does not open or close a closed menu');
  assert.equal(await menu().count(), 0);
  assert.equal(await currentView(), 'Overview');
  assert.equal(await scrollY(), restingScroll);

  // Keyboard: Enter opens, Tab goes into the menu, Escape closes and focus is on the button.
  await trigger().focus();
  await page.keyboard.press('Enter');
  await menuOpen('Enter on its button');
  await page.keyboard.press('Tab');
  assert.equal(await focused(), `track: ${TRACKS[0]}`, 'Tab goes from the button into the menu');
  await page.keyboard.press('Escape');
  await menuClosed('Escape with focus inside the menu');
  assert.equal(await focused(), 'the track menu button', 'Escape from inside the menu puts focus back on the button, not on the page');

  // A press on the button while open closes it once. It must not close and open again.
  await press(trigger());
  await menuOpen('a press on its button');
  let before = await menuHistory();
  await press(trigger());
  await menuClosed('a second press on its button');
  // The press has been fully delivered once its click has arrived.
  await page.waitForFunction((clicks) => window.__trackTriggerClicks > clicks, before.clicks);
  await painted();
  assert.deepEqual((await menuHistory()).changes.slice(before.changes.length), ['false'], 'one press on the button while open: closed, once');
  assert.equal(await menu().count(), 0, 'it stays closed');
  // The same with Enter.
  await trigger().focus();
  await page.keyboard.press('Enter');
  await menuOpen('Enter on its button');
  before = await menuHistory();
  await page.keyboard.press('Enter');
  await menuClosed('a second Enter on its button');
  await painted();
  assert.deepEqual((await menuHistory()).changes.slice(before.changes.length), ['false'], 'Enter on the button while open: closed, once');
  assert.equal(await menu().count(), 0);

  // Choosing a track with the keyboard: the menu closes, the button names the
  // new track, and focus is on the button rather than lost with the menu.
  const choice = TRACKS.length - 1;
  await page.keyboard.press('Enter');
  await menuOpen('Enter on its button');
  for (let step = 0; step <= choice; step += 1) await page.keyboard.press('Tab');
  assert.equal(await focused(), `track: ${TRACKS[choice]}`);
  await page.keyboard.press('Enter');
  await menuClosed('choosing a track with Enter');
  assert.equal((await trigger().locator('span').textContent()).trim(), TRACKS[choice], 'the button shows the chosen track');
  assert.notEqual(await focused(), 'the page body', 'choosing a track must not drop focus on the page');
  assert.equal(await focused(), 'the track menu button');

  // Closed again: Escape still does nothing to it.
  before = await menuHistory();
  await page.keyboard.press('Escape');
  await painted();
  assert.deepEqual((await menuHistory()).changes, before.changes);
  assert.equal(await focused(), 'the track menu button');
  layouts.push({ check: 'track menu', size: size.name, viewport: page.viewportSize(), emptySpot: spot });
  await context.close();
}

// ---- The Admin access dialog ----
const adminButton = () => page.locator('.corner-admin');
const dialog = () => page.getByRole('dialog');
const dialogOpen = () => soon(dialog().waitFor(), 'Enter on the Admin button opens the access dialog');
const dialogClosed = (how) => soon(dialog().waitFor({ state: 'detached' }), `${how} closes the access dialog`);
// True while focus is on something inside the dialog.
const insideDialog = () => page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')));
// The controls Tab can stop on in the dialog, counted from the page.
const dialogStops = () => dialog().evaluate((element) => [...element.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')].filter((control) => !control.disabled && control.tabIndex >= 0 && control.getClientRects().length > 0).length);

// Presses the key once for every control in the dialog, which is a full lap:
// through each of the others and one more, back to where it started.
async function lap(key, stops) {
  const visited = [];
  for (let step = 0; step < stops; step += 1) {
    await page.keyboard.press(key);
    assert.equal(await insideDialog(), true, `${key} press ${step + 1} left the dialog: focus is on ${await focused()}`);
    visited.push(await focused());
  }
  return visited;
}

async function adminDialog() {
  const context = await open(size.options);
  await page.goto(`${base}/`);
  await adminButton().waitFor();
  // Focusing the button brings it into view; on a phone it is far down the page.
  await adminButton().focus();
  const resting = await scrollY();
  await page.keyboard.press('Enter');
  await dialogOpen();
  assert.equal(await focused(), 'in the dialog: access field', 'the dialog opens with focus in its field');
  await capture(`${size.name}-admin-dialog`);

  const stops = await dialogStops();
  assert.ok(stops >= 2, `the dialog has controls to move between (${stops})`);
  const forward = await lap('Tab', stops);
  assert.equal(new Set(forward).size, stops, `Tab visits every control once: ${forward.join(', ')}`);
  assert.equal(forward.at(-1), 'in the dialog: access field', 'Tab from the last control wraps to the first, inside the dialog');
  const backward = await lap('Shift+Tab', stops);
  assert.equal(backward.at(-1), 'in the dialog: access field', 'Shift+Tab wraps the other way, inside the dialog');
  assert.deepEqual(backward.slice(0, -1), forward.slice(0, -1).reverse(), 'Shift+Tab visits the same controls in reverse');

  await page.keyboard.press('Escape');
  await dialogClosed('Escape');
  assert.equal(await focused(), 'the Admin button', 'Escape closes the dialog and gives focus back to the button that opened it');
  assert.equal(await scrollY(), resting, 'closing the dialog does not scroll the page');

  // Closed with its own Close button, by pointer.
  await page.keyboard.press('Enter');
  await dialogOpen();
  assert.equal(await focused(), 'in the dialog: access field');
  await press(dialog().getByRole('button', { name: 'Close', exact: true }));
  await dialogClosed('a press on its Close button');
  assert.equal(await focused(), 'the Admin button', 'the Close button gives focus back to the Admin button');
  assert.equal(await scrollY(), resting);

  // And by keyboard: Tab to Close, Enter.
  await page.keyboard.press('Enter');
  await dialogOpen();
  for (let step = 0; step < stops && await focused() !== 'in the dialog: Close'; step += 1) await page.keyboard.press('Tab');
  assert.equal(await focused(), 'in the dialog: Close');
  // Nothing in this file types into the field. Checked while the dialog is still open.
  assert.equal(await dialog().locator('input').inputValue(), '', 'the access field was left empty');
  await page.keyboard.press('Enter');
  await dialogClosed('Enter on its Close button');
  assert.equal(await focused(), 'the Admin button');
  assert.equal(await scrollY(), resting);
  layouts.push({ check: 'admin dialog', size: size.name, viewport: page.viewportSize(), scrollY: resting, tabOrder: forward, shiftTabOrder: backward });
  await context.close();
}

// ---- The Arena ----
const HEADING = 'the heading block: Choose a technique';
const startButton = (name) => page.getByRole('button', { name, exact: true });
const techniquePanel = () => page.locator('aside[aria-label="Technique selection"]');
// The line under "Choose a technique" says which phase the match is in.
const hint = (text) => soon(techniquePanel().locator('.section-heading p').filter({ hasText: text }).waitFor(), `the technique panel reads "${text}"`);
// Where the page is scrolled to, and where the heading block is on screen.
const arenaView = () => page.evaluate(() => {
  const rect = document.querySelector('aside[aria-label="Technique selection"] .section-heading').getBoundingClientRect();
  return { scrollY: Math.round(window.scrollY), headingTop: Math.round(rect.top), headingBottom: Math.round(rect.bottom), viewportHeight: window.innerHeight };
});
// Moving focus scrolls the page only to bring the focused thing into view. So
// the focus move did not scroll if the page is where it was, or if the heading
// block is still not fully on screen.
const notScrolledByFocus = (before, after) => after.scrollY === before.scrollY || after.headingTop < 0 || after.headingBottom > after.viewportHeight;
const openArena = async () => {
  // Position snapshots: the match runs the same and no Unity player is loaded.
  await page.goto(`${base}/?engine=snapshot`);
  await press(navButton('Arena'));
  await startButton('Standing Start').waitFor();
};

async function arenaByKeyboard() {
  const context = await open(size.options);
  await openArena();
  const standing = startButton('Standing Start');
  await standing.focus();
  const atStart = await arenaView();
  await page.keyboard.press('Enter');
  await hint('Select your response from standing.');
  assert.equal(await focused(), HEADING, 'Standing Start leaves focus on the technique heading, not on the page');
  assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest('aside[aria-label="Technique selection"]'))), true);
  const started = await arenaView();
  assert.equal(started.scrollY, atStart.scrollY, 'Standing Start does not scroll the page');
  await capture(`${size.name}-arena-keyboard-start`);
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('aside[aria-label="Technique selection"] .combat-moves button:not([disabled])')), true, `one Tab reaches the first technique that can be chosen (focus is on ${await focused()})`);

  // One exchange. The rival picks its technique at random, and about one pick
  // in four from standing is a submission that ends the match there and then.
  // Such a match is simply started again, so the check never depends on the
  // rival: twenty in a row would be needed to run out of tries.
  const outcome = page.locator('.arena-outcome');
  let settled = false, exchanges = 0;
  for (let attempt = 1; attempt <= 20 && !settled; attempt += 1) {
    exchanges = attempt;
    if (attempt > 1) {
      await standing.focus();
      await page.keyboard.press('Enter');
      await hint('Select your response from standing.');
      await page.keyboard.press('Tab');
    }
    await page.keyboard.press('Enter');
    await page.locator('.sequence-panel .order-stack').waitFor();
    await startButton('Submit sequence').focus();
    await page.keyboard.press('Enter');
    await outcome.waitFor();
    settled = await outcome.getAttribute('data-finished') !== 'true';
  }
  assert.ok(settled, 'an exchange settled with the match still running');
  await startButton('Prepare Next Action').waitFor();
  assert.equal(await focused(), 'button: Prepare Next Action', 'a settled exchange puts focus on Prepare Next Action');
  let atResult = await arenaView();
  if (size.touch) {
    // On the phone layout the button sits above what is on screen, and when it
    // is replaced the browser moves the scroll position a few pixels to hold
    // the visible content still. That is not the page scrolling, and how far
    // depends on the exchange. At the very top of the page the browser does no
    // such thing, so go there first, the way a keyboard user would: Home.
    await page.keyboard.press('Home');
    await soon(page.waitForFunction(() => window.scrollY === 0), 'the Home key scrolls the page to the top');
    assert.equal(await focused(), 'button: Prepare Next Action');
    atResult = await arenaView();
  }
  await page.keyboard.press('Enter');
  await hint('Select your response from');
  assert.equal(await focused(), HEADING, 'Prepare Next Action leaves focus on the technique heading, not on the page');
  const prepared = await arenaView();
  if (size.touch) assert.equal(prepared.scrollY, atResult.scrollY, `Prepare Next Action does not scroll the page: ${JSON.stringify({ atResult, prepared })}`);
  else assert.ok(notScrolledByFocus(atResult, prepared), `Prepare Next Action does not scroll the heading into view: ${JSON.stringify({ atResult, prepared })}`);
  await capture(`${size.name}-arena-keyboard-next-action`);
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('aside[aria-label="Technique selection"] .combat-moves button:not([disabled])')), true, 'one Tab reaches the first technique again');
  layouts.push({ check: 'arena by keyboard', size: size.name, viewport: page.viewportSize(), exchanges, atStart, started, atResult, prepared });
  await context.close();
}

async function arenaByPointer() {
  const context = await open(size.options);
  await openArena();
  const kneeling = startButton('Kneeling Start');
  // The browser driver may scroll the button into reach before it presses, so
  // the page notes where it is scrolled to at the moment the press lands.
  await page.evaluate(() => document.addEventListener('pointerdown', () => { window.__scrollAtPress = Math.round(window.scrollY); }, { capture: true, once: true }));
  await press(kneeling);
  await hint('Select your response from');
  assert.notEqual(await focused(), 'the page body', 'a start by pointer must not leave focus on the page');
  assert.equal(await focused(), HEADING);
  const atStart = { scrollY: await page.evaluate(() => window.__scrollAtPress) };
  const started = await arenaView();
  assert.equal(started.scrollY, atStart.scrollY, 'Kneeling Start does not scroll the page');

  // Restart match stays on screen, so focus stays on it. The page asks before
  // it restarts a running match; the answer is yes.
  const questions = [];
  page.on('dialog', (asked) => { questions.push(asked.type()); asked.accept(); });
  const restart = startButton('Restart match');
  await press(restart);
  await page.locator('.combat-grid .sr-only[role="status"]').filter({ hasText: 'Match restarted against' }).waitFor();
  assert.deepEqual(questions, ['confirm'], 'restarting a running match asks first');
  await painted();
  assert.equal(await focused(), 'button: Restart match', 'focus stays on Restart match while a technique is being chosen');

  // Restart once more with a result on screen. This time the match goes back
  // to choosing a technique while focus is on a control, and focus must be
  // left on it. It makes no difference here whether the exchange ended the match.
  const outcome = page.locator('.arena-outcome');
  await press(techniquePanel().locator('.combat-moves button:not([disabled])').first());
  await page.locator('.sequence-panel .order-stack').waitFor();
  await press(startButton('Submit sequence'));
  await outcome.waitFor();
  await press(restart);
  await outcome.waitFor({ state: 'detached' });
  await hint('Select your response from');
  await painted();
  assert.equal(await focused(), 'button: Restart match', 'focus stays on Restart match when it is pressed with a result showing');
  layouts.push({ check: 'arena by pointer', size: size.name, viewport: page.viewportSize(), atStart, started });
  await context.close();
}

async function arenaReturn() {
  const context = await open(size.options);
  await openArena();
  await press(startButton('Standing Start'));
  await hint('Select your response from standing.');
  assert.equal(await focused(), HEADING);
  await press(navButton('Training'));
  await techniquePanel().waitFor({ state: 'detached' });
  assert.equal(await currentView(), 'Training');
  await press(navButton('Arena'));
  // The match is still waiting for a technique. Coming back is not a start.
  await hint('Select your response from standing.');
  await painted();
  assert.notEqual(await focused(), HEADING, 'opening the Arena during a match must not move focus to the heading');
  assert.equal(await focused(), 'menu: Arena', 'focus stays on the menu button that was pressed');
  await context.close();
}

// The Overview's Open Arena button starts a match and opens the Arena in one
// press, and the pressed button goes away with the Overview. That is a start
// too: focus goes to the heading, not to the page.
async function arenaFromOverview() {
  const context = await open(size.options);
  await page.goto(`${base}/?engine=snapshot`);
  const openButton = startButton('Open Arena');
  await openButton.waitFor();
  await openButton.focus();
  await page.keyboard.press('Enter');
  await hint('Select your response from');
  await painted();
  assert.equal(await focused(), HEADING, 'the Overview\'s Open Arena button leaves focus on the technique heading, not on the page');
  await context.close();
}

// ---- The heading typeface ----
// The <link> tags of a page, as attribute maps. A bare attribute reads as ''.
function linkTags(html) {
  return [...html.matchAll(/<link\b([^>]*)>/gi)].map(([, body]) => Object.fromEntries([...body.matchAll(/([^\s=/"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)].map(([, name, double, single, bare]) => [name.toLowerCase(), double ?? single ?? bare ?? ''])));
}

// Returns the address of each preloaded font file, as the browser will ask for it.
async function fontLinks() {
  // The page as visitors get it: the built file, or the preview site's own copy.
  const html = process.env.JIUQUEST_PREVIEW_URL ? await (await fetch(`${base}/`)).text() : await readFile(resolve(root, 'index.html'), 'utf8');
  const links = linkTags(html).filter((link) => link.rel === 'preload' && link.as === 'font');
  assert.equal(links.length, PRELOADED_FACES.length, `one font preload link for each Barlow Condensed file (found: ${links.map((link) => link.href).join(', ') || 'none'})`);
  for (const [index, link] of links.entries()) {
    assert.equal(link.type, 'font/woff2');
    // Fonts are always fetched as CORS requests that send cookies only to the page's own origin. A preload without a bare crossorigin attribute (missing, or use-credentials) is fetched a second time.
    assert.ok('crossorigin' in link && link.crossorigin !== 'use-credentials', 'each link has a crossorigin attribute');
    assert.match(link.href, new RegExp(`/${PRELOADED_FACES[index]}-[A-Za-z0-9_-]{8}\\.woff2$`), 'the links name the three faces, bold italic first');
  }
  if (!process.env.JIUQUEST_PREVIEW_URL) {
    // The same tags the build plugin's own function gives for the files in this build.
    const bundle = Object.fromEntries((await readdir(resolve(root, 'assets'))).map((name) => [`assets/${name}`, { type: 'asset', fileName: `assets/${name}` }]));
    const expected = fontPreloadTags(bundle, '/').map((tag) => ({ ...tag.attrs, crossorigin: '' }));
    assert.deepEqual(links, expected, 'index.html carries the preload links for this build');
    for (const link of links) {
      const file = resolve(root, `.${link.href}`);
      assert.ok(file.startsWith(`${root}${sep}`) && (await stat(file)).size > 0, `${link.href} is a file in the build`);
    }
  }
  return links.map((link) => new URL(link.href, `${base}/`).href);
}

async function fontsLoadOnce(fonts) {
  const context = await open(size.options);
  const asked = new Map();
  page.on('request', (request) => asked.set(request.url(), (asked.get(request.url()) || 0) + 1));
  served.clear();
  await page.goto(`${base}/`);
  await navButton('Overview').waitFor();
  // The first screen is drawn, so every face it needs has been asked for; then wait for them all.
  await painted();
  await page.evaluate(() => document.fonts.ready);
  const faces = await page.evaluate(() => {
    const family = (name) => name.split(',')[0].trim().replace(/["']/g, '');
    const used = new Set();
    for (const element of document.querySelectorAll('body *')) {
      if (![...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim())) continue;
      const style = getComputedStyle(element);
      if (!element.getClientRects().length || style.visibility === 'hidden' || family(style.fontFamily) !== 'Barlow Condensed') continue;
      used.add(`${style.fontStyle} ${style.fontWeight} 16px "Barlow Condensed"`);
    }
    return {
      declared: [...document.fonts].filter((face) => family(face.family) === 'Barlow Condensed').map((face) => ({ style: face.style, weight: face.weight, status: face.status })),
      // check() is true when the face that text in this style is drawn with has loaded.
      used: [...used].sort().map((font) => ({ font, loaded: document.fonts.check(font, 'A') })),
    };
  });
  assert.ok(faces.used.length > 0, 'the home screen has text set in Barlow Condensed');
  assert.deepEqual(faces.used.filter((face) => !face.loaded), [], 'every face the home screen uses has loaded');
  assert.ok(faces.declared.some((face) => face.status === 'loaded'));
  assert.deepEqual(faces.declared.filter((face) => face.status === 'error' || face.status === 'loading'), [], 'no face failed or is still on its way');
  for (const url of fonts) {
    assert.equal(asked.get(url) || 0, 1, `the browser asks for ${url} exactly once`);
    if (server) assert.equal(served.get(new URL(url).pathname) || 0, 1, `${new URL(url).pathname} is sent exactly once`);
  }
  layouts.push({ check: 'fonts', size: size.name, viewport: page.viewportSize(), faces, requests: Object.fromEntries(fonts.map((url) => [url, asked.get(url) || 0])) });
  await context.close();
}

try {
  base = process.env.JIUQUEST_PREVIEW_URL?.replace(/\/$/, '') || await staticSite();
  browser = await chromium.launch(browserOptions);
  report.browserVersion = browser.version();

  for (size of SIZES) await trackMenu();
  checks.push('The track menu closes on Escape and on a press outside it, with a mouse at 1440 pixels and with touch at 390; focus goes back to its button, a second press on the button closes it once, and a closed menu ignores both.');
  checks.push('A track chosen with the keyboard closes the menu, shows on the button, and leaves focus on the button.');

  for (size of SIZES) await adminDialog();
  checks.push('The Admin access dialog opens with focus in its field; Tab and Shift+Tab go round inside it and never leave; Escape and the Close button return focus to the Admin button without scrolling the page.');

  for (size of SIZES) { await arenaByKeyboard(); await arenaByPointer(); await arenaReturn(); await arenaFromOverview(); }
  checks.push('Standing Start and Prepare Next Action by keyboard leave focus on the Choose a technique heading without scrolling to it, and one Tab reaches the first technique.');
  checks.push('Kneeling Start by mouse or touch leaves focus on the heading, not the page; Restart match keeps focus; coming back to the Arena during a match does not move focus.');
  checks.push('The Overview\'s Open Arena button, which starts a match and opens the Arena together, leaves focus on the heading.');

  const fonts = await fontLinks();
  for (size of SIZES) await fontsLoadOnce(fonts);
  checks.push('index.html preloads the three Barlow Condensed files of this build; on a first visit each is fetched exactly once and every face the home screen uses has loaded.');

  assert.deepEqual(errors, []);
  assert.deepEqual(consoleErrors, [], 'Unexpected browser console errors');
  assert.deepEqual(failedResponses, [], 'Every file the pages ask for must load');
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
