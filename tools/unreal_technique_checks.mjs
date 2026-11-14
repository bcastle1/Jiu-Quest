// Browser checks for a technique played as a pre-rendered Unreal clip, shared by
// tools/test_unreal_technique_clips.mjs (a test bundle with fixture clips) and the
// self-switching block in tools/test_unreal_clip_stage.mjs (the real release).
// Each check drives one Playwright page and throws on the first difference.
import assert from 'node:assert/strict';
import { allMoves, moves, trainingStartPositions } from '../src/data/curriculum.js';
import { TECHNIQUE_OPENING_CAMERA } from '../src/unreal/techniquePicture.js';
import { unrealClipMoveId, unrealClipStart } from '../src/unreal/techniqueIds.js';
import { techniqueNote } from '../src/unreal/clipPlayback.js';

export const CARD = '.training-animation-card';
export const MAT = '.mat-window';
// The clip id of every curriculum technique, in curriculum order: any of them
// can take clips. This is the importer's list.
export { TECHNIQUE_IDS } from './import_unreal_clips.mjs';
// Text as the page shows it: runs of white space read as one space.
const flat = (text) => text.replace(/\s+/g, ' ').trim();

// The curriculum move a technique clip belongs to: its name and where it starts.
export function curriculumMove(moveId) {
  const move = allMoves.find((item) => unrealClipMoveId(item.id) === moveId);
  assert.ok(move, `${moveId} has a curriculum move`);
  return move;
}

// Training lists the techniques of the blue, purple, brown and black belts. The
// white-belt starters (allMoves less moves) are offered in the Arena only.
export const inTraining = (move) => moves.includes(move);

// Opens one technique in Training, which is already on screen: its belt tab,
// then the row that carries exactly its name (some names begin with another's).
export async function openTrainingTechnique(page, move) {
  assert.ok(inTraining(move), `Training lists ${move.name}`);
  const sidebar = page.locator('.training-sidebar');
  await sidebar.locator(`.belt-tabs button[data-belt="${move.belt}"]`).click();
  const rows = sidebar.locator('.move-row');
  const names = await rows.evaluateAll((list) => list.map((row) => row.querySelector('strong')?.textContent ?? ''));
  assert.equal(names.filter((name) => name === move.name).length, 1, `Training lists ${move.name} once under the ${move.belt} belt`);
  await rows.nth(names.indexOf(move.name)).click();
  await page.waitForFunction((name) => document.querySelector('.technique-head h1')?.textContent === name, move.name);
}

// The Arena's button that starts a match in `position`: on the feet, kneeling,
// or from its position menu. Null when it offers none of them there.
export function arenaStartAt(position) {
  if (position === 'standing') return { button: 'Standing Start', position };
  if (position === 'kneeling') return { button: 'Kneeling Start', position };
  if (trainingStartPositions.includes(position)) return { button: 'Position Start', position };
  return null;
}

// How the Arena starts a match in this technique's clip start, the position its
// clips are rendered from and the only start after which they play. Null when
// the Arena cannot start a match there: a technique that starts only from the
// top of the guard is reached during a match.
export const arenaStart = (move) => arenaStartAt(unrealClipStart(move));

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

// The legend of the clip stage in `scope`, a stance clip's or a technique
// clip's, measured in the page. For each line: its colour dot, its box and the
// boxes of its text, one per line of text (a label that wraps has more than
// one). `overlay` is the wide layout, where the legend sits on the picture.
export const legendLines = (page, scope) => page.locator(`${scope} .unreal-clip-stage .unreal-clip-legend`).evaluate((legend) => {
  const rect = (box) => ({ left: box.left, right: box.right, top: box.top, bottom: box.bottom });
  const style = getComputedStyle(legend);
  const outer = legend.getBoundingClientRect();
  return {
    overlay: style.position === 'absolute',
    contentRight: outer.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight),
    lines: [...legend.querySelectorAll(':scope > span')].map((span) => {
      const dot = span.querySelector(':scope > i');
      // Everything after the dot is the label.
      const range = document.createRange();
      range.setStartAfter(dot);
      range.setEnd(span, span.childNodes.length);
      const rows = [];
      for (const box of [...range.getClientRects()].filter((item) => item.width > 0 && item.height > 0).sort((a, b) => a.top - b.top || a.left - b.left)) {
        const row = rows.find((line) => Math.abs(line.top - box.top) < box.height / 2);
        if (row) Object.assign(row, { left: Math.min(row.left, box.left), right: Math.max(row.right, box.right), bottom: Math.max(row.bottom, box.bottom) });
        else rows.push(rect(box));
      }
      return { text: span.textContent.replace(/\s+/g, ' ').trim(), dot: rect(dot.getBoundingClientRect()), span: rect(span.getBoundingClientRect()), rows };
    }),
  };
});

// Each dot sits beside its own text: the label's first line starts just after
// the dot (the legend's 0.45rem gap) and level with it, and every further line
// of a label that wraps starts under the first. On the picture each line still
// sits against the legend's right edge. Returns what was measured.
export function checkLegend(measured, where) {
  assert.ok(measured.lines.length >= 2, `${where}: the legend names both athletes`);
  return measured.lines.map((line) => {
    const label = `${where}, "${line.text}"`;
    const [first, ...more] = line.rows;
    assert.ok(first, `${label}: the label has text`);
    const gap = first.left - line.dot.right;
    assert.ok(gap >= 0 && gap <= 10, `${label}: its text starts ${gap.toFixed(1)}px after its dot`);
    const middle = (line.dot.top + line.dot.bottom) / 2;
    assert.ok(middle >= first.top && middle <= first.bottom, `${label}: the dot is level with the first line of its text`);
    for (const row of more) assert.ok(Math.abs(row.left - first.left) <= 1, `${label}: a wrapped line starts under the first, beside the dot (${row.left.toFixed(1)}px against ${first.left.toFixed(1)}px)`);
    if (measured.overlay) assert.ok(Math.abs(line.span.right - measured.contentRight) <= 1, `${label}: on the picture the line sits against the legend's right edge`);
    return { text: line.text, lines: line.rows.length, gap: Number(gap.toFixed(1)), farthestLine: Number((Math.max(...line.rows.map((row) => row.left)) - line.dot.right).toFixed(1)) };
  });
}

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
  await openTrainingTechnique(page, move);
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
  await openTrainingTechnique(page, move);
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
  await openTrainingTechnique(page, move);
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

// Start (or restart) a match in `start` (by default the technique's clip start),
// choose the technique (or, when `own` is false, another one, so the rival can
// win with it) and submit. Returns what settled and the stance picture's box
// just before, if one showed.
async function exchange(page, move, unity, own = true, start = arenaStart(move)) {
  assert.ok(start, `the Arena can start a match where ${move.name} starts`);
  const startButton = page.getByRole('button', { name: start.button, exact: true });
  if (await startButton.isVisible()) {
    if (start.button === 'Position Start') await page.getByLabel('Your starting position', { exact: true }).selectOption(start.position);
    await startButton.click();
  } else {
    await page.locator('.arena-page-heading').getByRole('button', { name: 'Restart match' }).click();
  }
  // The techniques on offer from this position, by exactly their names.
  const group = page.locator('.combat-moves .combat-group').first();
  await group.locator('button:not([disabled])').first().waitFor();
  const choices = group.locator('button');
  const offered = await choices.evaluateAll((list) => list.map((button) => ({ name: button.querySelector('span')?.textContent ?? '', disabled: button.disabled })));
  const pick = offered.findIndex((choice) => !choice.disabled && (choice.name === move.name) === own);
  assert.ok(pick >= 0, `${own ? move.name : `a technique other than ${move.name}`} is on offer (${offered.map((choice) => choice.name).join(', ')})`);
  await choices.nth(pick).click();
  await page.locator('.sequence-panel .order-stack').waitFor();
  const stance = page.locator(`${MAT} .unreal-clip-stage[data-kind="stance"] .unreal-clip-viewport`);
  const stanceBox = await stance.count() ? await pageBox(stance) : null;
  const unityMark = unity?.count() ?? 0;
  await page.getByRole('button', { name: 'Submit sequence', exact: true }).click();
  const outcome = page.locator('.arena-outcome');
  await outcome.waitFor();
  const headline = flat(await outcome.locator('span').first().innerText());
  const performer = (await outcome.getAttribute('class')).includes('success') ? 'fighter' : 'opponent';
  // The technique that won: the one whose exact name ends the headline.
  const technique = allMoves.find((item) => headline.endsWith(` executes ${flat(item.name)}`) || headline.endsWith(` with ${flat(item.name)}`));
  return { headline, performer, technique, won: technique === move, stanceBox, unityMark };
}

// Plays exchanges until `want` says to stop, calling `onWin` for each exchange
// the technique wins (by either athlete). Every match starts in `startAt` (a
// position id; by default the technique's clip start). The player chooses the
// technique while `playerTries(seen)` is true, and another one after. The
// page's Math.random must be seeded.
export async function playArena(page, { base, moveId, cap = 150, want, onWin, unity, playerTries = () => true, startAt }) {
  const move = curriculumMove(moveId);
  const start = startAt === undefined ? arenaStart(move) : arenaStartAt(startAt);
  if (startAt !== undefined) assert.ok(move.starts.includes(startAt), `${move.name} starts in ${startAt}`);
  page.on('dialog', (dialog) => dialog.accept());
  await page.goto(`${base}/`);
  await page.getByRole('button', { name: 'Arena', exact: true }).click();
  const seen = { fighter: 0, opponent: 0, exchanges: 0, headlines: [] };
  while (seen.exchanges < cap && !want(seen)) {
    const result = await exchange(page, move, unity, playerTries(seen), start);
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
