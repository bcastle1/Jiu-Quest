import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { allMoves } from '../src/data/curriculum.js';
import { createArenaState, getPositionForSide, otherArenaSide } from '../src/arena/outcome.js';
import { resolveArenaUnityPlayback, resolveUnityMove } from '../src/unity/bridge.js';
import { UNREAL_STANCES } from '../src/unreal/stances.js';
import { resolveArenaClipPlayback, unrealClipMoveId, unrealClipStart } from '../src/unreal/techniqueIds.js';

// The four techniques Unity animates, and the id Unity gave each one
// (curriculumMoves in src/unity/bridge.js). Their clips go by the same ids.
const UNITY_FOUR = Object.freeze({
  'trap-roll-escape': 'trap_roll_escape',
  'double-leg-takedown': 'double_leg',
  'triangle-choke': 'triangle_choke',
  'rear-naked-choke': 'rear_naked_choke',
});

// The clip id of every curriculum technique (49 today), written in curriculum
// order. A clip id is the folder a technique's clips are rendered into and
// published under, so a new or renamed technique changes this list on purpose,
// in the same commit.
const CLIP_IDS = Object.freeze([
  // White-belt starters.
  'protect_position', 'basic_punch', 'basic_kick', 'basic_tackle',
  // Blue belt.
  'trap_roll_escape', 'trap_roll_punch_block', 'americana_armlock', 'take_the_back_mount', 'rear_naked_choke', 'leg_hook_takedown',
  'establish_clinch', 'straight_armlock_mount', 'triangle_choke', 'elevator_sweep', 'elbow_escape_mount', 'elbow_escape_fish_hook',
  'elbow_escape_heel_drag', 'side_mount_to_full_mount', 'body_fold_takedown', 'double_leg', 'headlock_scissors_choke', 'straight_armlock_guard',
  'double_ankle_sweep', 'pull_guard', 'headlock_escape_2', 'guillotine_choke', 'kimura_guard', 'standing_headlock_defense',
  'blocking_standing_punch_from_ground', 'hook_sweep', 'rear_takedown', 'haymaker_defense', 'take_back_guard_head_arm', 'take_back_guard_final_getup',
  'guillotine_defense', 'elbow_escape_side', 'standing_armlock', 'twisting_arm_control', 'take_back_modified_mount', 'armbar_twisting_control',
  // Purple, brown and black belts.
  'purple_omoplata', 'purple_darce', 'purple_x_guard_sweep', 'brown_pressure_pass', 'brown_knee_cut', 'brown_crucifix',
  'black_berimbolo', 'black_leg_drag', 'black_bow_arrow',
]);

// A settled exchange as the Arena records it (src/App.jsx): the rival won it
// with the double leg, from the double leg's only start. `playerWins` can be
// about the whole match, so it does not say who performs.
const exchange = Object.freeze({ move: Object.freeze({ id: 'double-leg-takedown', starts: Object.freeze(['standing']) }), actorIsPlayer: false, animationSucceeded: true, playerWins: true, startedFrom: 'standing' });

// The curriculum techniques that start in more than one position, each with
// its clip start: the first of its starts, the one its clips are rendered from.
const MULTI_START = Object.freeze({
  'protect-position': 'standing',
  'basic-punch': 'standing',
  'basic-tackle': 'standing',
  'guillotine-choke': 'standing',
  'standing-headlock-defense': 'standing-headlock',
  'guillotine-defense': 'clinch',
  'purple-darce': 'side-top',
  'brown-crucifix': 'back-control',
});

// What the Arena records when `winnerSide` wins with `move` from `state`: who
// performs, and where the exchange started, seen from the winner's side. The
// test 'the Arena records where each exchange started ...' pins the lines of
// src/App.jsx this repeats.
const settle = (state, move, winnerSide) => ({ move, actorIsPlayer: winnerSide === 'fighter', animationSucceeded: true, startedFrom: getPositionForSide(state, winnerSide) });
const SIDES = Object.freeze(['fighter', 'opponent']);

test('the id rule is pure: its only import is the Unity move table', () => {
  const source = readFileSync(fileURLToPath(new URL('../src/unreal/techniqueIds.js', import.meta.url)), 'utf8');
  const imports = [...source.matchAll(/^import (?:[^'"]* from )?['"]([^'"]+)['"];?$/gm)].map((match) => match[1]);
  assert.deepEqual(imports, ['../unity/bridge.js']);
  assert.match(source, /^import \{ resolveUnityMove \} from '\.\.\/unity\/bridge\.js';$/m);
  // Nothing is loaded later either, so the curriculum (src/data) is never read.
  assert.doesNotMatch(source, /\bimport\s*\(|\brequire\s*\(/);
});

test('the four techniques Unity animates keep the ids Unity gave them', () => {
  for (const [curriculumId, clipId] of Object.entries(UNITY_FOUR)) {
    assert.ok(allMoves.some((move) => move.id === curriculumId), `${curriculumId} is in the curriculum`);
    assert.equal(unrealClipMoveId(curriculumId), clipId);
    assert.equal(clipId, resolveUnityMove(curriculumId), `${curriculumId} keeps Unity's id`);
  }
  // Unity's id comes before the hyphen rule: the double leg is not renamed.
  assert.notEqual(unrealClipMoveId('double-leg-takedown'), 'double_leg_takedown');
  // No other curriculum technique has a Unity id.
  assert.deepEqual(allMoves.filter((move) => resolveUnityMove(move.id) !== null).map((move) => move.id).sort(), Object.keys(UNITY_FOUR).sort());
});

test('every other technique is its curriculum id with each hyphen written as an underscore', () => {
  assert.equal(unrealClipMoveId('americana-armlock'), 'americana_armlock');
  assert.equal(unrealClipMoveId('headlock-escape-2'), 'headlock_escape_2');
  assert.equal(unrealClipMoveId('basic-tackle'), 'basic_tackle');
  // Every hyphen, not only the first.
  assert.equal(unrealClipMoveId('blocking-standing-punch-from-ground'), 'blocking_standing_punch_from_ground');
  // A name with no hyphen is already its clip id.
  assert.equal(unrealClipMoveId('kimura'), 'kimura');
  const others = allMoves.filter((move) => !Object.hasOwn(UNITY_FOUR, move.id));
  assert.equal(others.length, allMoves.length - 4);
  for (const move of others) {
    assert.equal(unrealClipMoveId(move.id), move.id.split('-').join('_'), move.id);
  }
});

test('anything but a non-empty string has no clip id', () => {
  const notIds = [undefined, null, '', 0, 42, NaN, true, false, {}, [], ['double-leg-takedown'], { id: 'double-leg-takedown' }, () => 'double-leg-takedown', Symbol('double-leg-takedown')];
  for (const value of notIds) assert.equal(unrealClipMoveId(value), null, String(value));
  assert.equal(unrealClipMoveId(), null);
  // A name every object inherits is a name like any other: the Unity table is
  // asked only for its own entries.
  for (const name of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) assert.equal(unrealClipMoveId(name), name);
});

test('over the whole curriculum every technique has its own clip id: lower-case letters, digits and underscores, and never a stance clip name', () => {
  const ids = allMoves.map((move) => unrealClipMoveId(move.id));
  assert.equal(new Set(ids).size, ids.length, 'two techniques must never share one set of clips');
  const stanceClips = new Set(UNREAL_STANCES.flatMap((stance) => [stance.loopMoveId, stance.entryMoveId]).filter(Boolean));
  for (const [index, id] of ids.entries()) {
    assert.equal(typeof id, 'string', `${JSON.stringify(allMoves[index].id)} has a clip id`);
    // What a clip folder can be called, starting with a letter.
    assert.match(id, /^[a-z][a-z0-9_]*$/, `${id} is not a name a clip folder can take`);
    // Never the name of a stance clip (src/unreal/stances.js): a stance is not a technique.
    assert.notEqual(id, 'standing_stance');
    assert.ok(!id.startsWith('stance_') && !id.startsWith('enter_'), `${id} would read as a stance clip`);
    assert.ok(!stanceClips.has(id), `${id} is the name of a stance clip`);
  }
  // The same ids as the list above, whatever order the curriculum is in.
  assert.deepEqual([...ids].sort(), [...CLIP_IDS].sort());
});

test('a settled Arena exchange asks for the clip of the technique that won it, performed by whoever won it', () => {
  // The rival won the exchange, so the rival performs, whoever is winning the match.
  assert.deepEqual(resolveArenaClipPlayback(exchange), { clipMoveId: 'double_leg', performerSide: 'opponent' });
  assert.deepEqual(resolveArenaClipPlayback({ ...exchange, actorIsPlayer: true }), { clipMoveId: 'double_leg', performerSide: 'fighter' });
  assert.deepEqual(resolveArenaClipPlayback({ ...exchange, playerWins: false }), { clipMoveId: 'double_leg', performerSide: 'opponent' });
  // A technique Unity cannot animate has a clip id all the same.
  const kimura = { ...exchange, move: { id: 'kimura-guard', starts: ['guard-bottom'] }, startedFrom: 'guard-bottom' };
  assert.equal(resolveArenaUnityPlayback(kimura), null);
  assert.deepEqual(resolveArenaClipPlayback(kimura), { clipMoveId: 'kimura_guard', performerSide: 'opponent' });
  assert.deepEqual(resolveArenaClipPlayback({ ...kimura, actorIsPlayer: true }), { clipMoveId: 'kimura_guard', performerSide: 'fighter' });
});

test('an exchange that did not plainly succeed, has no clear performer or names no technique asks for no clip', () => {
  for (const animationSucceeded of [false, undefined, null, 'true', 1]) {
    assert.equal(resolveArenaClipPlayback({ ...exchange, animationSucceeded }), null, `animationSucceeded ${String(animationSucceeded)}`);
  }
  for (const actorIsPlayer of [undefined, null, 'fighter', 1, 0]) {
    assert.equal(resolveArenaClipPlayback({ ...exchange, actorIsPlayer }), null, `actorIsPlayer ${String(actorIsPlayer)}`);
  }
  for (const move of [undefined, null, {}, { id: '' }, { id: null }, { id: 42 }, { name: 'Double Leg Takedown' }, 'double-leg-takedown']) {
    assert.equal(resolveArenaClipPlayback({ ...exchange, move }), null, `move ${JSON.stringify(move)}`);
  }
  for (const nothing of [undefined, null, {}, 'exchange', 0, true]) assert.equal(resolveArenaClipPlayback(nothing), null, String(nothing));
  assert.equal(resolveArenaClipPlayback(), null);
});

test('for every curriculum technique the Arena asks for the id Training uses, and for Unity\'s own id where Unity has the move', () => {
  for (const move of allMoves) {
    for (const actorIsPlayer of [true, false]) {
      const result = { move, actorIsPlayer, animationSucceeded: true, startedFrom: move.starts[0] };
      const performerSide = actorIsPlayer ? 'fighter' : 'opponent';
      const clip = resolveArenaClipPlayback(result);
      assert.deepEqual(clip, { clipMoveId: unrealClipMoveId(move.id), performerSide }, move.id);
      // Where Unity plays the exchange, the clip is the same move by the same performer.
      const unity = resolveArenaUnityPlayback(result);
      assert.equal(unity !== null, Object.hasOwn(UNITY_FOUR, move.id), move.id);
      if (unity) assert.deepEqual(clip, { clipMoveId: unity.moveId, performerSide: unity.performerSide }, move.id);
    }
  }
});

test('a technique\'s clip start is the first position it starts in', () => {
  for (const move of allMoves) assert.equal(unrealClipStart(move), move.starts[0], move.id);
  assert.equal(unrealClipStart({ starts: ['clinch', 'standing'] }), 'clinch');
  // A move that names no start has none.
  for (const move of [undefined, null, 'standing', {}, { starts: [] }, { starts: 'standing' }, { starts: [''] }, { starts: [null, 'standing'] }, { starts: [42] }, { starts: { 0: 'standing', length: 1 } }]) {
    assert.equal(unrealClipStart(move), null, JSON.stringify(move));
  }
  assert.equal(unrealClipStart(), null);
});

test('a technique that starts in more than one position asks for its clip only after a win from its clip start, by either performer', () => {
  const multi = allMoves.filter((move) => move.starts.length > 1);
  assert.deepEqual(Object.fromEntries(multi.map((move) => [move.id, unrealClipStart(move)])), { ...MULTI_START });
  // Protect Your Position starts in every position the game names.
  const positions = allMoves.find((move) => move.id === 'protect-position').starts;
  assert.equal(positions.length, 26);
  for (const move of multi) {
    const clipMoveId = unrealClipMoveId(move.id);
    for (const performerSide of SIDES) {
      const won = (startedFrom) => resolveArenaClipPlayback({ move, actorIsPlayer: performerSide === 'fighter', animationSucceeded: true, startedFrom });
      // Each of its own starts: the clip from the first, nothing from the others.
      for (const [index, start] of move.starts.entries()) {
        assert.deepEqual(won(start), index === 0 ? { clipMoveId, performerSide } : null, `${move.id} won by the ${performerSide} from ${start}`);
      }
      // Every position there is: only the clip start.
      for (const position of positions) {
        assert.deepEqual(won(position), position === move.starts[0] ? { clipMoveId, performerSide } : null, `${move.id} won by the ${performerSide} from ${position}`);
      }
    }
  }
});

test('a technique with one start asks for its clip after a win from that start, as before', () => {
  const single = allMoves.filter((move) => move.starts.length === 1);
  assert.equal(single.length, allMoves.length - Object.keys(MULTI_START).length);
  for (const move of single) {
    for (const performerSide of SIDES) {
      // What the Arena asked for before clip starts existed: the technique, by whoever won it.
      const before = { clipMoveId: unrealClipMoveId(move.id), performerSide };
      assert.deepEqual(resolveArenaClipPlayback({ move, actorIsPlayer: performerSide === 'fighter', animationSucceeded: true, startedFrom: move.starts[0] }), before, move.id);
    }
  }
  // The game offers a technique only where it starts (pinned in the next test),
  // so every win with one of these is a win from its one start.
});

test('an exchange that does not say where it started, or started elsewhere, asks for no clip; Unity plays it as before', () => {
  const { startedFrom, ...unsaid } = exchange;
  assert.equal(startedFrom, 'standing');
  assert.equal(resolveArenaClipPlayback(unsaid), null, 'a result recorded before clip starts existed');
  for (const value of [undefined, null, '', 'Standing', ' standing', 'standing ', 'stand', 'kneeling', 'clinch', ['standing'], { position: 'standing' }, 0, true]) {
    assert.equal(resolveArenaClipPlayback({ ...exchange, startedFrom: value }), null, JSON.stringify(value));
  }
  // A move that lists no start has no clip start, so no clip either.
  for (const move of [{ id: 'double-leg-takedown' }, { id: 'double-leg-takedown', starts: [] }, { id: 'double-leg-takedown', starts: 'standing' }, { id: 'double-leg-takedown', starts: [''] }]) {
    assert.equal(resolveArenaClipPlayback({ ...exchange, move, startedFrom: 'standing' }), null, JSON.stringify(move));
  }
  // Unity's playback reads none of this.
  for (const value of [undefined, null, 'standing', 'kneeling', 'mount-top']) {
    assert.deepEqual(resolveArenaUnityPlayback({ ...exchange, startedFrom: value }), { moveId: 'double_leg', performerSide: 'opponent' }, JSON.stringify(value));
  }
  assert.deepEqual(resolveArenaUnityPlayback(unsaid), { moveId: 'double_leg', performerSide: 'opponent' });
  for (const move of allMoves) {
    for (const actorIsPlayer of [true, false]) {
      const result = { move, actorIsPlayer, animationSucceeded: true };
      for (const position of [undefined, ...allMoves.find((item) => item.id === 'protect-position').starts]) {
        assert.deepEqual(resolveArenaUnityPlayback({ ...result, startedFrom: position }), resolveArenaUnityPlayback(result), move.id);
      }
    }
  }
});

test('the Arena records where each exchange started, seen from the winner, in the ids it offers techniques by', () => {
  const app = readFileSync(fileURLToPath(new URL('../src/App.jsx', import.meta.url)), 'utf8');
  const result = /const result = \{(?<body>[\s\S]*?)\n {6}\};/.exec(app)?.groups.body;
  assert.ok(result, 'src/App.jsx builds the exchange result');
  // The winner's side, worked out from the state before the exchange settles.
  assert.match(result, /\n {8}startedFrom: getPositionForSide\(current, exchangePlayerWins \? "fighter" : "opponent"\),\r?\n/);
  assert.match(result, /\n {8}actorIsPlayer: exchangePlayerWins,\r?\n/);
  assert.match(result, /\n {8}move: winnerMove,\r?\n/);
  assert.match(app, /const winnerMove = exchangePlayerWins \? move : npcMove;/);
  assert.match(app, /const nextArenaState = resolveArenaOutcome\(current, winnerMove, exchangePlayerWins \? "fighter" : "opponent", \{ opposingMove: losingMove \}\);/);
  // The player is offered a technique where it starts, seen from the player's side ...
  assert.match(app, /if \(!combat\.active \|\| combat\.phase === "ordering" \|\| !move\.starts\.includes\(getPositionForSide\(combat\)\)\) \{/);
  assert.match(app, /if \(!move \|\| !move\.starts\.includes\(getPositionForSide\(current\)\)\) return \{ \.\.\.current, phase: "selecting", selectedMoveId: null \};/);
  // ... and the rival chooses one where it starts, seen from the rival's side,
  // or falls back to Protect Your Position, which starts everywhere.
  assert.match(app, /const npcPosition = getPositionForSide\(combat, "opponent"\);/);
  assert.match(app, /const npcMoveForTurn = chooseNpcMove\(combat\.npc, npcPosition, playerMoveForTurn\);/);
  assert.match(app, /const fitting = known\.filter\(\(move\) => move\.starts\.includes\(position\) && isArenaCounterApplicable\(move, \{ position \}, opposingMove\)\);/);
  assert.match(app, /return shuffle\(fitting\)\[0\] \?\? starterMoves\.find\(\(move\) => move\.id === "protect-position"\);/);

  // Every start of every technique, won by either athlete: the winner stood
  // in that start, the result says so, and only the clip start asks for the clip.
  for (const move of allMoves) {
    const clipMoveId = unrealClipMoveId(move.id);
    for (const start of move.starts) {
      for (const winner of SIDES) {
        const state = createArenaState(start, winner);
        assert.equal(getPositionForSide(state, winner), start, `${move.id}: the ${winner} stands in ${start}`);
        assert.deepEqual(resolveArenaClipPlayback(settle(state, move, winner)), start === move.starts[0] ? { clipMoveId, performerSide: winner } : null, `${move.id} won by the ${winner} from ${start}`);
      }
    }
  }
  // Where one athlete is on top or in control, the loser sees another
  // position, so a start taken from the loser's side would miss the clip.
  const sided = allMoves.filter((move) => !['standing', 'kneeling', 'clinch', 'scramble'].includes(move.starts[0]));
  assert.ok(sided.length >= 30, `${sided.length} techniques start on top, underneath or in control`);
  for (const move of sided) {
    for (const winner of SIDES) {
      const state = createArenaState(move.starts[0], winner);
      const fromLoser = { ...settle(state, move, winner), startedFrom: getPositionForSide(state, otherArenaSide(winner)) };
      assert.notEqual(fromLoser.startedFrom, move.starts[0], move.id);
      assert.equal(resolveArenaClipPlayback(fromLoser), null, move.id);
      assert.notEqual(resolveArenaClipPlayback(settle(state, move, winner)), null, move.id);
    }
  }
  // Under mount the player sees 'mount-bottom' and the rival on top 'mount-top'.
  const mounted = createArenaState('mount-bottom');
  const americana = allMoves.find((move) => move.id === 'americana-armlock');
  assert.equal(unrealClipStart(americana), 'mount-top');
  assert.deepEqual(settle(mounted, americana, 'opponent').startedFrom, 'mount-top');
  assert.deepEqual(resolveArenaClipPlayback(settle(mounted, americana, 'opponent')), { clipMoveId: 'americana_armlock', performerSide: 'opponent' });
});
