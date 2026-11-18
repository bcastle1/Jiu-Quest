// Verifies the three match moments in a real browser: the greeting before a
// match that starts on the feet (match_greeting), and the end of a finished
// match (match_win, match_loss). Only the greeting's side view is published;
// the win and the loss are not.
//
// Against the release build (dist/), with the real greeting, at 1440x900 and
// 390x844, it checks that Standing Start plays the greeting once in the stance
// loop's place, with focus on the technique heading, and that the stance loop
// takes over from the greeting's last frame: that frame stays in the box until
// the loop's own first frame is on screen, it is the loop's first frame, and
// the loop's poster (a frame halfway through the loop) never shows in between,
// also when the loop's file is slow. It checks that Skip hands over to the
// loop at once, that reduced motion has no greeting (and that a start then
// leaves focus where it was, also on the stance loop's own control), that there
// is no greeting over any loop but the one it was rendered for (none over the
// front view of the standard loop, over the karate loop of the player's own
// stance, over the front views of the boxing and Muay Thai loops of the
// player's own stance, or over the sumo loop of the rival who holds sumo
// base) and none of its files is asked for there, that a Restart match
// which does not move focus from the stance loop's Pause button greets with
// focus on the technique heading, during the greeting and after it, and that
// a finished match has no "Match result" header, because neither end-of-match
// moment is published, and asks for none of their files.
//
// The rest runs in a test bundle built into tmp/ whose clip list is the real
// one, less the real match moment entries, plus fixture entries for the three
// moments: the published standing-stance files of the player's athlete,
// relabelled as clips that play once (no new video). The bundle is never
// published. With it, at 1440x900 and 390x844, it checks that the greeting
// plays once in the stance loop's picture box and hands over to the loop
// without moving anything, that a technique can be chosen while it plays, that
// a new stance, Skip, a kneeling start, leaving the Arena, a clip that cannot
// load and reduced motion each leave the stance loop showing, that there is no
// greeting over the karate loop while the bundle's front greeting plays over
// the front view of the standard loop, that a loop the player paused is still
// paused when it comes back (resting on the frame the greeting ended on), that
// its box shows the stance loop's still while its own files are on their way,
// that it gives way by itself when those files never arrive or stop part of the
// way through, and that a finished match offers "Match result" and "Final
// exchange": the moment plays once and holds with Replay, the final exchange is
// exactly what the release build shows, the toggle is a keyboard and touch
// control that never moves, the picture the player chose is still the one
// showing after a visit to Training, and reduced motion starts on the final
// exchange. One more pass at 320 pixels checks that the greeting and that
// header fit the narrowest phone.
// Unity's build manifest answers 404 here, so a Unity stage shows without
// starting WebGL. It checks video files played by the browser. It does not run
// Unreal or any stream.
// Run after `node tools/build_release.mjs`: the files the bundle does not build
// (videos, posters, fonts, pictures) are served from dist/.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { chromium } from 'playwright';
import { build } from 'vite';
import { defaultNpcs } from '../src/storage.js';
import { PASSING_MOMENT_PATIENCE } from '../src/unreal/clipPlayback.js';
import { MATCH_GREETING, MATCH_LOSS, MATCH_MOMENT_IDS, MATCH_MOMENT_TITLES, MATCH_WIN, isMatchMoment } from '../src/unreal/matchMoments.js';
import { DEFAULT_STANCE, stanceLoop } from '../src/unreal/stances.js';
import { UNREAL_CLIPS, findUnrealClip } from '../src/unreal/techniqueClips.js';
import { MATCH_MOMENT_CLIP } from './import_unreal_clips.mjs';
import { checkLegend, legendLines } from './unreal_technique_checks.mjs';

const dist = resolve('dist');
const work = resolve('tmp/match-moments');
const artifacts = resolve(process.env.JIUQUEST_BROWSER_ARTIFACTS || 'tmp/browser', 'match-moments');
await mkdir(artifacts, { recursive: true });
const checks = [], images = [], errors = [], consoleErrors = [], expectedConsoleErrors = [], failedResponses = [], layouts = [];
const browserOptions = { headless: true, args: ['--enable-unsafe-swiftshader'], ...(process.env.JIUQUEST_BROWSER_CHANNEL ? { channel: process.env.JIUQUEST_BROWSER_CHANNEL } : {}), ...(process.env.JIUQUEST_BROWSER_EXECUTABLE ? { executablePath: process.env.JIUQUEST_BROWSER_EXECUTABLE } : {}) };
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.wasm': 'application/wasm', '.data': 'application/octet-stream', '.glb': 'model/gltf-binary' };
const report = { startedAtUtc: new Date().toISOString(), status: 'running', scope: 'The release build with its published match greeting, and fixture match moment clips (relabelled stance files) in a test bundle, in desktop Chromium with phone viewport and touch emulation. No Unreal runtime, no WebGL, no physical device.' };
const STORAGE_KEY = 'jiuquest:v1';
const MAT = '.mat-window';
// A wide screen with a mouse, and a phone with touch.
const SIZES = [
  { name: 'desktop', touch: false, options: { viewport: { width: 1440, height: 900 } } },
  { name: 'phone', touch: true, options: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
];
// The narrowest phone, for one pass over the greeting and the header.
const NARROW = { name: 'phone-320', touch: true, options: { viewport: { width: 320, height: 700 }, isMobile: true, hasTouch: true } };
// A returning player who has learned the Guillotine choke and has the matches
// behind them. From a standing start the choke beats anything the first rival
// can answer with and ends the match by submission in the first exchange,
// whatever order its steps are in: the player always wins.
const WINNER = { selectedFighterId: 'clipper', fighters: [{ id: 'clipper', name: 'Clipper', matches: 1000, progress: { 'guillotine-choke': 50 } }] };
const WINNING_TECHNIQUE = 'Guillotine choke';
// A new player against the third rival loses every exchange with Protect Your
// Position, which is offered from every position: the player always loses, by
// submission or on points after eight rounds.
const STRONG_RIVAL = defaultNpcs[2];
const LOSING_TECHNIQUE = 'Protect Your Position';
// Math.random is replaced by this seeded generator, so a run repeats and the
// test bundle and the release build play the same match.
const SEED = 20261115;
// The stance loop the Arena opens on for a new fighter against the first rival.
const IDLE = stanceLoop(DEFAULT_STANCE, defaultNpcs[0].stance);
const IDLE_CLIP = findUnrealClip(IDLE.moveId, IDLE.performerSide);
const FIXTURE_SECONDS = IDLE_CLIP.frames / IDLE_CLIP.fps;
// The greeting the release build plays: the published side view.
const GREETING = findUnrealClip(MATCH_GREETING, 'fighter', 'side');
const GREETING_SECONDS = GREETING ? GREETING.frames / GREETING.fps : 0;
// How much later than its time limit a greeting may be seen to give way: the
// limit is a timer in the page, and a busy machine runs it late, never early.
const LATE = 3000;
let browser, server, page, size, bundle, base, bundles = {}, fixtures = [], momentRequests = [];
// A check can make the server stop part of the way through one file: only the
// bytes before `bytes` of the file asked for as `path` are ever sent, and the
// response is left open, like a connection that hangs without failing.
let stall = null;

// The fixture: the standing stance's files of the player's athlete, relabelled
// as a match moment that plays once.
function fixtureClips(moveId) {
  return ['side', 'front'].map((camera) => {
    const source = findUnrealClip('standing_stance', 'fighter', camera);
    assert.ok(source, `standing_stance/fighter-${camera} is published`);
    assert.ok(source.frames >= MATCH_MOMENT_CLIP.minFrames && source.frames <= MATCH_MOMENT_CLIP.maxFrames, 'the fixture is as long as a moment may be');
    const name = `${moveId}/fighter-${camera}`;
    return { ...source, moveId, video: `/assets/unreal-clips/${name}.mp4`, poster: `/assets/unreal-clips/${name}.webp`, loops: false, posterFrame: 0 };
  });
}

async function buildBundle(variant, clips) {
  const outDir = resolve(work, `dist-${variant}`);
  const data = `// Test bundle only: the real clip list, less any real match moment entries, plus fixture entries for ${MATCH_MOMENT_IDS.join(', ')}.\nexport default Object.freeze([\n${[...UNREAL_CLIPS.filter((clip) => !MATCH_MOMENT_IDS.includes(clip.moveId)), ...clips].map((clip) => `  Object.freeze(${JSON.stringify(clip)}),`).join('\n')}\n]);\n`;
  const target = resolve('src/unreal/techniqueClips.data.js').replace(/\\/g, '/').toLowerCase();
  let swapped = false;
  process.env.VITE_COMBAT_ENGINE = 'unity';
  await build({
    root: resolve('.'),
    logLevel: 'warn',
    plugins: [{ name: 'fixture-match-moments', enforce: 'pre', load(id) {
      if (resolve(id.split('?')[0]).replace(/\\/g, '/').toLowerCase() !== target) return null;
      swapped = true;
      return data;
    } }],
    build: { outDir, emptyOutDir: true, copyPublicDir: false },
  });
  assert.equal(swapped, true, 'the clip list was replaced in the test bundle');
  const scripts = await readdir(resolve(outDir, 'assets'));
  const text = (await Promise.all(scripts.filter((file) => file.endsWith('.js')).map((file) => readFile(resolve(outDir, 'assets', file), 'utf8')))).join('\n');
  for (const clip of clips) assert.ok(text.includes(clip.video), `${clip.video} is in the ${variant} bundle`);
  return outDir;
}

// Sends the bytes of a response and ends it. For the one file a check has
// asked to stall, it sends only the bytes before the stalling point (`offset`
// is where these bytes start in the file) and leaves the response open.
function send(response, bytes, offset, asked) {
  if (stall?.path !== asked) { response.end(bytes); return; }
  stall.responses += 1;
  if (offset < stall.bytes) response.write(bytes.subarray(0, stall.bytes - offset));
}

// The bundle's own files first, then the release build. In the test bundle a
// fixture path is served from the stance file it relabels; the release build
// gets its own files, the real greeting among them.
async function staticSite() {
  await stat(resolve(dist, 'index.html'));
  server = createServer(async (request, response) => {
    try {
      const asked = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const pathname = bundle === dist ? asked : asked.replace(new RegExp(`^/assets/unreal-clips/(${MATCH_MOMENT_IDS.join('|')})/`), '/assets/unreal-clips/standing_stance/');
      const relative = `.${pathname.endsWith('/') ? `${pathname}index.html` : pathname}`;
      for (const root of [...new Set([bundle, dist])]) {
        const file = resolve(root, relative);
        if (!file.startsWith(`${root}${sep}`)) { response.writeHead(403); response.end(); return; }
        const body = await readFile(file).catch(() => null);
        if (!body) continue;
        const headers = { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes' };
        // Byte ranges, as the real host serves them.
        const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? '');
        if (range && (range[1] || range[2])) {
          const start = range[1] ? Number(range[1]) : Math.max(0, body.length - Number(range[2]));
          const end = range[1] && range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
          if (start > end || start >= body.length) { response.writeHead(416, { 'Content-Range': `bytes */${body.length}` }); response.end(); return; }
          response.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${body.length}`, 'Content-Length': end - start + 1 });
          send(response, body.subarray(start, end + 1), start, asked);
          return;
        }
        response.writeHead(200, { ...headers, 'Content-Length': body.length });
        send(response, body, 0, asked);
        return;
      }
      response.writeHead(404); response.end('Not found');
    } catch { response.writeHead(500); response.end(); }
  });
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  return `http://127.0.0.1:${server.address().port}`;
}

// What the page writes down as it goes, so a check never has to catch a
// moment in the act: each change of the stage in the mat window, each video
// that starts, ends or fails, each layout shift nobody pressed anything for,
// and every time a finished match was on screen without its toggle. A check
// that wants to look at a greeting sets `hold` first: the page then stops the
// next match moment's picture the moment it starts playing (see greetingHeld).
// Each time a video runs out of data is written down apart, in `waits`.
// A check that wants to look at a greeting whose files are slow sets
// `holdTimers` first: a timer as long as one of the greeting's time limits
// (`limits`, in milliseconds) that the page starts is then kept back, and
// starts counting only when the check lets go (window.__releaseTimers), so the
// limit cannot run out while the check is still looking. Every other timer,
// and every timer while `holdTimers` is off, runs as it always does.
// Each stance loop's <video> gets an entry in `loops`: its file, whether the
// greeting's last frame (the canvas .unreal-clip-handover) lay over it when it
// was put on the page, every painted frame until the browser presented a frame
// of the video's own (with whether the still covered it then), that first
// presented frame, and when the still went. A check that wants to look at that
// first frame sets `pauseLoopOnFirstFrame`: the loop is then paused on it.
function watchPage({ limits }) {
  window.__moments = { stages: [], videos: [], transport: [], waits: [], shifts: [], loops: [], finishedWithoutToggle: 0, hold: false, held: 0, holdTimers: false, timersKept: 0, pauseLoopOnFirstFrame: false };
  const log = window.__moments;
  const at = () => Math.round(performance.now());
  const loopVideos = new Map();
  let shownStill = null;
  const lookAtLoops = () => {
    const stage = document.querySelector('.mat-window .unreal-clip-stage[data-kind="stance"]');
    const video = stage?.querySelector('video');
    const still = stage?.querySelector('.unreal-clip-handover') ?? null;
    if (video && !loopVideos.has(video)) {
      const entry = { path: new URL(video.getAttribute('src'), location.href).pathname, poster: video.getAttribute('poster'), born: at(), stillAtBirth: Boolean(still), frames: [], firstFrame: null, stillGone: null };
      loopVideos.set(video, entry);
      log.loops.push(entry);
      video.requestVideoFrameCallback?.((now, meta) => {
        entry.firstFrame = { at: Math.round(now), mediaTime: meta.mediaTime, presentedFrames: meta.presentedFrames };
        if (log.pauseLoopOnFirstFrame) { log.pauseLoopOnFirstFrame = false; video.pause(); }
      });
    }
    if (shownStill && !shownStill.still.isConnected && shownStill.entry.stillGone === null) shownStill.entry.stillGone = at();
    if (still && video) shownStill = { still, entry: loopVideos.get(video) };
  };
  new MutationObserver(lookAtLoops).observe(document, { childList: true, subtree: true });
  const paintedFrame = (now) => {
    lookAtLoops();
    const stage = document.querySelector('.mat-window .unreal-clip-stage[data-kind="stance"]');
    const entry = loopVideos.get(stage?.querySelector('video'));
    if (entry && entry.firstFrame === null && entry.frames.length < 600) entry.frames.push({ at: Math.round(now), still: Boolean(stage.querySelector('.unreal-clip-handover')) });
    requestAnimationFrame(paintedFrame);
  };
  requestAnimationFrame(paintedFrame);
  const [startTimer, stopTimer] = [window.setTimeout.bind(window), window.clearTimeout.bind(window)];
  const kept = new Map();
  let keptIds = 0;
  const run = (id) => { const timer = kept.get(id); timer.started = startTimer(() => { kept.delete(id); timer.handler(...timer.rest); }, timer.delay); };
  window.setTimeout = (handler, delay, ...rest) => {
    if (!log.holdTimers || !limits.includes(delay)) return startTimer(handler, delay, ...rest);
    // A kept timer goes by a number no real timer has.
    keptIds -= 1;
    kept.set(keptIds, { handler, delay, rest, started: null });
    log.timersKept += 1;
    return keptIds;
  };
  window.clearTimeout = (id) => {
    const timer = kept.get(id);
    if (!timer) { stopTimer(id); return; }
    kept.delete(id);
    if (timer.started !== null) stopTimer(timer.started);
  };
  window.__releaseTimers = () => {
    log.holdTimers = false;
    for (const [id, timer] of kept) if (timer.started === null) run(id);
  };
  let last = null;
  const look = () => {
    const mat = document.querySelector('.mat-window');
    if (!mat) return;
    const stage = mat.querySelector('.unreal-clip-stage');
    const now = stage ? `${stage.dataset.kind}:${stage.dataset.move}` : 'other';
    if (now !== last) { last = now; log.stages.push({ at: at(), stage: now }); }
    if (window.__expectToggle && document.querySelector('.arena-outcome[data-finished="true"]') && !mat.querySelector('.mat-view-toggle')) log.finishedWithoutToggle += 1;
  };
  new MutationObserver(look).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-kind', 'data-move', 'data-finished'] });
  // `playing` can fire again after buffering without a new playback. Keep
  // actual play sessions and progress separately, including element identity,
  // so a once-only check can still detect a replay, rewind or replaced video.
  const videoIds = new WeakMap();
  let nextVideoId = 0;
  for (const type of ['play', 'ended', 'seeking', 'timeupdate', 'error']) {
    document.addEventListener(type, (event) => {
      const video = event.target;
      if (!(video instanceof HTMLVideoElement)) return;
      if (!videoIds.has(video)) videoIds.set(video, ++nextVideoId);
      log.transport.push({ at: at(), type, element: videoIds.get(video), path: new URL(video.currentSrc || video.src, location.href).pathname, time: video.currentTime });
    }, true);
  }
  for (const type of ['playing', 'ended', 'error']) {
    document.addEventListener(type, (event) => {
      const video = event.target;
      if (!(video instanceof HTMLVideoElement)) return;
      log.videos.push({ at: at(), type, path: new URL(video.currentSrc || video.src, location.href).pathname, loop: video.loop, muted: video.muted, time: Number(video.currentTime.toFixed(3)) });
      if (type === 'playing' && log.hold && video.closest('.unreal-clip-stage[data-kind="moment"]')) {
        log.hold = false;
        log.held += 1;
        video.pause();
      }
    }, true);
  }
  document.addEventListener('waiting', (event) => {
    const video = event.target;
    if (video instanceof HTMLVideoElement) log.waits.push({ at: at(), path: new URL(video.currentSrc || video.src, location.href).pathname, time: Number(video.currentTime.toFixed(3)) });
  }, true);
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) if (!entry.hadRecentInput && entry.value > 0) log.shifts.push({ at: Math.round(entry.startTime), value: Number(entry.value.toFixed(5)) });
    }).observe({ type: 'layout-shift', buffered: true });
    log.shiftsWatched = true;
  } catch { log.shiftsWatched = false; }
}

// `saved` is a player to start from; `blocked` lists clip files this context
// cannot load (their errors are expected); `release` serves the release build
// alone, with no fixture.
async function open({ saved = null, blocked = [], reducedMotion = 'no-preference', release = false } = {}) {
  bundle = release ? dist : bundles.moments;
  const context = await browser.newContext({ deviceScaleFactor: 1, reducedMotion, ...size.options });
  if (saved) await context.addInitScript(({ key, value }) => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem(key, value); } }, { key: STORAGE_KEY, value: JSON.stringify(saved) });
  await context.addInitScript((seed) => {
    let state = seed >>> 0;
    Math.random = () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let value = Math.imul(state ^ (state >>> 15), state | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }, SEED);
  await context.addInitScript(watchPage, { limits: Object.values(PASSING_MOMENT_PATIENCE) });
  page = await context.newPage();
  // A Unity stage shows, but Unity itself is not started.
  await page.route('**/unity/build-manifest.json', (route) => route.fulfill({ status: 404, body: 'Unity is not started by this suite' }));
  for (const file of blocked) await page.route(`**/assets/unreal-clips/${file}`, (route) => route.abort());
  const asked = momentRequests = [];
  page.on('request', (request) => { const { pathname } = new URL(request.url()); if (pathname.startsWith('/assets/unreal-clips/match_')) asked.push(pathname); });
  page.on('dialog', (dialog) => dialog.accept());
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const entry = { text: message.text(), location: message.location() };
    // Unity's missing manifest and the blocked clips are expected; anything else is not.
    const where = `${entry.text} ${entry.location?.url ?? ''}`;
    const expected = /unity|build-manifest/i.test(where) || (blocked.length > 0 && /unreal-clips|ERR_FAILED|media/i.test(where));
    (expected ? expectedConsoleErrors : consoleErrors).push(entry);
  });
  page.on('response', (response) => {
    if (response.status() < 400 || new URL(response.url()).pathname === '/unity/build-manifest.json') return;
    failedResponses.push({ url: response.url(), status: response.status() });
  });
  return context;
}

// `atRest` waits first: a position picture just asked for is still fading in,
// and a tapped button still shows the browser's own tap highlight. The picture
// then shows the screen as it stays.
async function capture(name, { atRest = false } = {}) {
  if (atRest) await page.waitForTimeout(1200);
  const file = resolve(artifacts, `${size.name}-${name}.png`);
  const data = await page.screenshot({ path: file });
  images.push({ name: `${size.name}-${name}`, path: file, bytes: data.length });
}

// A real press with the pointer this screen has: a mouse click or a touch tap.
const press = (locator) => (size.touch ? locator.tap() : locator.click());
const button = (name) => page.getByRole('button', { name, exact: true });
const navButton = (name) => page.getByRole('navigation', { name: 'Main', exact: true }).getByRole('button', { name, exact: true });
const restartButton = () => page.locator('.arena-page-heading').getByRole('button', { name: 'Restart match' });
const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const log = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__moments)));
// A buffer resume is not another play session. An intentional test pause can
// add one session, but no once-only check permits a seek, rewind or remount.
function checkPlaySession(seen, path, { plays = 1, ends = 1 } = {}) {
  const events = seen.transport.filter((entry) => entry.path === path);
  assert.equal(events.filter((entry) => entry.type === 'play').length, plays, `${path}: expected play sessions`);
  assert.equal(events.filter((entry) => entry.type === 'ended').length, ends, `${path}: expected completed passes`);
  assert.equal(new Set(events.map((entry) => entry.element)).size, 1, `${path}: kept the same video element`);
  assert.equal(events.filter((entry) => ['seeking', 'error'].includes(entry.type)).length, 0, `${path}: did not seek, rewind or fail`);
  for (let index = 1; index < events.length; index += 1) {
    assert.ok(events[index].time >= events[index - 1].time, `${path}: did not reset progress`);
  }
  return events;
}
const stages = async () => (await log()).stages.map((entry) => entry.stage);
const stanceStage = () => page.locator(`${MAT} .unreal-clip-stage[data-kind="stance"]`);
const momentStage = (id) => page.locator(`${MAT} .unreal-clip-stage[data-kind="moment"]${id ? `[data-move="${id}"]` : ''}`);
const MOMENT_VIDEO = `${MAT} .unreal-clip-stage[data-kind="moment"] video`;
const toggle = () => page.locator(`${MAT} .mat-view-toggle`);
const techniquePanel = () => page.locator('aside[aria-label="Technique selection"]');
const firstTechnique = () => techniquePanel().locator('.combat-moves button:not([disabled])').first();
const technique = (name) => techniquePanel().locator('.combat-moves .combat-group').first().locator('button').filter({ has: page.locator('span', { hasText: new RegExp(`^${name}$`) }) });
const hint = (text) => techniquePanel().locator('.section-heading p').filter({ hasText: text }).waitFor();
const texts = async (locator) => (await locator.allInnerTexts()).map((text) => text.replace(/\s+/g, ' ').trim());
// Two painted frames: everything the last press set off has been drawn.
const painted = () => page.evaluate(() => new Promise((done) => { requestAnimationFrame(() => requestAnimationFrame(done)); }));
// A box in page coordinates, so scrolling does not move it.
const pageBox = (locator) => locator.evaluate((element) => { const rect = element.getBoundingClientRect(); return { x: Math.round(rect.x + window.scrollX), y: Math.round(rect.y + window.scrollY), width: Math.round(rect.width), height: Math.round(rect.height) }; });
const sameBox = (left, right) => ['x', 'y', 'width', 'height'].every((key) => Math.abs(left[key] - right[key]) <= 1);
const onHeading = () => page.evaluate(() => document.activeElement?.matches('aside[aria-label="Technique selection"] .section-heading') === true);

// What the one <video> in the mat window is doing.
const video = () => page.locator(`${MAT} .unreal-clip-stage video`).evaluate((element) => ({
  path: new URL(element.currentSrc || element.src).pathname, poster: new URL(element.poster, location.href).pathname,
  paused: element.paused, ended: element.ended, time: element.currentTime, duration: element.duration, ready: element.readyState,
  loop: element.loop, muted: element.muted, inline: element.playsInline, controls: element.controls, mark: element.dataset.mark ?? null,
}));
// Waits until the page sees a clip playing, and gives the moment of the clip
// (in seconds) at which the page saw it.
const untilPlaying = async (kind, path) => (await page.waitForFunction(({ selector, wanted }) => {
  const element = document.querySelector(selector);
  return Boolean(element) && new URL(element.currentSrc || element.src).pathname === wanted && element.readyState >= 2 && !element.paused && element.currentTime > 0.05 && element.currentTime;
}, { selector: `${MAT} .unreal-clip-stage[data-kind="${kind}"] video`, wanted: path }, { timeout: 30000 })).jsonValue();
const untilEnded = () => page.waitForFunction((selector) => document.querySelector(selector)?.ended === true, MOMENT_VIDEO, { timeout: 30000 + FIXTURE_SECONDS * 1000 });

async function openArena(search = '') {
  await page.goto(`${base}/${search}`);
  await press(navButton('Arena'));
  await stanceStage().waitFor();
  await untilPlaying('stance', IDLE_CLIP.video);
}

// The fixture greeting is under two seconds long: too short to be looked at
// from out here on a slow machine. A check that wants to look at a greeting
// asks the page first (holdNextGreeting), before the press that starts it. The
// page then stops the greeting's picture the moment it starts playing, and
// greetingHeld waits for that, so what follows is measured against a greeting
// that is still on screen however slow the machine is. The stage is not told.
// The greeting waits only so long for its first moving frame. That time limit
// is kept back with the greeting (see watchPage), so a machine that is slow to
// start a video still shows it, and greetingHeld lets the limit go once the
// greeting has started. The limit itself is checked where nothing is kept
// back: greetingFilesNeverArrive and greetingStalls.
const holdNextGreeting = () => page.evaluate(() => { window.__moments.hold = true; window.__moments.holdTimers = true; });
// The greeting's time limits are timers in the page. A check that looks at a
// greeting before it has started keeps them back first (see watchPage) and
// lets them go when it has looked.
const holdTimeLimits = () => page.evaluate(() => { window.__moments.holdTimers = true; });
const releaseTimeLimits = () => page.evaluate(() => { window.__releaseTimers(); });
// `camera` is the view the greeting is expected to open on.
async function greetingHeld(camera = 'side') {
  const greeting = fixtures.find((item) => item.moveId === MATCH_GREETING && item.camera === camera);
  await momentStage(MATCH_GREETING).waitFor();
  await page.waitForFunction(({ selector, wanted }) => {
    const element = document.querySelector(selector);
    return window.__moments.hold === false && window.__moments.held > 0 && Boolean(element) && new URL(element.currentSrc || element.src).pathname === wanted && element.readyState >= 2 && element.paused && !element.ended;
  }, { selector: MOMENT_VIDEO, wanted: greeting.video }, { timeout: 30000 });
  await releaseTimeLimits();
  return greeting;
}
const greetingResumed = () => page.locator(MOMENT_VIDEO).evaluate((element) => { element.play(); });
// The still behind a greeting's picture: the path of its background image.
const stillBehind = () => momentStage().locator('.unreal-clip-viewport').evaluate((element) => {
  const url = /^url\("(.+)"\)$/.exec(getComputedStyle(element).backgroundImage)?.[1];
  return url ? new URL(url).pathname : null;
});
// Waits until the greeting has come and gone by itself, and gives what the page wrote down.
async function greetingCameAndWent() {
  await page.waitForFunction((moment) => {
    const seen = window.__moments.stages.map((entry) => entry.stage);
    return seen.includes(moment) && seen.at(-1) !== moment;
  }, `moment:${MATCH_GREETING}`, { timeout: 30000 });
  await untilPlaying('stance', IDLE_CLIP.video);
  return log();
}

// Everything the stance loop's stage takes up, and its picture.
const stanceBoxes = async () => ({ stage: await pageBox(stanceStage()), picture: await pageBox(stanceStage().locator('.unreal-clip-viewport')) });
const momentBoxes = async (id) => ({ stage: await pageBox(momentStage(id)), picture: await pageBox(momentStage(id).locator('.unreal-clip-viewport')) });

// The words and the picture of a moment's stage.
async function checkMomentStage(id, { held }) {
  const stage = momentStage(id);
  const clip = fixtures.find((item) => item.moveId === id && item.camera === 'side');
  const title = MATCH_MOMENT_TITLES[id];
  const [fighterName, opponentName] = await page.locator('.arena-top .fighter-card strong').allTextContents();
  assert.deepEqual([await stage.getAttribute('aria-label'), await stage.getAttribute('data-camera'), await stage.getAttribute('data-held')], [`${title}, Unreal Engine clip`, 'side', held ? 'true' : 'false']);
  assert.deepEqual(await stage.locator('.unreal-clip-heading > *').allTextContents(), ['Unreal Engine', title]);
  assert.equal(await stage.locator('video').getAttribute('aria-label'), `${title}. ${fighterName} in the white gi and ${opponentName} in the navy gi, seen from the side.`);
  const legend = await stage.locator('.unreal-clip-legend').innerText();
  assert.ok(legend.includes(`${fighterName} (you): white gi`) && legend.includes(`${opponentName}: navy gi`) && legend.includes('Athletes and colors are fixed in this clip.'), legend);
  checkLegend(await legendLines(page, MAT), `${size.name} ${id}`);
  const state = await video();
  assert.deepEqual([state.path, state.poster, state.loop, state.muted, state.inline, state.controls], [clip.video, clip.poster, false, true, true, false], `${id} is silent, inline and never loops`);
  // Behind the greeting's video is the still of the stance loop it took the
  // place of, trimmed as the video is. The end of a match has none.
  const still = await stage.locator('.unreal-clip-viewport').evaluate((element) => {
    const style = getComputedStyle(element);
    const url = /^url\("(.+)"\)$/.exec(style.backgroundImage)?.[1];
    return { path: url ? new URL(url).pathname : null, size: style.backgroundSize, position: style.backgroundPosition, video: getComputedStyle(element.querySelector('video')).objectPosition };
  });
  assert.deepEqual([still.path, still.size, still.position, still.video], [held ? null : IDLE_CLIP.poster, 'cover', '50% 70%', '50% 70%'], `${id}: the still behind the picture`);
  assert.equal(await page.locator(`${MAT} .unreal-clip-stage`).count(), 1, 'one stage in the mat window');
  assert.equal(await page.locator(`${MAT} .unity-stage, ${MAT} .unity-unavailable, ${MAT} .grappling-snapshot-stage`).count(), 0, 'the moment is the only picture');
  return state;
}

// ---- The greeting ----

async function greetingPlaysOnce() {
  const context = await open();
  await openArena();
  assert.deepEqual(await stages(), [`stance:${IDLE.moveId}`], 'before a match starts the Arena shows the stance loop and no greeting');
  assert.deepEqual(momentRequests, [], 'no match moment file is asked for before a match starts');
  const before = await stanceBoxes();
  const standing = button('Standing Start');
  await holdNextGreeting();
  if (size.touch) await standing.tap(); else { await standing.focus(); await page.keyboard.press('Enter'); }
  const greeting = await greetingHeld();
  await hint('Select your response from standing.');
  // Focus is where a start always put it, and the first technique is one Tab away.
  assert.equal(await onHeading(), true, 'Standing Start leaves focus on the technique heading while the greeting plays');
  assert.equal(await techniquePanel().locator('.combat-moves button:not([disabled])').count() > 0, true, 'techniques can be chosen while the greeting plays');
  if (!size.touch) {
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('aside[aria-label="Technique selection"] .combat-moves button:not([disabled])')), true, 'one Tab reaches the first technique');
  }
  await checkMomentStage(MATCH_GREETING, { held: false });
  assert.deepEqual(await texts(momentStage().getByRole('button')), ['Skip'], 'the greeting has one control');
  assert.ok((await momentStage().getByRole('button').boundingBox()).height >= 44, 'Skip is easy to tap');
  // It plays in the stance loop's place: the same stage box and the same picture box.
  const during = await momentBoxes(MATCH_GREETING);
  assert.ok(sameBox(before.stage, during.stage) && sameBox(before.picture, during.picture), `the greeting takes exactly the stance loop's place (${JSON.stringify({ before, during })})`);
  assert.equal(await fits(), true, 'nothing scrolls sideways');
  await momentStage().scrollIntoViewIfNeeded();
  await capture('greeting');
  await greetingResumed();

  // It ends by itself and the loop takes over, in the same boxes.
  await momentStage().waitFor({ state: 'detached', timeout: 30000 });
  await untilPlaying('stance', IDLE_CLIP.video);
  const after = await stanceBoxes();
  assert.ok(sameBox(before.stage, after.stage) && sameBox(before.picture, after.picture), `the stance loop comes back where it was (${JSON.stringify({ before, after })})`);
  assert.deepEqual([(await video()).loop, await stanceStage().getAttribute('data-move')], [true, IDLE.moveId]);
  if (!size.touch) assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest('aside[aria-label="Technique selection"]'))), true, 'focus is still in the technique panel');
  // Once: it does not come back.
  await page.waitForTimeout(Math.ceil(FIXTURE_SECONDS * 1000) + 700);
  const seen = await log();
  assert.deepEqual(seen.stages.map((entry) => entry.stage), [`stance:${IDLE.moveId}`, `moment:${MATCH_GREETING}`, `stance:${IDLE.moveId}`], 'stance loop, greeting, stance loop');
  const played = seen.videos.filter((entry) => entry.path === greeting.video);
  // It starts by itself, this test pauses/resumes it once, then it ends once.
  checkPlaySession(seen, greeting.video, { plays: 2 });
  assert.ok(played.every((entry) => entry.loop === false && entry.muted === true));
  const ended = played.find((entry) => entry.type === 'ended');
  assert.ok(ended.time >= FIXTURE_SECONDS - 0.2, `it played to its end (${ended.time} of ${FIXTURE_SECONDS} seconds)`);
  const handOver = seen.stages[2].at - ended.at;
  assert.ok(handOver >= 0 && handOver < 500, `the loop takes over as the greeting ends (${handOver} ms)`);
  // It ended on the side view of the standard loop it took the place of, so it handed its last
  // frame to the loop, which kept it until a frame of its own was on screen.
  const loop = checkHandover(seen);
  // How long this machine took to start the greeting's picture. The greeting gives way if
  // that takes longer than its time limit, which this check kept back (see holdNextGreeting).
  const startedAfter = played[0].at - seen.stages[1].at;
  // Nothing on the page moved when the loop took over, which nobody pressed anything for.
  assert.equal(seen.shiftsWatched, true, 'this browser reports layout shifts');
  assert.deepEqual(seen.shifts.filter((shift) => shift.at >= seen.stages[1].at - 50), [], 'no layout shift from the start of the greeting on');
  layouts.push({ check: 'greeting', size: size.name, viewport: page.viewportSize(), before, during, after, startMilliseconds: startedAfter, handOverMilliseconds: handOver, stillFrames: loop.frames.length });
  await context.close();
  checks.push(`${size.name}: Standing Start plays the greeting once in the stance loop's place, silent and inline, with focus on the technique heading and techniques ready to choose (its picture started moving ${startedAfter} ms after it took the loop's place; the limit is ${PASSING_MOMENT_PATIENCE.start} ms); when it ends the stance loop takes over in the same boxes ${handOver} ms later, under the greeting's last frame until its own first frame is there, with no layout shift.`);
}

// Each way the greeting gives way before its end leaves the stance loop showing.
async function greetingGivesWay() {
  const context = await open();
  await openArena();
  const count = async () => (await stages()).filter((stage) => stage === `moment:${MATCH_GREETING}`).length;

  // A technique chosen while it plays: the match goes on at once and the stance loop shows.
  await holdNextGreeting();
  await press(button('Standing Start'));
  await greetingHeld();
  await press(firstTechnique());
  await page.locator('.sequence-panel .order-stack').waitFor();
  assert.equal(await momentStage().count(), 0, 'choosing a technique ends the greeting');
  assert.equal(await stanceStage().count(), 1, 'the stance loop shows while the steps are ordered, as before');
  assert.equal(await count(), 1);

  // Restart match starts on the feet again, so it greets again. A new stance ends that greeting.
  await holdNextGreeting();
  await press(restartButton());
  await greetingHeld();
  assert.equal(await count(), 2, 'Restart match plays the greeting again');
  const stances = page.getByRole('radiogroup', { name: 'Starting stance', exact: true });
  await stances.getByRole('radio', { name: 'Sumo Base', exact: true }).check();
  await stanceStage().waitFor();
  assert.equal(await momentStage().count(), 0, 'a new starting stance ends the greeting');
  assert.equal(await stanceStage().getAttribute('data-move'), stanceLoop('sumo base', defaultNpcs[0].stance).moveId, 'and the loop of that stance shows');
  await stances.getByRole('radio', { name: 'Wrestling Stance', exact: true }).check();

  // Skip, by keyboard: the loop shows, and focus goes to the technique heading instead of dropping to the page.
  await holdNextGreeting();
  await press(restartButton());
  await greetingHeld();
  await momentStage().getByRole('button', { name: 'Skip', exact: true }).focus();
  await page.keyboard.press('Enter');
  await stanceStage().waitFor();
  assert.equal(await momentStage().count(), 0, 'Skip ends the greeting');
  assert.equal(await onHeading(), true, 'after Skip focus is on the technique heading');
  assert.equal(await count(), 3);

  // Leaving the Arena ends it: coming back to the running match is not a start.
  await holdNextGreeting();
  await press(restartButton());
  await greetingHeld();
  await press(navButton('Training'));
  await techniquePanel().waitFor({ state: 'detached' });
  await press(navButton('Arena'));
  await stanceStage().waitFor();
  await hint('Select your response from standing.');
  await page.waitForTimeout(400);
  assert.equal(await momentStage().count(), 0, 'coming back to a running match does not greet again');
  assert.equal(await count(), 4);
  // None of these greetings played to its end, so none handed its last frame on: each loop
  // after them opened as a loop always does.
  assert.deepEqual((await log()).loops.filter((loop) => loop.stillAtBirth), [], 'a greeting cut short hands no frame on');

  // A start that is not on the feet has no greeting.
  await page.reload();
  await press(navButton('Arena'));
  await stanceStage().waitFor();
  await press(button('Kneeling Start'));
  await hint('Select your response from');
  await page.waitForTimeout(600);
  assert.deepEqual((await stages()).filter((stage) => stage.startsWith('moment:')), [], 'Kneeling Start plays no greeting');
  await context.close();

  // The Overview's Open Arena button starts a match on the feet and opens the Arena: it greets too.
  const overview = await open();
  await page.goto(`${base}/`);
  await holdNextGreeting();
  await press(button('Open Arena'));
  await greetingHeld();
  await hint('Select your response from standing.');
  assert.equal(await onHeading(), true, 'Open Arena leaves focus on the technique heading');
  await greetingResumed();
  await momentStage().waitFor({ state: 'detached', timeout: 30000 });
  await untilPlaying('stance', IDLE_CLIP.video);
  await overview.close();
  checks.push(`${size.name}: choosing a technique, a new starting stance, Skip and leaving the Arena each end the greeting and leave the stance loop showing; Restart match and the Overview's Open Arena greet again; Kneeling Start does not.`);
}

// Presses `start` (a start on the feet) while `clip` is the stance loop on
// screen, where there is no greeting: the loop carries on in the same <video>,
// playing, and no match moment file is asked for.
async function noGreetingOver(clip, start) {
  await stanceStage().locator('video').evaluate((element) => { element.dataset.mark = 'the loop before the start'; });
  const stagesBefore = (await log()).stages.length;
  const askedBefore = momentRequests.length;
  await start();
  await hint('Select your response from standing.');
  await page.waitForTimeout(900);
  const seen = await log();
  assert.deepEqual(seen.stages.slice(stagesBefore).map((entry) => entry.stage), [], `no greeting over ${clip.video}: the mat window kept the one stage it had`);
  const state = await video();
  assert.deepEqual([state.path, state.mark, state.paused, state.loop], [clip.video, 'the loop before the start', false, true], `${clip.video} carries on in the same <video>`);
  await untilPlaying('stance', clip.video);
  assert.deepEqual(momentRequests.slice(askedBefore), [], `no match moment file is asked for over ${clip.video}`);
}

// The greeting plays only over the loop it was rendered for: the standard
// stance loop of the player's athlete, in a view the greeting has. There it
// opens on the view the loop is showing, with that view's still behind it, and
// hands its last frame to the loop. Over another loop, here the karate loop,
// there is no greeting: the cuts into it and out of it would show the white
// athlete snap from his stance into the crouch and back.
async function greetingFollowsTheLoop() {
  const context = await open();
  await openArena();
  const front = findUnrealClip(IDLE.moveId, IDLE.performerSide, 'front');
  const karate = stanceLoop('karate stance', defaultNpcs[0].stance);
  const karateClip = findUnrealClip(karate.moveId, karate.performerSide);
  assert.ok(front, 'the standard stance loop has a front view');
  assert.ok(karate.exact && karateClip && !findUnrealClip(karate.moveId, karate.performerSide, 'front'), 'the karate stance loop is published with a side view only');
  const cameras = () => stanceStage().getByRole('group', { name: 'Camera view', exact: true });
  const stances = page.getByRole('radiogroup', { name: 'Starting stance', exact: true });
  const shown = async () => [await momentStage().getAttribute('data-camera'), (await video()).path, await stillBehind()];

  // The player looks at the standard loop from the front, then picks the karate stance, whose
  // loop has a side view only: that loop shows from the side, with no camera buttons.
  await press(cameras().getByRole('button', { name: 'Front', exact: true }));
  await untilPlaying('stance', front.video);
  await stances.getByRole('radio', { name: 'Karate Stance', exact: true }).check();
  await untilPlaying('stance', karateClip.video);
  assert.deepEqual([await stanceStage().getAttribute('data-camera'), await cameras().count()], ['side', 0]);
  // Standing Start: no greeting over the karate loop, which carries on.
  await noGreetingOver(karateClip, () => press(button('Standing Start')));

  // Back in the wrestling stance the loop has the front view the player chose, and shows it.
  // Restart match: the test bundle's greeting has a front view, so it opens on the front, over the
  // front still, and the loop comes back on the front.
  await stances.getByRole('radio', { name: 'Wrestling Stance', exact: true }).check();
  await untilPlaying('stance', front.video);
  await holdNextGreeting();
  await press(restartButton());
  const ahead = await greetingHeld('front');
  assert.deepEqual(await shown(), ['front', ahead.video, front.poster], 'over a loop that shows from the front, the greeting opens on the front');
  await greetingResumed();
  await momentStage().waitFor({ state: 'detached', timeout: 30000 });
  await untilPlaying('stance', front.video);
  assert.equal(await stanceStage().getAttribute('data-camera'), 'front');
  // A front view of the greeting ends on the front view of the standard loop, so the loop takes over from it.
  checkHandover(await log(), front);
  await context.close();
  checks.push(`${size.name}: there is no greeting over the karate loop (Standing Start leaves it playing in the same <video>, and no match moment file is asked for); back on the standard loop, which keeps the Front view the player chose before, Restart match plays the test bundle's front greeting on the front, over the front still, and the standard loop's front view takes over from its last frame.`);
}

// A stance loop the player paused is still paused when it comes back after the
// greeting, also after a greeting cut short by choosing a technique.
async function pausedLoopStaysPaused() {
  const context = await open();
  await openArena();
  const loopVideo = `${MAT} .unreal-clip-stage[data-kind="stance"] video`;
  const transport = () => stanceStage().locator('.unreal-clip-play');
  const loopStarts = async () => (await log()).transport.filter((entry) => entry.type === 'play' && entry.path === IDLE_CLIP.video).length;
  await press(transport());
  await page.waitForFunction((selector) => document.querySelector(selector)?.paused === true, loopVideo);
  assert.deepEqual(await texts(transport()), ['Play']);
  const startsBefore = await loopStarts();

  // Standing Start greets as for any start on the feet: a pause on the loop is not a request for reduced motion.
  await holdNextGreeting();
  const standing = button('Standing Start');
  if (size.touch) await standing.tap(); else { await standing.focus(); await page.keyboard.press('Enter'); }
  await greetingHeld();
  assert.equal(await onHeading(), true, 'Standing Start leaves focus on the technique heading');
  await greetingResumed();
  await momentStage().waitFor({ state: 'detached', timeout: 30000 });
  // The loop that comes back is the paused one, with Play to start it. It rests on the frame the
  // greeting ended on, which the greeting handed over: a loop that has not played yet has shown
  // no frame of its own, so that frame stays.
  await stanceStage().waitFor();
  await page.waitForFunction((selector) => document.querySelector(selector)?.readyState >= 1, loopVideo);
  // Longer than one turn of the loop: time enough to start, if it were going to.
  await page.waitForTimeout(Math.ceil(FIXTURE_SECONDS * 1000) + 300);
  let state = await video();
  assert.deepEqual([state.path, state.loop, state.paused, state.time], [IDLE_CLIP.video, true, true, 0], 'after the greeting the stance loop is back, still paused');
  assert.deepEqual(await texts(transport()), ['Play']);
  assert.equal(await loopStarts(), startsBefore, 'the loop did not start by itself');
  assert.deepEqual([await page.locator(HANDOVER_STILL).count(), (await log()).loops.at(-1).stillAtBirth], [1, true], 'the paused loop rests on the frame the greeting ended on');

  // A greeting cut short by choosing a technique leaves the loop paused too.
  await holdNextGreeting();
  await press(restartButton());
  await greetingHeld();
  await press(firstTechnique());
  await page.locator('.sequence-panel .order-stack').waitFor();
  await stanceStage().waitFor();
  await page.waitForFunction((selector) => document.querySelector(selector)?.readyState >= 1, loopVideo);
  await page.waitForTimeout(700);
  state = await video();
  assert.deepEqual([state.paused, state.time, await texts(transport())], [true, 0, ['Play']], 'after a greeting cut short by a technique the stance loop is still paused');
  assert.equal(await loopStarts(), startsBefore);
  assert.equal(await page.locator(HANDOVER_STILL).count(), 0, 'a greeting cut short hands no frame on');

  // Play is the player's to press: the loop moves again.
  await press(transport());
  await untilPlaying('stance', IDLE_CLIP.video);
  assert.deepEqual(await texts(transport()), ['Pause']);

  // Paused again, and greeted to the end once more: the loop rests on the greeting's last frame
  // until Play, and the frame goes as the loop moves.
  await press(transport());
  await page.waitForFunction((selector) => document.querySelector(selector)?.paused === true, loopVideo);
  await holdNextGreeting();
  await press(restartButton());
  await greetingHeld();
  await greetingResumed();
  await momentStage().waitFor({ state: 'detached', timeout: 30000 });
  await page.locator(HANDOVER_STILL).waitFor();
  await page.waitForTimeout(600);
  assert.deepEqual([await page.locator(HANDOVER_STILL).count(), (await video()).paused, await texts(transport())], [1, true, ['Play']], 'paused, the loop rests on the greeting\'s last frame');
  await press(transport());
  await untilPlaying('stance', IDLE_CLIP.video);
  await page.locator(HANDOVER_STILL).waitFor({ state: 'detached', timeout: 15000 });
  await context.close();
  checks.push(`${size.name}: a stance loop the player paused is greeted like any other, and is still paused when it comes back, after the greeting (resting on the frame the greeting ended on) and after a greeting cut short by choosing a technique (on its poster); it starts again only when Play is pressed, and the greeting's frame goes as it moves.`);
}

async function greetingCannotLoad() {
  const context = await open({ blocked: [`${MATCH_GREETING}/fighter-side.mp4`, `${MATCH_GREETING}/fighter-front.mp4`] });
  await openArena();
  await press(button('Standing Start'));
  await hint('Select your response from standing.');
  await untilPlaying('stance', IDLE_CLIP.video);
  await page.waitForTimeout(500);
  assert.equal(await momentStage().count(), 0, 'a greeting that cannot load gives way to the stance loop');
  assert.equal(await page.locator(`${MAT} .unreal-clip-stage video`).count(), 1, 'the box is never empty');
  await press(firstTechnique());
  await page.locator('.sequence-panel .order-stack').waitFor();
  await context.close();
  checks.push(`${size.name}: a greeting whose file cannot load gives way to the stance loop, and the match goes on.`);
}

// How bright the middle of a box is as the browser painted it, 0 (black) to
// 255: the part of the picture the athletes stand in, clear of the words and
// buttons a wide stage lays over its corners.
async function middleBrightness(locator) {
  const data = (await locator.screenshot()).toString('base64');
  return page.evaluate(async (source) => {
    const image = new Image();
    image.src = `data:image/png;base64,${source}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(Math.round(canvas.width * 0.3), Math.round(canvas.height * 0.3), Math.round(canvas.width * 0.4), Math.round(canvas.height * 0.45)).data;
    let sum = 0;
    for (let index = 0; index < pixels.length; index += 4) sum += pixels[index] + pixels[index + 1] + pixels[index + 2];
    return Number((sum / (pixels.length / 4 * 3)).toFixed(1));
  }, data);
}

// On a slow connection the greeting's own files take a while. Until its first
// frame is there, its box shows the still of the stance loop it took the place
// of, never an empty black box. The greeting waits only so long for its first
// frame (greetingFilesNeverArrive): this check keeps that time limit back
// while it looks, and lets the files through before it lets the limit go.
async function greetingFilesArriveLate() {
  const context = await open();
  await openArena();
  const greeting = fixtures.find((item) => item.moveId === MATCH_GREETING && item.camera === 'side');
  // The greeting's video and poster are held back until this check lets them through.
  const files = `**/assets/unreal-clips/${MATCH_GREETING}/**`;
  const heldBack = [];
  await page.route(files, (route) => { heldBack.push(route); });
  await holdTimeLimits();
  await press(button('Standing Start'));
  await momentStage(MATCH_GREETING).waitFor();
  await hint('Select your response from standing.');
  await momentStage().scrollIntoViewIfNeeded();
  const box = momentStage().locator('.unreal-clip-viewport');
  // The stance loop's still is a file the page has already shown. Give it a moment to be drawn.
  let lit = 0;
  for (let attempt = 0; attempt < 6 && lit < 12; attempt += 1) {
    await painted();
    lit = await middleBrightness(box);
  }
  const waiting = await page.locator(MOMENT_VIDEO).evaluate((element) => ({ ready: element.readyState, time: element.currentTime }));
  assert.deepEqual(waiting, { ready: 0, time: 0 }, 'the greeting has no picture of its own yet');
  assert.ok(lit >= 12, `while the greeting's files are on their way its box shows the stance loop's still (brightness ${lit} of 255)`);
  await capture('greeting-files-on-their-way');
  // What the box would be without that still: black.
  const empty = await box.evaluate((element) => { const image = element.style.backgroundImage; element.style.backgroundImage = 'none'; return image; });
  await painted();
  const dark = await middleBrightness(box);
  await box.evaluate((element, image) => { element.style.backgroundImage = image; }, empty);
  assert.ok(dark < 2 && lit > dark + 10, `without the still the box would be empty (brightness ${dark} against ${lit})`);
  assert.equal(await techniquePanel().locator('.combat-moves button:not([disabled])').count() > 0, true, 'techniques can be chosen while the greeting is on its way');
  assert.deepEqual([...new Set(heldBack.map((route) => new URL(route.request().url()).pathname))].sort(), [greeting.video, greeting.poster].sort(), 'the greeting asked for its video and its poster, and for nothing else');
  assert.equal((await log()).timersKept, 1, 'the greeting started one wait for its first frame, which this check is keeping back');
  // The files arrive in time: the greeting plays once, to its end, and hands over to the loop.
  await page.unroute(files);
  for (const route of heldBack) await route.continue();
  await untilPlaying('moment', greeting.video);
  // Its picture is moving, so its wait is over: letting the time limit go ends nothing.
  await releaseTimeLimits();
  await momentStage().waitFor({ state: 'detached', timeout: 30000 });
  await untilPlaying('stance', IDLE_CLIP.video);
  const seen = await log();
  assert.deepEqual(seen.stages.map((entry) => entry.stage), [`stance:${IDLE.moveId}`, `moment:${MATCH_GREETING}`, `stance:${IDLE.moveId}`]);
  const played = seen.videos.filter((entry) => entry.path === greeting.video);
  checkPlaySession(seen, greeting.video);
  const ended = played.find((entry) => entry.type === 'ended');
  assert.ok(ended.time >= FIXTURE_SECONDS - 0.2, `it was not cut short (${ended.time} of ${FIXTURE_SECONDS} seconds)`);
  await context.close();
  checks.push(`${size.name}: while the greeting's own files are held back, its box shows the stance loop's still (brightness ${lit} of 255 in the middle of the picture; ${dark} without it), and techniques can be chosen; once they arrive the greeting plays to its end and hands over.`);
}

// A file that is slow, or hangs without failing, sends no error. The greeting
// waits for its first moving frame only so long, then gives way to the stance
// loop by itself, and does not play late when the file turns up after all.
async function greetingFilesNeverArrive() {
  const context = await open();
  await openArena();
  const greeting = fixtures.find((item) => item.moveId === MATCH_GREETING && item.camera === 'side');
  const files = `**/assets/unreal-clips/${MATCH_GREETING}/**`;
  const heldBack = [];
  await page.route(files, (route) => { heldBack.push(route); });
  await press(button('Standing Start'));
  await hint('Select your response from standing.');
  const seen = await greetingCameAndWent();
  assert.deepEqual(seen.stages.map((entry) => entry.stage), [`stance:${IDLE.moveId}`, `moment:${MATCH_GREETING}`, `stance:${IDLE.moveId}`], 'stance loop, the greeting waiting, stance loop');
  const waited = seen.stages[2].at - seen.stages[1].at;
  assert.ok(waited >= PASSING_MOMENT_PATIENCE.start - 50 && waited < PASSING_MOMENT_PATIENCE.start + LATE, `the greeting gives way ${PASSING_MOMENT_PATIENCE.start} ms after it was asked for (seen after ${waited} ms)`);
  assert.deepEqual(seen.videos.filter((entry) => entry.path === greeting.video), [], 'it never started, ended or failed: nothing came from its file at all');
  assert.ok(heldBack.some((route) => new URL(route.request().url()).pathname === greeting.video), 'its video was asked for and never answered');
  assert.equal(await page.locator(`${MAT} .unreal-clip-stage video`).count(), 1, 'the box is never empty');
  assert.deepEqual([(await video()).loop, await stanceStage().getAttribute('data-move')], [true, IDLE.moveId]);
  // The file turns up after all: too late. The greeting does not play over the running match.
  await page.unroute(files);
  for (const route of heldBack) await route.continue().catch(() => {});
  await page.waitForTimeout(1200);
  const later = await log();
  assert.deepEqual([later.stages.length, later.videos.filter((entry) => entry.path === greeting.video)], [3, []], 'a greeting that gave way does not play late');
  await press(firstTechnique());
  await page.locator('.sequence-panel .order-stack').waitFor();
  await context.close();
  checks.push(`${size.name}: a greeting whose files never arrive waits on the stance loop's still for ${waited} ms (the limit is ${PASSING_MOMENT_PATIENCE.start} ms), then the stance loop takes over by itself; it does not play late, and the match goes on.`);
}

// A connection that hangs part of the way through the greeting: it starts,
// runs out of data and stands still. It gives way then, too.
async function greetingStalls() {
  const context = await open();
  await openArena();
  const greeting = fixtures.find((item) => item.moveId === MATCH_GREETING && item.camera === 'side');
  stall = { path: greeting.video, bytes: Math.floor(greeting.bytes / 2), responses: 0 };
  let seen;
  try {
    // A machine that is slow to start a video is not what this check is about: the wait for
    // the first frame is kept back until the greeting plays. The wait that follows, for the
    // picture to move again, then runs as it does for a player.
    await holdTimeLimits();
    await press(button('Standing Start'));
    await page.waitForFunction((path) => window.__moments.videos.some((entry) => entry.type === 'playing' && entry.path === path), greeting.video, { timeout: 30000 });
    await releaseTimeLimits();
    await hint('Select your response from standing.');
    seen = await greetingCameAndWent();
    assert.ok(stall.responses >= 1, 'the greeting\'s video was asked for, and only its first half was sent');
  } finally {
    stall = null;
  }
  assert.deepEqual(seen.stages.map((entry) => entry.stage), [`stance:${IDLE.moveId}`, `moment:${MATCH_GREETING}`, `stance:${IDLE.moveId}`], 'stance loop, greeting, stance loop');
  const played = seen.videos.filter((entry) => entry.path === greeting.video);
  checkPlaySession(seen, greeting.video, { ends: 0 });
  assert.ok(played.some((entry) => entry.type === 'playing'), 'the greeting actually started moving before it stalled');
  const stopped = seen.waits.find((entry) => entry.path === greeting.video && entry.at >= played[0].at);
  assert.ok(stopped && stopped.time < FIXTURE_SECONDS - 0.2, `it ran out of data before its end (${JSON.stringify(seen.waits)})`);
  const stoodStill = seen.stages[2].at - stopped.at;
  assert.ok(stoodStill >= PASSING_MOMENT_PATIENCE.stall - 50 && stoodStill < PASSING_MOMENT_PATIENCE.stall + LATE, `the greeting gives way ${PASSING_MOMENT_PATIENCE.stall} ms after it stops (seen after ${stoodStill} ms)`);
  assert.deepEqual([(await video()).loop, await stanceStage().getAttribute('data-move')], [true, IDLE.moveId]);
  await press(firstTechnique());
  await page.locator('.sequence-panel .order-stack').waitFor();
  await context.close();
  checks.push(`${size.name}: a greeting whose file stops arriving halfway starts, runs out of data ${stopped.time} seconds in, stands still for ${stoodStill} ms (the limit is ${PASSING_MOMENT_PATIENCE.stall} ms) and gives way to the stance loop; the match goes on.`);
}

async function greetingReducedMotion() {
  const context = await open({ reducedMotion: 'reduce' });
  await page.goto(`${base}/`);
  await press(navButton('Arena'));
  await stanceStage().waitFor();
  await page.waitForFunction((selector) => document.querySelector(selector)?.readyState >= 1, `${MAT} .unreal-clip-stage[data-kind="stance"] video`);
  await stanceStage().locator('video').evaluate((element) => { element.dataset.mark = 'before the start'; });
  await press(button('Standing Start'));
  await hint('Select your response from standing.');
  await page.waitForTimeout(900);
  const state = await video();
  assert.deepEqual([state.mark, state.paused, state.time], ['before the start', true, 0], 'reduced motion: the stance loop waits on its poster, in the same <video>');
  assert.deepEqual((await stages()).filter((stage) => stage.startsWith('moment:')), [], 'reduced motion: no greeting');
  assert.deepEqual(momentRequests, [], 'reduced motion: the greeting is not even fetched');
  await context.close();
  checks.push(`${size.name}: with reduced motion there is no greeting; the stance loop stays as it was, paused on its poster.`);
}

// ---- The end of a match ----

// Starts a match on the feet and plays it to its end. Returns who won.
async function playToTheEnd({ techniqueName, rival = null, expectToggle }) {
  if (rival) await page.getByLabel('Choose opponent', { exact: true }).selectOption(rival.id);
  await page.evaluate((expect) => { window.__expectToggle = expect; }, expectToggle);
  await press(button('Standing Start'));
  const outcome = page.locator('.arena-outcome');
  for (let round = 1; round <= 8; round += 1) {
    await technique(techniqueName).waitFor();
    await press(technique(techniqueName));
    await page.locator('.sequence-panel .order-stack').waitFor();
    await press(button('Submit sequence'));
    await outcome.waitFor();
    if (await outcome.getAttribute('data-finished') === 'true') {
      return { rounds: round, playerWins: (await outcome.getAttribute('class')).includes('success'), headline: (await outcome.locator('span').first().innerText()).replace(/\s+/g, ' ').trim() };
    }
    await press(button('Prepare Next Action'));
  }
  return assert.fail('the match did not finish within eight rounds');
}

// What the mat window shows under its header, with nothing that differs from
// one page load to the next.
const matPicture = () => page.locator(MAT).evaluate((mat) => [...mat.children].filter((child) => !child.matches('.mat-window-header')).map((child) => child.outerHTML
  .replace(/\s(id|for|aria-labelledby|aria-describedby)="[^"]*"/g, ' $1="…"')).join('\n'));
const pictureReady = () => page.waitForFunction((selector) => {
  const stage = document.querySelector(`${selector} .grappling-snapshot-stage`);
  return Boolean(stage) && ['ready', 'error'].includes(stage.dataset.ready);
}, MAT, { timeout: 15000 });
// The picture's box, and how far under the top of the mat window it starts.
const pictureBox = async () => {
  const [box, mat] = [await pageBox(page.locator(`${MAT} > :not(.mat-window-header)`).first()), await pageBox(page.locator(MAT))];
  return { ...box, fromTop: box.y - mat.y };
};

// A finished match in the release build: what "Final exchange" has to show.
async function finishedWithoutMoments({ saved, techniqueName, rival, search }) {
  const context = await open({ saved, release: true });
  await openArena(search);
  const result = await playToTheEnd({ techniqueName, rival, expectToggle: false });
  await pictureReady();
  await painted();
  assert.equal(await page.locator(`${MAT} .mat-window-header, ${MAT} .mat-view-toggle, ${MAT} [data-kind="moment"]`).count(), 0, 'the release build shows no toggle and no moment at the end of a match: neither the win nor the loss is published');
  const picture = { html: await matPicture(), box: await pictureBox() };
  // The one moment it draws is the greeting, at the start, cut short by the first technique.
  assert.deepEqual((await stages()).filter((stage) => stage.startsWith('moment:')), [`moment:${MATCH_GREETING}`], 'the only moment the release build drew is the greeting at the start of the match');
  assert.deepEqual(momentRequests.filter((path) => !path.startsWith(`/assets/unreal-clips/${MATCH_GREETING}/`)), [], 'the release build asked for no end-of-match file');
  await context.close();
  return { result, picture };
}

async function finishedMatch({ id, saved, techniqueName, rival, search = '', expectWin }) {
  const title = MATCH_MOMENT_TITLES[id];
  const without = await finishedWithoutMoments({ saved, techniqueName, rival, search });
  assert.equal(without.result.playerWins, expectWin, `the release build: ${without.result.headline}`);

  const context = await open({ saved });
  await openArena(search);
  const result = await playToTheEnd({ techniqueName, rival, expectToggle: true });
  // The same player, rival, technique and random numbers: the same match as in the release build.
  assert.deepEqual(result, without.result, 'the test bundle and the release build played the same match');
  // The toggle is there in the very frame the result is.
  const group = page.getByRole('group', { name: 'Match picture', exact: true });
  await group.waitFor();
  assert.equal((await log()).finishedWithoutToggle, 0, 'the toggle appears with the result, not after it');
  assert.deepEqual(await texts(group.getByRole('button')), ['Match result', 'Final exchange']);
  const pressed = () => group.getByRole('button').evaluateAll((list) => list.map((item) => item.getAttribute('aria-pressed')));
  assert.deepEqual(await pressed(), ['true', 'false'], 'with motion allowed a finished match opens on the match result');
  assert.equal(await page.locator(`${MAT} > *`).first().evaluate((element) => `${element.tagName.toLowerCase()}.${element.className}`), 'header.mat-window-header', 'the mat window starts with its header');
  assert.equal(await page.locator(`${MAT} > .mat-window-header .mat-view-toggle`).count(), 1, 'which holds the toggle');
  const toggleBox = await pageBox(toggle());
  const choiceBoxes = async () => Promise.all((await group.getByRole('button').all()).map((item) => pageBox(item)));
  const resting = await choiceBoxes();
  for (const box of resting) assert.ok(box.height >= 44 && box.width >= 44, `each choice is easy to tap (${box.width} by ${box.height})`);

  // "Match result": the moment plays once and holds its last frame, with Replay.
  const stage = momentStage(id);
  await stage.waitFor();
  await stage.scrollIntoViewIfNeeded();
  const clip = fixtures.find((item) => item.moveId === id && item.camera === 'side');
  await untilEnded();
  await checkMomentStage(id, { held: true });
  await page.waitForTimeout(600);
  const state = await video();
  assert.deepEqual([state.ended, state.paused, state.loop, await stage.getAttribute('data-ended')], [true, true, false, 'true'], `${id} rests on its last frame`);
  assert.ok(state.time >= state.duration - 1 / clip.fps, `on its last frame (${state.time} of ${state.duration})`);
  assert.deepEqual(await texts(stage.getByRole('button')), ['Replay', 'Side', 'Front']);
  for (const item of await stage.getByRole('button').all()) assert.ok((await item.boundingBox()).height >= 44, 'the stage\'s controls are easy to tap');
  assert.equal(await stage.locator('.unreal-clip-note').count(), 0, 'no note under a moment that plays by itself');
  checkPlaySession(await log(), clip.video);
  assert.equal(await fits(), true, 'nothing scrolls sideways');
  await page.locator(MAT).scrollIntoViewIfNeeded();
  await capture(`${id}-result`);
  // Replay: once more from the start, and it holds again.
  await press(stage.getByRole('button', { name: 'Replay', exact: true }));
  const replayedFrom = await untilPlaying('moment', clip.video);
  assert.ok(replayedFrom < FIXTURE_SECONDS / 2, `Replay starts from the beginning (seen playing at ${replayedFrom} of ${FIXTURE_SECONDS} seconds)`);
  await untilEnded();
  assert.equal(await stage.getByRole('button', { name: 'Replay', exact: true }).count(), 1);
  // The other view.
  await press(stage.getByRole('group', { name: 'Camera view', exact: true }).getByRole('button', { name: 'Front', exact: true }));
  await page.waitForFunction((selector) => document.querySelector(selector)?.dataset.camera === 'front', `${MAT} .unreal-clip-stage[data-kind="moment"]`);
  assert.equal((await video()).path, fixtures.find((item) => item.moveId === id && item.camera === 'front').video);

  // "Final exchange": exactly the picture the release build shows for this finished match.
  const final = group.getByRole('button', { name: 'Final exchange', exact: true });
  await press(final);
  await stage.waitFor({ state: 'detached' });
  assert.deepEqual(await pressed(), ['false', 'true']);
  await pictureReady();
  await painted();
  const picture = { html: await matPicture(), box: await pictureBox() };
  assert.equal(picture.html, without.picture.html, 'the final exchange is exactly what the release build shows');
  // The header is the only thing added: the picture has its size and sits right under the header.
  const header = await pageBox(page.locator(`${MAT} .mat-window-header`));
  assert.deepEqual([picture.box.x, picture.box.width, picture.box.height, picture.box.fromTop - without.picture.box.fromTop], [without.picture.box.x, without.picture.box.width, without.picture.box.height, header.height],
    `the picture keeps its size, under the header (${JSON.stringify({ picture: picture.box, release: without.picture.box, header })})`);
  // The toggle did not move, whichever picture is under it.
  assert.ok(sameBox(toggleBox, await pageBox(toggle())), 'the toggle stays where it is');
  assert.deepEqual(await choiceBoxes(), resting, 'and so does each choice');
  assert.equal(await fits(), true);
  await page.locator(MAT).scrollIntoViewIfNeeded();
  await capture(`${id}-final-exchange`, { atRest: true });

  // By keyboard: the focus ring shows whole, Enter and Space choose, and focus stays on the choice.
  await final.focus();
  await page.keyboard.press('Shift+Tab');
  const ring = await page.evaluate((selector) => {
    const element = document.activeElement;
    const style = getComputedStyle(element);
    const reach = parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
    const [box, mat] = [element.getBoundingClientRect(), document.querySelector(selector).getBoundingClientRect()];
    return { label: element.textContent, visible: element.matches(':focus-visible'), style: style.outlineStyle, width: parseFloat(style.outlineWidth), reach,
      inside: box.left - reach >= mat.left && box.right + reach <= mat.right && box.top - reach >= mat.top && box.bottom + reach <= mat.bottom };
  }, MAT);
  assert.deepEqual([ring.label, ring.visible, ring.style, ring.width >= 2, ring.inside], ['Match result', true, 'solid', true, true], `keyboard focus shows a whole ring on the toggle (${JSON.stringify(ring)})`);
  await page.keyboard.press('Enter');
  await stage.waitFor();
  assert.deepEqual([await pressed(), await page.evaluate(() => document.activeElement?.textContent)], [['true', 'false'], 'Match result'], 'Enter chooses, and focus stays on the choice');
  assert.equal(await page.locator('.combat-grid .sr-only[role="status"]').innerText(), 'Showing the match result.');
  // Shown again, the moment plays again from its start.
  await stage.scrollIntoViewIfNeeded();
  await untilPlaying('moment', clip.video);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Space');
  await stage.waitFor({ state: 'detached' });
  assert.deepEqual([await pressed(), await page.evaluate(() => document.activeElement?.textContent)], [['false', 'true'], 'Final exchange'], 'Space chooses too');
  assert.equal(await page.locator('.combat-grid .sr-only[role="status"]').innerText(), 'Showing the final exchange.');
  assert.ok(sameBox(toggleBox, await pageBox(toggle())));

  // A new match takes the toggle away, and greets.
  await holdNextGreeting();
  await press(restartButton());
  await greetingHeld();
  assert.equal(await page.locator(`${MAT} .mat-window-header`).count(), 0, 'a new match has no toggle');
  layouts.push({ check: id, size: size.name, viewport: page.viewportSize(), rounds: result.rounds, headline: result.headline, header, toggle: toggleBox, choices: resting, picture: picture.box, releasePicture: without.picture.box });
  await context.close();
  checks.push(`${size.name}: ${result.headline} (${result.rounds} ${result.rounds === 1 ? 'round' : 'rounds'}, the same match in the release build). The mat window shows "${title}" once and holds its last frame with Replay; "Final exchange" shows exactly the picture the release build shows, ${header.height} pixels lower, under the header; the toggle never moves, takes Enter and Space, and shows a whole focus ring.`);
}

async function finishedReducedMotion() {
  const context = await open({ saved: WINNER, reducedMotion: 'reduce' });
  await page.goto(`${base}/`);
  await press(navButton('Arena'));
  await stanceStage().waitFor();
  const result = await playToTheEnd({ techniqueName: WINNING_TECHNIQUE, expectToggle: true });
  assert.equal(result.playerWins, true, result.headline);
  const group = page.getByRole('group', { name: 'Match picture', exact: true });
  await group.waitFor();
  assert.equal((await log()).finishedWithoutToggle, 0);
  const pressed = () => group.getByRole('button').evaluateAll((list) => list.map((item) => item.getAttribute('aria-pressed')));
  assert.deepEqual(await pressed(), ['false', 'true'], 'reduced motion: a finished match opens on the final exchange, and the toggle is still there');
  assert.equal(await momentStage().count(), 0);
  assert.equal(await page.locator(`${MAT} .unity-unavailable .grappling-snapshot-stage`).count(), 1, 'the final exchange is what shows');
  assert.deepEqual(momentRequests, [], 'and nothing of the moment is fetched until it is asked for');
  // Asked for, the moment waits on its first frame for Play, like a technique clip.
  await press(group.getByRole('button', { name: 'Match result', exact: true }));
  const stage = momentStage(MATCH_WIN);
  await stage.waitFor();
  await stage.scrollIntoViewIfNeeded();
  await page.waitForFunction((selector) => document.querySelector(selector)?.readyState >= 1, MOMENT_VIDEO, { timeout: 15000 });
  await page.waitForTimeout(700);
  const state = await video();
  assert.deepEqual([state.paused, state.time, await texts(stage.locator('.unreal-clip-play'))], [true, 0, ['Play']], 'reduced motion: the moment waits on its first frame');
  assert.equal(await stage.locator('.unreal-clip-note').innerText(), 'Reduced motion is on; press Play when ready.');
  assert.equal(await stage.getAttribute('aria-describedby'), await stage.locator('.unreal-clip-note').getAttribute('id'));
  assert.equal(await fits(), true);
  await page.locator(MAT).scrollIntoViewIfNeeded();
  await capture('reduced-motion-result');
  await press(stage.getByRole('button', { name: 'Play', exact: true }));
  await untilEnded();
  assert.deepEqual(await texts(stage.locator('.unreal-clip-play')), ['Replay']);
  await context.close();
  checks.push(`${size.name}: with reduced motion a finished match opens on "Final exchange" with the toggle there; "Match result" waits on its first frame for Play and says why.`);
}

// The picture chosen for a finished match belongs to the match, not to the
// Arena screen: it is still the one showing after a visit to Training.
async function resultChoiceIsKept() {
  const context = await open({ saved: WINNER });
  await openArena();
  const result = await playToTheEnd({ techniqueName: WINNING_TECHNIQUE, expectToggle: true });
  assert.equal(result.playerWins, true, result.headline);
  const group = page.getByRole('group', { name: 'Match picture', exact: true });
  await group.waitFor();
  const pressed = () => group.getByRole('button').evaluateAll((list) => list.map((item) => item.getAttribute('aria-pressed')));
  const stage = momentStage(MATCH_WIN);
  const completedPass = async () => {
    const seen = await log();
    const path = fixtures.find((item) => item.moveId === MATCH_WIN && item.camera === 'side').video;
    assert.equal(seen.transport.some((entry) => entry.path.startsWith(`/assets/unreal-clips/${MATCH_WIN}/`) && entry.path !== path), false, 'the match result did not switch sources');
    return checkPlaySession(seen, path);
  };
  const visitTraining = async (leave) => {
    await press(leave);
    await techniquePanel().waitFor({ state: 'detached' });
    await press(navButton('Arena'));
    await group.waitFor();
  };
  await stage.waitFor();
  await stage.scrollIntoViewIfNeeded();
  await untilEnded();
  const firstPass = await completedPass();

  // The player chooses the final exchange, then leaves by the Arena's own "Open training" button
  // ("Your current match stays available.") and comes back.
  await press(group.getByRole('button', { name: 'Final exchange', exact: true }));
  await stage.waitFor({ state: 'detached' });
  await pictureReady();
  await painted();
  const chosen = await matPicture();
  await visitTraining(techniquePanel().getByRole('button', { name: 'Open training', exact: true }));
  assert.deepEqual(await pressed(), ['false', 'true'], 'back in the Arena, "Final exchange" is still the pressed choice');
  await pictureReady();
  await painted();
  await page.waitForTimeout(700);
  assert.equal(await momentStage().count(), 0, 'the match result does not take the picture back');
  assert.equal(await matPicture(), chosen, 'the final exchange shows as it was left');
  assert.deepEqual(await completedPass(), firstPass, 'and the match result clip did not play again');
  assert.equal(await fits(), true);

  // Chosen back, "Match result" is what shows after the next visit: the moment, once more from its start.
  await press(group.getByRole('button', { name: 'Match result', exact: true }));
  await stage.waitFor();
  await visitTraining(navButton('Training'));
  assert.deepEqual(await pressed(), ['true', 'false'], 'back in the Arena, "Match result" is still the pressed choice');
  await stage.waitFor();
  await stage.scrollIntoViewIfNeeded();
  await untilEnded();
  assert.deepEqual(await texts(stage.locator('.unreal-clip-play')), ['Replay']);
  await context.close();
  checks.push(`${size.name}: the picture chosen for a finished match stays chosen through a visit to Training: "Final exchange" is still pressed and still the picture, and the match result clip does not play again; chosen back, "Match result" is what shows after the next visit.`);
}

async function resultCannotLoad() {
  const context = await open({ saved: WINNER, blocked: [`${MATCH_WIN}/fighter-side.mp4`, `${MATCH_WIN}/fighter-front.mp4`] });
  await openArena();
  const result = await playToTheEnd({ techniqueName: WINNING_TECHNIQUE, expectToggle: false });
  assert.equal(result.playerWins, true, result.headline);
  await page.locator(`${MAT} .unity-unavailable .grappling-snapshot-stage`).waitFor({ timeout: 15000 });
  await page.waitForFunction((selector) => !document.querySelector(`${selector} .mat-window-header`) && !document.querySelector(`${selector} [data-kind="moment"]`), MAT, { timeout: 15000 });
  await pictureReady();
  assert.equal(await page.locator(`${MAT} > *`).count(), 1, 'a moment that cannot load leaves the final exchange alone in the mat window, with no toggle');
  await context.close();
  checks.push(`${size.name}: when neither view of the match result can load, the toggle goes and the final exchange shows, as in the release build.`);
}

// ---- The narrowest phone ----

// At 320 pixels the greeting and the header of a finished match still fit:
// nothing scrolls sideways, and both choices are whole and easy to tap.
async function narrowPhone() {
  const context = await open({ saved: WINNER });
  await openArena();
  await holdNextGreeting();
  await press(button('Standing Start'));
  await greetingHeld();
  assert.equal(await fits(), true, 'the greeting fits a 320 pixel phone');
  assert.ok((await momentStage().getByRole('button', { name: 'Skip', exact: true }).boundingBox()).height >= 44, 'Skip is easy to tap');
  await momentStage().scrollIntoViewIfNeeded();
  await capture('greeting');
  // The match goes on while the greeting is on screen, and one exchange ends it.
  await press(technique(WINNING_TECHNIQUE));
  await page.locator('.sequence-panel .order-stack').waitFor();
  await press(button('Submit sequence'));
  await page.locator('.arena-outcome[data-finished="true"]').waitFor();
  const group = page.getByRole('group', { name: 'Match picture', exact: true });
  await group.waitFor();
  const stage = momentStage(MATCH_WIN);
  await stage.waitFor();
  const measure = () => page.locator(MAT).evaluate((mat) => {
    const inside = (element) => { const [box, around] = [element.getBoundingClientRect(), mat.getBoundingClientRect()]; return box.left >= around.left && box.right <= around.right; };
    return [...mat.querySelectorAll('.mat-view-toggle button')].map((item) => ({ label: item.textContent, height: Math.round(item.getBoundingClientRect().height), whole: item.scrollWidth <= item.clientWidth, inside: inside(item) }));
  });
  const whole = [{ label: 'Match result', whole: true, inside: true }, { label: 'Final exchange', whole: true, inside: true }];
  const choices = await measure();
  assert.deepEqual(choices.map(({ label, whole: fitsItsBox, inside }) => ({ label, whole: fitsItsBox, inside })), whole, `both choices are whole at 320 pixels (${JSON.stringify(choices)})`);
  for (const choice of choices) assert.ok(choice.height >= 44, `${choice.label} is easy to tap (${choice.height})`);
  assert.equal(await fits(), true, 'the match result fits a 320 pixel phone');
  await stage.scrollIntoViewIfNeeded();
  await untilEnded();
  for (const item of await stage.getByRole('button').all()) assert.ok((await item.boundingBox()).height >= 44, 'the stage\'s controls are easy to tap');
  await page.locator(MAT).scrollIntoViewIfNeeded();
  await capture(`${MATCH_WIN}-result`);
  await press(group.getByRole('button', { name: 'Final exchange', exact: true }));
  await stage.waitFor({ state: 'detached' });
  await pictureReady();
  await painted();
  assert.deepEqual((await measure()).map(({ label, whole: fitsItsBox, inside }) => ({ label, whole: fitsItsBox, inside })), whole);
  assert.equal(await fits(), true, 'the final exchange fits a 320 pixel phone');
  await page.locator(MAT).scrollIntoViewIfNeeded();
  await capture(`${MATCH_WIN}-final-exchange`, { atRest: true });
  layouts.push({ check: 'narrow phone', size: size.name, viewport: page.viewportSize(), choices });
  await context.close();
  checks.push(`${size.name}: at 320 pixels the greeting and the finished match's header fit with nothing scrolling sideways; "Match result" and "Final exchange" are whole and ${Math.min(...choices.map((choice) => choice.height))} pixels high.`);
}

// ---- The release build: the published greeting ----

const HANDOVER_STILL = `${MAT} .unreal-clip-stage[data-kind="stance"] .unreal-clip-handover`;
const LOOP_VIDEO = `${MAT} .unreal-clip-stage[data-kind="stance"] video`;

// The release build's greeting, stopped by holdNextGreeting the moment it started playing.
async function realGreetingHeld() {
  await momentStage(MATCH_GREETING).waitFor();
  await page.waitForFunction(({ selector, wanted }) => {
    const element = document.querySelector(selector);
    return window.__moments.hold === false && window.__moments.held > 0 && Boolean(element) && new URL(element.currentSrc || element.src).pathname === wanted && element.readyState >= 2 && element.paused && !element.ended;
  }, { selector: MOMENT_VIDEO, wanted: GREETING.video }, { timeout: 30000 });
  await releaseTimeLimits();
}

// The greeting's stage in the release build: its words, its one control, the
// published clip, and the still of the stance loop behind it.
async function checkRealGreetingStage() {
  const stage = momentStage(MATCH_GREETING);
  const [fighterName, opponentName] = await page.locator('.arena-top .fighter-card strong').allTextContents();
  assert.deepEqual([await stage.getAttribute('aria-label'), await stage.getAttribute('data-camera'), await stage.getAttribute('data-held')], [`${MATCH_MOMENT_TITLES[MATCH_GREETING]}, Unreal Engine clip`, 'side', 'false']);
  assert.deepEqual(await stage.locator('.unreal-clip-heading > *').allTextContents(), ['Unreal Engine', MATCH_MOMENT_TITLES[MATCH_GREETING]]);
  assert.equal(await stage.locator('video').getAttribute('aria-label'), `${MATCH_MOMENT_TITLES[MATCH_GREETING]}. ${fighterName} in the white gi and ${opponentName} in the navy gi, seen from the side.`);
  checkLegend(await legendLines(page, MAT), `${size.name} release greeting`);
  assert.deepEqual(await texts(stage.getByRole('button')), ['Skip'], 'the greeting has one control');
  assert.ok((await stage.getByRole('button').boundingBox()).height >= 44, 'Skip is easy to tap');
  const state = await video();
  assert.deepEqual([state.path, state.poster, state.loop, state.muted, state.inline, state.controls], [GREETING.video, GREETING.poster, false, true, true, false], 'the published greeting, silent and inline, never looping');
  assert.equal(await stillBehind(), IDLE_CLIP.poster, 'behind it, the still of the stance loop whose place it took');
  assert.equal(await page.locator(`${MAT} .unreal-clip-stage`).count(), 1, 'one stage in the mat window');
}

// The stance loop that took over from a greeting that played to its end, from
// what the page wrote down (see watchPage): it was given the frame the greeting
// ended on, which lay over it from the moment it was put on the page and on
// every painted frame until the browser presented a frame of the loop's own,
// and went right after. Its own file and poster are the ones it always has.
function checkHandover(seen, clip = IDLE_CLIP) {
  const loop = seen.loops.at(-1);
  const said = JSON.stringify({ ...loop, frames: loop.frames.length });
  assert.deepEqual([loop.path, loop.poster, loop.stillAtBirth], [clip.video, clip.poster, true], `the loop that took over has its own file and poster, under the greeting's last frame (${said})`);
  assert.ok(loop.firstFrame, `the loop presented a frame of its own (${said})`);
  assert.deepEqual(loop.frames.filter((frame) => !frame.still), [], `the still covered every frame painted before the loop's own (${said})`);
  // A busy machine can present a frame or two before it gets round to saying so.
  assert.ok(loop.firstFrame.mediaTime < 0.25, `the loop starts from its beginning (${said})`);
  assert.ok(loop.stillGone !== null && loop.stillGone >= loop.firstFrame.at - 1 && loop.stillGone - loop.firstFrame.at < 250, `the still went once the loop's own frame was there, and not later than a few frames after (${said})`);
  return loop;
}

// Two screenshots of the same box, compared in the page where the athletes
// stand (the middle of the box, clear of the words and buttons at its edges):
// the mean difference (0 to 255) and the share of pixels, in percent, that
// differ by more than 8 levels.
async function compareShots(left, right) {
  return page.evaluate(async ([one, two]) => {
    const pixels = async (source) => {
      const image = new Image();
      image.src = `data:image/png;base64,${source}`;
      await image.decode();
      const canvas = Object.assign(document.createElement('canvas'), { width: image.naturalWidth, height: image.naturalHeight });
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      return { width: canvas.width, height: canvas.height, data: context.getImageData(0, 0, canvas.width, canvas.height).data };
    };
    const [a, b] = [await pixels(one), await pixels(two)];
    if (a.width !== b.width || a.height !== b.height) return { mean: 255, changed: 100 };
    let total = 0, changed = 0, count = 0;
    for (let y = Math.round(a.height * 0.22); y < Math.round(a.height * 0.92); y += 1) {
      for (let x = Math.round(a.width * 0.3); x < Math.round(a.width * 0.7); x += 1) {
        const index = (y * a.width + x) * 4;
        const difference = (Math.abs(a.data[index] - b.data[index]) + Math.abs(a.data[index + 1] - b.data[index + 1]) + Math.abs(a.data[index + 2] - b.data[index + 2])) / 3;
        total += difference; count += 1;
        if (difference > 8) changed += 1;
      }
    }
    return { mean: Number((total / count).toFixed(2)), changed: Number((100 * changed / count).toFixed(2)) };
  }, [left.toString('base64'), right.toString('base64')]);
}

// The still a stance loop was handed, kept in the page as pixels, compared with
// frames the browser decodes on its own: the greeting's last frame, and the
// loop's first frame and its middle one (the frame its poster shows). Full
// size; the mean difference over the whole picture and the share of pixels
// that differ by more than 8 levels where the athletes stand.
const keepStill = () => page.evaluate((selector) => {
  const canvas = Object.assign(document.createElement('canvas'), { width: 1280, height: 720 });
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(document.querySelector(selector), 0, 0, 1280, 720);
  window.__keptStill = context.getImageData(0, 0, 1280, 720).data;
}, HANDOVER_STILL);
const keptStillAgainstFrames = () => page.evaluate(async ({ greeting, loop }) => {
  const full = (source) => {
    const canvas = Object.assign(document.createElement('canvas'), { width: 1280, height: 720 });
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(source, 0, 0, 1280, 720);
    return context.getImageData(0, 0, 1280, 720).data;
  };
  const frameOf = async (clip, frame) => {
    const element = Object.assign(document.createElement('video'), { src: clip.video, muted: true, preload: 'auto' });
    await new Promise((done, fail) => { element.addEventListener('loadeddata', done, { once: true }); element.addEventListener('error', fail, { once: true }); });
    if (frame > 0) {
      element.currentTime = (frame + 0.5) / clip.fps;
      await new Promise((done) => element.addEventListener('seeked', done, { once: true }));
    }
    return full(element);
  };
  const compare = (a, b) => {
    let total = 0, changed = 0, count = 0;
    for (let index = 0; index < a.length; index += 4) total += (Math.abs(a[index] - b[index]) + Math.abs(a[index + 1] - b[index + 1]) + Math.abs(a[index + 2] - b[index + 2])) / 3;
    for (let y = 160; y < 700; y += 1) {
      for (let x = 384; x < 896; x += 1) {
        const index = (y * 1280 + x) * 4;
        if ((Math.abs(a[index] - b[index]) + Math.abs(a[index + 1] - b[index + 1]) + Math.abs(a[index + 2] - b[index + 2])) / 3 > 8) changed += 1;
        count += 1;
      }
    }
    return { mean: Number((total / (a.length / 4)).toFixed(3)), changed: Number((100 * changed / count).toFixed(2)) };
  };
  const still = window.__keptStill;
  return {
    greetingLast: compare(still, await frameOf(greeting, greeting.frames - 1)),
    loopFirst: compare(still, await frameOf(loop, 0)),
    loopMiddle: compare(still, await frameOf(loop, Math.floor(loop.frames / 2))),
  };
}, { greeting: { video: GREETING.video, fps: GREETING.fps, frames: GREETING.frames }, loop: { video: IDLE_CLIP.video, fps: IDLE_CLIP.fps, frames: IDLE_CLIP.frames } });

// Standing Start in the release build: the real greeting plays once in the
// stance loop's place, and the loop takes over from the frame it ended on.
async function releaseGreetingPlaysOnce() {
  const context = await open({ release: true });
  await openArena();
  assert.deepEqual(await stages(), [`stance:${IDLE.moveId}`], 'before a match starts the Arena shows the stance loop and no greeting');
  assert.deepEqual(momentRequests, [], 'no match moment file is asked for before a match starts');
  const before = await stanceBoxes();
  // A machine that is slow to start a video is not what this check is about: the greeting's
  // wait for its first moving frame is kept back (see watchPage) until its picture moves.
  await holdTimeLimits();
  const standing = button('Standing Start');
  if (size.touch) await standing.tap(); else { await standing.focus(); await page.keyboard.press('Enter'); }
  await momentStage(MATCH_GREETING).waitFor();
  await hint('Select your response from standing.');
  assert.equal(await onHeading(), true, 'Standing Start leaves focus on the technique heading while the greeting plays');
  assert.equal(await techniquePanel().locator('.combat-moves button:not([disabled])').count() > 0, true, 'techniques can be chosen while the greeting plays');
  await checkRealGreetingStage();
  await page.waitForFunction((path) => window.__moments.videos.some((entry) => entry.type === 'playing' && entry.path === path), GREETING.video, { timeout: 30000 });
  await releaseTimeLimits();
  const during = await momentBoxes(MATCH_GREETING);
  assert.ok(sameBox(before.stage, during.stage) && sameBox(before.picture, during.picture), `the greeting takes exactly the stance loop's place (${JSON.stringify({ before, during })})`);
  assert.equal(await fits(), true, 'nothing scrolls sideways');
  await momentStage().scrollIntoViewIfNeeded();
  await capture('release-greeting');

  // It ends by itself and the loop takes over, in the same boxes.
  await momentStage().waitFor({ state: 'detached', timeout: 30000 });
  await untilPlaying('stance', IDLE_CLIP.video);
  const after = await stanceBoxes();
  assert.ok(sameBox(before.stage, after.stage) && sameBox(before.picture, after.picture), `the stance loop comes back where it was (${JSON.stringify({ before, after })})`);
  assert.deepEqual([(await video()).loop, await stanceStage().getAttribute('data-move')], [true, IDLE.moveId]);
  // Once: it does not come back.
  await page.waitForTimeout(Math.ceil(GREETING_SECONDS * 1000) + 700);
  const seen = await log();
  assert.deepEqual(seen.stages.map((entry) => entry.stage), [`stance:${IDLE.moveId}`, `moment:${MATCH_GREETING}`, `stance:${IDLE.moveId}`], 'stance loop, greeting, stance loop');
  checkPlaySession(seen, GREETING.video);
  const played = seen.videos.filter((entry) => entry.path === GREETING.video);
  assert.ok(played.every((entry) => entry.loop === false && entry.muted === true));
  const ended = played.find((entry) => entry.type === 'ended');
  assert.ok(ended.time >= GREETING_SECONDS - 0.2, `it played to its end (${ended.time} of ${GREETING_SECONDS} seconds)`);
  const handOver = seen.stages[2].at - ended.at;
  assert.ok(handOver >= 0 && handOver < 500, `the loop takes over as the greeting ends (${handOver} ms)`);
  // The loop takes over from the frame the greeting ended on, which stays until the loop's own first frame is there.
  const loop = checkHandover(seen);
  assert.equal(seen.shiftsWatched, true, 'this browser reports layout shifts');
  assert.deepEqual(seen.shifts.filter((shift) => shift.at >= seen.stages[1].at - 50), [], 'no layout shift from the start of the greeting on');
  // It asked for its own files and for nothing of the end of a match.
  assert.deepEqual([...new Set(momentRequests)].sort(), [GREETING.poster, GREETING.video].sort(), 'the greeting asked for its video and its poster, and for no other match moment file');
  const startedAfter = played[0].at - seen.stages[1].at;
  layouts.push({ check: 'release greeting', size: size.name, viewport: page.viewportSize(), before, during, after, startMilliseconds: startedAfter, handOverMilliseconds: handOver, stillFrames: loop.frames.length, stillMilliseconds: loop.stillGone - loop.born });
  await context.close();
  const between = loop.frames.length === 0 ? 'no frame was painted before that' : `${loop.frames.length} ${loop.frames.length === 1 ? 'frame was' : 'frames were'} painted before that, all under the still`;
  checks.push(`${size.name}, release build: Standing Start plays the published greeting (${GREETING.frames} frames, ${GREETING_SECONDS} s) once in the stance loop's place, with focus on the technique heading and techniques ready to choose (its picture started moving ${startedAfter} ms after it took the loop's place). ${handOver} ms after it ended the stance loop took over in the same boxes with the greeting's last frame laid over it; the loop presented its own frame at ${loop.firstFrame.mediaTime} s ${loop.firstFrame.at - loop.born} ms later (${between}), and the still went ${loop.stillGone - loop.firstFrame.at} ms after that. No layout shift; only the greeting's own files were asked for.`);
}

// On a slow connection the loop's own file takes a while after the greeting
// ends. Until the loop's first frame is there the box shows the frame the
// greeting ended on, which is the loop's first frame, and never the loop's
// poster, a frame halfway through the loop.
async function releaseHandoverHeldBack() {
  const context = await open({ release: true });
  await openArena();
  await holdNextGreeting();
  await press(button('Standing Start'));
  await realGreetingHeld();
  await momentStage().scrollIntoViewIfNeeded();
  // From now on the loop's file is held back.
  const heldBack = [];
  const loopFile = `**${IDLE_CLIP.video}`;
  await page.route(loopFile, (route) => { heldBack.push(route); });
  await greetingResumed();
  await page.locator(HANDOVER_STILL).waitFor({ timeout: 30000 });
  assert.equal(await momentStage().count(), 0, 'the greeting has ended');
  assert.deepEqual(await page.locator(LOOP_VIDEO).evaluate((element) => ({ ready: element.readyState, poster: new URL(element.getAttribute('poster'), location.href).pathname })), { ready: 0, poster: IDLE_CLIP.poster }, 'the loop has no picture of its own yet, and its poster is the one it always has');
  assert.ok(heldBack.length >= 1, 'the loop asked for its file, which is held back');
  // The still covers the picture box exactly, trimmed as the video is, over the video.
  const placed = await stanceStage().locator('.unreal-clip-viewport').evaluate((box) => {
    const [still, element] = [box.querySelector('.unreal-clip-handover'), box.querySelector('video')];
    const [inner, outer] = [still.getBoundingClientRect(), box.getBoundingClientRect()];
    const [style, videoStyle] = [getComputedStyle(still), getComputedStyle(element)];
    return { covers: ['left', 'top', 'width', 'height'].every((key) => Math.abs(inner[key] - outer[key]) <= 1), fit: [style.objectFit, style.objectPosition], videoFit: [videoStyle.objectFit, videoStyle.objectPosition], shown: [style.visibility, style.opacity, style.display], size: [still.width, still.height], over: box.lastElementChild === still && element.nextElementSibling === still };
  });
  assert.deepEqual(placed, { covers: true, fit: ['cover', '50% 70%'], videoFit: ['cover', '50% 70%'], shown: ['visible', '1', 'block'], size: [1280, 720], over: true }, 'the still lies over the video, as big as the picture box and trimmed as the video is');
  await keepStill();
  // As painted: the box with the still, and what it would show without it, the loop's poster.
  const box = stanceStage().locator('.unreal-clip-viewport');
  await painted();
  const withStill = await box.screenshot();
  await page.locator(HANDOVER_STILL).evaluate((element) => { element.style.visibility = 'hidden'; });
  let lit = 0;
  for (let attempt = 0; attempt < 6 && lit < 12; attempt += 1) {
    await painted();
    lit = await middleBrightness(box);
  }
  assert.ok(lit >= 12, `under the still the box shows the loop's poster, a picture (brightness ${lit} of 255)`);
  const withoutStill = await box.screenshot();
  await page.locator(HANDOVER_STILL).evaluate((element) => { element.style.visibility = ''; });
  await painted();
  await capture('release-handover-loop-file-on-its-way');
  // The file arrives: the loop presents its first frame and the still goes. The loop is paused on
  // that frame, to be looked at.
  await page.evaluate(() => { window.__moments.pauseLoopOnFirstFrame = true; });
  await page.unroute(loopFile);
  for (const route of heldBack) await route.continue().catch(() => {});
  await page.locator(HANDOVER_STILL).waitFor({ state: 'detached', timeout: 30000 });
  await page.waitForFunction((selector) => window.__moments.pauseLoopOnFirstFrame === false && document.querySelector(selector)?.paused === true, LOOP_VIDEO, { timeout: 30000 });
  // The frame on screen may already be the next one (a busy machine presents a frame or two
  // before it says so, and the clock does not tell which): look at frame 0 itself.
  await page.locator(LOOP_VIDEO).evaluate(async (element) => {
    element.currentTime = 0.5 / 30;
    await new Promise((done) => element.addEventListener('seeked', done, { once: true }));
  });
  await painted();
  const firstFrame = await box.screenshot();
  const loop = checkHandover(await log());
  // What the still showed: exactly the greeting's last frame, which is the loop's first frame, and
  // not its middle one.
  const frames = await keptStillAgainstFrames();
  assert.ok(frames.greetingLast.mean < 0.5 && frames.greetingLast.changed < 0.5, `the still is the greeting's last frame (${JSON.stringify(frames)})`);
  assert.ok(frames.loopFirst.changed < 3, `which is the loop's first frame (${JSON.stringify(frames)})`);
  assert.ok(frames.loopMiddle.changed > 4 && frames.loopMiddle.changed > 2 * frames.loopFirst.changed, `and not its middle frame, the one its poster shows (${JSON.stringify(frames)})`);
  // As painted: the loop's own first frame takes over from the still with no visible change; the
  // poster it kept off the screen is another pose.
  const kept = await compareShots(withStill, firstFrame);
  const poster = await compareShots(withStill, withoutStill);
  assert.ok(kept.changed < 3, `the loop's first frame takes over from the still with no visible change (${JSON.stringify({ kept, poster })})`);
  assert.ok(poster.changed > 4 && poster.changed > 2 * kept.changed, `the poster the still kept off the screen would have shown another pose (${JSON.stringify({ kept, poster })})`);
  // And on it plays.
  await page.locator(LOOP_VIDEO).evaluate((element) => { element.play(); });
  await untilPlaying('stance', IDLE_CLIP.video);
  layouts.push({ check: 'release handover, loop file held back', size: size.name, stillAgainstFrames: frames, painted: { kept, poster }, loopFirstFrame: loop.firstFrame });
  await context.close();
  checks.push(`${size.name}, release build: while the loop's file was held back after the greeting, the box showed the greeting's last frame (exactly that frame: mean difference ${frames.greetingLast.mean}; against the loop's first frame ${frames.loopFirst.changed}% of the athletes' pixels differ by more than 8 levels, against its middle frame ${frames.loopMiddle.changed}%), laid over the loop's video and trimmed as it is; under it was the loop's poster. When the file arrived the loop's first frame took over (${kept.changed}% of the painted pixels changed; the poster would have changed ${poster.changed}%).`);
}

// Skip in the release build: the stance loop shows at once, with focus on the
// technique heading. The greeting did not play to its end, so it hands no frame
// on and the loop opens as it always does.
async function releaseGreetingSkip() {
  const context = await open({ release: true });
  await openArena();
  await holdNextGreeting();
  await press(button('Standing Start'));
  await realGreetingHeld();
  await momentStage().getByRole('button', { name: 'Skip', exact: true }).focus();
  await page.keyboard.press('Enter');
  await stanceStage().waitFor();
  assert.equal(await momentStage().count(), 0, 'Skip ends the greeting');
  assert.equal(await onHeading(), true, 'after Skip focus is on the technique heading');
  await untilPlaying('stance', IDLE_CLIP.video);
  const seen = await log();
  const loop = seen.loops.at(-1);
  assert.deepEqual([loop.path, loop.stillAtBirth, loop.stillGone], [IDLE_CLIP.video, false, null], 'a skipped greeting hands no frame on');
  assert.equal(await page.locator(HANDOVER_STILL).count(), 0);
  checkPlaySession(seen, GREETING.video, { ends: 0 });
  await press(firstTechnique());
  await page.locator('.sequence-panel .order-stack').waitFor();
  await context.close();
  checks.push(`${size.name}, release build: Skip ends the greeting at once, the stance loop shows as it always does (no still handed on), focus goes to the technique heading, and the match goes on.`);
}

// Reduced motion in the release build: no greeting, and its files are not even
// asked for. The stance loop stays as it was, and a start that does not move
// focus (a browser that does not focus a button it clicks) leaves focus where it
// was, also on the stance loop's own control: with no greeting to end, nothing
// sends it to the technique heading.
async function releaseGreetingReducedMotion() {
  const context = await open({ release: true, reducedMotion: 'reduce' });
  await page.goto(`${base}/`);
  await press(navButton('Arena'));
  await stanceStage().waitFor();
  await page.waitForFunction((selector) => document.querySelector(selector)?.readyState >= 1, LOOP_VIDEO);
  await stanceStage().locator('video').evaluate((element) => { element.dataset.mark = 'before the start'; });
  const standing = button('Standing Start');
  if (size.touch) await standing.tap(); else { await standing.focus(); await page.keyboard.press('Enter'); }
  await hint('Select your response from standing.');
  assert.equal(await onHeading(), true, 'Standing Start leaves focus on the technique heading');
  await page.waitForTimeout(900);
  const state = await video();
  assert.deepEqual([state.mark, state.paused, state.time], ['before the start', true, 0], 'reduced motion: the stance loop waits on its poster, in the same <video>');
  assert.deepEqual((await stages()).filter((stage) => stage.startsWith('moment:')), [], 'reduced motion: no greeting');
  await stanceStage().locator('.unreal-clip-play').focus();
  await page.evaluate(() => document.querySelector('.arena-page-heading button[title="Restart match"]').click());
  await page.locator('.combat-grid .sr-only[role="status"]').filter({ hasText: 'Match restarted against' }).waitFor();
  await hint('Select your response from standing.');
  await painted();
  assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('.mat-window .unreal-clip-stage[data-kind="stance"] .unreal-clip-play')), true, 'a restart that leaves focus on the stance loop\'s Play button leaves it there');
  assert.equal((await video()).mark, 'before the start', 'and the stance loop is still the same <video>');
  assert.deepEqual(momentRequests, [], 'reduced motion: no match moment file is asked for');
  await context.close();
  checks.push(`${size.name}, release build with reduced motion: no greeting and no request for its files; the stance loop stays paused on its poster in the same <video>; a restart leaves focus on the stance loop's own control.`);
}

// The release build greets only over the loop the greeting was rendered for:
// the standard stance loop, from the side. Over the front view of that loop
// (the published greeting has no front view), over a loop of the player's own
// stance (the karate loop from the side, and the motion-captured boxing and
// Muay Thai loops from the front) and over a loop of the rival's stance there
// is no greeting, its files are not asked for, and the loop carries on.
async function releaseNoGreetingOverOtherLoops() {
  const front = findUnrealClip(IDLE.moveId, IDLE.performerSide, 'front');
  const karate = stanceLoop('karate stance', defaultNpcs[0].stance);
  const karateClip = findUnrealClip(karate.moveId, karate.performerSide);
  const boxing = stanceLoop('boxer shell', defaultNpcs[0].stance);
  const boxingFront = findUnrealClip(boxing.moveId, boxing.performerSide, 'front');
  const muayThai = stanceLoop('muay thai guard', defaultNpcs[0].stance);
  const muayThaiFront = findUnrealClip(muayThai.moveId, muayThai.performerSide, 'front');
  const rival = defaultNpcs.find((npc) => stanceLoop(DEFAULT_STANCE, npc.stance).performerSide === 'opponent');
  const rivalLoop = rival && stanceLoop(DEFAULT_STANCE, rival.stance);
  const rivalClip = rival && findUnrealClip(rivalLoop.moveId, rivalLoop.performerSide);
  assert.ok(front && karate.exact && karateClip && rivalClip, 'the front view of the standard loop, the karate loop and a default rival\'s own stance loop are published');
  assert.ok(boxing.exact && boxingFront, 'the boxing loop of the player\'s own stance is published with a front view');
  assert.ok(muayThai.exact && muayThaiFront, 'the Muay Thai loop of the player\'s own stance is published with a front view');
  assert.deepEqual([findUnrealClip(MATCH_GREETING, 'fighter', 'front')], [null], 'the published greeting has no front view');
  const cases = [
    ['the front view of the standard loop', front, async () => {
      await press(stanceStage().getByRole('group', { name: 'Camera view', exact: true }).getByRole('button', { name: 'Front', exact: true }));
    }],
    ['the karate loop of the player\'s own stance', karateClip, async () => {
      await page.getByRole('radiogroup', { name: 'Starting stance', exact: true }).getByRole('radio', { name: 'Karate Stance', exact: true }).check();
    }],
    ['the boxing loop of the player\'s own stance, seen from the front', boxingFront, async () => {
      await page.getByRole('radiogroup', { name: 'Starting stance', exact: true }).getByRole('radio', { name: 'Boxer Shell', exact: true }).check();
      await untilPlaying('stance', findUnrealClip(boxing.moveId, boxing.performerSide, 'side').video);
      await press(stanceStage().getByRole('group', { name: 'Camera view', exact: true }).getByRole('button', { name: 'Front', exact: true }));
    }],
    ['the Muay Thai loop of the player\'s own stance, seen from the front', muayThaiFront, async () => {
      await page.getByRole('radiogroup', { name: 'Starting stance', exact: true }).getByRole('radio', { name: 'Muay Thai Guard', exact: true }).check();
      await untilPlaying('stance', findUnrealClip(muayThai.moveId, muayThai.performerSide, 'side').video);
      await press(stanceStage().getByRole('group', { name: 'Camera view', exact: true }).getByRole('button', { name: 'Front', exact: true }));
    }],
    [`the ${rival.stance} loop of ${rival.name}`, rivalClip, async () => {
      await page.getByLabel('Choose opponent', { exact: true }).selectOption(rival.id);
    }],
  ];
  for (const [, clip, choose] of cases) {
    const context = await open({ release: true });
    await openArena();
    await choose();
    await untilPlaying('stance', clip.video);
    await noGreetingOver(clip, () => press(button('Standing Start')));
    await press(firstTechnique());
    await page.locator('.sequence-panel .order-stack').waitFor();
    await context.close();
  }
  checks.push(`${size.name}, release build: no greeting over ${cases.map(([name]) => name).join(', ')}; each loop carries on in the same <video> after Standing Start, no match moment file is asked for, and the match goes on.`);
}

// Restart match while a technique is being chosen, pressed in a way that does
// not move focus (Safari does not focus a button it clicks), with focus on the
// stance loop's own Pause button. The restart greets: the greeting takes the
// loop's place, the button with it, and focus goes to the technique heading,
// where a start puts it, while the greeting plays and after it.
async function releaseRestartFromLoopControl() {
  const context = await open({ release: true });
  await openArena();
  await press(button('Standing Start'));
  await hint('Select your response from standing.');
  await greetingCameAndWent();
  const pause = stanceStage().locator('.unreal-clip-play');
  assert.deepEqual(await texts(pause), ['Pause']);
  await pause.focus();
  await holdNextGreeting();
  await page.evaluate(() => document.querySelector('.arena-page-heading button[title="Restart match"]').click());
  await page.locator('.combat-grid .sr-only[role="status"]').filter({ hasText: 'Match restarted against' }).waitFor();
  await realGreetingHeld();
  assert.equal(await onHeading(), true, 'while the greeting plays, focus is on the technique heading, not on the page');
  await greetingResumed();
  await momentStage().waitFor({ state: 'detached', timeout: 30000 });
  await untilPlaying('stance', IDLE_CLIP.video);
  assert.equal(await onHeading(), true, 'after the greeting, focus is still on the technique heading');
  if (!size.touch) {
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('aside[aria-label="Technique selection"] .combat-moves button:not([disabled])')), true, 'one Tab reaches the first technique');
  }
  assert.equal((await stages()).filter((stage) => stage === `moment:${MATCH_GREETING}`).length, 2, 'Standing Start and Restart match each greeted once');
  await context.close();
  checks.push(`${size.name}, release build: with focus on the stance loop's Pause button, a Restart match that does not move focus greets, and focus is on the technique heading while the greeting plays and after it${size.touch ? '' : ', one Tab from the first technique'}.`);
}

try {
  // The release build's checks are written for what is published: the greeting's side view,
  // and no end-of-match moment. Any other match moment file in the real list stops the suite,
  // also one the game does not show yet (a front view), until these checks follow it.
  const live = UNREAL_CLIPS.filter((clip) => isMatchMoment(clip.moveId)).map((clip) => `${clip.moveId}/${clip.performerSide}-${clip.camera}`);
  assert.deepEqual(live, [`${MATCH_GREETING}/fighter-side`], `the published match moment clips are not the ones this suite checks (${live.join(', ')}): check them here against the real files`);
  fixtures = MATCH_MOMENT_IDS.flatMap(fixtureClips);
  bundles = { moments: await buildBundle('moments', fixtures) };
  checks.push(`A test bundle was built with VITE_COMBAT_ENGINE=unity, relabelling the published standing-stance files as ${MATCH_MOMENT_IDS.join(', ')} (${IDLE_CLIP.frames} frames, ${FIXTURE_SECONDS} seconds, side and front).`);
  bundle = bundles.moments;
  base = await staticSite();
  browser = await chromium.launch(browserOptions);
  report.browserVersion = browser.version();

  for (size of SIZES) {
    await releaseGreetingPlaysOnce();
    await releaseHandoverHeldBack();
    await releaseGreetingSkip();
    await releaseGreetingReducedMotion();
    await releaseNoGreetingOverOtherLoops();
    await releaseRestartFromLoopControl();
    await greetingPlaysOnce();
    await greetingGivesWay();
    await greetingFollowsTheLoop();
    await pausedLoopStaysPaused();
    await greetingCannotLoad();
    await greetingFilesArriveLate();
    await greetingFilesNeverArrive();
    await greetingStalls();
    await greetingReducedMotion();
    // A win, on the release default: the final exchange is the position picture under Unity's note.
    await finishedMatch({ id: MATCH_WIN, saved: WINNER, techniqueName: WINNING_TECHNIQUE, expectWin: true });
    // A loss, with position pictures only: up to eight rounds against the third rival.
    await finishedMatch({ id: MATCH_LOSS, saved: null, techniqueName: LOSING_TECHNIQUE, rival: STRONG_RIVAL, search: '?engine=snapshot', expectWin: false });
    await resultChoiceIsKept();
    await finishedReducedMotion();
    await resultCannotLoad();
  }
  // The narrowest phone the site is laid out for.
  size = NARROW;
  await narrowPhone();

  assert.deepEqual(errors, []);
  assert.deepEqual(consoleErrors, [], 'Unexpected browser console errors');
  assert.deepEqual(failedResponses, [], 'Every file must load');
  report.status = 'passed';
  console.log(JSON.stringify({ checks, layouts, images: images.length, artifacts }, null, 2));
} catch (error) {
  report.status = 'failed'; report.failure = error.stack || String(error);
  if (page && !page.isClosed()) report.lastPageEvents = await log().catch(() => null);
  if (page && !page.isClosed()) await page.screenshot({ path: resolve(artifacts, 'failure.png'), fullPage: true, timeout: 10000 }).catch(() => {});
  console.error(error); process.exitCode = 1;
} finally {
  Object.assign(report, { checkedAtUtc: new Date().toISOString(), checks, layouts, images, pageErrors: errors, consoleErrors, expectedConsoleErrors, failedResponses });
  await writeFile(resolve(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  if (browser) await browser.close().catch(() => {});
  if (server) { server.closeAllConnections(); await new Promise((resolveClose) => server.close(resolveClose)); }
}
