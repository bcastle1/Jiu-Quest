// Browser checks for a technique played as a pre-rendered Unreal clip, shared by
// tools/test_unreal_technique_clips.mjs (a test bundle with fixture clips) and the
// self-switching block in tools/test_unreal_clip_stage.mjs (the real release).
// Each check drives one Playwright page and throws on the first difference.
import assert from 'node:assert/strict';
import { allMoves } from '../src/data/curriculum.js';
import { resolveUnityMove } from '../src/unity/bridge.js';
import { TECHNIQUE_OPENING_CAMERA } from '../src/unreal/techniquePicture.js';
import { techniqueNote } from '../src/unreal/clipPlayback.js';

export const CARD = '.training-animation-card';
export const MAT = '.mat-window';
export const TECHNIQUE_IDS = Object.freeze(['double_leg', 'rear_naked_choke', 'triangle_choke', 'trap_roll_escape']);
export const escapeName = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The curriculum move a technique clip belongs to: its name and where it starts.
export function curriculumMove(moveId) {
  const move = allMoves.find((item) => resolveUnityMove(item.id) === moveId);
  assert.ok(move, `${moveId} has a curriculum move`);
  return move;
}

// The view a technique opens on, given the views that exist for one performer.
export function openingView(moveId, views) {
  return views.find((clip) => clip.camera === TECHNIQUE_OPENING_CAMERA[moveId]) ?? views[0];
}

export const techniqueStage = (page, scope) => page.locator(`${scope} .unreal-clip-stage[data-kind="technique"]`);

// Every request for a Unity file the page makes, so a check can say none was made.
export function watchUnity(page) {
  const urls = [];
  page.on('request', (request) => { if (new URL(request.url()).pathname.startsWith('/unity/')) urls.push(new URL(request.url()).pathname); });
  return { count: () => urls.length, since: (mark) => urls.slice(mark) };
}

export const fits = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const box = async (locator) => { const found = await locator.boundingBox(); return found && { x: found.x, y: found.y, width: found.width, height: found.height }; };
// A box in page coordinates, so scrolling does not move it.
const pageBox = (locator) => locator.evaluate((element) => { const rect = element.getBoundingClientRect(); return { x: rect.x + window.scrollX, y: rect.y + window.scrollY, width: rect.width, height: rect.height }; });
const sameBox = (left, right) => ['x', 'y', 'width', 'height'].every((key) => Math.abs(left[key] - right[key]) <= 1);

export const clipState = (page, scope) => techniqueStage(page, scope).evaluate((stage) => {
  const video = stage.querySelector('video');
  const range = stage.querySelector('input[type="range"]');
  const note = stage.querySelector('.unreal-clip-note');
  const text = (selector) => stage.querySelector(selector)?.textContent.trim() ?? null;
  return {
    move: stage.dataset.move, performer: stage.dataset.performer, camera: stage.dataset.camera, endedAttr: stage.dataset.ended,
    label: stage.getAttribute('aria-label'), describedBy: stage.getAttribute('aria-describedby'), noteId: note?.id ?? null, note: note?.textContent ?? null,
    kicker: text('.unreal-clip-heading span'), title: text('.unreal-clip-heading strong'), tag: text('.unreal-clip-draft'),
    fighterLine: text('.unreal-clip-legend [data-side="fighter"]'), opponentLine: text('.unreal-clip-legend [data-side="opponent"]'),
    face: text('.unreal-clip-play'),
    path: new URL(video.currentSrc || video.src).pathname, poster: new URL(video.poster, location.href).pathname,
    paused: video.paused, ended: video.ended, time: video.currentTime, duration: video.duration, rate: video.playbackRate, defaultRate: video.defaultPlaybackRate,
    loop: video.loop, muted: video.muted, ready: video.readyState, seeking: video.seeking, mark: video.dataset.mark ?? null,
    frame: range ? Number(range.value) : null, max: range ? Number(range.max) : null, valuetext: range?.getAttribute('aria-valuetext') ?? null,
  };
});

const untilPlaying = (page, scope, path) => page.waitForFunction(({ selector, wanted }) => {
  const video = document.querySelector(`${selector} .unreal-clip-stage[data-kind="technique"] video`);
  return video && (!wanted || new URL(video.currentSrc || video.src).pathname === wanted) && video.readyState >= 2 && !video.paused && video.currentTime > 0.03;
}, { selector: scope, wanted: path }, { timeout: 30000 });
const untilEnded = (page, scope, clip, rate = 1) => page.waitForFunction((selector) => document.querySelector(`${selector} .unreal-clip-stage[data-kind="technique"] video`)?.ended === true, scope, { timeout: 30000 + (clip.frames / clip.fps / rate) * 1000 });
const untilStill = (page, scope) => page.waitForFunction((selector) => {
  const video = document.querySelector(`${selector} .unreal-clip-stage[data-kind="technique"] video`);
  return video && video.readyState >= 2 && !video.seeking && video.paused;
}, scope, { timeout: 15000 });

// The words on the stage: kicker, title, draft tag, note and who performs.
function checkLabels(state, { clip, title, performer, reducedMotion = false }) {
  assert.equal(state.kicker, 'Unreal Engine clip');
  assert.equal(state.title, title);
  assert.equal(state.label, `${title}, Unreal Engine clip`);
  assert.equal(state.tag, clip.choreographyReviewed === false ? 'Draft choreography' : null);
  assert.equal(state.note, techniqueNote({ choreographyReviewed: clip.choreographyReviewed, reducedMotion }));
  assert.match(state.note, /^Pre-rendered video\. Animated visual reference\. .*Playback does not award points or training repetitions\./);
  assert.equal(state.describedBy, state.noteId, 'the region is described by its note');
  const [performs, other] = performer === 'opponent' ? [state.opponentLine, state.fighterLine] : [state.fighterLine, state.opponentLine];
  assert.match(performs, / · performs the technique$/, `the ${performer} performs`);
  assert.doesNotMatch(other, /performs the technique/);
  assert.deepEqual([state.performer, state.muted, state.loop], [performer, true, false], 'silent and plays once');
}

// Opens Training on the technique and checks the whole study stage. `views` are
// the fighter's views in button order; `unity` is watchUnity(page).
export async function checkTraining(page, { base, moveId, views, unity, capture, checks }) {
  const move = curriculumMove(moveId);
  const clip = openingView(moveId, views);
  await page.goto(`${base}/`);
  await page.getByRole('button', { name: 'Training', exact: true }).click();
  const mark = unity.count();
  await page.locator('.training-sidebar').getByRole('button', { name: new RegExp(escapeName(move.name)) }).first().click();
  await page.locator(`${CARD} .unreal-clip-stage[data-kind="technique"][data-move="${moveId}"]`).waitFor();
  assert.equal(await page.locator(`${CARD} .training-animation-head h3`).textContent(), 'Movement preview');
  assert.equal(await page.locator(`${CARD} .unity-stage, ${CARD} .grappling-snapshot-stage`).count(), 0, 'the clip is the only picture');
  await untilPlaying(page, CARD, clip.video);
  let state = await clipState(page, CARD);
  assert.deepEqual([state.move, state.camera, state.path, state.poster], [moveId, clip.camera, clip.video, clip.poster]);
  checkLabels(state, { clip, title: move.name, performer: 'fighter' });
  assert.equal(state.face, 'Pause');
  checks.push(`Training on ${move.name}: the Unreal clip plays as a "Movement preview", labelled with its kicker, draft tag, note and who performs.`);

  // Plays once and rests on its last frame; one press of Replay starts it again.
  await untilEnded(page, CARD, clip);
  await page.waitForTimeout(150);
  state = await clipState(page, CARD);
  assert.deepEqual([state.paused, state.ended, state.loop, state.endedAttr, state.face], [true, true, false, 'true', 'Replay']);
  assert.ok(state.time >= state.duration - 1 / clip.fps, `rests on its last frame (${state.time} of ${state.duration})`);
  assert.equal(state.frame, clip.frames - 1, 'the scrubber shows the last frame');
  if (capture) await capture(`training-${moveId}-ended`);
  await techniqueStage(page, CARD).getByRole('button', { name: 'Replay', exact: true }).click();
  await untilPlaying(page, CARD);
  state = await clipState(page, CARD);
  assert.deepEqual([state.ended, state.endedAttr, state.face], [false, 'false', 'Pause'], 'one press of Replay plays again');
  assert.ok(state.time < state.duration / 2, `Replay starts from the beginning (${state.time})`);
  checks.push('The technique plays once, rests on its last frame with Replay, and one press plays it again from the start.');

  // Speeds, measured against the clock.
  const speeds = techniqueStage(page, CARD).getByRole('group', { name: 'Playback speed', exact: true });
  assert.deepEqual(await speeds.getByRole('button').allInnerTexts(), ['0.25×', '0.5×', '1×']);
  assert.equal(await speeds.getByRole('button', { name: '1×', exact: true }).getAttribute('aria-pressed'), 'true');
  await speeds.getByRole('button', { name: '0.25×', exact: true }).click();
  assert.equal(await speeds.getByRole('button', { name: '0.25×', exact: true }).getAttribute('aria-pressed'), 'true');
  state = await clipState(page, CARD);
  if (state.ended || state.paused) { await techniqueStage(page, CARD).locator('.unreal-clip-play').click(); await untilPlaying(page, CARD); }
  const [from, fromClock] = [(await clipState(page, CARD)).time, Date.now()];
  await page.waitForTimeout(1200);
  const after = await clipState(page, CARD);
  const measured = (after.time - from) / ((Date.now() - fromClock) / 1000);
  assert.deepEqual([after.rate, after.defaultRate], [0.25, 0.25]);
  assert.ok(measured > 0.12 && measured < 0.4, `quarter speed runs at a quarter of the clock (${measured.toFixed(3)})`);

  // The scrubber steps frame by frame from the keyboard and holds the picture still.
  const scrubber = techniqueStage(page, CARD).getByRole('slider', { name: 'Review movement', exact: true });
  assert.deepEqual([await scrubber.getAttribute('min'), await scrubber.getAttribute('max'), await scrubber.getAttribute('step')], ['0', String(clip.frames - 1), '1']);
  await scrubber.focus();
  await page.keyboard.press('Home');
  await untilStill(page, CARD);
  for (let press = 0; press < 3; press += 1) await page.keyboard.press('ArrowRight');
  await page.waitForFunction((selector) => document.querySelector(`${selector} input[type="range"]`)?.value === '3', CARD);
  await untilStill(page, CARD);
  state = await clipState(page, CARD);
  const frameTime = (frame) => (frame + 0.5) / clip.fps;
  assert.deepEqual([state.frame, state.paused, state.ended, state.face], [3, true, false, 'Play']);
  assert.ok(Math.abs(state.time - frameTime(3)) < 0.5 / clip.fps, `three presses step three frames (${state.time})`);
  assert.equal(state.valuetext, `${(3 / clip.fps).toFixed(1)} of ${(clip.durationSeconds ?? clip.frames / clip.fps).toFixed(1)} seconds`);
  checks.push(`Speeds 0.25×, 0.5× and 1× change the playback rate (quarter speed measured at ${measured.toFixed(2)}× the clock), and the scrubber steps one frame per arrow key and holds still.`);

  // The other camera keeps the moment.
  const other = views.find((view) => view.camera !== clip.camera);
  if (other) {
    await techniqueStage(page, CARD).getByRole('group', { name: 'Camera view', exact: true }).getByRole('button', { name: other.camera === 'front' ? 'Front' : 'Side', exact: true }).click();
    await page.waitForFunction(({ selector, wanted }) => {
      const video = document.querySelector(`${selector} .unreal-clip-stage[data-kind="technique"] video`);
      return video && new URL(video.currentSrc || video.src).pathname === wanted && video.readyState >= 2 && !video.seeking && video.currentTime > 0;
    }, { selector: CARD, wanted: other.video }, { timeout: 15000 });
    state = await clipState(page, CARD);
    assert.deepEqual([state.camera, state.frame, state.paused], [other.camera, 3, true]);
    assert.ok(Math.abs(state.time - frameTime(3)) < 0.5 / clip.fps, `the ${other.camera} view opens on the same frame (${state.time})`);
    checks.push(`Changing to the ${other.camera} view keeps the moment (frame 3).`);
  }
  assert.deepEqual(unity.since(mark), [], 'no Unity file is requested while the clip plays');
  if (capture) await capture(`training-${moveId}-study`);
}

// Reduced motion: the clip waits on its first frame and says so.
export async function checkTrainingReducedMotion(page, { base, moveId, views, checks }) {
  const move = curriculumMove(moveId);
  const clip = openingView(moveId, views);
  await page.goto(`${base}/`);
  await page.getByRole('button', { name: 'Training', exact: true }).click();
  await page.locator('.training-sidebar').getByRole('button', { name: new RegExp(escapeName(move.name)) }).first().click();
  await page.waitForFunction((selector) => document.querySelector(`${selector} .unreal-clip-stage[data-kind="technique"] video`)?.readyState >= 1, CARD, { timeout: 15000 });
  await page.waitForTimeout(700);
  const state = await clipState(page, CARD);
  assert.deepEqual([state.paused, state.time, state.face, state.frame], [true, 0, 'Play', 0], 'reduced motion waits on frame 0');
  checkLabels(state, { clip, title: move.name, performer: 'fighter', reducedMotion: true });
  assert.match(state.note, /Reduced motion is on; press Play when ready\.$/);
  await techniqueStage(page, CARD).getByRole('button', { name: 'Play', exact: true }).click();
  await untilPlaying(page, CARD);
  checks.push('With reduced motion the technique waits paused on frame 0, the note says "Reduced motion is on; press Play when ready.", and Play starts it.');
}

// Phones: nothing scrolls sideways and every button is at least 44 pixels tall.
export async function checkTrainingPhone(page, { base, moveId, viewport, capture }) {
  const move = curriculumMove(moveId);
  await page.goto(`${base}/`);
  await page.getByRole('button', { name: 'Training', exact: true }).click();
  await page.locator('.training-sidebar').getByRole('button', { name: new RegExp(escapeName(move.name)) }).first().click();
  const stage = techniqueStage(page, CARD);
  await stage.waitFor();
  await stage.scrollIntoViewIfNeeded();
  await page.waitForFunction((selector) => document.querySelector(`${selector} .unreal-clip-stage[data-kind="technique"] video`)?.readyState >= 2, CARD, { timeout: 30000 });
  assert.equal(await fits(page), true, `${viewport.width}-pixel Training must not scroll sideways`);
  const heights = [];
  for (const button of await stage.getByRole('button').all()) heights.push((await button.boundingBox()).height);
  assert.ok(heights.length >= 5 && heights.every((height) => height >= 44), `buttons are easy to tap (${heights.map(Math.round).join(', ')})`);
  const stageBox = await box(stage);
  assert.ok(stageBox.x >= 0 && stageBox.x + stageBox.width <= viewport.width + 1, 'the stage fits the phone');
  if (capture) await capture(`training-${moveId}-${viewport.width}`);
  return { viewport, stage: stageBox, smallestButton: Math.min(...heights) };
}

// Start (or restart) a match where the technique starts, choose it (or, when
// `own` is false, another technique, so the rival can win with it) and submit.
// Returns what settled and the stance picture's box just before, if one showed.
async function exchange(page, move, unity, own = true) {
  const standing = move.starts[0] === 'standing';
  const startButton = page.getByRole('button', { name: standing ? 'Standing Start' : 'Position Start', exact: true });
  if (await startButton.isVisible()) {
    if (!standing) await page.getByLabel('Your starting position', { exact: true }).selectOption(move.starts[0]);
    await startButton.click();
  } else {
    await page.locator('.arena-page-heading').getByRole('button', { name: 'Restart match' }).click();
  }
  const choices = page.locator('.combat-moves .combat-group').first();
  const mine = new RegExp(`^${escapeName(move.name)}`);
  if (own) await choices.getByRole('button', { name: mine }).first().click();
  else await choices.locator('button:not([disabled])').filter({ hasNotText: mine }).first().click();
  await page.locator('.sequence-panel .order-stack').waitFor();
  const stance = page.locator(`${MAT} .unreal-clip-stage[data-kind="stance"] .unreal-clip-viewport`);
  const stanceBox = await stance.count() ? await pageBox(stance) : null;
  const unityMark = unity?.count() ?? 0;
  await page.getByRole('button', { name: 'Submit sequence', exact: true }).click();
  const outcome = page.locator('.arena-outcome');
  await outcome.waitFor();
  const headline = (await outcome.locator('span').first().innerText()).trim();
  const performer = (await outcome.getAttribute('class')).includes('success') ? 'fighter' : 'opponent';
  return { headline, performer, won: headline.includes(`executes ${move.name}`) || headline.includes(`with ${move.name}`), stanceBox, unityMark };
}

// Plays exchanges until `want` says to stop, calling `onWin` for each exchange
// the technique wins (by either athlete). The player chooses the technique while
// `playerTries(seen)` is true, and another one after. The page's Math.random
// must be seeded.
export async function playArena(page, { base, moveId, cap = 150, want, onWin, unity, playerTries = () => true }) {
  const move = curriculumMove(moveId);
  page.on('dialog', (dialog) => dialog.accept());
  await page.goto(`${base}/`);
  await page.getByRole('button', { name: 'Arena', exact: true }).click();
  const seen = { fighter: 0, opponent: 0, exchanges: 0, headlines: [] };
  while (seen.exchanges < cap && !want(seen)) {
    const result = await exchange(page, move, unity, playerTries(seen));
    seen.exchanges += 1;
    if (!result.won) continue;
    seen[result.performer] += 1;
    seen.headlines.push(`${seen.exchanges}: ${result.headline}`);
    await onWin({ ...result, count: seen[result.performer], seen });
  }
  assert.ok(want(seen), `within ${cap} exchanges the Arena showed ${moveId} won by each athlete (${JSON.stringify(seen)})`);
  return seen;
}

// One win shown as the technique clip: right performer, no Unity, frame 0 first,
// and the same picture box the stance used.
export async function checkArenaWin(page, { win, moveId, views, unity, title }) {
  const clip = openingView(moveId, views[win.performer]);
  const stage = techniqueStage(page, MAT);
  await page.locator(`${MAT} .unreal-clip-stage[data-kind="technique"][data-performer="${win.performer}"][data-move="${moveId}"]`).waitFor({ timeout: 10000 });
  const first = await clipState(page, MAT);
  assert.equal(first.mark, null, 'a new win is a new video, not the last one carried over');
  assert.ok(first.time < 0.3 && !first.ended, `the clip starts again from frame 0 (${first.time})`);
  await stage.scrollIntoViewIfNeeded();
  await untilPlaying(page, MAT, clip.video);
  const state = await clipState(page, MAT);
  assert.deepEqual([state.path, state.camera], [clip.video, clip.camera]);
  checkLabels(state, { clip, title, performer: win.performer });
  assert.equal(await page.locator(`${MAT} .unity-stage, ${MAT} .unity-unavailable, ${MAT} .grappling-snapshot-stage`).count(), 0, 'the clip is the only picture');
  await page.waitForTimeout(300);
  assert.deepEqual(unity.since(win.unityMark), [], 'no Unity file is requested for a technique that has its clips');
  if (win.stanceBox) {
    const pictureBox = await pageBox(stage.locator('.unreal-clip-viewport'));
    assert.ok(sameBox(win.stanceBox, pictureBox), `the cut from the stance keeps the picture box (${JSON.stringify(win.stanceBox)} then ${JSON.stringify(pictureBox)})`);
  }
  // Mark this video so the next win can tell it got a new one.
  await stage.locator('video').evaluate((video) => { video.dataset.mark = 'seen'; });
  return state;
}
