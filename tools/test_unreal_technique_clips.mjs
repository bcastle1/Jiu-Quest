// Verifies the technique kind of the pre-rendered Unreal clip stage in a real
// browser, before any technique clip is published. It builds two test bundles
// into tmp/ whose clip list is the real one plus fixture entries for three
// techniques: published standing-stance files relabelled as a technique that
// plays once (no new video, and none of the held drafts). The bundles are never
// published. Unity animates `double_leg`. It does not animate
// `establish_clinch` (Establish the Clinch Control), which also starts standing
// and shows the position picture until it has clips, or `basic_tackle` (Mat
// Tackle), a white-belt starter that starts standing (its clip start) or
// kneeling.
//
//   both     clips for the fighter and the opponent: the techniques switch over
//   fighter  clips for the fighter only: the double leg must stay on Unity and
//            Establish the Clinch Control on the position picture
//
// For the double leg it checks Training (plays once, Replay, speeds, scrubber,
// camera, labels, reduced motion, phones), the fallbacks (another view, then the
// Unity stage, still under "Movement preview"; ?engine=unity; ?engine=snapshot)
// and the Arena (a player's and a rival's win, a second win starting from frame
// 0, the cut from the stance in the same box). For Establish the Clinch Control
// it checks the same Training stage under "Movement preview", the position
// picture under ?engine=snapshot and ?engine=unity, what Training shows when
// none of its views can play (exactly what the release build without technique
// clips shows: the position picture under "Position reference") and that the
// clip plays again once the technique is opened anew, and the player's and the
// rival's clip in the Arena. For the Mat Tackle it checks that the Arena plays
// the winner's clip after a standing start and the position picture after a
// kneeling start. It also measures every legend at 1440x900, 390x844 and
// 320x700: each colour dot sits beside its own text.
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
import { CARD, MAT, checkArenaWin, checkLegend, checkTraining, checkTrainingPhone, checkTrainingReducedMotion, clipState, curriculumMove, legendLines, openTrainingTechnique, playArena, techniqueStage, watchUnity } from './unreal_technique_checks.mjs';

const MOVE = 'double_leg';
// A technique Unity does not animate, which starts standing like the double leg.
const NO_UNITY = 'establish_clinch';
// A technique that starts in two positions the Arena has a start button for:
// standing, the first of its starts and so its clip start, and kneeling. Its
// clips play only after a standing start.
const TWO_STARTS = 'basic_tackle';
const FIXTURE_MOVES = [MOVE, NO_UNITY, TWO_STARTS];
const dist = resolve('dist');
const work = resolve('tmp/unreal-technique-clips');
const artifacts = resolve(process.env.JIUQUEST_BROWSER_ARTIFACTS || 'tmp/browser', 'unreal-technique-clips');
await mkdir(artifacts, { recursive: true });
const checks = [], images = [], errors = [], consoleErrors = [], expectedConsoleErrors = [], failedResponses = [], layouts = [], arena = {};
const browserOptions = { headless: true, args: ['--enable-unsafe-swiftshader'], ...(process.env.JIUQUEST_BROWSER_CHANNEL ? { channel: process.env.JIUQUEST_BROWSER_CHANNEL } : {}), ...(process.env.JIUQUEST_BROWSER_EXECUTABLE ? { executablePath: process.env.JIUQUEST_BROWSER_EXECUTABLE } : {}) };
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.wasm': 'application/wasm', '.data': 'application/octet-stream', '.glb': 'model/gltf-binary' };
const report = { startedAtUtc: new Date().toISOString(), status: 'running', scope: 'Fixture technique clips (relabelled stance files) in a test bundle, desktop Chromium with phone viewport emulation. No Unreal runtime, no WebGL.' };
const STORAGE_KEY = 'jiuquest:v1';
// A returning player who has learned the four techniques Unity animates today,
// and Establish the Clinch Control.
const PLAYER = { selectedFighterId: 'clipper', fighters: [{ id: 'clipper', name: 'Clipper', progress: { 'double-leg-takedown': 50, 'rear-naked-choke': 50, 'triangle-choke': 50, 'trap-roll-escape': 50, 'establish-clinch': 50 } }] };
// The same player, who has also learned the Mat Tackle, with the matches behind
// them that it takes to win with a white-belt starter now and then.
const TACKLER = { selectedFighterId: 'clipper', fighters: [{ ...PLAYER.fighters[0], matches: 1000, progress: { ...PLAYER.fighters[0].progress, 'basic-tackle': 50 } }] };
// Math.random is replaced by this seeded generator in the Arena, so the run is repeatable.
const SEED = 20261113;
const TITLE = curriculumMove(MOVE).name;
const NO_UNITY_TITLE = curriculumMove(NO_UNITY).name;
const TWO_STARTS_TITLE = curriculumMove(TWO_STARTS).name;
// The Arena's note over the position picture of an exchange no animation shows.
const NO_ANIMATION = 'This exchange has no matching successful Unity animation yet.';
// The sizes every legend is measured at.
const LEGEND_VIEWPORTS = [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 700 }];
let browser, server, page, bundle;

// The fixture: the standing stance's files for each performer given, relabelled
// as the technique, playing once with its poster taken as frame 0.
function fixtureClips(moveId, performers) {
  return performers.flatMap((performerSide) => ['side', 'front'].map((camera) => {
    const source = findUnrealClip('standing_stance', performerSide, camera);
    assert.ok(source, `standing_stance/${performerSide}-${camera} is published`);
    const name = `${moveId}/${performerSide}-${camera}`;
    return { ...source, moveId, video: `/assets/unreal-clips/${name}.mp4`, poster: `/assets/unreal-clips/${name}.webp`, loops: false, posterFrame: 0 };
  }));
}

async function buildBundle(variant, fixtures) {
  const outDir = resolve(work, `dist-${variant}`);
  const data = `// Test bundle only: the real clip list, less any real ${FIXTURE_MOVES.join(' or ')} entries, plus fixture technique entries.\nexport default Object.freeze([\n${[...UNREAL_CLIPS.filter((clip) => !FIXTURE_MOVES.includes(clip.moveId)), ...fixtures].map((clip) => `  Object.freeze(${JSON.stringify(clip)}),`).join('\n')}\n]);\n`;
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
      pathname = pathname.replace(new RegExp(`^/assets/unreal-clips/(${FIXTURE_MOVES.join('|')})/`), '/assets/unreal-clips/standing_stance/');
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

// Waits until the position picture under the Unity-unavailable note in `scope`
// has loaded (or given up), so its text has settled.
const settledPicture = (scope) => page.waitForFunction((selector) => ['ready', 'error'].includes(document.querySelector(`${selector} .unity-unavailable .grappling-snapshot-stage`)?.dataset.ready), scope, { timeout: 15000 });

// What Training's picture card shows: the heading, the line under it, all of
// its text, and which stages it holds.
const trainingCard = () => page.locator(CARD).evaluate((card) => ({
  heading: card.querySelector('.training-animation-head h3')?.textContent ?? null,
  line: card.querySelector('.training-animation-head p')?.textContent ?? null,
  text: card.innerText.replace(/\s+/g, ' ').trim(),
  clipStages: card.querySelectorAll('.unreal-clip-stage').length,
  unityStages: card.querySelectorAll('.unity-stage').length,
  unavailable: card.querySelectorAll('.unity-unavailable').length,
  pictures: card.querySelectorAll('.grappling-snapshot-stage').length,
}));

try {
  const both = FIXTURE_MOVES.flatMap((moveId) => fixtureClips(moveId, ['fighter', 'opponent']));
  const fighterOnly = FIXTURE_MOVES.flatMap((moveId) => fixtureClips(moveId, ['fighter']));
  const views = (clips, side, moveId = MOVE) => clips.filter((clip) => clip.performerSide === side && clip.moveId === moveId);
  const bundles = { both: await buildBundle('both', both), fighter: await buildBundle('fighter', fighterOnly) };
  checks.push(`Two test bundles were built with VITE_COMBAT_ENGINE=unity: ${FIXTURE_MOVES.join(' and ')} for both performers, and for the fighter only, relabelling published stance files.`);
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
  // The clip gave way to the Unity stage, which animates the double leg, so the
  // heading stays.
  assert.equal(await page.locator(`${CARD} .training-animation-head h3`).textContent(), 'Movement preview');
  await page.waitForTimeout(500);
  assert.equal(await page.locator(`${CARD} .training-animation-head h3`).textContent(), 'Movement preview', 'still, once the clip has given way');
  await context.close();
  checks.push('A side view that cannot load gives way to the front view; when neither loads, Training shows the Unity stage, still under "Movement preview".');

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

  // ---- Training: a technique Unity does not animate ----
  // On the release default its clips play, under "Movement preview", like the double leg's.
  context = await open();
  unity = watchUnity(page);
  await checkTraining(page, { base, moveId: NO_UNITY, views: views(both, 'fighter', NO_UNITY), unity, capture, checks });
  await context.close();
  // An explicit choice of position pictures or of Unity turns its clip off, and
  // Unity has no animation of it: the position picture shows.
  context = await open();
  for (const search of ['?engine=snapshot', '?engine=unity']) {
    await page.goto(`${base}/${search}`);
    await page.getByRole('button', { name: 'Training', exact: true }).click();
    await openTrainingTechnique(page, curriculumMove(NO_UNITY));
    await page.locator(`${CARD} .grappling-snapshot-stage`).waitFor({ timeout: 15000 });
    assert.equal(await techniqueStage(page, CARD).count(), 0, `${search} turns the ${NO_UNITY} clip off`);
    assert.equal(await page.locator(`${CARD} .unity-stage`).count(), 0, `Unity has no animation of ${NO_UNITY}`);
    assert.equal(await page.locator(`${CARD} .training-animation-head h3`).textContent(), 'Position reference', search);
  }
  await context.close();
  checks.push(`${NO_UNITY_TITLE}, which Unity does not animate, plays its clip in Training under "Movement preview" on the release default; ?engine=snapshot and ?engine=unity show the position picture under "Position reference".`);

  // When none of its views can play, its clip gives way to the stage's own
  // picture, and Training shows exactly what the release build without
  // technique clips shows for it: the position picture under "Position reference".
  bundle = dist;
  context = await open();
  await page.goto(`${base}/`);
  await page.getByRole('button', { name: 'Training', exact: true }).click();
  await openTrainingTechnique(page, curriculumMove(NO_UNITY));
  await settledPicture(CARD);
  const withoutClips = await trainingCard();
  await context.close();
  assert.deepEqual([withoutClips.heading, withoutClips.clipStages, withoutClips.unityStages, withoutClips.unavailable, withoutClips.pictures], ['Position reference', 0, 0, 1, 1], 'the release build shows the position picture');
  bundle = bundles.both;
  const noUnityFiles = ['fighter', 'opponent'].flatMap((side) => ['side', 'front'].map((camera) => `${NO_UNITY}/${side}-${camera}.mp4`));
  context = await open({}, { blocked: noUnityFiles });
  const clipRequests = [];
  page.on('request', (request) => { if (new URL(request.url()).pathname.startsWith(`/assets/unreal-clips/${NO_UNITY}/`) && request.url().endsWith('.mp4')) clipRequests.push(new URL(request.url()).pathname); });
  await page.goto(`${base}/`);
  await page.getByRole('button', { name: 'Training', exact: true }).click();
  await openTrainingTechnique(page, curriculumMove(NO_UNITY));
  await settledPicture(CARD);
  await page.waitForFunction((selector) => document.querySelector(`${selector} .training-animation-head h3`)?.textContent === 'Position reference', CARD, { timeout: 15000 });
  assert.deepEqual([...new Set(clipRequests)].sort(), [`/assets/unreal-clips/${NO_UNITY}/fighter-front.mp4`, `/assets/unreal-clips/${NO_UNITY}/fighter-side.mp4`], 'both of the player\'s views were tried');
  assert.deepEqual(await trainingCard(), withoutClips, 'the clip gave way to exactly what the release build shows');
  await page.waitForTimeout(1000);
  assert.deepEqual(await trainingCard(), withoutClips, 'and it stays so');
  await capture(`training-${NO_UNITY}-no-view-plays`);
  // With its files back, another technique and then this one again: the clip
  // is tried anew, plays, and the heading follows it.
  for (const file of noUnityFiles) await page.unroute(`**/assets/unreal-clips/${file}`);
  await openTrainingTechnique(page, curriculumMove(MOVE));
  await page.locator(`${CARD} .unreal-clip-stage[data-kind="technique"][data-move="${MOVE}"]`).waitFor({ timeout: 15000 });
  await openTrainingTechnique(page, curriculumMove(NO_UNITY));
  await page.locator(`${CARD} .unreal-clip-stage[data-kind="technique"][data-move="${NO_UNITY}"]`).waitFor({ timeout: 15000 });
  await page.waitForFunction((selector) => { const video = document.querySelector(`${selector} .unreal-clip-stage video`); return video && video.readyState >= 2 && !video.paused && video.currentTime > 0.03; }, CARD, { timeout: 30000 });
  assert.equal(await page.locator(`${CARD} .training-animation-head h3`).textContent(), 'Movement preview', 'opened anew, the clip plays under "Movement preview"');
  assert.equal(await page.locator(`${CARD} .unity-unavailable, ${CARD} .grappling-snapshot-stage, ${CARD} .unity-stage`).count(), 0, 'the clip is the only picture');
  assert.equal((await clipState(page, CARD)).path, `/assets/unreal-clips/${NO_UNITY}/fighter-side.mp4`);
  await context.close();
  checks.push(`When none of ${NO_UNITY_TITLE}'s views can play, Training shows exactly what the release build without technique clips shows (heading, line, text and stages): the position picture under "Position reference", with no clip stage and no Unity stage. With the files back, opening another technique and then ${NO_UNITY_TITLE} again plays its clip under "Movement preview".`);

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

  // The technique Unity does not animate: the player's win plays the fighter
  // clip and the rival's win the opponent clip.
  context = await open({}, { saved: PLAYER, seeded: true });
  unity = watchUnity(page);
  arena.noUnityBoth = await playArena(page, {
    base, moveId: NO_UNITY, unity,
    want: (seen) => seen.fighter >= 1 && seen.opponent >= 1,
    playerTries: (seen) => seen.fighter < 1,
    onWin: async (win) => {
      await checkArenaWin(page, { win, moveId: NO_UNITY, views: { fighter: views(both, 'fighter', NO_UNITY), opponent: views(both, 'opponent', NO_UNITY) }, unity, title: NO_UNITY_TITLE });
      if (win.count === 1) await capture(`arena-${NO_UNITY}-${win.performer}-wins`);
      checks.push(`Arena: ${win.headline} shows the ${win.performer === 'fighter' ? "player's" : "rival's"} ${NO_UNITY} clip from frame 0, labelled as theirs, with no Unity request${win.stanceBox ? ', in the stance\'s picture box' : ''}.`);
    },
  });
  await context.close();

  // ---- Arena: a technique that starts in two positions plays its clip only after its clip start ----
  // The Mat Tackle starts standing, the first of its starts and so the
  // position its clips are rendered from, and kneeling. The Arena starts a
  // match in either with a button of its own. The player chooses it until the
  // player has won with it once, then another technique, so the rival can win
  // with it too.
  const twoStartsViews = { fighter: views(both, 'fighter', TWO_STARTS), opponent: views(both, 'opponent', TWO_STARTS) };
  context = await open({}, { saved: TACKLER, seeded: true });
  unity = watchUnity(page);
  arena.twoStartsStanding = await playArena(page, {
    base, moveId: TWO_STARTS, unity, startAt: 'standing',
    want: (seen) => seen.fighter >= 1 && seen.opponent >= 1,
    playerTries: (seen) => seen.fighter < 1,
    onWin: async (win) => {
      await checkArenaWin(page, { win, moveId: TWO_STARTS, views: twoStartsViews, unity, title: TWO_STARTS_TITLE });
      if (win.count === 1) await capture(`arena-${TWO_STARTS}-standing-${win.performer}-wins`);
      checks.push(`Arena, Standing Start: ${win.headline} shows the ${win.performer === 'fighter' ? "player's" : "rival's"} ${TWO_STARTS} clip from frame 0, labelled as theirs, with no Unity request.`);
    },
  });
  await context.close();
  // After a kneeling start the same wins show what they show today: the
  // position picture under the Arena's note, and no clip is even requested.
  context = await open({}, { saved: TACKLER, seeded: true });
  unity = watchUnity(page);
  const twoStartsFiles = [];
  page.on('request', (request) => { if (new URL(request.url()).pathname.startsWith(`/assets/unreal-clips/${TWO_STARTS}/`)) twoStartsFiles.push(new URL(request.url()).pathname); });
  arena.twoStartsKneeling = await playArena(page, {
    base, moveId: TWO_STARTS, unity, startAt: 'kneeling',
    want: (seen) => seen.fighter >= 1 && seen.opponent >= 1,
    playerTries: (seen) => seen.fighter < 1,
    onWin: async (win) => {
      await page.locator(`${MAT} .unity-unavailable .grappling-snapshot-stage`).waitFor({ timeout: 10000 });
      await settledPicture(MAT);
      assert.equal(await page.locator(`${MAT} .unreal-clip-stage, ${MAT} .unity-stage`).count(), 0, `${win.headline}: after a kneeling start no clip plays`);
      assert.equal((await page.locator(`${MAT} .unity-unavailable > p`).textContent()).trim(), NO_ANIMATION, win.headline);
      await page.waitForTimeout(300);
      assert.deepEqual(twoStartsFiles, [], `${win.headline}: no ${TWO_STARTS} file is requested`);
      assert.deepEqual(unity.since(win.unityMark), [], `${win.headline}: no Unity file is requested`);
      if (win.count === 1) await capture(`arena-${TWO_STARTS}-kneeling-${win.performer}-wins`);
      checks.push(`Arena, Kneeling Start: ${win.headline} shows the position picture under "${NO_ANIMATION}", with no clip stage, no Unity stage and no ${TWO_STARTS} file requested.`);
    },
  });
  await context.close();

  // ---- Legends: each colour dot sits beside its own text ----
  // Measured in the page, at each size: the technique clip in Training, the
  // stance clip in the Arena, and the technique clip of a player's and of a
  // rival's Arena win.
  const legends = [];
  const measureLegend = async (where, scope) => { legends.push({ where, lines: checkLegend(await legendLines(page, scope), where) }); };
  for (const viewport of LEGEND_VIEWPORTS) {
    const size = `${viewport.width}x${viewport.height}`;
    const device = viewport.width < 600 ? { viewport, isMobile: true, hasTouch: true } : { viewport };
    context = await open(device);
    await page.goto(`${base}/`);
    await page.getByRole('button', { name: 'Training', exact: true }).click();
    await openTrainingTechnique(page, curriculumMove(MOVE));
    await page.locator(`${CARD} .unreal-clip-stage[data-kind="technique"][data-move="${MOVE}"]`).waitFor({ timeout: 15000 });
    await measureLegend(`Training ${size}, ${MOVE} clip`, CARD);
    await context.close();

    context = await open(device, { saved: PLAYER, seeded: true });
    await page.goto(`${base}/`);
    await page.getByRole('button', { name: 'Arena', exact: true }).click();
    await page.locator(`${MAT} .unreal-clip-stage[data-kind="stance"]`).waitFor({ timeout: 15000 });
    await measureLegend(`Arena ${size}, stance clip`, MAT);
    await playArena(page, {
      base, moveId: MOVE,
      want: (seen) => seen.fighter >= 1 && seen.opponent >= 1,
      playerTries: (seen) => seen.fighter < 1,
      onWin: async (win) => {
        if (win.count > 1) return;
        await page.locator(`${MAT} .unreal-clip-stage[data-kind="technique"][data-move="${MOVE}"][data-performer="${win.performer}"]`).waitFor({ timeout: 10000 });
        await measureLegend(`Arena ${size}, ${win.performer === 'fighter' ? "player's" : "rival's"} ${MOVE} win`, MAT);
      },
    });
    await context.close();
  }
  report.legends = legends;
  const wrapped = legends.flatMap((item) => item.lines.filter((line) => line.lines > 1).map((line) => `${item.where}: "${line.text}" (${line.lines} lines)`));
  assert.ok(wrapped.length > 0, 'at least one measured label wraps, so the check covers a wrapped label');
  checks.push(`Legends measured at ${LEGEND_VIEWPORTS.map((viewport) => `${viewport.width}x${viewport.height}`).join(', ')} (Training technique clip, Arena stance clip, Arena technique clip of a player's and a rival's win): every label starts at most 10px after its dot (largest ${Math.max(...legends.flatMap((item) => item.lines.map((line) => line.gap)))}px), level with it, and every wrapped line starts under the first. Wrapped labels: ${wrapped.join('; ')}.`);

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

  // ---- The fighter only has clips, so the technique Unity does not animate keeps the position picture ----
  context = await open();
  await page.goto(`${base}/`);
  await page.getByRole('button', { name: 'Training', exact: true }).click();
  await openTrainingTechnique(page, curriculumMove(NO_UNITY));
  await page.locator(`${CARD} .unity-unavailable .grappling-snapshot-stage`).waitFor({ timeout: 15000 });
  assert.equal(await page.locator(`${CARD} .unreal-clip-stage, ${CARD} .unity-stage`).count(), 0, 'half a technique never plays as a clip');
  assert.equal(await page.locator(`${CARD} .training-animation-head h3`).textContent(), 'Position reference');
  await context.close();
  context = await open({}, { saved: PLAYER, seeded: true });
  arena.noUnityFighterOnly = await playArena(page, {
    base, moveId: NO_UNITY,
    want: (seen) => seen.fighter >= 1 && seen.opponent >= 1,
    playerTries: (seen) => seen.fighter < 1,
    onWin: async (win) => {
      await page.locator(`${MAT} .unity-unavailable .grappling-snapshot-stage`).waitFor({ timeout: 10000 });
      assert.equal(await page.locator(`${MAT} .unreal-clip-stage, ${MAT} .unity-stage`).count(), 0, `${win.performer}: half a technique never plays as a clip`);
    },
  });
  await context.close();
  checks.push(`With clips for the fighter only, ${NO_UNITY_TITLE} shows the position picture: in Training under "Position reference", and for both the player's and the rival's wins in the Arena.`);

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
