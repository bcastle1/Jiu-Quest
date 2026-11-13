import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { readAcceptance, renderDataFile, selectEntries, TECHNIQUE_IDS } from '../tools/import_unreal_clips.mjs';

const hash = (digit) => digit.repeat(64);
const entry = (moveId, performerSide, camera, extra = {}) => ({
  moveId, performerSide, camera,
  file: `${moveId}/${performerSide}-${camera}.mp4`, poster: `${moveId}/${performerSide}-${camera}.webp`,
  bytes: 1000, sha256: hash('a'), width: 1280, height: 720, fps: 30,
  frames: 54, durationSeconds: 1.8, loops: true, choreographyReviewed: false, draft: false,
  ...extra,
});
const technique = (performerSide, camera, extra = {}) => entry('double_leg', performerSide, camera,
  { frames: 126, durationSeconds: 4.2, loops: false, sha256: hash(performerSide === 'fighter' ? 'b' : 'c'), ...extra });
const accept = (clip) => ({ file: clip.file, sha256: clip.sha256, acceptedOn: '2026-11-13' });
const files = (result) => result.selected.map((clip) => clip.file);

test('a draft is held and listed, whatever it is', () => {
  const result = selectEntries([entry('standing_stance', 'fighter', 'side'), technique('fighter', 'side', { draft: true })], []);
  assert.deepEqual(files(result), ['standing_stance/fighter-side.mp4']);
  assert.deepEqual(result.draftsLeftOut, ['double_leg/fighter-side.mp4']);
  assert.deepEqual(result.notAccepted, []);
});

test('a technique clip with no acceptance line is left out and listed', () => {
  const result = selectEntries([technique('fighter', 'side'), technique('opponent', 'side')], []);
  assert.deepEqual(result.selected, []);
  assert.deepEqual(result.notAccepted, ['double_leg/fighter-side.mp4', 'double_leg/opponent-side.mp4']);
});

test('an accepted technique clip is imported; one re-delivered with a new hash is refused', () => {
  const fighter = technique('fighter', 'side');
  const opponent = technique('opponent', 'side');
  const result = selectEntries([fighter, { ...opponent, sha256: hash('d') }], [accept(fighter), accept(opponent)]);
  assert.deepEqual(files(result), ['double_leg/fighter-side.mp4']);
  assert.deepEqual(result.notAccepted, ['double_leg/opponent-side.mp4']);
  // The acceptance is for the exact file: the same name with the old hash is not enough.
  assert.deepEqual(selectEntries([{ ...fighter, sha256: hash('e') }], [accept(fighter)]).selected, []);
});

test('a technique clip must play once and must not be a draft', () => {
  const looping = technique('fighter', 'side', { loops: true });
  assert.throws(() => selectEntries([looping], [accept(looping)]), /plays once/);
  // Format is checked before acceptance, so a bad delivery fails loudly.
  assert.throws(() => selectEntries([looping], []), /plays once/);
  const unmarked = technique('fighter', 'side');
  delete unmarked.draft;
  assert.throws(() => selectEntries([unmarked], [accept(unmarked)]), /"draft": false/);
});

test('every view of one technique and performer has the same length', () => {
  const side = technique('fighter', 'side');
  const front = technique('fighter', 'front', { frames: 120, durationSeconds: 4, sha256: hash('f') });
  assert.throws(() => selectEntries([side, front], [accept(side), accept(front)]), /same length/);
  // Different performers may differ.
  const opponent = technique('opponent', 'side', { frames: 120, durationSeconds: 4 });
  assert.equal(selectEntries([side, opponent], [accept(side), accept(opponent)]).selected.length, 2);
});

test('a stance clip needs no acceptance line and must loop; an entry clip plays once', () => {
  const result = selectEntries([entry('stance_sambo', 'fighter', 'side'), entry('enter_sambo', 'fighter', 'side', { loops: false })], []);
  assert.deepEqual(files(result), ['enter_sambo/fighter-side.mp4', 'stance_sambo/fighter-side.mp4']);
  assert.throws(() => selectEntries([entry('standing_stance', 'fighter', 'side', { loops: false })], []), /"loops": true/);
  assert.throws(() => selectEntries([entry('enter_sambo', 'fighter', 'side')], []), /"loops": false/);
});

test('names, sets, repeats and durations are still checked', () => {
  assert.throws(() => selectEntries([entry('armbar', 'fighter', 'side')], []), /neither a technique/);
  assert.throws(() => selectEntries([entry('standing_stance', 'referee', 'side')], []), /unexpected or repeated/);
  assert.throws(() => selectEntries([entry('standing_stance', 'fighter', 'top')], []), /unexpected or repeated/);
  assert.throws(() => selectEntries([entry('standing_stance', 'fighter', 'side'), entry('standing_stance', 'fighter', 'side')], []), /unexpected or repeated/);
  assert.throws(() => selectEntries([{ ...entry('standing_stance', 'fighter', 'side'), file: 'standing_stance/side.mp4' }], []), /file names/);
  assert.throws(() => selectEntries([entry('standing_stance', 'fighter', 'side', { durationSeconds: 2 })], []), /duration/);
});

test('output is ordered by move, then fighter before opponent, then side before front', () => {
  const pack = [
    entry('standing_stance', 'opponent', 'front'), entry('standing_stance', 'fighter', 'front'),
    entry('stance_sumo', 'fighter', 'side'), entry('standing_stance', 'opponent', 'side'), entry('standing_stance', 'fighter', 'side'),
  ];
  assert.deepEqual(files(selectEntries(pack, [])), [
    'stance_sumo/fighter-side.mp4', 'standing_stance/fighter-side.mp4', 'standing_stance/fighter-front.mp4',
    'standing_stance/opponent-side.mp4', 'standing_stance/opponent-front.mp4',
  ]);
});

test('the acceptance list is checked for shape', () => {
  assert.throws(() => readAcceptance({}), /JSON array/);
  assert.throws(() => readAcceptance([{ file: 'double_leg/fighter-side.mp4', sha256: 'abc', acceptedOn: '2026-11-13' }]), /sha256/);
  assert.throws(() => readAcceptance([{ file: 'double_leg/fighter-side.mp4', sha256: hash('a'), acceptedOn: '13/11/2026' }]), /acceptedOn/);
  const line = { file: 'double_leg/fighter-side.mp4', sha256: hash('a'), acceptedOn: '2026-11-13' };
  assert.throws(() => readAcceptance([line, line]), /repeated/);
});

test('the committed acceptance list is valid and names only technique files', () => {
  const list = readAcceptance(JSON.parse(readFileSync(new URL('../tools/unreal_clip_acceptance.json', import.meta.url), 'utf8')));
  for (const line of list) assert.ok(TECHNIQUE_IDS.includes(line.file.split('/')[0]), line.file);
});

test('the generated data file names the Node importer and records the poster frame', () => {
  const text = renderDataFile([{ moveId: 'double_leg', loops: false, posterFrame: 0 }, { moveId: 'standing_stance', loops: true, posterFrame: null }]);
  assert.equal(text, [
    "// Generated by tools/import_unreal_clips.mjs from the Unreal render pack's",
    '// clips/technique-clips.json. Do not edit by hand: rerun the tool.',
    'export default Object.freeze([',
    '  Object.freeze({"moveId": "double_leg", "loops": false, "posterFrame": 0}),',
    '  Object.freeze({"moveId": "standing_stance", "loops": true, "posterFrame": null}),',
    ']);',
    '',
  ].join('\n'));
});

test('the four technique ids are the ones Unity animates today', () => {
  assert.deepEqual([...TECHNIQUE_IDS].sort(), ['double_leg', 'rear_naked_choke', 'trap_roll_escape', 'triangle_choke']);
  assert.equal(existsSync(new URL('../tools/import_unreal_clips.py', import.meta.url)), false);
});
