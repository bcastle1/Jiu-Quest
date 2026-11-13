// Verifies the technique kind of the pre-rendered Unreal clip stage in a real
// browser, before any technique clip is published. It builds two test bundles
// into tmp/ whose clip list is the real one plus fixture `double_leg` entries:
// published standing-stance files relabelled as a technique that plays once
// (no new video, and none of the held drafts). The bundles are never published.
//
//   both     clips for the fighter and the opponent: the technique switches over
//   fighter  clips for the fighter only: the technique must stay on Unity
//
// It checks Training (plays once, Replay, speeds, scrubber, camera, labels,
// reduced motion, phones), the fallbacks (another view, then the Unity stage;
// ?engine=unity; ?engine=snapshot) and the Arena (a player's and a rival's win,
// a second win starting from frame 0, the cut from the stance in the same box).
// Unity's build manifest answers 404 here, so a Unity stage shows without
// starting WebGL; this suite checks which stage shows, not Unity itself.
// Run after `node tools/build_release.mjs`: the files the bundles do not build
// (videos, posters, fonts, Unity) are served from dist/.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { chromium } from 'playwright';
import { build } from 'vite';
import { UNREAL_CLIPS, findUnrealClip } from '../src/unreal/techniqueClips.js';
import { CARD, MAT, checkArenaWin, checkTraining, checkTrainingPhone, checkTrainingReducedMotion, clipState, curriculumMove, playArena, techniqueStage, watchUnity } from './unreal_technique_checks.mjs';

const MOVE = 'double_leg';
const dist = resolve('dist');
const work = resolve('tmp/unreal-technique-clips');
const artifacts = resolve(process.env.JIUQUEST_BROWSER_ARTIFACTS || 'tmp/browser', 'unreal-technique-clips');
await mkdir(artifacts, { recursive: true });
const checks = [], images = [], errors = [], consoleErrors = [], expectedConsoleErrors = [], failedResponses = [], layouts = [], arena = {};
const browserOptions = { headless: true, args: ['--enable-unsafe-swiftshader'], ...(process.env.JIUQUEST_BROWSER_CHANNEL ? { channel: process.env.JIUQUEST_BROWSER_CHANNEL } : {}), ...(process.env.JIUQUEST_BROWSER_EXECUTABLE ? { executablePath: process.env.JIUQUEST_BROWSER_EXECUTABLE } : {}) };
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.wasm': 'application/wasm', '.data': 'application/octet-stream', '.glb': 'model/gltf-binary' };
const report = { startedAtUtc: new Date().toISOString(), status: 'running', scope: 'Fixture technique clips (relabelled stance files) in a test bundle, desktop Chromium with phone viewport emulation. No Unreal runtime, no WebGL.' };
const STORAGE_KEY = 'jiuquest:v1';
// A returning player who has learned the four techniques Unity animates today.
const PLAYER = { selectedFighterId: 'clipper', fighters: [{ id: 'clipper', name: 'Clipper', progress: { 'double-leg-takedown': 50, 'rear-naked-choke': 50, 'triangle-choke': 50, 'trap-roll-escape': 50 } }] };
// Math.random is replaced by this seeded generator in the Arena, so the run is repeatable.
const SEED = 20261113;
const TITLE = curriculumMove(MOVE).name;
let browser, server, page, bundle;

// The fixture: the standing stance's files for one performer, relabelled as the
// technique, playing once with its poster taken as frame 0.
function fixtureClips(performers) {
  return performers.flatMap((performerSide) => ['side', 'front'].map((camera) => {
    const source = findUnrealClip('standing_stance', performerSide, camera);
    assert.ok(source, `standing_stance/${performerSide}-${camera} is published`);
    const name = `${MOVE}/${performerSide}-${camera}`;
    return { ...source, moveId: MOVE, video: `/assets/unreal-clips/${name}.mp4`, poster: `/assets/unreal-clips/${name}.webp`, loops: false, posterFrame: 0 };
  }));
}

async function buildBundle(variant, fixtures) {
  const outDir = resolve(work, `dist-${variant}`);
  const data = `// Test bundle only: the real clip list, less any real ${MOVE} entries, plus fixture technique entries.\nexport default Object.freeze([\n${[...UNREAL_CLIPS.filter((clip) => clip.moveId !== MOVE), ...fixtures].map((clip) => `  Object.freeze(${JSON.stringify(clip)}),`).join('\n')}\n]);\n`;
  const target = resolve('src/unreal/techniqueClips.data.js').replace(/\\/g, '/').toLowerCase();
  let swapped = false;
  process.env.VITE_COMBAT_ENGINE = 'unity';
  await build({
    root: resolve('.'),
    logLevel: 'warn',
    plugins: [{ name: 'fixture-technique-clips', enforce: 'pre', load(id) {
      if (resolve(id.split('?')[0]).replace(/\\/g, '/').toLowerCase() !== target) return null;
      swapped = true;
      return data;
    } }],
    build: { outDir, emptyOutDir: true, copyPublicDir: false },
  });
  assert.equal(swapped, true, 'the clip list was replaced in the test bundle');
  const scripts = await readdir(resolve(outDir, 'assets'));
  const text = (await Promise.all(scripts.filter((file) => file.endsWith('.js')).map((file) => readFile(resolve(outDir, 'assets', file), 'utf8')))).join('\n');
  for (const clip of fixtures) assert.ok(text.includes(clip.video), `${clip.video} is in the ${variant} bundle`);
  return outDir;
}

// The bundle's own files first, then the release build. A fixture path is
// served from the stance file it relabels.
async function staticSite() {
  await stat(resolve(dist, 'index.html'));
  server = createServer(async (request, response) => {
    try {
      let pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      pathname = pathname.replace(new RegExp(`^/assets/unreal-clips/${MOVE}/`), '/assets/unreal-clips/standing_stance/');
      const relative = `.${pathname.endsWith('/') ? `${pathname}index.html` : pathname}`;
      for (const root of [bundle, dist]) {
        const file = resolve(root, relative);
        if (!file.startsWith(`${root}${sep}`)) { response.writeHead(403); response.end(); return; }
        const body = await readFile(file).catch(() => null);
        if (!body) continue;
        const headers = { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes' };
        // Byte ranges, as the real host serves them: a browser can only seek
        // in a video whose server answers them.
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
        return;
      }
      response.writeHead(404); response.end('Not found');
    } catch { response.writeHead(500); response.end(); }
  });
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  return `http://127.0.0.1:${server.address().port}`;
}

// `blocked` lists clip files this context cannot load; their errors are expected.
async function open(options = {}, { saved = null, seeded = false, blocked = [] } = {}) {
  const context = await browser.newContext({ deviceScaleFactor: 1, reducedMotion: 'no-preference', viewport: { width: 1440, height: 900 }, ...options });
  if (saved) await context.addInitScript(({ key, value }) => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem(key, value); } }, { key: STORAGE_KEY, value: JSON.stringify(saved) });
  if (seeded) await context.addInitScript((seed) => {
    let state = seed >>> 0;
    Math.random = () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let value = Math.imul(state ^ (state >>> 15), state | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }, SEED);
  page = await context.newPage();
  // A Unity stage shows, but Unity itself is not started.
  await page.route('**/unity/build-manifest.json', (route) => route.fulfill({ status: 404, body: 'Unity is not started by this suite' }));
  for (const file of blocked) await page.route(`**/assets/unreal-clips/${file}`, (route) => route.abort());
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const entry = { text: message.text(), location: message.location() };
    // Unity's missing manifest and the blocked clips are expected; anything else is not.
    const expected = /unity|build-manifest/i.test(`${entry.text} ${entry.location?.url ?? ''}`) || (blocked.length > 0 && /unreal-clips|ERR_FAILED|media/i.test(`${entry.text} ${entry.location?.url ?? ''}`));
    (expected ? expectedConsoleErrors : consoleErrors).push(entry);
  });
  page.on('response', (response) => {
    if (response.status() < 400) return;
    if (new URL(response.url()).pathname === '/unity/build-manifest.json') return;
    failedResponses.push({ url: response.url(), status: response.status() });
  });
  return context;
}

async function capture(name) {
  const file = resolve(artifacts, `${name}.png`);
  const data = await page.screenshot({ path: file });
  images.push({ name, path: file, bytes: data.length });
}

const openTraining = async (base, search = '') => {
  await page.goto(`${base}/${search}`);
  await page.getByRole('button', { name: 'Training', exact: true }).click();
  await page.locator('.training-sidebar').getByRole('button', { name: new RegExp(TITLE) }).first().click();
};

try {
  const both = fixtureClips(['fighter', 'opponent']);
  const fighterOnly = fixtureClips(['fighter']);
  const views = (clips, side) => clips.filter((clip) => clip.performerSide === side);
  const bundles = { both: await buildBundle('both', both), fighter: await buildBundle('fighter', fighterOnly) };
  checks.push('Two test bundles were built with VITE_COMBAT_ENGINE=unity: double_leg for both performers, and for the fighter only, relabelling published stance files.');
  bundle = bundles.both;
  const base = await staticSite();
  browser = await chromium.launch(browserOptions);
  report.browserVersion = browser.version();

  // ---- Training, desktop ----
  let context = await open();
  let unity = watchUnity(page);
  await checkTraining(page, { base, moveId: MOVE, views: views(both, 'fighter'), unity, capture, checks });
  await context.close();

  context = await open({ reducedMotion: 'reduce' });
  await checkTrainingReducedMotion(page, { base, moveId: MOVE, views: views(both, 'fighter'), checks });
  await context.close();

  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 640 }]) {
    context = await open({ viewport, isMobile: true, hasTouch: true });
    layouts.push(await checkTrainingPhone(page, { base, moveId: MOVE, viewport, capture }));
    await context.close();
  }
  checks.push('At 390 and 320 pixels the Training study stage fits without sideways scrolling and every button is at least 44 pixels tall.');

  // ---- Fallbacks ----
  context = await open({}, { blocked: [`${MOVE}/fighter-side.mp4`] });
  await openTraining(base);
  await page.locator(`${CARD} .unreal-clip-stage[data-kind="technique"][data-camera="front"]`).waitFor({ timeout: 15000 });
  await page.waitForFunction((selector) => { const video = document.querySelector(`${selector} .unreal-clip-stage video`); return video && !video.paused && video.currentTime > 0.03; }, CARD, { timeout: 30000 });
  assert.equal((await clipState(page, CARD)).path, `/assets/unreal-clips/${MOVE}/fighter-front.mp4`);
  await context.close();
  context = await open({}, { blocked: [`${MOVE}/fighter-side.mp4`, `${MOVE}/fighter-front.mp4`] });
  await openTraining(base);
  await page.locator(`${CARD} .unity-stage[data-engine="unity"]`).waitFor({ timeout: 15000 });
  assert.equal(await techniqueStage(page, CARD).count(), 0);
  await context.close();
  checks.push('A side view that cannot load gives way to the front view; when neither loads, Training shows the Unity stage.');

  context = await open();
  await openTraining(base, '?engine=unity');
  await page.locator(`${CARD} .unity-stage[data-engine="unity"]`).waitFor({ timeout: 15000 });
  assert.equal(await techniqueStage(page, CARD).count(), 0, '?engine=unity keeps Unity for the technique');
  assert.equal(await page.locator(`${CARD} .training-animation-head h3`).textContent(), 'Movement preview');
  await page.goto(`${base}/?engine=snapshot`);
  await page.getByRole('button', { name: 'Training', exact: true }).click();
  await page.locator('.training-sidebar').getByRole('button', { name: new RegExp(TITLE) }).first().click();
  await page.locator(`${CARD} .grappling-snapshot-stage`).waitFor({ timeout: 15000 });
  assert.equal(await techniqueStage(page, CARD).count(), 0, '?engine=snapshot turns technique clips off');
  assert.equal(await page.locator(`${CARD} .training-animation-head h3`).textContent(), 'Position reference');
  await context.close();
  checks.push('?engine=unity shows the Unity stage, and ?engine=snapshot shows the position picture under "Position reference".');

  // ---- Arena: both performers have clips ----
  context = await open({}, { saved: PLAYER, seeded: true });
  unity = watchUnity(page);
  arena.both = await playArena(page, {
    base, moveId: MOVE, unity,
    want: (seen) => seen.fighter >= 2 && seen.opponent >= 1,
    playerTries: (seen) => seen.fighter < 2,
    onWin: async (win) => {
      await checkArenaWin(page, { win, moveId: MOVE, views: { fighter: views(both, 'fighter'), opponent: views(both, 'opponent') }, unity, title: TITLE });
      if (win.count === 1) await capture(`arena-${win.performer}-wins`);
      checks.push(`Arena: ${win.headline} shows the ${win.performer === 'fighter' ? "player's" : "rival's"} clip from frame 0, labelled as theirs, with no Unity request${win.stanceBox ? ', in the stance\'s picture box' : ''}.`);
    },
  });
  await context.close();

  // ---- Arena: the fighter only has clips, so the technique stays on Unity ----
  bundle = bundles.fighter;
  context = await open({}, { saved: PLAYER, seeded: true });
  arena.fighterOnly = await playArena(page, {
    base, moveId: MOVE,
    want: (seen) => seen.fighter >= 1 && seen.opponent >= 1,
    playerTries: (seen) => seen.fighter < 1,
    onWin: async (win) => {
      await page.locator(`${MAT} .unity-stage[data-engine="unity"]`).waitFor({ timeout: 10000 });
      assert.equal(await page.locator(`${MAT} .unreal-clip-stage`).count(), 0, `${win.performer}: half a technique never plays as a clip`);
    },
  });
  await context.close();
  checks.push('With clips for the fighter only, both the player\'s and the rival\'s Double Leg Takedown wins play the Unity stage.');

  assert.deepEqual(errors, []);
  assert.deepEqual(consoleErrors, [], 'Unexpected browser console errors');
  assert.deepEqual(failedResponses, [], 'Every file must load');
  report.status = 'passed';
  console.log(JSON.stringify({ checks, layouts, arena, images: images.length, artifacts }, null, 2));
} catch (error) {
  report.status = 'failed'; report.failure = error.stack || String(error);
  if (page && !page.isClosed()) await page.screenshot({ path: resolve(artifacts, 'failure.png'), fullPage: true, timeout: 10000 }).catch(() => {});
  console.error(error); process.exitCode = 1;
} finally {
  Object.assign(report, { checkedAtUtc: new Date().toISOString(), checks, layouts, arena, images, pageErrors: errors, consoleErrors, expectedConsoleErrors, failedResponses });
  await writeFile(resolve(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  if (browser) await browser.close().catch(() => {});
  if (server) { server.closeAllConnections(); await new Promise((resolveClose) => server.close(resolveClose)); }
}
