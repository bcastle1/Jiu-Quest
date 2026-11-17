import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { MATCH_MOMENT_CLIP, readAcceptance, renderDataFile, selectEntries, TECHNIQUE_IDS } from '../tools/import_unreal_clips.mjs';
import { allMoves } from '../src/data/curriculum.js';
import { UNITY_PREVIEWS, resolveUnityMove } from '../src/unity/bridge.js';
import { MATCH_MOMENT_IDS } from '../src/unreal/matchMoments.js';
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
    // The message names the three kinds of clip the importer takes, and the three match moments by id.
    assert.match(error.message, /^armbar\/fighter-side\.mp4: armbar is neither a technique \(.+\), a stance clip nor a match moment \(match_greeting, match_win, match_loss\)$/);
    for (const id of TECHNIQUE_IDS) assert.ok(!error.message.includes(id), `the error lists ${id}`);
    return true;
  });
});

// A match moment clip, named by its id (src/unreal/matchMoments.js): it plays
// once and shows the player's athlete.
const moment = (moveId, camera = 'side', extra = {}) => entry(moveId, 'fighter', camera,
  { frames: 96, durationSeconds: 3.2, loops: false, sha256: hash(camera === 'side' ? '1' : '2'), ...extra });

test('a match moment clip is held until it is accepted, exactly like a technique clip', () => {
  assert.deepEqual([...MATCH_MOMENT_IDS], ['match_greeting', 'match_win', 'match_loss']);
  for (const id of MATCH_MOMENT_IDS) {
    assert.ok(!TECHNIQUE_IDS.includes(id), `${id} is not a technique's clip id`);
    const [side, front] = [moment(id), moment(id, 'front')];
    const names = [`${id}/fighter-side.mp4`, `${id}/fighter-front.mp4`];
    // No acceptance line: left out and listed, and the import goes on.
    const waiting = selectEntries([side, front, entry('standing_stance', 'fighter', 'side')], []);
    assert.deepEqual([files(waiting), waiting.notAccepted, waiting.draftsLeftOut], [['standing_stance/fighter-side.mp4'], names, []], id);
    // The acceptance line is the technique's: file, sha256 and acceptedOn, for that exact file.
    assert.deepEqual(files(selectEntries([front, side], [accept(side), accept(front)])), names, id);
    const half = selectEntries([side, front], [accept(side)]);
    assert.deepEqual([files(half), half.notAccepted], [[names[0]], [names[1]]], id);
    assert.deepEqual(selectEntries([{ ...side, sha256: hash('e') }], [accept(side)]).notAccepted, [names[0]], `${id}: a new take needs a new line`);
    // The same hash under a technique's name, or a technique's line, accepts nothing.
    assert.deepEqual(selectEntries([side], [accept(technique('fighter', 'side', { sha256: side.sha256 }))]).notAccepted, [names[0]], id);
    // A draft waits for the owner like any other draft, whatever else is wrong with it.
    assert.deepEqual(selectEntries([moment(id, 'side', { draft: true, loops: true, frames: 10, durationSeconds: 1 / 3 })], [accept(side)]).draftsLeftOut, [names[0]], id);
  }
});

test('a match moment clip plays once, shows the fighter, is 1280 by 720 at 30 frames a second and has 45 to 240 frames', () => {
  assert.deepEqual({ ...MATCH_MOMENT_CLIP }, { width: 1280, height: 720, fps: 30, minFrames: 45, maxFrames: 240 });
  assert.ok(Object.isFrozen(MATCH_MOMENT_CLIP));
  for (const id of MATCH_MOMENT_IDS) {
    const good = moment(id);
    const refused = (extra, message) => {
      const clip = moment(id, 'side', extra);
      // Format is checked before acceptance, so a bad delivery fails loudly, accepted or not.
      for (const acceptance of [[], [accept(clip)]]) assert.throws(() => selectEntries([clip], acceptance), message, `${id} ${JSON.stringify(extra)}`);
    };
    refused({ loops: true }, /a match moment clip plays once/);
    refused({ draft: undefined }, /"draft": false/);
    refused({ performerSide: 'opponent', file: `${id}/opponent-side.mp4`, poster: `${id}/opponent-side.webp` }, /a match moment clip shows the player's athlete \("performerSide": "fighter"\)/);
    refused({ width: 1920, height: 1080 }, /a match moment clip is 1280 by 720 at 30 frames a second/);
    refused({ height: 1280, width: 720 }, /1280 by 720/);
    refused({ fps: 60, durationSeconds: 1.6 }, /at 30 frames a second/);
    refused({ fps: 24, durationSeconds: 4 }, /at 30 frames a second/);
    refused({ frames: 44, durationSeconds: 44 / 30 }, /44 frames, but a match moment clip has between 45 and 240/);
    refused({ frames: 241, durationSeconds: 241 / 30 }, /241 frames, but a match moment clip has between 45 and 240/);
    refused({ durationSeconds: 3 }, /duration/);
    refused({ camera: 'top', file: `${id}/fighter-top.mp4`, poster: `${id}/fighter-top.webp` }, /unexpected or repeated/);
    refused({ poster: `${id}/fighter-side.png` }, /file names/);
    // The shortest and the longest a moment may be, and both cameras.
    for (const frames of [45, 240]) {
      const clip = moment(id, 'side', { frames, durationSeconds: frames / 30 });
      assert.deepEqual(files(selectEntries([clip], [accept(clip)])), [`${id}/fighter-side.mp4`], `${id} at ${frames} frames`);
    }
    // A front view is taken in on its own line like any view. The site does not show a moment
    // until its side view is published too (findMatchMoment, tests/unrealMatchMoments.test.js).
    const front = moment(id, 'front');
    assert.deepEqual(files(selectEntries([front], [accept(front)])), [`${id}/fighter-front.mp4`], id);
    // Its two views are one take seen from two sides: the same length.
    const longer = moment(id, 'front', { frames: 120, durationSeconds: 4 });
    assert.throws(() => selectEntries([good, longer], [accept(good), accept(longer)]), /same length/, id);
    // A repeat of one view is refused like any repeat.
    assert.throws(() => selectEntries([good, moment(id)], [accept(good)]), /unexpected or repeated/, id);
  }
  // A name that only looks like a moment is still refused with the clear message.
  for (const name of ['match', 'match_greet', 'match_draw', 'match_greeting_2', 'greeting', 'match_victory']) {
    assert.throws(() => selectEntries([moment(name)], []), /neither a technique \(.+\), a stance clip nor a match moment/, name);
  }
  // In the published order a moment sorts by its name like every other move, side before front.
  const pack = [entry('standing_stance', 'fighter', 'side'), moment('match_win', 'front'), moment('match_win'), moment('match_greeting'), technique('fighter', 'side')];
  assert.deepEqual(files(selectEntries(pack, pack.filter((clip) => !clip.loops).map(accept))), [
    'double_leg/fighter-side.mp4', 'match_greeting/fighter-side.mp4', 'match_win/fighter-side.mp4', 'match_win/fighter-front.mp4', 'standing_stance/fighter-side.mp4',
  ]);
});

test('an imported match moment clip takes its poster from frame 0, like every clip that plays once', () => {
  const importer = readFileSync(new URL('../tools/import_unreal_clips.mjs', import.meta.url), 'utf8');
  // One rule for every clip: a loop keeps the pack's poster, anything else gets frame 0 of its video.
  assert.equal(importer.match(/const posterFrame = entry\.loops \? null : 0;/g).length, 1);
  // The moment's rules are checked on the entry, before its acceptance line is looked for.
  assert.match(importer, /if \(moment\) checkMatchMoment\(entry\);[\s\S]*?if \(!accepted\.has\(`\$\{entry\.file\} \$\{entry\.sha256\}`\)\) \{ notAccepted\.push\(entry\.file\); continue; \}/);
  // The moment ids come from the module that has no imports, never from one that reads the
  // clip list this tool writes: the importer has to start when that file is missing or broken
  // (tests/unrealMatchMoments.test.js follows every file it loads, and runs it without the list).
  assert.match(importer, /^import \{ MATCH_MOMENT_IDS, MATCH_MOMENT_PERFORMER, isMatchMoment \} from '\.\.\/src\/unreal\/matchMomentIds\.js';\r?$/m);
  assert.doesNotMatch(importer, /from '[^']*(?:matchMoments|techniqueClips)(?:\.data)?\.js'/);
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

test('the committed acceptance list is valid and names only technique and match moment files', () => {
  const list = readAcceptance(JSON.parse(readFileSync(new URL('../tools/unreal_clip_acceptance.json', import.meta.url), 'utf8')));
  // The two kinds of clip that wait for an acceptance line. A stance clip needs none.
  for (const line of list) assert.ok([...TECHNIQUE_IDS, ...MATCH_MOMENT_IDS].includes(line.file.split('/')[0]), line.file);
});

test('every non-draft publication passes the acceptance importer again, in published order', () => {
  // The pack entry each published clip came from, as far as the clip list records it.
  const pack = published.filter((clip) => clip.draft !== true).map((clip) => {
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
  // nothing the importer published is dropped, held or refused. So apart from the owner-published
  // draft, which is left out above (tests/unrealOwnerDraft.test.js), a technique clip is published
  // only with its acceptance line.
  const result = selectEntries([...pack].reverse(), acceptance);
  assert.deepEqual(files(result), pack.map((clip) => clip.file));
  assert.deepEqual([result.draftsLeftOut, result.notAccepted], [[], []]);
});

test('the generated data file names the Node importer and the draft publisher, and records the poster frame', () => {
  const text = renderDataFile([{ moveId: 'double_leg', loops: false, posterFrame: 0 }, { moveId: 'standing_stance', loops: true, posterFrame: null }]);
  assert.equal(text, [
    "// Generated by tools/import_unreal_clips.mjs from the Unreal render pack's",
    '// clips/technique-clips.json. A row marked "draft": true is added afterwards by',
    '// tools/publish_unreal_clip_draft.mjs, because the importer leaves every draft out.',
    '// Do not edit by hand: rerun the importer, then that tool with --restore.',
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
