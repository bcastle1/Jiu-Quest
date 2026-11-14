import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { readAcceptance, renderDataFile, selectEntries, TECHNIQUE_IDS } from '../tools/import_unreal_clips.mjs';
import { allMoves } from '../src/data/curriculum.js';
import { UNITY_PREVIEWS, resolveUnityMove } from '../src/unity/bridge.js';
import published from '../src/unreal/techniqueClips.data.js';
import { unrealClipMoveId } from '../src/unreal/techniqueIds.js';

const hash = (digit) => digit.repeat(64);
const entry = (moveId, performerSide, camera, extra = {}) => ({
  moveId, performerSide, camera,
  file: `${moveId}/${performerSide}-${camera}.mp4`, poster: `${moveId}/${performerSide}-${camera}.webp`,
  bytes: 1000, sha256: hash('a'), width: 1280, height: 720, fps: 30,
  frames: 54, durationSeconds: 1.8, loops: true, choreographyReviewed: false, draft: false,
  ...extra,
});
// A clip of one technique, named by its clip id: it plays once.
const clipOf = (moveId, performerSide, camera, extra = {}) => entry(moveId, performerSide, camera,
  { frames: 126, durationSeconds: 4.2, loops: false, sha256: hash(performerSide === 'fighter' ? 'b' : 'c'), ...extra });
const technique = (performerSide, camera, extra = {}) => clipOf('double_leg', performerSide, camera, extra);
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

test('a technique Unity does not animate takes clips the same way: held until accepted, then imported', () => {
  // No Unity animation, so its clip id is its curriculum id with underscores.
  assert.ok(allMoves.some((move) => move.id === 'americana-armlock'));
  assert.equal(resolveUnityMove('americana-armlock'), null);
  assert.equal(unrealClipMoveId('americana-armlock'), 'americana_armlock');
  const fighter = clipOf('americana_armlock', 'fighter', 'side');
  const opponent = clipOf('americana_armlock', 'opponent', 'side');
  const waiting = selectEntries([fighter, opponent], []);
  assert.deepEqual(waiting.selected, []);
  assert.deepEqual(waiting.notAccepted, ['americana_armlock/fighter-side.mp4', 'americana_armlock/opponent-side.mp4']);
  const accepted = selectEntries([opponent, fighter], [accept(fighter), accept(opponent)]);
  assert.deepEqual(files(accepted), ['americana_armlock/fighter-side.mp4', 'americana_armlock/opponent-side.mp4']);
  assert.deepEqual(accepted.notAccepted, []);
  // With one performer accepted, that file alone is imported and the other is listed.
  const half = selectEntries([fighter, opponent], [accept(fighter)]);
  assert.deepEqual([files(half), half.notAccepted], [['americana_armlock/fighter-side.mp4'], ['americana_armlock/opponent-side.mp4']]);
  // An acceptance line is for one file: the same hash under another technique's name accepts nothing.
  const doubleLeg = technique('fighter', 'side');
  assert.equal(doubleLeg.sha256, fighter.sha256);
  assert.deepEqual(selectEntries([fighter], [accept(doubleLeg)]).notAccepted, ['americana_armlock/fighter-side.mp4']);
  // The format rules are the ones the first four techniques have.
  assert.throws(() => selectEntries([clipOf('americana_armlock', 'fighter', 'side', { loops: true })], [accept(fighter)]), /plays once/);
  const unmarked = clipOf('americana_armlock', 'fighter', 'side');
  delete unmarked.draft;
  assert.throws(() => selectEntries([unmarked], [accept(unmarked)]), /"draft": false/);
  const front = clipOf('americana_armlock', 'fighter', 'front', { frames: 120, durationSeconds: 4, sha256: hash('f') });
  assert.throws(() => selectEntries([fighter, front], [accept(fighter), accept(front)]), /same length/);
  // A draft waits for the owner like any other draft.
  assert.deepEqual(selectEntries([clipOf('americana_armlock', 'fighter', 'side', { draft: true })], [accept(fighter)]).draftsLeftOut, ['americana_armlock/fighter-side.mp4']);
});

test('every curriculum technique is held until it is accepted, and none can come in as a stance', () => {
  for (const move of allMoves) {
    const id = unrealClipMoveId(move.id);
    const pair = [clipOf(id, 'fighter', 'side'), clipOf(id, 'opponent', 'side')];
    const names = [`${id}/fighter-side.mp4`, `${id}/opponent-side.mp4`];
    const waiting = selectEntries(pair, []);
    assert.deepEqual([waiting.selected, waiting.notAccepted], [[], names], id);
    assert.deepEqual(files(selectEntries(pair, pair.map(accept))), names, id);
    // A stance clip loops and needs no acceptance line. A technique's name never gets that treatment.
    assert.throws(() => selectEntries([clipOf(id, 'fighter', 'side', { loops: true })], []), /plays once/, id);
  }
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

test('a move name may contain digits after its first letter', () => {
  // The curriculum has one technique with a digit in its id.
  assert.ok(allMoves.some((move) => move.id === 'headlock-escape-2'));
  assert.ok(TECHNIQUE_IDS.includes('headlock_escape_2'));
  const clip = clipOf('headlock_escape_2', 'fighter', 'side');
  assert.deepEqual(selectEntries([clip], []).notAccepted, ['headlock_escape_2/fighter-side.mp4']);
  assert.deepEqual(files(selectEntries([clip], [accept(clip)])), ['headlock_escape_2/fighter-side.mp4']);
  // A stance name takes digits the same way.
  const stances = selectEntries([entry('stance_guard_2', 'fighter', 'side'), entry('enter_guard_2', 'fighter', 'side', { loops: false })], []);
  assert.deepEqual(files(stances), ['enter_guard_2/fighter-side.mp4', 'stance_guard_2/fighter-side.mp4']);
  // A name still starts with a lower-case letter and has no hyphen, space or capital.
  for (const name of ['2_headlock_escape', '_headlock_escape', 'Headlock_escape_2', 'headlock-escape-2', 'headlock escape 2', '']) {
    assert.throws(() => selectEntries([entry(name, 'fighter', 'side')], []), /unexpected or repeated/, name);
  }
  // So does the part after stance_ or enter_.
  for (const name of ['stance_2', 'enter_2nd', 'stance_', 'enter_']) {
    assert.throws(() => selectEntries([entry(name, 'fighter', 'side')], []), /neither a technique/, name);
  }
});

test('a move the curriculum does not have is refused, and the error no longer lists every technique', () => {
  // 'kimura' is not a clip id ('kimura_guard' is); the double leg goes by Unity's id, not by its curriculum id.
  const unknown = ['armbar', 'kimura', 'double_leg_takedown', 'headlock_escape_3', 'standing_stance_2'];
  // Unity's other preview moves (a generic armbar, a guard pass) are not curriculum techniques either.
  const unityOnly = UNITY_PREVIEWS.map((move) => move.id).filter((id) => id !== 'standing_stance' && !TECHNIQUE_IDS.includes(id));
  assert.equal(unityOnly.length, UNITY_PREVIEWS.length - 5);
  for (const move of [...unknown, ...unityOnly]) {
    assert.ok(!TECHNIQUE_IDS.includes(move), move);
    const clip = clipOf(move, 'fighter', 'side');
    assert.throws(() => selectEntries([clip], []), /neither a technique/, move);
    // An acceptance line does not make it a technique.
    assert.throws(() => selectEntries([clip], [accept(clip)]), /neither a technique/, move);
  }
  assert.throws(() => selectEntries([clipOf('armbar', 'fighter', 'side')], []), (error) => {
    assert.match(error.message, /^armbar\/fighter-side\.mp4: armbar is neither a technique \(.+\) nor a stance clip$/);
    for (const id of TECHNIQUE_IDS) assert.ok(!error.message.includes(id), `the error lists ${id}`);
    return true;
  });
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

test('everything published passes the importer again, in the published order', () => {
  // The pack entry each published clip came from, as far as the clip list records it.
  const pack = published.map((clip) => {
    const stem = `${clip.moveId}/${clip.performerSide}-${clip.camera}`;
    return {
      moveId: clip.moveId, performerSide: clip.performerSide, camera: clip.camera, file: `${stem}.mp4`, poster: `${stem}.webp`,
      bytes: clip.bytes, sha256: clip.sha256, width: clip.width, height: clip.height, fps: clip.fps, frames: clip.frames,
      durationSeconds: clip.durationSeconds, loops: clip.loops, choreographyReviewed: clip.choreographyReviewed, draft: false,
    };
  });
  assert.ok(pack.length > 0);
  const acceptance = JSON.parse(readFileSync(new URL('../tools/unreal_clip_acceptance.json', import.meta.url), 'utf8'));
  // Whatever order the pack lists them in, and with the committed acceptance list:
  // nothing published is dropped, held or refused, so a technique clip is published only with its acceptance line.
  const result = selectEntries([...pack].reverse(), acceptance);
  assert.deepEqual(files(result), pack.map((clip) => clip.file));
  assert.deepEqual([result.draftsLeftOut, result.notAccepted], [[], []]);
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

test('the technique ids are the whole curriculum in its order, each once; the four Unity animates keep the ids Unity gave them', () => {
  assert.deepEqual([...TECHNIQUE_IDS], allMoves.map((move) => unrealClipMoveId(move.id)));
  assert.equal(new Set(TECHNIQUE_IDS).size, TECHNIQUE_IDS.length);
  assert.throws(() => { TECHNIQUE_IDS.push('armbar'); }, TypeError);
  // Every one is a name a clip's move can have.
  for (const id of TECHNIQUE_IDS) assert.match(id, /^[a-z][a-z0-9_]*$/);
  // The four Unity animates are in the list under Unity's ids, not under their curriculum ids.
  const unity = allMoves.map((move) => resolveUnityMove(move.id)).filter(Boolean);
  assert.deepEqual([...unity].sort(), ['double_leg', 'rear_naked_choke', 'trap_roll_escape', 'triangle_choke']);
  for (const id of unity) assert.ok(TECHNIQUE_IDS.includes(id), id);
  assert.equal(existsSync(new URL('../tools/import_unreal_clips.py', import.meta.url)), false);
});
