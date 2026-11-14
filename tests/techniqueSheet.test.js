import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createArenaState, getPositionForSide, isArenaCounterApplicable, resolveArenaOutcome } from '../src/arena/outcome.js';
import { allMoves, BELTS, moves as trainingMoves, positionLabels, trainingStartPositions } from '../src/data/curriculum.js';
import { resolveUnityMove } from '../src/unity/bridge.js';
import { UNREAL_CLIP_CAMERAS, UNREAL_CLIPS, unrealClipViews } from '../src/unreal/techniqueClips.js';
import { unrealClipMoveId, unrealClipStart } from '../src/unreal/techniqueIds.js';
import { chooseTechniquePicture, FIGHTER_ONLY_CLIP_IDS, TECHNIQUE_OPENING_CAMERA, techniqueClipPerformers, techniqueClipReady } from '../src/unreal/techniquePicture.js';
import { CAMERAS, importClips, PERFORMERS, selectEntries, TECHNIQUE_IDS } from '../tools/import_unreal_clips.mjs';
import { buildTechniqueSheet, CLIP_FILE_PATTERN, SHEET_JSON, SHEET_MARKDOWN } from '../tools/build_technique_sheet.mjs';

const COMMIT = 'abc1234';
const build = (inputs = {}) => buildTechniqueSheet({ moves: allMoves, positionLabels, clips: UNREAL_CLIPS, commit: COMMIT, ...inputs });

// The sheet of the real curriculum and the published clip list.
const sheet = build();
const data = JSON.parse(sheet.json);
const lines = sheet.markdown.split('\n');

const code = (text) => `\`${text}\``;
const clipIds = allMoves.map((move) => unrealClipMoveId(move.id));
const stepTotal = allMoves.reduce((count, move) => count + move.steps.length, 0);
// The header's counts line for the real curriculum, with `playing` techniques playing their Unreal clips.
const countsLine = (playing) => `Techniques: ${allMoves.length}. Steps: ${stepTotal}. With a Unity animation: 4. Playing Unreal clips today: ${playing}. Needing fighter and opponent clips: ${allMoves.length - FIGHTER_ONLY_CLIP_IDS.length}. Needing fighter clips only: ${FIGHTER_ONLY_CLIP_IDS.length}.`;
// The line a technique Unity has an animation of gets.
const UNITY_YES = "- Unity animation: yes. The site plays it until this technique's Unreal clips switch on.";

// The markdown's technique sections, in order: the heading line, then its lines.
function sectionsOf(markdown) {
  const all = markdown.split('\n');
  const found = [];
  for (const line of all.slice(all.indexOf('## Techniques') + 1)) {
    if (line.startsWith('### ')) found.push({ heading: line, lines: [] });
    else if (found.length) found.at(-1).lines.push(line);
  }
  return found;
}
// The lines of one section after "Steps:", without the blank ones.
const afterSteps = (section) => section.lines.slice(section.lines.indexOf('Steps:') + 1).filter((line) => line !== '');
// The cells of the index table's rows.
const indexRows = (markdown) => markdown.split('\n').filter((line) => /^\| \d+ \| /.test(line)).map((row) => row.slice(2, -2).split(' | '));
// The "By starting position" list: [what the line names, its clip ids].
function startRows(markdown) {
  const all = markdown.split('\n');
  return all.slice(all.indexOf('## By starting position') + 1, all.indexOf('## Techniques')).filter((line) => line.startsWith('- ')).map((line) => {
    const at = line.lastIndexOf(': ');
    return [line.slice(2, at), line.slice(at + 2).split(', ')];
  });
}

// A curriculum technique made up for a test, in plain ASCII.
const fixture = (id, extra = {}) => ({
  id, name: `Fixture ${id}`, belt: 'white', lesson: 'Fixture lesson', category: 'takedown',
  starts: ['standing'], endsIn: 'guard-top', isSubmission: false,
  steps: ['First step', 'Second step'], scenario: 'A fixture scenario.',
  ...extra,
});
const fixtureLabels = { standing: 'Standing Range', clinch: 'Clinch', 'guard-top': 'Top Guard' };
const made = (moves, inputs = {}) => buildTechniqueSheet({ moves, positionLabels: fixtureLabels, clips: [], commit: COMMIT, ...inputs });
const clip = (moveId, performerSide, camera) => ({ moveId, performerSide, camera });

test('every curriculum technique is in the sheet exactly once, in curriculum order', () => {
  assert.equal(data.techniques.length, allMoves.length);
  assert.deepEqual(data.techniques.map((technique) => technique.curriculumId), allMoves.map((move) => move.id));
  assert.deepEqual(data.techniques.map((technique) => technique.clipId), clipIds);
  assert.deepEqual(data.techniques.map((technique) => technique.number), allMoves.map((move, index) => index + 1));

  // One section each, headed by its number, clip id and name.
  const sections = sectionsOf(sheet.markdown);
  assert.deepEqual(sections.map((section) => section.heading), allMoves.map((move, index) => `### ${index + 1}. ${code(clipIds[index])}: ${move.name}`));
  // One index row each.
  const rows = indexRows(sheet.markdown);
  assert.equal(rows.length, allMoves.length);
  for (const [index, move] of allMoves.entries()) {
    assert.equal(rows[index].length, 10, `${move.id}: index columns`);
    assert.deepEqual(rows[index].slice(0, 4), [String(index + 1), code(clipIds[index]), move.name, move.belt], move.id);
    assert.equal(rows[index][6], String(move.steps.length), `${move.id}: number of steps`);
  }
  // No other heading of that kind and no other table row.
  assert.equal(lines.filter((line) => line.startsWith('### ')).length, allMoves.length);
  assert.equal(lines.filter((line) => line.startsWith('| ') && !line.startsWith('| #') && !line.startsWith('| ---')).length, allMoves.length);
});

test('one technique in the JSON has these fields, in this order', () => {
  for (const technique of data.techniques) {
    assert.deepEqual(Object.keys(technique), [
      'number', 'clipId', 'curriculumId', 'name', 'belt', 'lesson', 'guideStartingPosition', 'category', 'scenario',
      'starts', 'endsIn', 'isSubmission', 'steps', 'unityAnimationToday', 'unrealClipsToday', 'clipFileNames',
      'renderFrom', 'otherStarts', 'gameContinuesFrom', 'clipsNeeded', 'fighterOnlyReason', 'clipFilesNeeded', 'opensOn',
    ], technique.curriculumId);
  }
  assert.deepEqual(Object.keys(data), ['generatedBy', 'commit', 'uncommittedChanges', 'notice', 'clipFilePattern', 'performers', 'cameras', 'techniques']);
});

test('names, lessons, scenarios and steps in the JSON are the curriculum\'s, character for character', () => {
  for (const [index, move] of allMoves.entries()) {
    const technique = data.techniques[index];
    assert.deepEqual(technique.steps, move.steps, `${move.id}: steps`);
    assert.equal(technique.name, move.name, `${move.id}: name`);
    assert.equal(technique.scenario, move.scenario ?? null, `${move.id}: scenario`);
    // A blue-belt technique has no lesson name: the guide files it under a starting position.
    assert.equal(technique.lesson, move.lesson ?? null, `${move.id}: lesson`);
    assert.equal(technique.guideStartingPosition, move.startingPosition ?? null, `${move.id}: starting position in the approved guide`);
    assert.equal(technique.belt, move.belt);
    assert.equal(technique.category, move.category);
    assert.equal(technique.isSubmission, move.isSubmission);
    // In the file itself, not only once it is parsed: a curly apostrophe is written as one.
    for (const text of [move.name, ...move.steps]) assert.ok(sheet.json.includes(JSON.stringify(text)), `${move.id}: ${text}`);
  }
  assert.equal(data.techniques.reduce((count, technique) => count + technique.steps.length, 0), stepTotal);
});

test('the markdown shows every name, lesson, scenario and step verbatim, each to the end of a line', () => {
  const sections = sectionsOf(sheet.markdown);
  for (const [index, move] of allMoves.entries()) {
    const section = sections[index];
    // The steps, numbered in the curriculum's order. Nothing else follows them but a note on the guide's numbers.
    const steps = afterSteps(section).filter((line) => !line.startsWith('Step numbers in the approved guide: '));
    assert.deepEqual(steps, move.steps.map((step, at) => `${at + 1}. ${step}`), `${move.id}: steps`);
    for (const step of move.steps) assert.ok(sheet.markdown.includes(step), `${move.id}: ${step}`);
    // The name closes the heading, so it too runs to the end of its line.
    assert.ok(section.heading.endsWith(`: ${move.name}`), `${move.id}: name`);
    assert.ok(section.lines.includes(move.scenario ? `- Scenario: ${move.scenario}` : '- Scenario: (the curriculum gives none)'), `${move.id}: scenario`);
    if (move.lesson !== undefined) assert.ok(section.lines.includes(`- Lesson: ${move.lesson}`), `${move.id}: lesson`);
    if (move.startingPosition !== undefined) assert.ok(section.lines.includes(`- Starting position in the approved guide: ${move.startingPosition}`), `${move.id}: starting position in the approved guide`);
    // A technique filed under a guide heading gets no lesson line, and the other way round: neither is made up.
    assert.equal(section.lines.some((line) => line.startsWith('- Lesson: ')), move.lesson !== undefined || move.startingPosition === undefined, `${move.id}: lesson line`);
    assert.equal(section.lines.some((line) => line.startsWith('- Starting position in the approved guide: ')), move.startingPosition !== undefined, `${move.id}: guide heading line`);
    assert.ok(section.lines.includes(`- Curriculum id (not used in file names): ${code(move.id)}`), `${move.id}: curriculum id`);
    assert.ok(section.lines.includes(`- Belt: ${move.belt}; category: ${move.category}; is a submission: ${move.isSubmission ? 'yes' : 'no'}`), `${move.id}: belt and category`);
  }
});

test('wording that looks like a slip is copied as it stands: nothing is trimmed, re-quoted, corrected or escaped', () => {
  const apostrophe = String.fromCodePoint(0x2019);
  const [opening, closing, dash] = [0x201C, 0x201D, 0x2014].map((point) => String.fromCodePoint(point));
  const odd = fixture('odd-move', {
    name: `Odd  name (Step 1: the opponent${apostrophe}s "arm")`,
    lesson: undefined,
    startingPosition: `Standing ${dash} front clinch `,
    scenario: `The opponent${apostrophe}s scenario has no full stop`,
    steps: [
      `Trap the opponent${apostrophe}s wrist with a ${opening}monkey grip.${closing} `,
      'Keep keep the word written twice [and the note in brackets]',
      " A step that starts with a space and has 'straight' quotes",
      'Marks stay as typed: *stars*, _underscores_, `ticks`, <angle>, #hash, &amp; and (brackets).',
      '7. A step that brings its own number',
    ],
  });
  const result = made([odd, fixture('plain-move', { lesson: ' A lesson with a space each side ', scenario: '' })]);
  const technique = JSON.parse(result.json).techniques[0];
  assert.equal(technique.name, odd.name);
  assert.equal(technique.lesson, null);
  assert.equal(technique.guideStartingPosition, odd.startingPosition);
  assert.equal(technique.scenario, odd.scenario);
  assert.deepEqual(technique.steps, odd.steps);
  // The JSON file itself has the curly marks, not escapes of them.
  for (const text of [odd.name, odd.startingPosition, odd.scenario, ...odd.steps]) assert.ok(result.json.includes(JSON.stringify(text)), text);

  const all = result.markdown.split('\n');
  const [section, plain] = sectionsOf(result.markdown);
  assert.equal(section.heading, `### 1. ${code('odd_move')}: ${odd.name}`);
  assert.ok(section.lines.includes(`- Starting position in the approved guide: ${odd.startingPosition}`));
  assert.ok(section.lines.includes(`- Scenario: ${odd.scenario}`));
  assert.deepEqual(afterSteps(section), odd.steps.map((step, at) => `${at + 1}. ${step}`));
  // The index row keeps both spaces of the name too.
  assert.equal(all.filter((line) => line.includes(odd.name)).length, 2);
  assert.equal(indexRows(result.markdown)[0][2], odd.name);
  // A lesson keeps its spaces. An empty scenario stays empty in the JSON, and the markdown says the curriculum gives none.
  assert.ok(plain.lines.includes('- Lesson:  A lesson with a space each side '));
  assert.ok(plain.lines.includes('- Scenario: (the curriculum gives none)'));
  assert.equal(JSON.parse(result.json).techniques[1].scenario, '');
  // A technique the curriculum gives next to nothing for says so in the markdown, in brackets, and
  // its JSON has what the curriculum has: null where a text is missing, '' where it is empty.
  const bare = made([fixture('bare-move', { lesson: undefined, scenario: undefined }), fixture('empty-move', { lesson: '', starts: [], endsIn: null, steps: [] })]);
  const [missing, empty] = sectionsOf(bare.markdown);
  assert.ok(missing.lines.includes('- Lesson: (the curriculum gives none)'));
  assert.ok(missing.lines.includes('- Scenario: (the curriculum gives none)'));
  assert.ok(!missing.lines.some((line) => line.startsWith('- Starting position in the approved guide: ')));
  assert.deepEqual([null, null, null], ['lesson', 'guideStartingPosition', 'scenario'].map((key) => JSON.parse(bare.json).techniques[0][key]));
  assert.ok(empty.lines.includes('- Lesson: (the curriculum gives none)'));
  assert.ok(empty.lines.includes('- Starts in: none'));
  assert.ok(empty.lines.includes('- Ends in: none (the position stays as it was)'));
  assert.deepEqual(afterSteps(empty), []);
  assert.deepEqual(indexRows(bare.markdown)[1].slice(4, 7), ['none', 'none', '0']);
  assert.deepEqual(['', [], null, []], ['lesson', 'starts', 'endsIn', 'steps'].map((key) => JSON.parse(bare.json).techniques[1][key]));
});

test('everything the sheet adds around the copied text is plain ASCII', () => {
  const plain = made([fixture('first-move'), fixture('second-move', { lesson: undefined, startingPosition: 'Fixture heading', endsIn: null, scenario: '' })],
    { clips: [clip('first_move', 'fighter', 'side')], uncommitted: true });
  for (const text of [plain.markdown, plain.json]) {
    assert.deepEqual([...text].filter((character) => character.codePointAt(0) > 126 || (character < ' ' && character !== '\n')), []);
  }
});

test('clip ids are unique, are the ids the importer takes technique clips under, and name files it accepts', () => {
  const ids = data.techniques.map((technique) => technique.clipId);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids, [...TECHNIQUE_IDS]);
  assert.equal(data.clipFilePattern, CLIP_FILE_PATTERN);
  assert.equal(CLIP_FILE_PATTERN, '<clipId>/<performer>-<camera>.mp4');
  assert.deepEqual(data.performers, [...PERFORMERS]);
  assert.deepEqual(data.cameras, [...CAMERAS]);

  const sections = sectionsOf(sheet.markdown);
  for (const [index, technique] of data.techniques.entries()) {
    const names = PERFORMERS.flatMap((performer) => CAMERAS.map((camera) => `${technique.clipId}/${performer}-${camera}.mp4`));
    assert.deepEqual(technique.clipFileNames, names, technique.clipId);
    assert.ok(sections[index].lines.includes(`- Clip files: ${code(`${technique.clipId}/<performer>-<camera>.mp4`)}`), technique.clipId);
    // The importer reads each name as a clip of this technique: it holds it for the owner's acceptance ...
    const delivery = PERFORMERS.flatMap((performerSide, performer) => CAMERAS.map((camera, view) => {
      const file = technique.clipFileNames[performer * CAMERAS.length + view];
      return {
        moveId: technique.clipId, performerSide, camera, file, poster: file.replace(/\.mp4$/, '.webp'),
        bytes: 1000, sha256: 'a'.repeat(64), width: 1280, height: 720, fps: 30, frames: 120, durationSeconds: 4,
        loops: false, choreographyReviewed: false, draft: false,
      };
    }));
    const held = selectEntries(delivery, []);
    assert.deepEqual(held.notAccepted, names, technique.clipId);
    assert.deepEqual(held.selected, [], technique.clipId);
    // ... and imports it once accepted.
    const accepted = selectEntries(delivery, delivery.map((entry) => ({ file: entry.file, sha256: entry.sha256, acceptedOn: '2026-11-14' })));
    assert.deepEqual(accepted.selected.map((entry) => entry.file), names, technique.clipId);
    assert.deepEqual(accepted.notAccepted, [], technique.clipId);
  }
});

test('the Unity flag is true for exactly the four techniques Unity animates: a fact about Unity, whatever clips are published', () => {
  const unity = data.techniques.filter((technique) => technique.unityAnimationToday);
  assert.deepEqual(unity.map((technique) => technique.curriculumId).sort(), ['double-leg-takedown', 'rear-naked-choke', 'trap-roll-escape', 'triangle-choke']);
  assert.deepEqual(unity.map((technique) => technique.clipId).sort(), ['double_leg', 'rear_naked_choke', 'trap_roll_escape', 'triangle_choke']);
  const rows = indexRows(sheet.markdown);
  const sections = sectionsOf(sheet.markdown);
  for (const [index, move] of allMoves.entries()) {
    const animated = resolveUnityMove(move.id) !== null;
    assert.equal(data.techniques[index].unityAnimationToday, animated, move.id);
    assert.equal(rows[index][7], animated ? 'yes' : 'no', move.id);
    // One line, then the published views on a line of their own.
    const section = sections[index].lines;
    const at = section.findIndex((line) => line.startsWith('- Unity '));
    assert.equal(section[at], animated ? UNITY_YES : '- Unity animation: no', move.id);
    assert.ok(section[at + 1].startsWith('- Unreal clips today: '), move.id);
    assert.equal(section.filter((line) => line.startsWith('- Unity ') || line.startsWith('- Unreal clips today: ')).length, 2, move.id);
  }
  // The index says what the column means: whether Unity has an animation, not what the site plays.
  assert.ok(lines.some((line) => line.includes(' "Unity animation" says whether Unity has an animation of the technique, which the site plays until the technique\'s Unreal clips switch on. ')));
  assert.ok(!sheet.markdown.includes('Unity today'));

  // Once the rear naked choke's clips are published for both performers, the site plays them instead of Unity's
  // animation. The sheet still says Unity has one, and counts the technique as playing its Unreal clips.
  const published = build({ clips: PERFORMERS.flatMap((performer) => CAMERAS.map((camera) => clip('rear_naked_choke', performer, camera))) });
  const choke = sectionsOf(published.markdown)[allMoves.findIndex((move) => move.id === 'rear-naked-choke')].lines;
  assert.ok(choke.includes(UNITY_YES));
  assert.ok(choke.includes('- Unreal clips today: fighter: side, front; opponent: side, front'));
  assert.deepEqual(indexRows(published.markdown).find((cells) => cells[1] === code('rear_naked_choke')).slice(7), ['yes', 'fighter and opponent', 'fighter: side, front; opponent: side, front']);
  assert.ok(published.markdown.split('\n').includes(countsLine(1)));
});

test('the Unreal clips of a technique are the published views of its clip id, for each performer', () => {
  // With the published clip list: what the site itself finds.
  for (const technique of data.techniques) {
    assert.deepEqual(Object.keys(technique.unrealClipsToday), [...PERFORMERS]);
    for (const performer of PERFORMERS) {
      assert.deepEqual(technique.unrealClipsToday[performer], unrealClipViews(technique.clipId, performer).map((view) => view.camera), `${technique.clipId} ${performer}`);
    }
  }
  // The techniques that play their Unreal clips today, by the site's own rule on the published clip list.
  const playing = data.techniques.filter((technique) => techniqueClipReady(technique.clipId, unrealClipViews)).length;
  assert.ok(lines.includes(countsLine(playing)));

  // With clips for three techniques, in no particular order: one for both performers (a technique
  // Unity cannot animate), and two for the player's athlete only: the double leg, which needs the
  // rival's clips too, and the hook sweep, which needs no more (the rival never performs it).
  const some = build({ clips: [
    clip('basic_tackle', 'opponent', 'side'), clip('basic_tackle', 'fighter', 'front'), clip('basic_tackle', 'fighter', 'side'),
    clip('double_leg', 'fighter', 'side'), clip('hook_sweep', 'fighter', 'front'),
    // Not a technique's clips: a stance, a curriculum id instead of a clip id, an unknown performer, an unknown camera.
    clip('standing_stance', 'fighter', 'side'), clip('americana-armlock', 'fighter', 'side'), clip('kimura_guard', 'referee', 'side'), clip('kimura_guard', 'fighter', 'top'),
  ] });
  const withClips = JSON.parse(some.json).techniques;
  const published = Object.fromEntries(withClips.filter((technique) => PERFORMERS.some((performer) => technique.unrealClipsToday[performer].length)).map((technique) => [technique.clipId, technique.unrealClipsToday]));
  assert.deepEqual(published, { basic_tackle: { fighter: ['side', 'front'], opponent: ['side'] }, double_leg: { fighter: ['side'], opponent: [] }, hook_sweep: { fighter: ['front'], opponent: [] } });
  const rows = Object.fromEntries(indexRows(some.markdown).map((cells) => [cells[1], cells[9]]));
  assert.equal(rows[code('basic_tackle')], 'fighter: side, front; opponent: side');
  assert.equal(rows[code('double_leg')], 'fighter: side; opponent: none');
  assert.equal(rows[code('hook_sweep')], 'fighter: front; opponent: none');
  assert.equal(rows[code('kimura_guard')], 'none');
  assert.equal(rows[code('americana_armlock')], 'none');
  const tackle = sectionsOf(some.markdown).find((section) => section.heading.includes(` ${code('basic_tackle')}: `));
  assert.ok(tackle.lines.includes('- Unity animation: no'));
  assert.ok(tackle.lines.includes('- Unreal clips today: fighter: side, front; opponent: side'));
  // A technique plays its clips once every performer it needs has a view: the Mat Tackle (both
  // performers) and the hook sweep (the fighter alone). Not the double leg: it needs the rival's too.
  assert.ok(some.markdown.split('\n').includes(countsLine(2)));
  const fixtureViews = (clipId, performer) => withClips.find((technique) => technique.clipId === clipId).unrealClipsToday[performer];
  assert.deepEqual(withClips.filter((technique) => techniqueClipReady(technique.clipId, fixtureViews)).map((technique) => technique.clipId), ['basic_tackle', 'hook_sweep']);
});

test('where a technique starts and ends is given by the game\'s position ids and labels', () => {
  const label = (id) => (Object.hasOwn(positionLabels, id) ? positionLabels[id] : null);
  const named = Object.keys(positionLabels);
  const anywhere = (move) => named.every((id) => move.starts.includes(id));
  const rows = indexRows(sheet.markdown);
  const sections = sectionsOf(sheet.markdown);
  const text = (id) => (label(id) === null ? `${code(id)} (no label)` : `${label(id)} (${code(id)})`);
  for (const [index, move] of allMoves.entries()) {
    const technique = data.techniques[index];
    assert.deepEqual(technique.starts, move.starts.map((id) => ({ id, label: label(id) })), move.id);
    assert.deepEqual(technique.endsIn, move.endsIn === null ? null : { id: move.endsIn, label: label(move.endsIn) }, move.id);
    assert.equal(rows[index][4], anywhere(move) ? 'Every position' : move.starts.map((id) => label(id) ?? code(id)).join(', '), move.id);
    assert.equal(rows[index][5], move.endsIn === null ? 'none' : label(move.endsIn) ?? code(move.endsIn), move.id);
    assert.ok(sections[index].lines.includes(`- Starts in: ${anywhere(move) ? `every position (${move.starts.length}): ` : ''}${move.starts.map(text).join(', ')}`), move.id);
    assert.ok(sections[index].lines.includes(`- Ends in: ${move.endsIn === null ? 'none (the position stays as it was)' : text(move.endsIn)}`), move.id);
  }
});

// Plain ASCII, apart from copied curriculum text: as the test above checks for the whole sheet.
const unusual = (text) => [...text].filter((character) => character.codePointAt(0) > 126 || (character < ' ' && character !== '\n'));
const both = (id, label) => ({ fighter: { id, label }, opponent: { id, label } });
// The lines of one section that say where the game starts the next exchange.
const saysGame = (section) => section.lines.filter((line) => line.startsWith('- In the game '));
const GAME_RULES = { createArenaState, getPositionForSide, isArenaCounterApplicable, resolveArenaOutcome };
// The clip files section's rule for how a clip ends, and its word on submissions.
const END_RULE = 'Every clip ends on the finish its approved steps describe. For a technique that is not a submission, that finish is its "Ends in" position ("none": its "Render from" position), and the game continues from there. Where the game would continue from another position, the technique\'s section says so in a line "In the game the next exchange starts from".';
const SUBMISSION_RULE = `A submission does not move the athletes in the game (${code('src/arena/outcome.js')}): when it does not end the match, the next exchange starts again from its "Render from" position. Its clip still ends on the approved finish, also where the steps leave the start position.`;
// The reasons the sheet gives for a technique that needs the fighter's clips only.
const PREVIEW = 'The rival never uses preview techniques';
const neverIn = (place) => `The rival is never in ${place} in the game`;
// The line a white-belt starter's section has.
const ARENA_ONLY = '- Training does not list it (a white-belt starter), so its clips play only in the Arena.';
// The clip files section's word on a delivered entry that fails a check.
const IMPORT_STOPS = `A delivered entry that is not a draft and fails any of these checks, other than a missing acceptance line, stops the whole import, so no clip in the pack is published until it is fixed or marked ${code('"draft": true')}. The importer checks every entry that is not a draft as it reads ${code('clips/technique-clips.json')}, and a clip's own files (the video, with its size and SHA-256, and the poster) once the clip has its acceptance line. Deliver a take that is not ready with ${code('"draft": true')}.`;
// The line that says which view the site opens a technique on: for one with an opening view of its own
// (the rear naked choke's is the front), and for every other.
const OPENS_FRONT = '- The site opens on: the front view once one is published; the side view until then.';
const OPENS_SIDE = '- The site opens on: the side view once one is published; the front view if it is the only one.';
const OPENS_PICK = `Each technique's "The site opens on" line gives the view its clips open on until the viewer picks the other one with the Side and Front buttons. That pick then carries over to every later technique clip on the same screen, in Training or in the Arena, wherever that view is published.`;
// The JSON's notice, which also says what its two lists of clip file names are.
const NOTICE = "Generated file: do not edit it, run the tool again. In each technique, clipFileNames lists every file name the site's importer (tools/import_unreal_clips.mjs) accepts for its clips, and clipFilesNeeded only the names for the performers in clipsNeeded, the only clips of that technique the site ever shows. The site switches a technique to its clips once each performer in clipsNeeded has at least one of these views published: side views first, front views can follow. The name, lesson, scenario and steps of every technique are the owner's approved wording, copied character for character from the curriculum (src/data). They must not be changed.";

test('every technique is rendered from the first position it starts in, and its section names the other starts', () => {
  const label = (id) => (Object.hasOwn(positionLabels, id) ? positionLabels[id] : null);
  const text = (id) => (label(id) === null ? `${code(id)} (no label)` : `${label(id)} (${code(id)})`);
  const sections = sectionsOf(sheet.markdown);
  for (const [index, move] of allMoves.entries()) {
    const technique = data.techniques[index];
    const section = sections[index].lines;
    assert.deepEqual(technique.renderFrom, { id: move.starts[0], label: label(move.starts[0]) }, move.id);
    // The position the Arena plays the technique's clips after, by the site's own rule.
    assert.equal(technique.renderFrom.id, unrealClipStart(move), move.id);
    assert.deepEqual(technique.otherStarts, move.starts.slice(1).map((id) => ({ id, label: label(id) })), move.id);
    // Right after every position it starts in: the one it is rendered from, then the others, then where it ends.
    const others = move.starts.length > 1
      ? [`- The game also offers it from: ${move.starts.slice(1).map((id) => label(id) ?? code(id)).join(', ')}. After those starts the site shows its position picture, not this clip.`]
      : [];
    const at = section.findIndex((line) => line.startsWith('- Starts in: '));
    assert.deepEqual(section.slice(at + 1, at + 2 + others.length), [`- Render from: ${text(move.starts[0])}`, ...others], move.id);
    assert.ok(section[at + 2 + others.length].startsWith('- Ends in: '), move.id);
    assert.equal(section.filter((line) => line.startsWith('- Render from: ') || line.startsWith('- The game also offers it from: ')).length, 1 + others.length, move.id);
  }
  // The techniques the game offers from more than one position, each rendered from its first.
  assert.deepEqual(data.techniques.filter((technique) => technique.otherStarts.length > 0).map((technique) => [technique.clipId, technique.renderFrom.id, technique.otherStarts.length]), [
    ['protect_position', 'standing', 25], ['basic_punch', 'standing', 1], ['basic_tackle', 'standing', 1], ['guillotine_choke', 'standing', 1],
    ['standing_headlock_defense', 'standing-headlock', 1], ['guillotine_defense', 'clinch', 1], ['purple_darce', 'side-top', 1], ['brown_crucifix', 'back-control', 1],
  ]);
  const of = (clipId) => sections[data.techniques.findIndex((technique) => technique.clipId === clipId)].lines;
  assert.ok(of('basic_punch').includes(`- Render from: Standing Range (${code('standing')})`));
  assert.ok(of('basic_punch').includes('- The game also offers it from: Combat Base. After those starts the site shows its position picture, not this clip.'));
  assert.ok(of('protect_position').includes(`- Render from: Standing Range (${code('standing')})`));
  assert.ok(of('rear_naked_choke').includes(`- Render from: Back Control (${code('back-control')})`));
  assert.ok(!of('rear_naked_choke').some((line) => line.startsWith('- The game also offers it from: ')));
  // The rule, in the clip files section, and in the index by starting position, which lists a technique under every start.
  const naming = lines.slice(lines.indexOf('## Clip files'), lines.indexOf('## Index'));
  assert.ok(naming.includes(`Each technique is rendered from one position, its "Render from" position: the first position it starts in. Every clip of the technique starts there, for both performers and both cameras. Training shows the technique in that position, except the white-belt starters (${code('protect_position')}, ${code('basic_punch')}, ${code('basic_kick')} and ${code('basic_tackle')}): Training does not list them, so their clips play only in the Arena. The Arena plays a technique's clip only after an exchange that started in its "Render from" position. Where the game also offers a technique from other positions, the site shows the position picture after those, not the clip.`));
  const byPosition = lines.slice(lines.indexOf('## By starting position'), lines.indexOf('## Techniques'));
  assert.ok(byPosition.includes('Techniques that start in the same position can share a starting pose. A technique is listed under every position the game offers it from, but its clips start only in its "Render from" position, the first of them. The game\'s positions are broad: before two techniques share a pose, compare their scenarios and, where they have one, their starting positions in the approved guide.'));

  // A made-up curriculum: starts with no label, and a technique with no start at all.
  const odd = made([fixture('turtle-move', { starts: ['turtle-top', 'standing', 'side-top'], endsIn: null }), fixture('nowhere-move', { starts: [], endsIn: null })]);
  const [turtle, nowhere] = JSON.parse(odd.json).techniques;
  assert.deepEqual(turtle.renderFrom, { id: 'turtle-top', label: null });
  assert.deepEqual(turtle.otherStarts, [{ id: 'standing', label: 'Standing Range' }, { id: 'side-top', label: null }]);
  assert.deepEqual(turtle.gameContinuesFrom, both('turtle-top', null));
  const [turtleSection, nowhereSection] = sectionsOf(odd.markdown);
  assert.ok(turtleSection.lines.includes(`- Render from: ${code('turtle-top')} (no label)`));
  assert.ok(turtleSection.lines.includes(`- The game also offers it from: Standing Range, ${code('side-top')}. After those starts the site shows its position picture, not this clip.`));
  assert.deepEqual(saysGame(turtleSection), []);
  assert.deepEqual([nowhere.renderFrom, nowhere.otherStarts, nowhere.gameContinuesFrom], [null, [], { fighter: null, opponent: null }]);
  assert.ok(nowhereSection.lines.includes('- Render from: none'));
  assert.ok(!nowhereSection.lines.some((line) => line.startsWith('- The game also offers it from: ') || line.startsWith('- In the game ')));
  assert.deepEqual(unusual(odd.markdown), []);
});

test('where the game starts the next exchange is worked out by its own rules, after each performer wins from the Render from position', () => {
  const find = (id) => allMoves.find((move) => move.id === id);
  // The other athlete plays Protect Your Position. A counter wins only against the attack it answers.
  const attacks = { 'haymaker-defense': 'basic-punch', 'guillotine-defense': 'guillotine-choke' };
  for (const [index, move] of allMoves.entries()) {
    const technique = data.techniques[index];
    assert.deepEqual(Object.keys(technique.gameContinuesFrom), [...PERFORMERS], move.id);
    const opposingMove = find(attacks[move.id] ?? 'protect-position');
    for (const performer of PERFORMERS) {
      // The performer stands, by its own side, in the position the clips start in ...
      const before = createArenaState(move.starts[0], performer);
      assert.equal(getPositionForSide(before, performer), move.starts[0], `${move.id} ${performer}`);
      // ... the game lets it win there ...
      assert.ok(isArenaCounterApplicable(move, before, opposingMove, performer), `${move.id} ${performer}`);
      // ... and the next exchange starts, by the performer's side, where the game's rules put them.
      const after = getPositionForSide(resolveArenaOutcome(before, move, performer, { opposingMove }), performer);
      assert.deepEqual(technique.gameContinuesFrom[performer], { id: after, label: positionLabels[after] ?? null }, `${move.id} ${performer}`);
    }
  }
  // Against Protect Your Position the game would not let the two counters win at all.
  for (const id of Object.keys(attacks)) assert.equal(isArenaCounterApplicable(find(id), createArenaState(find(id).starts[0]), find('protect-position')), false, id);
  // Today the game goes on, for both performers, from where the curriculum has every technique end
  // (its Render from position where it gives no end), so no section has to say otherwise.
  const elsewhere = data.techniques.filter((technique) => PERFORMERS.some((performer) => technique.gameContinuesFrom[performer].id !== (technique.endsIn ?? technique.renderFrom).id));
  assert.deepEqual(elsewhere.map((technique) => technique.clipId), []);
  assert.ok(!lines.some((line) => line.startsWith('- In the game ')));
  // The clip files section says the game continues there, and how the sheet works it out.
  const naming = lines.slice(lines.indexOf('## Clip files'), lines.indexOf('## Index'));
  assert.ok(naming.includes(END_RULE));
  assert.ok(naming.includes(`The sheet works out where the game continues with the game's own rules (${code('src/arena/outcome.js')}): each performer wins with the technique from its "Render from" position while the other athlete plays Protect Your Position (${code('protect_position')}). The other athlete's technique matters only to a counter, which the game lets win only against the attack it answers, so a counter is worked out against that attack.`));
  // The sheet is made with the game's own rules unless it is given others.
  assert.deepEqual(build({ arena: GAME_RULES }), sheet);
});

test('a section says where the game starts the next exchange wherever that is not where the technique ends', () => {
  const result = made([
    fixture('kept-move'),
    fixture('still-move', { endsIn: null }),
    // A strike moves nobody.
    fixture('strike-move', { category: 'strike', endsIn: 'clinch' }),
    // A takedown leaves its performer on top.
    fixture('pulled-move', { endsIn: 'guard-bottom' }),
    // A submission on the ground leaves the athletes where they were.
    fixture('held-move', { category: 'submission', isSubmission: true, starts: ['guard-top', 'standing'], endsIn: 'clinch' }),
    // The game keeps the position when it does not know where a technique ends.
    fixture('lost-move', { endsIn: 'somewhere-else' }),
  ]);
  assert.deepEqual(Object.fromEntries(JSON.parse(result.json).techniques.map((technique) => [technique.clipId, technique.gameContinuesFrom])), {
    kept_move: both('guard-top', 'Top Guard'), still_move: both('standing', 'Standing Range'), strike_move: both('standing', 'Standing Range'),
    pulled_move: both('guard-top', 'Top Guard'), held_move: both('guard-top', 'Top Guard'), lost_move: both('standing', 'Standing Range'),
  });
  const [kept, still, strike, pulled, held, lost] = sectionsOf(result.markdown);
  assert.deepEqual([kept, still].map(saysGame), [[], []]);
  assert.deepEqual([strike, pulled, held, lost].map(saysGame), [
    [`- In the game the next exchange starts from: Standing Range (${code('standing')})`],
    [`- In the game the next exchange starts from: Top Guard (${code('guard-top')})`],
    [`- In the game the next exchange starts from: Top Guard (${code('guard-top')})`],
    [`- In the game the next exchange starts from: Standing Range (${code('standing')})`],
  ]);
  // Right after where the curriculum has it end.
  for (const section of [strike, pulled, held, lost]) assert.equal(section.lines[section.lines.findIndex((line) => line.startsWith('- Ends in: ')) + 1], saysGame(section)[0]);
  assert.ok(strike.lines.includes(`- Ends in: Clinch (${code('clinch')})`));
  assert.ok(pulled.lines.includes(`- Ends in: ${code('guard-bottom')} (no label)`));
  // Without Protect Your Position in the moves, the clip files section names no technique for the other athlete.
  assert.ok(result.markdown.split('\n').includes(`The sheet works out where the game continues with the game's own rules (${code('src/arena/outcome.js')}): each performer wins with the technique from its "Render from" position. The other athlete's technique matters only to a counter, which the game lets win only against the attack it answers, so a counter is worked out against that attack.`));

  // A counter is worked out against the attack it answers, and can win only where the moves have it.
  const counter = fixture('haymaker-defense', { category: 'defense', endsIn: 'clinch' });
  const answered = made([counter, fixture('basic-punch', { category: 'strike', endsIn: 'standing' })]);
  assert.deepEqual(JSON.parse(answered.json).techniques[0].gameContinuesFrom, both('clinch', 'Clinch'));
  assert.deepEqual(saysGame(sectionsOf(answered.markdown)[0]), []);
  const never = '- In the game the next exchange starts from: nowhere, because the game never lets it win from its Render from position';
  const unanswered = made([counter]);
  assert.deepEqual(JSON.parse(unanswered.json).techniques[0].gameContinuesFrom, { fighter: null, opponent: null });
  assert.deepEqual(saysGame(sectionsOf(unanswered.markdown)[0]), [never]);
  // Nor can a technique rendered from a position the game never names that way: it calls it guard-top.
  const renamed = made([fixture('guard-move', { starts: ['guard'], endsIn: 'guard-top' })]);
  assert.deepEqual(JSON.parse(renamed.json).techniques[0].gameContinuesFrom, { fighter: null, opponent: null });
  assert.deepEqual(saysGame(sectionsOf(renamed.markdown)[0]), [never]);
  for (const text of [result.markdown, unanswered.markdown, result.json]) assert.deepEqual(unusual(text), []);
});

test('where the game would start the next exchange in different places for the two performers, the section names each', () => {
  // Rules that send every win of the rival's to the clinch. The game's own never tell the performers apart.
  const arena = { ...GAME_RULES, resolveArenaOutcome: (current, move, side, options) => (side === 'opponent' ? createArenaState('clinch', side) : resolveArenaOutcome(current, move, side, options)) };
  const split = made([fixture('first-move'), fixture('clinch-move', { endsIn: 'clinch' }), fixture('kept-move', { starts: ['clinch'], endsIn: 'clinch' })], { arena });
  const [first, clinch, kept] = JSON.parse(split.json).techniques;
  assert.deepEqual(first.gameContinuesFrom, { fighter: { id: 'guard-top', label: 'Top Guard' }, opponent: { id: 'clinch', label: 'Clinch' } });
  assert.deepEqual(clinch.gameContinuesFrom, { fighter: { id: 'standing', label: 'Standing Range' }, opponent: { id: 'clinch', label: 'Clinch' } });
  assert.deepEqual(kept.gameContinuesFrom, both('clinch', 'Clinch'));
  // Where only one performer's differs from where the technique ends too.
  assert.deepEqual(sectionsOf(split.markdown).map(saysGame), [
    [`- In the game the next exchange starts from: Top Guard (${code('guard-top')}) when ${code('fighter')} performs it; Clinch (${code('clinch')}) when ${code('opponent')} performs it`],
    [`- In the game the next exchange starts from: Standing Range (${code('standing')}) when ${code('fighter')} performs it; Clinch (${code('clinch')}) when ${code('opponent')} performs it`],
    [],
  ]);
  assert.deepEqual(unusual(split.markdown), []);
  // Rules the sheet cannot use are refused.
  assert.throws(() => made([fixture('first-move')], { arena: {} }), /needs the game's rules/);
  assert.throws(() => made([fixture('first-move')], { arena: { ...GAME_RULES, resolveArenaOutcome: undefined } }), /needs the game's rules/);
});

test('each technique says whose clips it needs, by the site\'s own rule, and why the fighter\'s alone are enough', () => {
  const rows = indexRows(sheet.markdown);
  const sections = sectionsOf(sheet.markdown);
  for (const [index, move] of allMoves.entries()) {
    const technique = data.techniques[index];
    // Whose views the site waits for before the technique plays its clips (src/unreal/techniquePicture.js).
    assert.deepEqual(technique.clipsNeeded, [...techniqueClipPerformers(technique.clipId)], move.id);
    const fighterOnly = FIGHTER_ONLY_CLIP_IDS.includes(technique.clipId);
    assert.deepEqual(technique.clipsNeeded, fighterOnly ? ['fighter'] : ['fighter', 'opponent'], move.id);
    // Why: the rival never uses a preview technique, and is never in any other one's Render from position.
    const reason = fighterOnly ? (move.preview ? PREVIEW : neverIn(positionLabels[move.starts[0]])) : null;
    assert.equal(technique.fighterOnlyReason, reason, move.id);
    // One line, right after the clip files, and a cell of the index.
    const section = sections[index].lines;
    assert.equal(section[section.findIndex((line) => line.startsWith('- Clip files: ')) + 1], fighterOnly
      ? `- Clips needed: fighter only. ${reason}, so an opponent clip would never be shown.`
      : '- Clips needed: fighter and opponent.', move.id);
    assert.equal(section.filter((line) => line.startsWith('- Clips needed: ')).length, 1, move.id);
    assert.equal(rows[index][8], fighterOnly ? 'fighter only' : 'fighter and opponent', move.id);
  }
  // Today fifteen techniques need the fighter's clips only, in curriculum order: six whose Render
  // from position the rival is never in, and the nine preview techniques.
  const fighterOnly = data.techniques.filter((technique) => technique.fighterOnlyReason !== null);
  assert.deepEqual(fighterOnly.map((technique) => technique.clipId), [...FIGHTER_ONLY_CLIP_IDS]);
  assert.deepEqual(Object.fromEntries(fighterOnly.map((technique) => [technique.clipId, technique.fighterOnlyReason])), {
    headlock_scissors_choke: neverIn('Headlock Trap'), double_ankle_sweep: neverIn('Open Guard From Bottom'), headlock_escape_2: neverIn('Headlock Trap'),
    standing_headlock_defense: neverIn('Defending Standing Headlock'), blocking_standing_punch_from_ground: neverIn('Open Guard From Bottom'), hook_sweep: neverIn('Open Guard From Bottom'),
    purple_omoplata: PREVIEW, purple_darce: PREVIEW, purple_x_guard_sweep: PREVIEW, brown_pressure_pass: PREVIEW, brown_knee_cut: PREVIEW, brown_crucifix: PREVIEW,
    black_berimbolo: PREVIEW, black_leg_drag: PREVIEW, black_bow_arrow: PREVIEW,
  });
  const of = (clipId) => sections[data.techniques.findIndex((technique) => technique.clipId === clipId)].lines;
  assert.ok(of('hook_sweep').includes('- Clips needed: fighter only. The rival is never in Open Guard From Bottom in the game, so an opponent clip would never be shown.'));
  assert.ok(of('black_bow_arrow').includes('- Clips needed: fighter only. The rival never uses preview techniques, so an opponent clip would never be shown.'));
  assert.ok(of('rear_naked_choke').includes('- Clips needed: fighter and opponent.'));
  // The header counts both kinds, the index says what its column means, and the clip files section gives the rule.
  assert.ok(lines.includes(countsLine(data.techniques.filter((technique) => techniqueClipReady(technique.clipId, unrealClipViews)).length)));
  assert.equal(lines.filter((line) => line.startsWith('Techniques: ')).length, 1);
  assert.ok(lines.some((line) => line.includes(' "Clips needed" says whose clips the technique needs: "fighter and opponent" for 34 of them and "fighter only" for 15, as "Clip files" explains. ')));
  const naming = lines.slice(lines.indexOf('## Clip files'), lines.indexOf('## Index'));
  assert.ok(naming.includes(`Training plays only the ${code('fighter')} clip of a technique. An ${code('opponent')} clip shows only in the Arena, after the rival wins with the technique in an exchange that started in its "Render from" position. The rival never does that with a preview technique, because it never uses preview techniques, nor with a technique whose "Render from" position it is never in. An ${code('opponent')} clip of such a technique would never be shown, so it needs ${code('fighter')} clips only, and its section says "Clips needed: fighter only." and why. Every other technique needs clips of both performers: "Clips needed: fighter and opponent."`));
  assert.ok(naming.includes(`The site switches a technique to its Unreal clips once every performer it needs has at least one published view: both performers, or the ${code('fighter')} alone for a technique that needs ${code('fighter')} clips only. Until then the site plays the technique's Unity animation where Unity has one ("Unity animation: yes"), and otherwise shows the position picture.`));
  assert.ok(naming.includes(OPENS_PICK));
  assert.ok(!sheet.markdown.includes('once both performers'));

  // A made-up curriculum, under clip ids the site needs only the fighter's clips of.
  const odd = made([
    fixture('purple-omoplata', { belt: 'purple', preview: true, starts: ['guard-top'] }),
    // The rival knows every white-belt technique, preview or not, so that is never the reason.
    fixture('purple-darce', { preview: true }),
    // A position with no label is named by its id.
    fixture('hook-sweep', { belt: 'blue', starts: ['open-guard-bottom', 'standing'] }),
    // The site decides which techniques need the fighter's clips only, not the sheet.
    fixture('plain-move', { belt: 'purple', preview: true }),
  ]);
  assert.deepEqual(JSON.parse(odd.json).techniques.map((technique) => [technique.clipsNeeded, technique.fighterOnlyReason]), [
    [['fighter'], PREVIEW], [['fighter'], neverIn('Standing Range')], [['fighter'], neverIn(code('open-guard-bottom'))], [['fighter', 'opponent'], null],
  ]);
  assert.deepEqual(sectionsOf(odd.markdown).map((section) => section.lines.filter((line) => line.startsWith('- Clips needed: '))), [
    [`- Clips needed: fighter only. ${PREVIEW}, so an opponent clip would never be shown.`],
    [`- Clips needed: fighter only. ${neverIn('Standing Range')}, so an opponent clip would never be shown.`],
    [`- Clips needed: fighter only. ${neverIn(code('open-guard-bottom'))}, so an opponent clip would never be shown.`],
    ['- Clips needed: fighter and opponent.'],
  ]);
  assert.deepEqual(indexRows(odd.markdown).map((cells) => cells[8]), ['fighter only', 'fighter only', 'fighter only', 'fighter and opponent']);
  const oddLines = odd.markdown.split('\n');
  assert.ok(oddLines.includes('Techniques: 4. Steps: 8. With a Unity animation: 0. Playing Unreal clips today: 0. Needing fighter and opponent clips: 1. Needing fighter clips only: 3.'));
  assert.ok(oddLines.some((line) => line.includes(' "fighter and opponent" for 1 of them and "fighter only" for 3, ')));
  assert.deepEqual(unusual(odd.markdown), []);
  // With the fighter's views alone such a technique plays its clips, and another one does not.
  const played = made([fixture('hook-sweep', { belt: 'blue' }), fixture('plain-move')], { clips: [clip('hook_sweep', 'fighter', 'side'), clip('plain_move', 'fighter', 'side')] });
  assert.ok(played.markdown.split('\n').includes('Techniques: 2. Steps: 4. With a Unity animation: 0. Playing Unreal clips today: 1. Needing fighter and opponent clips: 1. Needing fighter clips only: 1.'));
  // A technique that needs the fighter's clips only must start somewhere the rival is never in.
  assert.throws(() => made([fixture('hook-sweep', { belt: 'blue', starts: [] })]), /technique "hook-sweep" needs a fighter clip only, but has no Render from position/);
});

test('the reasons the sheet gives for needing the fighter\'s clips only are true in the game', () => {
  // Where the rival can ever be, worked out generously: from every match start (Standing Start,
  // Kneeling Start, each Position Start option and the profile's start poses, which
  // tests/unrealRivalReach.test.js pins), either athlete may win with any technique that starts where
  // it is (a counter against any technique at all), by the game's own outcome rules. A position the
  // rival never reaches here, it never reaches in the game.
  const key = (state) => `${state.position}|${state.topSide}|${state.controlSide}`;
  const states = new Map();
  const queue = [];
  const reach = (state) => {
    if (states.has(key(state))) return;
    states.set(key(state), state);
    queue.push(state);
  };
  for (const start of ['standing', 'kneeling', ...trainingStartPositions]) reach(createArenaState(start));
  while (queue.length) {
    const state = queue.shift();
    for (const side of PERFORMERS) {
      for (const move of allMoves.filter((item) => item.starts.includes(getPositionForSide(state, side)))) {
        for (const opposingMove of [null, ...allMoves]) {
          if (isArenaCounterApplicable(move, state, opposingMove, side)) reach(resolveArenaOutcome(state, move, side, { opposingMove }));
        }
      }
    }
  }
  const rivalIsIn = new Set([...states.values()].map((state) => getPositionForSide(state, 'opponent')));
  for (const technique of data.techniques) {
    const move = allMoves[technique.number - 1];
    if (technique.fighterOnlyReason === PREVIEW) {
      // chooseNpcMove (src/App.jsx) never gives the rival a preview technique above white belt.
      assert.ok(move.preview && move.belt !== 'white', move.id);
    } else if (technique.fighterOnlyReason !== null) {
      assert.equal(technique.fighterOnlyReason, neverIn(technique.renderFrom.label), move.id);
      assert.ok(!rivalIsIn.has(technique.renderFrom.id), `${move.id}: the rival can be in ${technique.renderFrom.id}, so the sheet's reason is wrong`);
    } else {
      // The search is not an empty one: it puts the rival where every other technique is rendered from.
      assert.ok(rivalIsIn.has(technique.renderFrom.id), move.id);
    }
  }
  // "The rival never uses preview techniques" is true of every preview technique: the rival knows
  // every white-belt technique, and none of them is a preview (tests/unrealRivalReach.test.js runs
  // chooseNpcMove as src/App.jsx writes it).
  assert.deepEqual(allMoves.filter((move) => move.preview && move.belt === 'white').map((move) => move.id), []);
});

test('the JSON names the clip files each technique needs, beside every name the importer accepts, and its notice says which is which', () => {
  // The file names of some performers' clips of a technique, in the importer's order of performers and cameras.
  const names = (clipId, performers) => performers.flatMap((performer) => CAMERAS.map((camera) => `${clipId}/${performer}-${camera}.mp4`));
  // A clip list that holds exactly these files, as the site finds a technique's views in it.
  const holding = (files) => (clipId, performer) => UNREAL_CLIP_CAMERAS
    .filter((camera) => files.includes(`${clipId}/${performer}-${camera}.mp4`))
    .map((camera) => ({ moveId: clipId, performerSide: performer, camera }));
  for (const technique of data.techniques) {
    const fighterOnly = FIGHTER_ONLY_CLIP_IDS.includes(technique.clipId);
    // Every name the importer accepts, and the names of the performers in clipsNeeded only, in the same order.
    assert.deepEqual(technique.clipFileNames, names(technique.clipId, PERFORMERS), technique.clipId);
    assert.deepEqual(technique.clipFilesNeeded, names(technique.clipId, fighterOnly ? ['fighter'] : ['fighter', 'opponent']), technique.clipId);
    assert.deepEqual(technique.clipFilesNeeded, technique.clipFileNames.filter((name) => technique.clipsNeeded.some((performer) => name.startsWith(`${technique.clipId}/${performer}-`))), technique.clipId);
    // Published, those files switch the technique to its clips by the site's own rule. Without the files
    // of any one performer it needs, they do not.
    assert.equal(techniqueClipReady(technique.clipId, holding(technique.clipFilesNeeded)), true, technique.clipId);
    for (const performer of technique.clipsNeeded) {
      const without = technique.clipFilesNeeded.filter((name) => !name.startsWith(`${technique.clipId}/${performer}-`));
      assert.equal(techniqueClipReady(technique.clipId, holding(without)), false, `${technique.clipId} without its ${performer} files`);
    }
  }
  // Two names for each of the 15 techniques that need the fighter's clips only, four for each of the
  // other 34: 166 of the 196 names the importer accepts.
  const total = (key) => data.techniques.reduce((count, technique) => count + technique[key].length, 0);
  assert.deepEqual([FIGHTER_ONLY_CLIP_IDS.length, allMoves.length - FIGHTER_ONLY_CLIP_IDS.length], [15, 34]);
  assert.deepEqual([total('clipFilesNeeded'), total('clipFileNames')], [166, 196]);
  const of = (clipId) => data.techniques.find((technique) => technique.clipId === clipId);
  assert.deepEqual(of('hook_sweep').clipFilesNeeded, ['hook_sweep/fighter-side.mp4', 'hook_sweep/fighter-front.mp4']);
  assert.deepEqual(of('purple_omoplata').clipFilesNeeded, ['purple_omoplata/fighter-side.mp4', 'purple_omoplata/fighter-front.mp4']);
  assert.deepEqual(of('rear_naked_choke').clipFilesNeeded, ['rear_naked_choke/fighter-side.mp4', 'rear_naked_choke/fighter-front.mp4', 'rear_naked_choke/opponent-side.mp4', 'rear_naked_choke/opponent-front.mp4']);
  // The notice says what each of the two lists is.
  assert.equal(data.notice, NOTICE);
  // A made-up curriculum: the site's rule decides whose files are needed, not the sheet.
  const odd = JSON.parse(made([fixture('hook-sweep', { belt: 'blue', starts: ['open-guard-bottom'] }), fixture('plain-move')]).json).techniques;
  assert.deepEqual(odd.map((technique) => technique.clipFilesNeeded), [names('hook_sweep', ['fighter']), names('plain_move', ['fighter', 'opponent'])]);
});

test('each technique says which view the site opens it on, by the site\'s own rule', () => {
  const sections = sectionsOf(sheet.markdown);
  // The site lists a technique's views in the order of its camera buttons, which is the importer's.
  assert.deepEqual([...UNREAL_CLIP_CAMERAS], [...CAMERAS]);
  for (const [index, technique] of data.techniques.entries()) {
    // Its own opening view where it has one, otherwise the side view.
    assert.equal(technique.opensOn, Object.hasOwn(TECHNIQUE_OPENING_CAMERA, technique.clipId) ? TECHNIQUE_OPENING_CAMERA[technique.clipId] : 'side', technique.clipId);
    // What the site opens it on, for each performer it needs: with both views published, with that
    // view alone, and with the other view alone.
    const other = CAMERAS.find((camera) => camera !== technique.opensOn);
    const holding = (cameras) => (clipId, performer) => (clipId === technique.clipId && technique.clipsNeeded.includes(performer)
      ? UNREAL_CLIP_CAMERAS.filter((camera) => cameras.includes(camera)).map((camera) => ({ moveId: clipId, performerSide: performer, camera }))
      : []);
    for (const performerSide of technique.clipsNeeded) {
      const opens = (cameras) => chooseTechniquePicture({ moveId: null, clipMoveId: technique.clipId, performerSide, engine: 'unity', search: '', views: holding(cameras) }).camera;
      assert.deepEqual([opens(CAMERAS), opens([technique.opensOn]), opens([other])], [technique.opensOn, technique.opensOn, other], `${technique.clipId} ${performerSide}`);
    }
    // One line, right after whose clips it needs.
    const section = sections[index].lines;
    assert.equal(section[section.findIndex((line) => line.startsWith('- Clips needed: ')) + 1], technique.clipId === 'rear_naked_choke' ? OPENS_FRONT : OPENS_SIDE, technique.clipId);
    assert.equal(section.filter((line) => line.startsWith('- The site opens on: ')).length, 1, technique.clipId);
  }
  // Today the rear naked choke opens on the front view, and every other technique on the side view.
  assert.deepEqual(data.techniques.filter((technique) => technique.opensOn !== 'side').map((technique) => [technique.clipId, technique.opensOn]), [['rear_naked_choke', 'front']]);
  assert.deepEqual([lines.filter((line) => line === OPENS_FRONT).length, lines.filter((line) => line === OPENS_SIDE).length], [1, allMoves.length - 1]);
  const of = (clipId) => sections[data.techniques.findIndex((technique) => technique.clipId === clipId)].lines;
  assert.ok(of('rear_naked_choke').includes(OPENS_FRONT));
  for (const clipId of ['double_leg', 'hook_sweep', 'purple_omoplata', 'protect_position']) assert.ok(of(clipId).includes(OPENS_SIDE), clipId);
  // A made-up curriculum: the view goes by the clip id.
  const odd = made([fixture('rear-naked-choke', { belt: 'blue' }), fixture('plain-move', { belt: 'blue' })]);
  assert.deepEqual(JSON.parse(odd.json).techniques.map((technique) => technique.opensOn), ['front', 'side']);
  assert.deepEqual(sectionsOf(odd.markdown).map((section) => section.lines.filter((line) => line.startsWith('- The site opens on: '))), [[OPENS_FRONT], [OPENS_SIDE]]);
  assert.deepEqual(unusual(odd.markdown), []);
});

test('the white-belt starters, which Training does not list, say that their clips play only in the Arena', () => {
  // Training lists the curriculum's `moves` under its belt tabs, BELTS.slice(1): blue to black
  // (src/App.jsx; tests/unrealRivalReach.test.js pins those lines).
  const listed = new Set(BELTS.slice(1).flatMap((belt) => trainingMoves.filter((move) => move.belt === belt)).map((move) => move.id));
  const arenaOnly = allMoves.filter((move) => !listed.has(move.id));
  assert.deepEqual(arenaOnly.map((move) => unrealClipMoveId(move.id)), ['protect_position', 'basic_punch', 'basic_kick', 'basic_tackle']);
  assert.deepEqual(arenaOnly, allMoves.filter((move) => move.belt === 'white'));
  const sections = sectionsOf(sheet.markdown);
  for (const [index, move] of allMoves.entries()) {
    const section = sections[index].lines;
    assert.equal(section.filter((line) => line === ARENA_ONLY).length, listed.has(move.id) ? 0 : 1, move.id);
    // Right after whose clips it needs and the view the site opens it on.
    if (!listed.has(move.id)) assert.equal(section[section.findIndex((line) => line.startsWith('- The site opens on: ')) + 1], ARENA_ONLY, move.id);
  }
  assert.equal(lines.filter((line) => line.includes('Training does not list')).length, arenaOnly.length + 1);
  // A made-up curriculum: only its white-belt techniques, and with none of them the clip files section names no starters.
  const some = made([fixture('first-move', { belt: 'blue' }), fixture('second-move'), fixture('third-move')]);
  assert.deepEqual(sectionsOf(some.markdown).map((section) => section.lines.includes(ARENA_ONLY)), [false, true, true]);
  assert.ok(some.markdown.split('\n').some((line) => line.includes(` Training shows the technique in that position, except the white-belt starters (${code('second_move')} and ${code('third_move')}): Training does not list them, so their clips play only in the Arena. The Arena plays `)));
  const none = made([fixture('first-move', { belt: 'blue' })]);
  assert.ok(!none.markdown.includes('Training does not list'));
  assert.ok(none.markdown.split('\n').some((line) => line.includes(' Training shows the technique in that position. The Arena plays a technique\'s clip only after an exchange that started in its "Render from" position. ')));
});

test('every clip ends on the finish its approved steps describe, a submission\'s too, which does not move the athletes in the game', () => {
  const naming = lines.slice(lines.indexOf('## Clip files'), lines.indexOf('## Index'));
  // The rule, then submissions, then how the sheet works out where the game continues.
  const at = naming.indexOf(END_RULE);
  assert.ok(at > 0);
  assert.deepEqual(naming.slice(at + 1, at + 4), ['', SUBMISSION_RULE, '']);
  assert.ok(naming[at + 4].startsWith('The sheet works out where the game continues with the game\'s own rules '));
  // No clip has to end anywhere but on its approved finish.
  assert.ok(!sheet.markdown.includes('must end'));
  // True in the game: whatever the other athlete plays, a submission won from its Render from
  // position leaves the athletes where they were, for either performer. The sheet says so too.
  const submissions = allMoves.filter((move) => move.isSubmission || move.category === 'submission');
  assert.equal(submissions.length, 13);
  assert.deepEqual(submissions, allMoves.filter((move) => move.isSubmission === true));
  for (const move of submissions) {
    const technique = data.techniques[allMoves.indexOf(move)];
    assert.deepEqual(technique.gameContinuesFrom, both(move.starts[0], positionLabels[move.starts[0]]), move.id);
    for (const performer of PERFORMERS) {
      const before = createArenaState(move.starts[0], performer);
      for (const opposingMove of [null, ...allMoves]) {
        assert.equal(getPositionForSide(resolveArenaOutcome(before, move, performer, { opposingMove }), performer), move.starts[0], `${move.id} ${performer} ${opposingMove?.id}`);
      }
    }
    // Its section says it is a submission.
    assert.ok(sectionsOf(sheet.markdown)[allMoves.indexOf(move)].lines.includes(`- Belt: ${move.belt}; category: ${move.category}; is a submission: yes`), move.id);
  }
});

test('the clip files section says what the importer requires of every delivered technique clip, as the importer checks it', () => {
  const importer = [
    `What the site's importer (${code('tools/import_unreal_clips.mjs')}) requires of every delivered technique clip. It publishes a clip only when all of these hold:`,
    '',
    `- An entry for the clip in the render pack's ${code('clips/technique-clips.json')}, with its ${['moveId', 'performerSide', 'camera', 'file', 'poster', 'bytes', 'sha256', 'width', 'height', 'fps', 'frames'].map(code).join(', ')} and ${code('durationSeconds')}. Its ${code('moveId')} is the clip id, and the file's size and SHA-256 are the entry's. There is one entry per clip that is not a draft: a new take replaces the old entry, or the old entry is marked ${code('"draft": true')}.`,
    `- ${code('"loops": false')} and ${code('"draft": false')}. An entry marked ${code('"draft": true')} is left out.`,
    `- A poster of the same name beside each ${code('.mp4')}, ${code('<clipId>/<performer>-<camera>.webp')}, with the same pixel size as the video. For a technique clip the site cuts its own poster from frame 0 of the video, but the pack's poster must exist.`,
    `- H.264, High profile, ${code('yuv420p')}, one video stream and nothing else (no sound), the index before the media (fast start), and the picture size, frame rate and frame count its entry gives.`,
    `- ${code('frames')} and ${code('fps')} that match ${code('durationSeconds')}: frames divided by fps is the duration, to a thousandth of a second.`,
    `- The same frame count for every view of one performer: a technique's ${code('fighter-side')} and ${code('fighter-front')} clips are the same length, and so are its two ${code('opponent')} clips.`,
    `- An acceptance line for that exact file and SHA-256 in the site's ${code('tools/unreal_clip_acceptance.json')}, which Claude writes after reviewing the clip. Until then the importer leaves the clip out.`,
    '',
    IMPORT_STOPS,
    '',
    '## Index',
  ];
  // The last part of the clip files section.
  const at = lines.indexOf(importer[0]);
  assert.ok(at > lines.indexOf('## Clip files'));
  assert.deepEqual(lines.slice(at, at + importer.length), importer);

  // The importer checks the files so (tools/import_unreal_clips.mjs) ...
  const source = readFileSync(fileURLToPath(new URL('../tools/import_unreal_clips.mjs', import.meta.url)), 'utf8').split(/\r?\n/).map((line) => line.trim());
  for (const line of [
    "const ACCEPTANCE = 'tools/unreal_clip_acceptance.json';",
    'if (statSync(video).size !== entry.bytes || sha256(video) !== entry.sha256) fail(`${entry.file} is not the file its manifest describes`);',
    'if (video.length !== 1 || streams.length !== 1) fail(`${file}: expected one video stream and nothing else`);',
    "const [moov, mdat] = [data.indexOf('moov'), data.indexOf('mdat')];",
    "const expected = { codec: 'h264', profile: 'High', pixelFormat: 'yuv420p', width: entry.width, height: entry.height, fps: Number(entry.fps), frames: entry.frames, faststart: true };",
    'const posterSource = path.join(source, entry.poster);',
    'const size = pictureSize(ffbin, posterSource);',
    'if (size[0] !== entry.width || size[1] !== entry.height) fail(`${entry.poster}: poster and video sizes differ`);',
    'const posterFrame = entry.loops ? null : 0;',
  ]) assert.ok(source.includes(line), line);

  // ... and takes a technique's clips in, or leaves them out, by its manifest as the sheet says.
  const entry = (performerSide, camera, extra = {}) => ({
    moveId: 'rear_naked_choke', performerSide, camera, file: `rear_naked_choke/${performerSide}-${camera}.mp4`, poster: `rear_naked_choke/${performerSide}-${camera}.webp`,
    bytes: 1000, sha256: 'b'.repeat(64), width: 1280, height: 720, fps: 30, frames: 120, durationSeconds: 4, loops: false, draft: false, ...extra,
  });
  const accept = (entries) => entries.map((item) => ({ file: item.file, sha256: item.sha256, acceptedOn: '2026-11-14' }));
  // The two performers' clips may differ in length.
  const views = [entry('fighter', 'side'), entry('fighter', 'front'), entry('opponent', 'side', { frames: 90, durationSeconds: 3 })];
  assert.deepEqual(selectEntries(views, accept(views)).selected.map((item) => item.file), views.map((item) => item.file));
  // Without an acceptance line for that file and that SHA-256, a clip is left out; so is a draft.
  assert.deepEqual(selectEntries(views, accept(views.slice(1))).notAccepted, [views[0].file]);
  assert.deepEqual(selectEntries(views, [...accept(views.slice(1)), { file: views[0].file, sha256: 'c'.repeat(64), acceptedOn: '2026-11-14' }]).notAccepted, [views[0].file]);
  assert.deepEqual(selectEntries([entry('fighter', 'side', { draft: true })], []).draftsLeftOut, ['rear_naked_choke/fighter-side.mp4']);
  for (const [what, entries] of Object.entries({
    'a technique clip that loops': [entry('fighter', 'side', { loops: true })],
    'a technique clip that does not say "draft": false': [entry('fighter', 'side', { draft: undefined })],
    'a poster of another name': [entry('fighter', 'side', { poster: 'rear_naked_choke/fighter-side.png' })],
    'frames and fps that do not match the duration': [entry('fighter', 'side', { durationSeconds: 4.01 })],
    'two views of one performer that differ in length': [entry('fighter', 'side'), entry('fighter', 'front', { frames: 121, durationSeconds: 121 / 30 })],
  })) assert.throws(() => selectEntries(entries, accept(entries)), Error, what);
});

test('a delivered entry that fails a check stops the whole import, as the sheet says, while a draft or a clip without its acceptance line is only left out', () => {
  const base = mkdtempSync(path.join(os.tmpdir(), 'jiuquest-import-stops-'));
  try {
    const pack = path.join(base, 'clips');
    const out = path.join(base, 'site');
    const clipList = path.join(out, 'src', 'unreal', 'techniqueClips.data.js');
    // A take of the rear naked choke whose file is not the one its entry describes, and a stance clip.
    mkdirSync(path.join(pack, 'rear_naked_choke'), { recursive: true });
    writeFileSync(path.join(pack, 'rear_naked_choke', 'fighter-side.mp4'), 'not the take its entry describes');
    const take = (extra = {}) => ({
      moveId: 'rear_naked_choke', performerSide: 'fighter', camera: 'side', file: 'rear_naked_choke/fighter-side.mp4', poster: 'rear_naked_choke/fighter-side.webp',
      bytes: 1000, sha256: 'b'.repeat(64), width: 1280, height: 720, fps: 30, frames: 120, durationSeconds: 4, loops: false, draft: false, ...extra,
    });
    const stance = {
      moveId: 'standing_stance', performerSide: 'fighter', camera: 'side', file: 'standing_stance/fighter-side.mp4', poster: 'standing_stance/fighter-side.webp',
      bytes: 1000, sha256: 'c'.repeat(64), width: 1280, height: 720, fps: 30, frames: 54, durationSeconds: 1.8, loops: true,
    };
    const accepted = [{ file: 'rear_naked_choke/fighter-side.mp4', sha256: 'b'.repeat(64), acceptedOn: '2026-11-14' }];
    // The importer is given no ffmpeg: nothing here gets as far as reading a video.
    const run = (entries, acceptance) => {
      rmSync(out, { recursive: true, force: true });
      writeFileSync(path.join(pack, 'technique-clips.json'), JSON.stringify(entries));
      return importClips({ source: pack, ffbin: path.join(base, 'no-ffmpeg'), out, acceptance });
    };
    // Once the take has its acceptance line its file is checked, and the whole import stops: no clip
    // list is written and nothing is copied, so the stance clip in the pack is not published either.
    assert.throws(() => run([take(), stance], accepted), /rear_naked_choke\/fighter-side\.mp4 is not the file its manifest describes/);
    assert.deepEqual([existsSync(clipList), existsSync(path.join(out, 'public'))], [false, false]);
    // A check of the entry itself stops it too, whether the take is accepted or not.
    for (const acceptance of [[], accepted]) {
      assert.throws(() => run([stance, take({ durationSeconds: 4.01 })], acceptance), /duration does not match its frame count/);
      assert.throws(() => run([stance, take({ loops: true })], acceptance), /a technique clip plays once/);
      assert.deepEqual([existsSync(clipList), existsSync(path.join(out, 'public'))], [false, false]);
    }
    // Without its acceptance line the take's file is not checked: it is only left out, and the import goes on.
    assert.deepEqual(run([take()], []), { clips: 0, moves: [], draftsLeftOut: [], notAccepted: ['rear_naked_choke/fighter-side.mp4'], videoBytes: 0, posterBytes: 0 });
    assert.ok(existsSync(clipList));
    // Delivered as a draft, the same take is left out whatever else is wrong with it, and the import goes on.
    assert.deepEqual(run([take({ draft: true, loops: true, durationSeconds: 4.01 })], accepted).draftsLeftOut, ['rear_naked_choke/fighter-side.mp4']);
    assert.ok(existsSync(clipList));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('the index by starting position lists each position with the techniques that start there', () => {
  const named = Object.keys(positionLabels);
  const anywhere = (move) => named.every((id) => move.starts.includes(id));
  const rows = startRows(sheet.markdown);
  // The game's positions in the game's order, each with its techniques in curriculum order.
  const expected = named
    .map((id) => [`${positionLabels[id]} (${code(id)})`, allMoves.filter((move) => !anywhere(move) && move.starts.includes(id)).map((move) => code(unrealClipMoveId(move.id)))])
    .filter(([, ids]) => ids.length > 0);
  // A technique that starts in every position the game names comes last, once.
  const everywhere = allMoves.filter(anywhere).map((move) => code(unrealClipMoveId(move.id)));
  assert.deepEqual(rows, everywhere.length ? [...expected, ['Every position', everywhere]] : expected);
  // Every technique is in the index: under each position it starts in, or once under every position.
  for (const move of allMoves) {
    const listed = rows.filter(([, ids]) => ids.includes(code(unrealClipMoveId(move.id)))).length;
    assert.equal(listed, anywhere(move) ? 1 : move.starts.length, move.id);
  }

  // The same rules on a made-up curriculum: a position with no label is listed by its id after the
  // labelled ones, a position nothing starts in is left out, and a technique that starts in every
  // labelled position is listed once at the end instead of under each.
  const odd = made([
    fixture('first-move', { starts: ['turtle-top', 'standing'] }), fixture('second-move', { starts: ['standing', 'clinch'] }),
    fixture('third-move', { starts: ['clinch'] }), fixture('guard-move', { starts: ['clinch', 'standing', 'turtle-top', 'guard-top'] }),
  ]);
  assert.deepEqual(startRows(odd.markdown), [
    [`Standing Range (${code('standing')})`, [code('first_move'), code('second_move')]],
    [`Clinch (${code('clinch')})`, [code('second_move'), code('third_move')]],
    [`${code('turtle-top')} (no label)`, [code('first_move')]],
    ['Every position', [code('guard_move')]],
  ]);
  const [first, , , guard] = JSON.parse(odd.json).techniques;
  assert.deepEqual(first.starts, [{ id: 'turtle-top', label: null }, { id: 'standing', label: 'Standing Range' }]);
  assert.deepEqual(indexRows(odd.markdown).map((cells) => cells[4]), [`${code('turtle-top')}, Standing Range`, 'Standing Range, Clinch', 'Clinch', 'Every position']);
  // Its own section and the JSON still name every position it starts in.
  assert.equal(guard.starts.length, 4);
  assert.ok(sectionsOf(odd.markdown)[3].lines.includes(`- Starts in: every position (4): Clinch (${code('clinch')}), Standing Range (${code('standing')}), ${code('turtle-top')} (no label), Top Guard (${code('guard-top')})`));
});

test('the header says what made the sheet, from which commit, and that the wording must not be changed', () => {
  assert.equal(lines[0], '# JiuQuest technique sheet');
  assert.equal(lines[2], `Generated by ${code('tools/build_technique_sheet.mjs')} from the JiuQuest site's curriculum (${code('src/data')}) at commit ${code(COMMIT)}. Do not edit this file: run the tool again.`);
  assert.equal(lines[4], "The name, lesson, scenario and steps of every technique are the owner's approved wording, copied character for character. They must not be changed. Nothing is corrected here: where the wording looks like a slip, that is how the curriculum has it.");
  assert.equal(data.generatedBy, 'tools/build_technique_sheet.mjs');
  assert.equal(data.commit, COMMIT);
  assert.equal(data.uncommittedChanges, false);
  assert.match(data.notice, /owner's approved wording, copied character for character from the curriculum \(src\/data\)\. They must not be changed\.$/);

  // A sheet made while the files it is made from held uncommitted changes says so.
  const dirty = build({ uncommitted: true });
  assert.ok(dirty.markdown.split('\n')[2].endsWith(` at commit ${code(COMMIT)}, plus uncommitted changes to the files it is made from. Do not edit this file: run the tool again.`));
  assert.equal(JSON.parse(dirty.json).uncommittedChanges, true);

  // Then how clip files are named, the index, the index by starting position, and the techniques.
  assert.deepEqual(lines.filter((line) => line.startsWith('## ')), ['## Clip files', '## Index', '## By starting position', '## Techniques']);
  const naming = lines.slice(lines.indexOf('## Clip files'), lines.indexOf('## Index'));
  assert.ok(naming.includes(`A technique's clips are named ${code(CLIP_FILE_PATTERN)}.`));
  assert.ok(naming.some((line) => line.startsWith(`- ${code('<clipId>')} is the technique's clip id`) && line.endsWith('It is not the curriculum id.')));
  assert.ok(naming.includes(`- ${code('<performer>')} is who performs the technique: ${code('fighter')} when the player's athlete performs it on the rival, ${code('opponent')} when the rival performs it on the player's athlete.`));
  assert.ok(naming.includes(`- ${code('<camera>')} is ${code('side')} or ${code('front')}.`));
  // The sheet says in words who each performer is. A new performer needs words of its own there.
  assert.deepEqual([...PERFORMERS], ['fighter', 'opponent']);
  assert.ok(naming.includes(`The steps and scenarios speak to the performer: "you" is the athlete who performs the technique and "the opponent" is the other athlete. So in an ${code('opponent')} clip, "you" is the rival.`));
  // One technique's file names in full, as an example: the first technique rendered.
  assert.ok(naming.includes(`For example, ${code('rear_naked_choke')} can have these clips:`));
  assert.deepEqual(naming.filter((line) => line.startsWith('    ')), data.techniques.find((technique) => technique.clipId === 'rear_naked_choke').clipFileNames.map((name) => `    ${name}`));
  assert.equal(lines[lines.indexOf('## Index') + 4], '| # | Clip id | Name | Belt | Starts in | Ends in | Steps | Unity animation | Clips needed | Unreal clips today |');
});

test('the guide\'s own step numbers are noted where they are not 1, 2, 3', () => {
  // On the real curriculum: a note exactly where the guide's labels differ from the steps' places.
  const sections = sectionsOf(sheet.markdown);
  for (const [index, move] of allMoves.entries()) {
    const labels = move.stepDetails?.map((step) => step.label);
    const note = sections[index].lines.filter((line) => line.startsWith('Step numbers in the approved guide: '));
    const irregular = labels?.some((label, at) => label !== `${at + 1}.`) ?? false;
    assert.deepEqual(note, irregular ? [`Step numbers in the approved guide: ${labels.join(' ')}`] : [], move.id);
  }
  // On a made-up one: the sheet numbers the steps by their place whatever the guide calls them.
  const details = (...labels) => labels.map((label) => ({ label }));
  const steps = ['First step', 'Second step', 'Third step'];
  const [twice, regular, none] = sectionsOf(made([
    fixture('twice-move', { steps, stepDetails: details('1.', '2.', '2.') }),
    fixture('regular-move', { steps, stepDetails: details('1.', '2.', '3.') }),
    fixture('plain-move', { steps }),
  ]).markdown);
  assert.deepEqual(afterSteps(twice), ['1. First step', '2. Second step', '3. Third step', 'Step numbers in the approved guide: 1. 2. 2.']);
  assert.deepEqual(afterSteps(regular), ['1. First step', '2. Second step', '3. Third step']);
  assert.deepEqual(afterSteps(none), ['1. First step', '2. Second step', '3. Third step']);
});

test('text the sheet cannot show unchanged is refused, never altered', () => {
  assert.doesNotThrow(() => made([fixture('first-move')]));
  assert.throws(() => made([fixture('first-move', { steps: ['First step', 'Second\nstep'] })]), /technique "first-move": step 2 has a line break/);
  assert.throws(() => made([fixture('first-move', { scenario: 'Line one.\r\nLine two.' })]), /scenario has a line break/);
  assert.throws(() => made([fixture('first-move', { lesson: 'Line one.\rLine two.' })]), /lesson has a line break/);
  assert.throws(() => made([fixture('first-move', { name: 'Guard | Pass' })]), /name has a "\|"/);
  assert.throws(() => made([fixture('first-move', { name: undefined })]), /name must be text/);
  assert.throws(() => made([fixture('first-move', { steps: ['First step', 42] })]), /step 2 must be text/);
  // Two techniques can never share one set of clips.
  assert.throws(() => made([fixture('first-move'), fixture('first_move')]), /first_move and first-move share the clip id first_move/);
  assert.throws(() => made([fixture('')]), /has no clip id/);
  assert.throws(() => buildTechniqueSheet({ moves: [fixture('first-move')], positionLabels: fixtureLabels, clips: [] }), /needs the commit/);
  assert.throws(() => made([fixture('first-move')], { commit: '' }), /needs the commit/);
  assert.throws(() => made({}), /needs moves/);
});

test('the same inputs give the same two files, with plain line ends, and the curriculum is left as it was', () => {
  const before = JSON.stringify(allMoves);
  const again = build();
  assert.deepEqual(again, sheet);
  assert.equal(JSON.stringify(allMoves), before);
  assert.deepEqual(Object.keys(sheet), ['markdown', 'json']);
  for (const text of [sheet.markdown, sheet.json]) {
    assert.equal(typeof text, 'string');
    assert.ok(!text.includes('\r'));
    assert.ok(text.endsWith('\n') && !text.endsWith('\n\n'));
  }
  // The JSON file is indented JSON of the listed techniques.
  assert.equal(sheet.json, `${JSON.stringify(data, null, 2)}\n`);
});

test('the command writes the two files into the folder it is given, creating it', (t) => {
  const tool = fileURLToPath(new URL('../tools/build_technique_sheet.mjs', import.meta.url));
  const root = fileURLToPath(new URL('..', import.meta.url));
  let commit;
  try {
    commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    t.skip('git is not available here, and the command stamps the sheet with the commit');
    return;
  }
  const base = mkdtempSync(path.join(os.tmpdir(), 'jiuquest-technique-sheet-'));
  try {
    const out = path.join(base, 'not', 'there yet');
    const run = spawnSync(process.execPath, [tool, out], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(readdirSync(out).sort(), [SHEET_JSON, SHEET_MARKDOWN].sort());
    assert.deepEqual([SHEET_MARKDOWN, SHEET_JSON], ['TECHNIQUE-SHEET.md', 'TECHNIQUE-SHEET.json']);
    const written = { markdown: readFileSync(path.join(out, SHEET_MARKDOWN), 'utf8'), json: readFileSync(path.join(out, SHEET_JSON), 'utf8') };
    const stamped = JSON.parse(written.json);
    assert.equal(stamped.commit, commit);
    assert.equal(typeof stamped.uncommittedChanges, 'boolean');
    // The files hold exactly what the pure function gives for the curriculum and the published clip list.
    assert.deepEqual(written, build({ commit, uncommitted: stamped.uncommittedChanges }));
    assert.deepEqual(JSON.parse(run.stdout), {
      markdown: path.join(out, SHEET_MARKDOWN), json: path.join(out, SHEET_JSON), techniques: allMoves.length, steps: stepTotal,
      markdownLines: written.markdown.split('\n').length - 1, commit, uncommittedChanges: stamped.uncommittedChanges,
    });

    // Anything but one folder is a usage error, and nothing is written.
    for (const args of [[], [out, 'extra'], ['--help']]) {
      const refused = spawnSync(process.execPath, [tool, ...args], { encoding: 'utf8', cwd: base });
      assert.equal(refused.status, 2, JSON.stringify(args));
      assert.match(refused.stderr, /^usage: node tools\/build_technique_sheet\.mjs <output dir>\s*$/);
      assert.equal(refused.stdout, '');
    }
    assert.deepEqual(readdirSync(base), ['not']);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
