import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createArenaState } from '../src/arena/outcome.js';
import { allMoves } from '../src/data/curriculum.js';
import { UNITY_PREVIEWS } from '../src/unity/bridge.js';
import { PASSING_MOMENT_PATIENCE } from '../src/unreal/clipPlayback.js';
import * as momentIds from '../src/unreal/matchMomentIds.js';
import * as moments from '../src/unreal/matchMoments.js';
import {
  MATCH_GREETING, MATCH_LOSS, MATCH_MOMENT_CAMERA, MATCH_MOMENT_IDS, MATCH_MOMENT_PERFORMER, MATCH_MOMENT_TITLES, MATCH_WIN,
  findMatchMoment, isMatchMoment, matchResultMoment, prefersReducedMotion,
} from '../src/unreal/matchMoments.js';
import { UNREAL_STANCES } from '../src/unreal/stances.js';
import { UNREAL_CLIPS, UNREAL_CLIP_CAMERAS, findUnrealClip } from '../src/unreal/techniqueClips.js';
import { unrealClipMoveId } from '../src/unreal/techniqueIds.js';
import { STAND_IN_REACT, asModule, clipView, createHookRunner, findElement, loadComponent, repoModule, standInComponent, useGlobals, viewsOf } from './helpers/stageHarness.js';

const source = (path) => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8');
const imports = (path) => [...source(path).matchAll(/^import (?:[^'"]* from )?['"]([^'"]+)['"];?\r?$/gm)].map((match) => match[1]);

// A stand-in for the published clip list: the views named `move/performer-camera`
// exist, nothing else does. It records what it was asked for.
const published = (...names) => {
  const asked = [];
  const find = (moveId, performerSide = 'fighter', camera = 'side') => {
    asked.push(`${moveId}/${performerSide}-${camera}`);
    return names.includes(`${moveId}/${performerSide}-${camera}`) ? clipView(moveId, performerSide, camera) : null;
  };
  return Object.assign(find, { asked });
};

test('the three match moments have fixed ids and titles, and nothing else is a moment', () => {
  assert.deepEqual([...MATCH_MOMENT_IDS], ['match_greeting', 'match_win', 'match_loss']);
  assert.deepEqual([MATCH_GREETING, MATCH_WIN, MATCH_LOSS], [...MATCH_MOMENT_IDS]);
  assert.ok(Object.isFrozen(MATCH_MOMENT_IDS));
  assert.throws(() => { MATCH_MOMENT_IDS.push('match_draw'); }, TypeError);
  assert.deepEqual({ ...MATCH_MOMENT_TITLES }, { match_greeting: 'Match greeting', match_win: 'Match won', match_loss: 'Match lost' });
  assert.ok(Object.isFrozen(MATCH_MOMENT_TITLES));
  assert.deepEqual([MATCH_MOMENT_PERFORMER, MATCH_MOMENT_CAMERA], ['fighter', 'side']);
  assert.equal(MATCH_MOMENT_CAMERA, UNREAL_CLIP_CAMERAS[0], 'a moment opens on the view every clip opens on');
  for (const id of MATCH_MOMENT_IDS) {
    assert.equal(isMatchMoment(id), true, id);
    // A name the importer can take a clip folder under.
    assert.match(id, /^[a-z][a-z0-9_]*$/);
  }
  for (const value of ['match', 'match_greet', 'match_draw', 'Match_win', 'match-win', ' match_win', 'match_win ', 'greeting', 'standing_stance', 'double_leg', '', null, undefined, 0, ['match_win'], { id: 'match_win' }]) {
    assert.equal(isMatchMoment(value), false, JSON.stringify(value));
  }
  assert.equal(isMatchMoment(), false);
});

test('a moment is never a technique\'s clip id or a stance clip, so the three kinds of clip never share a name', () => {
  const techniques = new Set([...allMoves.map((move) => unrealClipMoveId(move.id)), ...UNITY_PREVIEWS.map((move) => move.id)]);
  const stanceClips = new Set(UNREAL_STANCES.flatMap((stance) => [stance.loopMoveId, stance.entryMoveId]).filter(Boolean));
  for (const id of MATCH_MOMENT_IDS) {
    assert.ok(!techniques.has(id), `${id} is a technique's clip id`);
    assert.ok(!stanceClips.has(id) && id !== 'standing_stance' && !/^(stance|enter)_/.test(id), `${id} reads as a stance clip`);
  }
  // No technique's clip id could be mistaken for a moment either.
  for (const id of techniques) assert.ok(!id.startsWith('match_'), `${id} reads as a match moment`);
});

test('the finder returns the view asked for when it is published, otherwise the side view, and nothing without the side view', () => {
  for (const id of MATCH_MOMENT_IDS) {
    const both = published(`${id}/fighter-side`, `${id}/fighter-front`);
    assert.deepEqual(findMatchMoment(id, 'side', both), clipView(id, 'fighter', 'side'), id);
    assert.deepEqual(findMatchMoment(id, 'front', both), clipView(id, 'fighter', 'front'), id);
    // No camera named: the side view.
    assert.equal(findMatchMoment(id, undefined, both).camera, 'side', id);
    // A view that does not exist falls back to the side view.
    const sideOnly = published(`${id}/fighter-side`);
    assert.equal(findMatchMoment(id, 'front', sideOnly).camera, 'side', id);
    assert.equal(findMatchMoment(id, 'overhead', sideOnly).camera, 'side', id);
    assert.equal(findMatchMoment(id, null, sideOnly).camera, 'side', id);
    // A moment needs its side view. The front view alone is not shown to anyone,
    // also not to someone who asks for the front: the checks of a newly published
    // moment run on the side view, so a moment never goes live without them.
    const frontOnly = published(`${id}/fighter-front`);
    for (const camera of ['front', 'side', undefined, null, 'overhead']) assert.equal(findMatchMoment(id, camera, frontOnly), null, `${id}, ${camera}`);
    assert.ok(frontOnly.asked.includes(`${id}/fighter-side`), 'it looked for the side view');
    // Nothing published.
    const nothing = published();
    for (const camera of [undefined, 'side', 'front']) assert.equal(findMatchMoment(id, camera, nothing), null, id);
    // It only ever asks for the player's athlete: a rival's take is never borrowed.
    const rivalOnly = published(`${id}/opponent-side`, `${id}/opponent-front`);
    assert.equal(findMatchMoment(id, 'side', rivalOnly), null, id);
    assert.equal(findMatchMoment(id, 'front', rivalOnly), null, id);
    for (const find of [both, sideOnly, frontOnly, nothing, rivalOnly]) {
      assert.ok(find.asked.length > 0 && find.asked.every((name) => name.startsWith(`${id}/fighter-`)), find.asked.join(' '));
    }
    // Another moment's clips, or a stance's, are not this moment's.
    const others = published(...MATCH_MOMENT_IDS.filter((other) => other !== id).flatMap((other) => [`${other}/fighter-side`, `${other}/fighter-front`]), 'standing_stance/fighter-side');
    assert.equal(findMatchMoment(id, 'side', others), null, id);
  }
});

test('the finder knows the three moments only, and never plays a draft', () => {
  // Whatever the clip list holds, an id that is not a moment finds nothing and asks for nothing.
  const everything = Object.assign((moveId, performerSide, camera) => { everything.asked.push(moveId); return clipView(moveId, performerSide, camera); }, { asked: [] });
  for (const id of ['standing_stance', 'double_leg', 'match_draw', 'match', '', null, undefined, '__proto__', 'constructor']) {
    assert.equal(findMatchMoment(id, 'side', everything), null, String(id));
    assert.equal(findMatchMoment(id, 'front', everything), null, String(id));
  }
  assert.deepEqual(everything.asked, []);
  // The importer leaves drafts out of the clip list. One that reached it anyway is not played.
  const drafts = (...names) => (moveId, performerSide, camera) => ({ ...clipView(moveId, performerSide, camera), draft: names.includes(camera) });
  assert.equal(findMatchMoment('match_win', 'side', drafts('side', 'front')), null);
  assert.equal(findMatchMoment('match_win', 'front', drafts('side', 'front')), null);
  assert.equal(findMatchMoment('match_win', 'front', drafts('front')).camera, 'side', 'a draft front view falls back to the side view');
  assert.equal(findMatchMoment('match_win', 'side', drafts('front')).camera, 'side');
  // A draft side view is no side view: the moment is not shown, from the front either.
  assert.equal(findMatchMoment('match_win', 'front', drafts('side')), null);
  assert.equal(findMatchMoment('match_win', 'side', drafts('side')), null);
  assert.equal(findMatchMoment('match_win', 'side', drafts()).draft, false);
});

test('with the real clip list the finder says what the list says', (t) => {
  for (const id of MATCH_MOMENT_IDS) {
    const side = findUnrealClip(id, 'fighter', 'side');
    const front = findUnrealClip(id, 'fighter', 'front');
    assert.equal(findMatchMoment(id), side, id);
    assert.equal(findMatchMoment(id, 'side'), side, id);
    // The front view is shown only beside a published side view.
    assert.equal(findMatchMoment(id, 'front'), side ? front ?? side : null, id);
    // A moment is the player's athlete's: no rival's take is ever published.
    assert.deepEqual(UNREAL_CLIPS.filter((clip) => clip.moveId === id && clip.performerSide !== 'fighter'), [], id);
    const views = [side && 'side', front && 'front'].filter(Boolean).join(' and ');
    t.diagnostic(`${id}: ${side ? views : front ? 'front only, which is not shown until the side view is published' : 'not published, so the game shows what it showed before'}`);
  }
});

test('the browser suite stops as soon as the clip list holds any match moment file, shown or not', () => {
  // Its release-build checks expect no moment at all. A front view on its own is
  // not shown (see the finder above), so the guard looks at the list, not at the finder.
  const suite = source('tools/test_match_moments.mjs');
  assert.match(suite, /const live = UNREAL_CLIPS\.filter\(\(clip\) => isMatchMoment\(clip\.moveId\)\)\.map\(\(clip\) => `\$\{clip\.moveId\}\/\$\{clip\.performerSide\}-\$\{clip\.camera\}`\);\r?\n\s+assert\.deepEqual\(live, \[\], /);
  assert.doesNotMatch(suite, /MATCH_MOMENT_IDS\.filter\(\(id\) => findMatchMoment\(id\)\)/);
});

test('a finished match ends on the win or the loss, by who won the match', () => {
  assert.equal(matchResultMoment({ finished: true, matchPlayerWins: true }), 'match_win');
  assert.equal(matchResultMoment({ finished: true, matchPlayerWins: false }), 'match_loss');
  // By the match, not by the last exchange: a player who loses the last exchange can still win on points.
  assert.equal(matchResultMoment({ finished: true, matchPlayerWins: true, actorIsPlayer: false, playerWins: true, outcome: 'decision' }), 'match_win');
  assert.equal(matchResultMoment({ finished: true, matchPlayerWins: false, actorIsPlayer: true, outcome: 'decision' }), 'match_loss');
  // A running match, no result, or a result that does not say who won: no moment.
  for (const result of [null, undefined, {}, { finished: false, matchPlayerWins: null }, { finished: false, matchPlayerWins: true }, { finished: true }, { finished: true, matchPlayerWins: null }, { finished: 'true', matchPlayerWins: true }, { finished: true, matchPlayerWins: 'yes' }]) {
    assert.equal(matchResultMoment(result), null, JSON.stringify(result));
  }
  assert.equal(matchResultMoment(), null);
  // The fields are the ones the Arena records (src/App.jsx).
  const app = source('src/App.jsx');
  const result = /const result = \{(?<body>[\s\S]*?)\n {6}\};/.exec(app)?.groups.body;
  assert.ok(result, 'src/App.jsx builds the exchange result');
  for (const field of ['matchPlayerWins,', 'finished,']) assert.ok(result.split(/\r?\n/).some((line) => line.trim() === field), field);
  assert.match(app, /const matchPlayerWins = submission \? exchangePlayerWins : finished \? decisionPlayerWins : null;/);
});

test('reduced motion is read from the browser, and is off where there is no browser', (t) => {
  useGlobals(t, { window: undefined });
  assert.equal(prefersReducedMotion(), false, 'no window');
  globalThis.window = {};
  assert.equal(prefersReducedMotion(), false, 'no matchMedia');
  const asked = [];
  for (const [matches, expected] of [[true, true], [false, false], [undefined, false], ['yes', false]]) {
    globalThis.window = { matchMedia: (query) => { asked.push(query); return { matches }; } };
    assert.equal(prefersReducedMotion(), expected, String(matches));
  }
  assert.deepEqual([...new Set(asked)], ['(prefers-reduced-motion: reduce)']);
  globalThis.window = { matchMedia: () => null };
  assert.equal(prefersReducedMotion(), false);
});

test('the moments module reads its ids and the clip list and nothing else: no renderer, stream or storage code', () => {
  assert.deepEqual(imports('src/unreal/matchMoments.js'), ['./matchMomentIds.js', './techniqueClips.js']);
  assert.doesNotMatch(source('src/unreal/matchMoments.js'), /\bimport\s*\(|\brequire\s*\(|localStorage|sessionStorage|\bexport\b[^;]*\bfrom\b/);
  // The ids are in a module of their own with no imports at all, and the moments module hands
  // on exactly those names, so everything that read them from it still does.
  const ids = source('src/unreal/matchMomentIds.js');
  assert.doesNotMatch(ids, /^\s*import\b|\bimport\s*\(|\brequire\s*\(|\bexport\b[^;]*\bfrom\b/m);
  assert.match(source('src/unreal/matchMoments.js'), /^export \{ MATCH_GREETING, MATCH_LOSS, MATCH_MOMENT_IDS, MATCH_MOMENT_PERFORMER, MATCH_WIN, isMatchMoment \};\r?$/m);
  assert.deepEqual(Object.keys(momentIds).sort(), ['MATCH_GREETING', 'MATCH_LOSS', 'MATCH_MOMENT_IDS', 'MATCH_MOMENT_PERFORMER', 'MATCH_WIN', 'isMatchMoment']);
  for (const [name, value] of Object.entries(momentIds)) assert.equal(moments[name], value, `${name} is the same thing from either module`);
});

test('the clip importer never loads the clip list it writes, so it starts when that file is missing or broken', (t) => {
  // Every file the importer loads: its relative imports, and theirs.
  const loaded = new Set();
  const visit = (path) => {
    if (loaded.has(path)) return;
    loaded.add(path);
    const text = source(path);
    assert.doesNotMatch(text, /\bimport\s*\(|\brequire\s*\(/, `${path} loads nothing at run time`);
    const specifiers = [...imports(path), ...[...text.matchAll(/^export [^'"]* from ['"]([^'"]+)['"];?\r?$/gm)].map((match) => match[1])];
    for (const specifier of specifiers.filter((name) => name.startsWith('.'))) visit(posix.join(posix.dirname(path), specifier));
  };
  visit('tools/import_unreal_clips.mjs');
  assert.ok(loaded.has('src/unreal/matchMomentIds.js'), 'it reads the moment ids from the module that has no imports');
  for (const path of ['src/unreal/techniqueClips.data.js', 'src/unreal/techniqueClips.js', 'src/unreal/matchMoments.js']) {
    assert.ok(!loaded.has(path), `the importer loads ${path}, which is, or reads, the list the importer writes`);
  }
  assert.deepEqual(imports('tools/import_unreal_clips.mjs').filter((name) => name.includes('unreal')), ['../src/unreal/matchMomentIds.js', '../src/unreal/techniqueIds.js']);

  // And in fact: a copy of exactly those files, beside a clip list left with merge
  // conflict markers, loads and sorts a pack that holds a stance clip and a moment.
  const copy = mkdtempSync(join(tmpdir(), 'jiuquest-importer-'));
  t.after(() => rmSync(copy, { recursive: true, force: true }));
  for (const path of loaded) {
    mkdirSync(dirname(join(copy, path)), { recursive: true });
    copyFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), join(copy, path));
  }
  writeFileSync(join(copy, 'package.json'), '{ "type": "module" }\n');
  writeFileSync(join(copy, 'src/unreal/techniqueClips.data.js'), '<<<<<<< HEAD\nexport default Object.freeze([]);\n=======\nexport default Object.freeze([\n>>>>>>> other\n');
  const entry = (moveId, extra) => ({ moveId, performerSide: 'fighter', camera: 'side', file: `${moveId}/fighter-side.mp4`, poster: `${moveId}/fighter-side.webp`, bytes: 1000, sha256: 'a'.repeat(64), width: 1280, height: 720, fps: 30, frames: 54, durationSeconds: 1.8, draft: false, ...extra });
  const script = `import { selectEntries } from './tools/import_unreal_clips.mjs';
const result = selectEntries(${JSON.stringify([entry('standing_stance', { loops: true }), entry('match_greeting', { loops: false })])}, []);
console.log(JSON.stringify([result.selected.map((clip) => clip.file), result.notAccepted]));`;
  const run = (cwd) => spawnSync(process.execPath, ['--input-type=module', '--eval', script], { cwd, encoding: 'utf8' });
  const started = run(copy);
  assert.equal(started.status, 0, started.stderr);
  assert.deepEqual(JSON.parse(started.stdout), [['standing_stance/fighter-side.mp4'], ['match_greeting/fighter-side.mp4']]);
  // The same holds with the clip list gone altogether.
  rmSync(join(copy, 'src/unreal/techniqueClips.data.js'));
  assert.equal(run(copy).status, 0);
});

// ---- The match state (src/App.jsx) ----

test('a match that starts on the feet asks for the greeting with a flag that is never saved', () => {
  const app = source('src/App.jsx');
  // startCombat is where Standing Start, Restart match and the Overview's Open Arena all pass
  // (tests/unrealRivalReach.test.js pins that). The flag follows the start position.
  assert.match(app, /\n {6}\.\.\.createArenaState\(startPosition\),\r?\n {6}startPosition,\r?\n(?: {6}\/\/[^\n]*\r?\n)+ {6}greeting: createArenaState\(startPosition\)\.position === "standing",\r?\n/);
  // A match that is not running asks for none.
  const idle = /function createCombatState\(npc\) \{(?<body>[\s\S]*?)\n\}/.exec(app)?.groups.body;
  assert.ok(idle?.split(/\r?\n/).some((line) => line.trim() === 'greeting: false,'), 'createCombatState starts without the flag');
  // Choosing a technique clears it, and so does every settled exchange (a position change).
  const choose = /const chooseCombatMove = \(move\) => \{(?<body>[\s\S]*?)\n {2}\};/.exec(app)?.groups.body;
  assert.ok(choose?.split(/\r?\n/).some((line) => line.trim() === 'greeting: false,'), 'chooseCombatMove clears the flag');
  const settle = /const resolveCombatTurn = \(\) => \{(?<body>[\s\S]*?)\n {2}\};/.exec(app)?.groups.body;
  assert.ok(settle?.split(/\r?\n/).some((line) => line.trim() === 'greeting: false,'), 'resolveCombatTurn clears the flag');
  // Leaving the Arena clears it, so coming back to a running match is not a start.
  assert.match(app, /useEffect\(\(\) => \{\r?\n {4}if \(view !== "combat"\) setCombat\(\(current\) => \(current\.greeting \? \{ \.\.\.current, greeting: false \} : current\)\);\r?\n {2}\}, \[view\]\);/);
  // Set in one place and cleared in these four. Nothing else in App.jsx reads it:
  // the only other mention, outside comments, is the test in the leaving effect.
  assert.equal(app.match(/\bgreeting: createArenaState\(/g).length, 1);
  assert.equal(app.match(/\bgreeting: false\b/g).length, 4);
  const code = app.split(/\r?\n/).filter((line) => !line.trim().startsWith('//')).join('\n');
  assert.equal(code.match(/\bgreeting\b/g).length, 6, 'the flag, its four clearings and the test in the leaving effect');
  // The picture chosen for a finished match is match state too, so it outlives a visit to another
  // screen. App.jsx only declares it, empty (every new match starts from createCombatState); the
  // Arena keeps it, for one result at a time.
  assert.ok(idle?.split(/\r?\n/).some((line) => line.trim() === 'resultView: null,'), 'createCombatState starts with no picture chosen');
  assert.equal(code.match(/\bresultView\b/g).length, 1, 'declared in createCombatState and touched nowhere else in App.jsx');
  assert.match(app, /\n {4}setCombat\(\{\r?\n {6}\.\.\.createCombatState\(npc\),\r?\n {6}active: true,/, 'startCombat starts from createCombatState');
  assert.doesNotMatch(source('src/storage.js'), /resultView/);
  // The match state is React state only: what is saved is the store, which has no such field.
  assert.match(app, /const \[combat, setCombat\] = useState\(\(\) => createCombatState\(store\.npcs\[0\]\)\);/);
  assert.deepEqual([...new Set([...app.matchAll(/\bsaveState\(([^()]*)\)/g)].map((match) => match[1]))], ['store']);
  assert.doesNotMatch(source('src/storage.js'), /greeting/);
});

// ---- The Arena (src/components/CombatArenaView.jsx) ----

test('the Arena asks the stage for the greeting only at the idle standing start, and clears the flag when it ends or the stance changes', () => {
  const arena = source('src/components/CombatArenaView.jsx');
  assert.match(arena, /import \{ MATCH_GREETING, findMatchMoment, matchResultMoment, prefersReducedMotion \} from "\.\.\/unreal\/matchMoments\.js";/);
  // The flag, and the position the stance loop shows in: both athletes on their feet, nothing settled.
  assert.match(arena, /const greeting = combat\.greeting === true && idleStanding;/);
  assert.match(arena, /const momentId = greeting \? MATCH_GREETING : resultChoice && resultView === "result" \? resultMoment : null;/);
  // The stage gets the moment after the props it always got (tests/unrealTechniquePicture.test.js pins those).
  assert.match(arena, /\s+signal=\{combat\.result\?\.animationSignal\}\r?\n\s+momentId=\{momentId\}\r?\n\s+onMomentDone=\{momentDone\}\r?\n/);
  // Its end, or its failure, clears the flag. So does a new starting stance.
  assert.match(arena, /const endGreeting = \(\) => setCombat\(\(current\) => \(current\.greeting \? \{ \.\.\.current, greeting: false \} : current\)\);/);
  assert.match(arena, /if \(id === MATCH_GREETING\) \{[\s\S]*?endGreeting\(\);\r?\n {4}\}/);
  // Only focus that was on the greeting's own stage (its Skip button) is sent to the technique heading.
  // Focus elsewhere in the mat window, such as the stance loop's controls when no greeting could show, is left alone.
  assert.match(arena, /const greetingStage = matRef\.current\?\.querySelector\('\.unreal-clip-stage\[data-kind="moment"\]'\);\r?\n\s+if \(greetingStage\?\.contains\(document\.activeElement\)\) chooseRef\.current\?\.focus\(\{ preventScroll: true \}\);\r?\n\s+endGreeting\(\);/);
  assert.doesNotMatch(arena, /matRef\.current\?\.contains\(/);
  assert.match(arena, /onChange=\{\(stance\) => \{\r?\n\s+onStanceChange\(stance\);\r?\n(?:\s+\/\/[^\n]*\r?\n)+\s+endGreeting\(\);/);
  assert.equal(arena.match(/\bendGreeting\(\)/g).length, 2, 'when the greeting is over, and when the stance changes');
  // A new opponent resets the match without it.
  const reset = /const changeOpponent = \(event\) => \{(?<body>[\s\S]*?)\n {2}\};/.exec(arena)?.groups.body;
  assert.ok(reset?.split(/\r?\n/).some((line) => line.trim() === 'greeting: false,'));
  // And without a picture chosen for a finished match.
  assert.ok(reset?.split(/\r?\n/).some((line) => line.trim() === 'resultView: null,'));
  // The greeting never holds a technique back: what can be chosen does not look at it.
  assert.match(arena, /const canChoose = combat\.active && combat\.phase === "selecting";/);
  assert.match(arena, /disabled=\{!available \|\| !canChoose\}/);
  // Focus after a start is decided by the phase alone, as before.
  assert.match(arena, /if \(combat\.phase === "selecting" && previousPhase !== "selecting"\) \{\r?\n\s+const focused = document\.activeElement;\r?\n\s+if \(!focused \|\| focused === document\.body\) chooseRef\.current\?\.focus\(\{ preventScroll: true \}\);\r?\n\s+\}\r?\n {2}\}, \[combat\.phase\]\);/);
});

test('a finished match offers its match moment and the final exchange, starting on the final exchange under reduced motion', () => {
  const arena = source('src/components/CombatArenaView.jsx');
  // Only a finished match, only once its clip is published, and for one result at a time.
  assert.match(arena, /const resultMoment = isFinished \? matchResultMoment\(combat\.result\) : null;/);
  assert.match(arena, /const resultSignal = resultMoment && findMatchMoment\(resultMoment\) \? combat\.result\.animationSignal \?\? null : null;/);
  // The picture is the one kept with the match for this result; until one is kept, the one the match opens on.
  assert.match(arena, /const openingView = prefersReducedMotion\(\) \? "exchange" : "result";\r?\n {2}const resultView = combat\.resultView\?\.signal === resultSignal \? combat\.resultView\.view : openingView;\r?\n {2}const resultChoice = resultSignal !== null && resultView !== "none";/);
  // It is kept through setCombat, for the result on screen, and the opening picture is kept once,
  // when the result first shows. The screen has no state of its own for it: its state is gone
  // when the player leaves the Arena (the last test in this file runs the Arena through such a visit).
  assert.match(arena, /const keepResultView = \(view, opening = false\) => setCombat\(\(current\) => \(\r?\n {4}current\.result\?\.animationSignal === resultSignal && !\(opening && current\.resultView\?\.signal === resultSignal\)\r?\n {6}\? \{ \.\.\.current, resultView: \{ signal: resultSignal, view \} \}\r?\n {6}: current\r?\n {2}\)\);/);
  assert.match(arena, /useEffect\(\(\) => \{\r?\n {4}if \(resultSignal !== null\) keepResultView\(openingView, true\);\r?\n {2}\}, \[resultSignal\]\);/);
  assert.equal(arena.match(/\buseState\(/g).length, 2, 'the announcement and the position start, and nothing about the finished match\'s picture');
  // The toggle: two buttons in one named group, each saying whether it is the one pressed.
  assert.match(arena, /\{resultChoice && \(\r?\n\s+<header className="mat-window-header">\r?\n\s+<div className="segmented mat-view-toggle" role="group" aria-label="Match picture">/);
  assert.match(arena, /\{\[\["result", "Match result"\], \["exchange", "Final exchange"\]\]\.map\(\(\[view, label\]\) => \(\r?\n\s+<button key=\{view\} type="button" className=\{resultView === view \? "active" : undefined\} aria-pressed=\{resultView === view\} onClick=\{\(\) => showResultView\(view\)\}>\{label\}<\/button>/);
  // It sits in the mat window, above the one stage.
  assert.match(arena, /<div ref=\{matRef\} className=\{`mat-window cinematic-mode \$\{combat\.result \? "result-mode" : ""\}`\}>\r?\n\s+\{resultChoice && \(/);
  assert.match(arena, /<\/header>\r?\n\s+\)\}\r?\n\s+<GrapplingStage\r?\n/);
  // A moment the stage could not show leaves nothing to choose: the toggle goes and the final exchange shows.
  assert.match(arena, /\} else if \(id === resultMoment\) \{[\s\S]*?keepResultView\("none"\);\r?\n {4}\}/);
  // Easy to tap, in the app's own segmented-control look, across the whole mat window
  // (which centers its children on phones), with room around it for the focus ring.
  const css = source('src/game/arena.css');
  assert.match(css, /\.app-shell\.jq-game \.mat-view-toggle button \{[^}]*min-height: 44px;[^}]*\}/);
  assert.match(css, /\.app-shell\.jq-game \.mat-window-header \{[^}]*justify-self: stretch;[^}]*width: 100%;[^}]*padding: 0\.4rem 1rem;[^}]*\}/);
});

// ---- The stage (src/components/UnrealClipStage.jsx), run outside React ----

const LUCIDE = asModule('export const Pause = () => null, Play = () => null, RotateCcw = () => null, SkipForward = () => null;');
const loadClipStage = () => loadComponent('src/components/UnrealClipStage.jsx', {
  react: STAND_IN_REACT,
  'lucide-react': LUCIDE,
  '../unreal/techniqueClips.js': asModule(`export { UNREAL_CLIP_LOOK } from ${JSON.stringify(repoModule('src/unreal/techniqueClips.js'))};\nexport const unrealClipViews = (...args) => globalThis.__clipViews(...args);`),
  '../unreal/clipPlayback.js': repoModule('src/unreal/clipPlayback.js'),
  './UnrealClipStage.css': null,
});
const FALLBACK = Object.freeze({ type: 'what shows without the moment', props: {} });
const videoOf = (tree) => findElement(tree, (node) => node.type === 'video');
const text = (node) => (Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : '');
const buttons = (tree) => {
  const found = [];
  const walk = (node) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object') return;
    if (node.type === 'button') found.push(node);
    walk(node.props?.children);
  };
  walk(tree);
  return found;
};
// A browser that asks for reduced motion (or not), and lets a test change its mind.
const motionWindow = (reduce) => {
  const listeners = [];
  const query = { matches: reduce, addEventListener: (type, listener) => listeners.push(listener), removeEventListener() {} };
  return { window: { matchMedia: () => query }, set(value) { query.matches = value; for (const listener of listeners) listener(); } };
};

test('the moment stage is a third kind of clip stage, and the stance and technique kinds are untouched', async (t) => {
  useGlobals(t, { document: { hidden: false, addEventListener() {}, removeEventListener() {} }, window: undefined, __hookRunner: undefined, __clipViews: undefined });
  const { default: UnrealClipStage } = await loadClipStage();
  assert.equal(UnrealClipStage({ kind: 'moment', moveId: 'match_greeting' }).type.name, 'MomentClip');
  assert.equal(UnrealClipStage({ kind: 'technique', moveId: 'double_leg' }).type.name, 'TechniqueClip');
  for (const kind of [undefined, 'stance', 'loop', 'Moment']) assert.equal(UnrealClipStage({ kind, moveId: 'standing_stance' }).type.name, 'StanceClip', String(kind));
  // `kind` is not handed on.
  assert.deepEqual(UnrealClipStage({ kind: 'moment', moveId: 'match_win', holdLastFrame: true }).props, { moveId: 'match_win', holdLastFrame: true });
  const stage = source('src/components/UnrealClipStage.jsx');
  assert.match(stage, /if \(kind === 'moment'\) return <MomentClip \{\.\.\.props\} \/>;\r?\n {2}return kind === 'technique' \? <TechniqueClip \{\.\.\.props\} \/> : <StanceClip \{\.\.\.props\} \/>;/);
  // The stage needs no module the other kinds do not: it finds a moment's views in the clip list like theirs.
  assert.deepEqual(imports('src/components/UnrealClipStage.jsx'), ['react', 'lucide-react', '../unreal/techniqueClips.js', '../unreal/clipPlayback.js', './UnrealClipStage.css']);
  assert.match(stage, /^import \{ Pause, Play, RotateCcw, SkipForward \} from 'lucide-react';\r?$/m);
});

test('the greeting plays once, silent and inline, and gives way when it ends: the parent is told at once, once', async (t) => {
  useGlobals(t, { document: { hidden: false, addEventListener() {}, removeEventListener() {} }, window: undefined, __hookRunner: undefined, __clipViews: undefined });
  const { default: UnrealClipStage } = await loadClipStage();
  // The greeting's time limit is a timer. This test's clock stands still, so it never runs out here.
  t.mock.timers.enable({ apis: ['setTimeout'] });
  globalThis.__clipViews = viewsOf({ match_greeting: { fighter: ['side', 'front'] } });
  const runner = globalThis.__hookRunner = createHookRunner();
  const told = [];
  const onDone = (...args) => told.push({ args, whileRendering: runner.rendering });
  const element = UnrealClipStage({ kind: 'moment', moveId: 'match_greeting', moveLabel: 'Match greeting', fighter: { name: 'Clipper' }, opponent: { name: 'Ryu Tanaka' }, fallback: FALLBACK, onDone });
  let tree = runner.render(element.type, element.props);

  // One video: the side view, from its first frame (the poster), never looping.
  const video = videoOf(tree);
  assert.deepEqual([video.props.src, video.props.poster], ['/assets/unreal-clips/match_greeting/fighter-side.mp4', '/assets/unreal-clips/match_greeting/fighter-side.webp']);
  assert.deepEqual([video.props.loop, video.props.muted, video.props.playsInline, video.props.disableRemotePlayback, video.props.preload, video.props.controls], [false, true, true, true, 'auto', undefined]);
  assert.equal(video.props['aria-label'], 'Match greeting. Clipper in the white gi and Ryu Tanaka in the navy gi, seen from the side.');
  // The section says what it is, as every Unreal clip does.
  assert.deepEqual([tree.type, tree.props.className, tree.props['aria-label'], tree.props['data-kind'], tree.props['data-move'], tree.props['data-camera'], tree.props['data-held'], tree.props['data-ended']],
    ['section', 'unreal-clip-stage is-moment', 'Match greeting, Unreal Engine clip', 'moment', 'match_greeting', 'side', 'false', 'false']);
  const heading = findElement(tree, (node) => node.props?.className === 'unreal-clip-heading');
  assert.deepEqual([heading.type, text(heading)], ['header', 'Unreal EngineMatch greeting']);
  // The legend is the one every clip has.
  const legend = findElement(tree, (node) => node.props?.className === 'unreal-clip-legend');
  assert.equal(text(legend), 'Clipper (you): white giRyu Tanaka: navy giAthletes and colors are fixed in this clip.');
  // One control: Skip. No camera buttons, no Replay, no note.
  assert.deepEqual(buttons(tree).map((button) => [text(button), button.props.type, button.props.className]), [['Skip', 'button', 'unreal-clip-play']]);
  assert.equal(findElement(tree, (node) => node.props?.className === 'unreal-clip-note'), null);
  assert.equal(tree.props['aria-describedby'], undefined);
  // The picture box has the clip's shape, and no still behind the video unless one is given.
  const viewport = findElement(tree, (node) => node.props?.className === 'unreal-clip-viewport');
  assert.deepEqual(viewport.props.style, { '--clip-ratio': '1280 / 720', backgroundImage: undefined });
  assert.deepEqual(told, []);

  // It ends: the parent is told from the event itself, before the next render, and the fallback takes its place.
  video.props.onEnded();
  assert.deepEqual(told, [{ args: ['match_greeting'], whileRendering: false }]);
  tree = runner.render(element.type, element.props);
  assert.equal(tree, FALLBACK);
  // Nothing more is said, also to a new callback, and nothing can bring the moment back.
  const late = [];
  for (const callback of [onDone, (...args) => late.push(args)]) assert.equal(runner.render(element.type, { ...element.props, onDone: callback }), FALLBACK);
  video.props.onEnded();
  video.props.onError();
  assert.equal(runner.render(element.type, element.props), FALLBACK);
  assert.equal(told.length, 1);
  assert.deepEqual(late, []);
});

test('the greeting gives way at once when it is skipped, cannot load, is refused, or motion is reduced, and never leaves an empty box', async (t) => {
  useGlobals(t, { document: { hidden: false, addEventListener() {}, removeEventListener() {} }, window: undefined, __hookRunner: undefined, __clipViews: undefined });
  const { default: UnrealClipStage } = await loadClipStage();
  // The greeting's time limit is a timer. This test's clock stands still, so it never runs out here.
  t.mock.timers.enable({ apis: ['setTimeout'] });
  globalThis.__clipViews = viewsOf({ match_greeting: { fighter: ['side', 'front'] } });
  const mount = (props = {}) => {
    const runner = globalThis.__hookRunner = createHookRunner();
    const told = [];
    const element = UnrealClipStage({ kind: 'moment', moveId: 'match_greeting', moveLabel: 'Match greeting', fallback: FALLBACK, onDone: (...args) => told.push({ args, whileRendering: runner.rendering }), ...props });
    return { runner, told, render: () => runner.render(element.type, element.props) };
  };
  const once = [{ args: ['match_greeting'], whileRendering: false }];

  // Skip.
  {
    const { told, render } = mount();
    buttons(render())[0].props.onClick();
    assert.deepEqual(told, once);
    assert.equal(render(), FALLBACK);
  }
  // The side view cannot load. A passing moment does not try its other view: what follows takes over.
  {
    const { told, render } = mount();
    videoOf(render()).props.onError();
    assert.deepEqual(told, once);
    assert.equal(render(), FALLBACK);
    assert.equal(render(), FALLBACK);
    assert.deepEqual(told, once);
  }
  // No view is published at all: the fallback from the first render, and the parent is told after it.
  {
    globalThis.__clipViews = viewsOf({});
    const { told, render } = mount();
    assert.equal(render(), FALLBACK);
    assert.deepEqual(told, once);
    assert.equal(render(), FALLBACK);
    assert.deepEqual(told, once);
    globalThis.__clipViews = viewsOf({ match_greeting: { fighter: ['side', 'front'] } });
  }
  // Reduced motion: no greeting. The fallback shows from the first render, with no video made at all.
  {
    globalThis.window = motionWindow(true).window;
    const { told, render } = mount();
    assert.equal(render(), FALLBACK);
    assert.deepEqual(told, once);
    assert.equal(render(), FALLBACK);
    assert.deepEqual(told, once);
  }
  // Motion is reduced while it plays: it gives way then.
  {
    const motion = motionWindow(false);
    globalThis.window = motion.window;
    const { told, render } = mount();
    assert.ok(videoOf(render()));
    assert.deepEqual(told, []);
    motion.set(true);
    assert.equal(render(), FALLBACK);
    assert.deepEqual(told, once);
    // Turning motion back on does not start it again.
    motion.set(false);
    assert.equal(render(), FALLBACK);
    assert.deepEqual(told, once);
    globalThis.window = undefined;
  }
  // No callback and no fallback given: it still ends, and draws nothing of its own.
  {
    const { render } = mount({ onDone: undefined, fallback: undefined });
    videoOf(render()).props.onEnded();
    assert.equal(render(), null);
  }
  // Given the still of the picture whose place it takes, the box shows that still behind the
  // video, so it is not black while the greeting's own files arrive. The video is what it was.
  {
    const still = '/assets/unreal-clips/standing_stance/fighter-side.webp';
    const { told, render } = mount({ backdrop: still });
    const tree = render();
    const viewport = findElement(tree, (node) => node.props?.className === 'unreal-clip-viewport');
    assert.deepEqual(viewport.props.style, { '--clip-ratio': '1280 / 720', backgroundImage: `url("${still}")` });
    assert.deepEqual([videoOf(tree).props.src, videoOf(tree).props.poster], ['/assets/unreal-clips/match_greeting/fighter-side.mp4', '/assets/unreal-clips/match_greeting/fighter-side.webp']);
    // The still leaves with the greeting.
    videoOf(tree).props.onEnded();
    assert.deepEqual(told, once);
    assert.equal(render(), FALLBACK);
  }
  // The browser refuses to start a video nobody asked for: the greeting is over. Any other
  // rejection (the element was replaced) is not a refusal.
  for (const [name, refused] of [['NotAllowedError', true], ['AbortError', false]]) {
    const { runner, told, render } = mount();
    const calls = [];
    const video = { muted: false, pause: () => calls.push('pause'), play: () => { calls.push('play'); return Promise.reject(Object.assign(new Error(name), { name })); } };
    // The second ref the stage makes is its <video>.
    const useRef = runner.useRef;
    let refs = 0;
    runner.useRef = (current) => { const slot = useRef(current); refs += 1; if (refs === 2) slot.current = video; return slot; };
    assert.ok(videoOf(render()));
    assert.deepEqual([calls, video.muted], [['play'], true], 'it starts by itself, silent');
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(told, refused ? once : [], name);
    assert.equal(render() === FALLBACK, refused, name);
  }
});

test('a greeting whose picture does not start in two seconds, or runs out of data and stands still for a second, gives way; the end of a match has no such limit', async (t) => {
  useGlobals(t, { document: { hidden: false, addEventListener() {}, removeEventListener() {} }, window: undefined, __hookRunner: undefined, __clipViews: undefined });
  const { default: UnrealClipStage } = await loadClipStage();
  // The clock is this test's: time passes only when it says so.
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const clock = t.mock.timers;
  assert.deepEqual({ ...PASSING_MOMENT_PATIENCE }, { start: 2000, stall: 1000 });
  assert.ok(Object.isFrozen(PASSING_MOMENT_PATIENCE));
  globalThis.__clipViews = viewsOf({ match_greeting: { fighter: ['side', 'front'] }, match_win: { fighter: ['side', 'front'] } });
  const mount = (props = {}) => {
    const runner = globalThis.__hookRunner = createHookRunner();
    const told = [];
    const element = UnrealClipStage({ kind: 'moment', moveId: 'match_greeting', moveLabel: 'Match greeting', fallback: FALLBACK, onDone: (...args) => told.push({ args, whileRendering: runner.rendering }), ...props });
    return { runner, told, element, render: (extra = {}) => runner.render(element.type, { ...element.props, ...extra }) };
  };
  const once = [{ args: ['match_greeting'], whileRendering: false }];

  // Its file is slow, or hangs without failing: no event comes at all. After two seconds the
  // greeting is over, the parent is told from the timer itself, and the fallback takes the box.
  {
    const { told, render } = mount();
    const video = videoOf(render());
    clock.tick(1999);
    assert.deepEqual(told, []);
    assert.ok(videoOf(render()), 'still the greeting, on the still behind it');
    clock.tick(1);
    assert.deepEqual(told, once);
    assert.equal(render(), FALLBACK);
    // It never plays late: whatever the file does afterwards changes nothing.
    video.props.onPlaying();
    video.props.onWaiting();
    video.props.onEnded();
    clock.tick(60000);
    assert.equal(render(), FALLBACK);
    assert.deepEqual(told, once);
  }
  // It starts in time: the limit is gone, however long the greeting is.
  {
    const { told, render } = mount();
    const video = videoOf(render());
    clock.tick(1500);
    video.props.onPlaying();
    clock.tick(60000);
    assert.deepEqual(told, []);
    assert.ok(videoOf(render()));
    video.props.onEnded();
    assert.deepEqual(told, once);
    assert.equal(render(), FALLBACK);
  }
  // A browser says "waiting" while the first frames load. That is the same wait, not a new
  // one: two seconds from the start, neither sooner nor later.
  {
    const { told, render } = mount();
    const video = videoOf(render());
    clock.tick(1500);
    video.props.onWaiting();
    clock.tick(499);
    assert.deepEqual(told, []);
    clock.tick(1);
    assert.deepEqual(told, once);
    assert.equal(render(), FALLBACK);
  }
  // It runs out of data halfway: after a second without moving it is over.
  {
    const { told, render } = mount();
    const video = videoOf(render());
    video.props.onPlaying();
    clock.tick(700);
    video.props.onWaiting();
    clock.tick(999);
    assert.deepEqual(told, []);
    assert.ok(videoOf(render()));
    clock.tick(1);
    assert.deepEqual(told, once);
    assert.equal(render(), FALLBACK);
  }
  // A short stop that recovers is no reason to give way, and each stop gets its own second.
  {
    const { told, render } = mount();
    const video = videoOf(render());
    video.props.onPlaying();
    video.props.onWaiting();
    clock.tick(900);
    video.props.onPlaying();
    clock.tick(60000);
    assert.deepEqual(told, []);
    video.props.onWaiting();
    clock.tick(600);
    // A second "waiting" during the same stop does not start the second again.
    video.props.onWaiting();
    clock.tick(399);
    assert.deepEqual(told, []);
    clock.tick(1);
    assert.deepEqual(told, once);
    assert.equal(render(), FALLBACK);
  }
  // Skip, the end and a failed file each end the wait with the greeting: nothing is said twice.
  for (const leave of [(tree) => buttons(tree)[0].props.onClick(), (tree) => videoOf(tree).props.onEnded(), (tree) => videoOf(tree).props.onError()]) {
    const { told, render } = mount();
    leave(render());
    assert.deepEqual(told, once);
    assert.equal(render(), FALLBACK);
    clock.tick(60000);
    assert.equal(render(), FALLBACK);
    assert.deepEqual(told, once);
  }
  // The timer tells whoever is listening when it runs out, not whoever was listening at the start.
  {
    const { told, render } = mount();
    const later = [];
    render();
    render({ onDone: (...args) => later.push(args) });
    clock.tick(2000);
    assert.deepEqual([told, later], [[], [['match_greeting']]]);
  }
  // Reduced motion: the greeting is over before it starts, and no wait is left running.
  {
    globalThis.window = motionWindow(true).window;
    const { told, render } = mount();
    assert.equal(render(), FALLBACK);
    clock.tick(60000);
    assert.equal(render(), FALLBACK);
    assert.deepEqual(told, once);
    globalThis.window = undefined;
  }
  // The end of a match waits on its first frame for as long as its file takes, as a technique
  // clip does: no limit at the start, and none when it runs out of data.
  {
    const { told, render } = mount({ moveId: 'match_win', moveLabel: 'Match won', holdLastFrame: true });
    const video = videoOf(render());
    clock.tick(600000);
    video.props.onWaiting();
    clock.tick(600000);
    video.props.onPlaying();
    video.props.onWaiting();
    clock.tick(600000);
    assert.deepEqual(told, []);
    assert.equal(render().props['data-move'], 'match_win');
  }
  // The stage is told by the browser's own events, on the one <video> a moment draws.
  const stage = source('src/components/UnrealClipStage.jsx');
  assert.equal(stage.match(/onPlaying=\{stopWaiting\}\r?\n\s+onWaiting=\{\(\) => wait\(PASSING_MOMENT_PATIENCE\.stall\)\}/g).length, 1);
  assert.match(stage, /useEffect\(\(\) => \{\r?\n {4}if \(over\) return undefined;\r?\n {4}wait\(PASSING_MOMENT_PATIENCE\.start\);\r?\n {4}return stopWaiting;\r?\n {2}\}, \[over\]\);/);
  // "stalled" only says the download paused; the picture may still be moving from what has arrived.
  assert.doesNotMatch(stage, /onStalled/);
});

test('the stance loop lets its parent hold Play and Pause, as it lets it hold the camera, and is unchanged without one', async (t) => {
  useGlobals(t, { document: { hidden: false, addEventListener() {}, removeEventListener() {} }, window: undefined, __hookRunner: undefined, __clipViews: undefined });
  const { default: UnrealClipStage } = await loadClipStage();
  globalThis.__clipViews = viewsOf({ standing_stance: { fighter: ['side', 'front'] } });
  // A stance loop with a stand-in <video>: what the stage does to it, and what it tells its parent.
  const mount = (props = {}, { refuse = false } = {}) => {
    const runner = globalThis.__hookRunner = createHookRunner();
    const calls = [];
    const told = [];
    const video = { muted: false, pause: () => calls.push('pause'), play: () => { calls.push('play'); return refuse ? Promise.reject(Object.assign(new Error('refused'), { name: 'NotAllowedError' })) : Promise.resolve(); } };
    // The first ref the stance stage makes is its <video>.
    const useRef = runner.useRef;
    let refs = 0;
    runner.useRef = (current) => { const slot = useRef(current); refs += 1; if (refs === 1) slot.current = video; return slot; };
    const element = UnrealClipStage({ moveId: 'standing_stance', moveLabel: 'Standing stance', fallback: FALLBACK, onWantsPlayChange: (...args) => told.push(args), ...props });
    assert.equal(element.type.name, 'StanceClip');
    return { calls, told, render: (extra = {}) => runner.render(element.type, { ...element.props, ...extra }) };
  };
  const face = (tree) => text(buttons(tree)[0]);

  // No parent holding it (or one that has nothing to say yet): it plays by itself, and Pause and
  // Play are its own, exactly as before. Each press is reported.
  for (const props of [{ onWantsPlayChange: undefined }, { wantsPlay: null }, { wantsPlay: undefined }]) {
    const { calls, told, render } = mount(props);
    assert.equal(face(render()), 'Pause');
    assert.deepEqual(calls, ['play']);
    buttons(render())[0].props.onClick();
    assert.equal(face(render()), 'Play');
    assert.deepEqual(calls, ['play', 'pause']);
    buttons(render())[0].props.onClick();
    assert.equal(face(render()), 'Pause');
    assert.deepEqual(calls, ['play', 'pause', 'play']);
    assert.deepEqual(told, props.onWantsPlayChange === undefined && Object.hasOwn(props, 'onWantsPlayChange') ? [] : [[false], [true]]);
  }
  // The parent says the loop was paused: a loop that comes back starts paused, on its poster.
  {
    const { calls, told, render } = mount({ wantsPlay: false });
    assert.equal(face(render()), 'Play');
    assert.deepEqual(calls, ['pause'], 'it is not started');
    assert.deepEqual(told, []);
    // Play is asked of the parent, and plays once the parent says so.
    buttons(render())[0].props.onClick();
    assert.deepEqual(told, [[true]]);
    assert.equal(face(render({ wantsPlay: true })), 'Pause');
    assert.deepEqual(calls, ['pause', 'play']);
    buttons(render({ wantsPlay: true }))[0].props.onClick();
    assert.deepEqual(told, [[true], [false]]);
  }
  // The parent says it plays, also for someone who asks for reduced motion: Play was their own press.
  {
    globalThis.window = motionWindow(true).window;
    const own = mount();
    assert.equal(face(own.render()), 'Play', 'reduced motion starts paused');
    assert.deepEqual([own.calls, own.told], [['pause'], []]);
    const held = mount({ wantsPlay: true });
    assert.equal(face(held.render()), 'Pause');
    assert.deepEqual(held.calls, ['play']);
    globalThis.window = undefined;
  }
  // What stops the loop without a press is reported too, so the parent knows the loop stands still:
  // reduced motion turned on while it plays, and a browser that refuses to start it.
  {
    const motion = motionWindow(false);
    globalThis.window = motion.window;
    const { told, render } = mount();
    assert.equal(face(render()), 'Pause');
    motion.set(true);
    assert.equal(face(render()), 'Play');
    assert.deepEqual(told, [[false]]);
    globalThis.window = undefined;
  }
  {
    const { calls, told, render } = mount({}, { refuse: true });
    assert.equal(face(render()), 'Pause');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(face(render()), 'Play');
    assert.deepEqual([calls, told], [['play', 'pause'], [[false]]]);
  }
  // The stage reads the parent's word before its own, as it does for the camera.
  const stage = source('src/components/UnrealClipStage.jsx');
  assert.match(stage, /const \[ownPlay, setOwnPlay\] = useState\(\(\) => !reducedMotionQuery\(\)\?\.matches\);\r?\n {2}const wantsPlay = chosenPlay \?\? ownPlay;\r?\n {2}const setWantsPlay = \(value\) => \{ setOwnPlay\(value\); onWantsPlayChange\?\.\(value\); \};/);
});

test('the end of a match plays once and holds its last frame, with Replay and the other view, and waits for Play under reduced motion', async (t) => {
  useGlobals(t, { document: { hidden: false, addEventListener() {}, removeEventListener() {} }, window: undefined, __hookRunner: undefined, __clipViews: undefined });
  const { default: UnrealClipStage } = await loadClipStage();
  const mount = (moveId, moveLabel, props = {}) => {
    const runner = globalThis.__hookRunner = createHookRunner();
    const told = [];
    const element = UnrealClipStage({ kind: 'moment', moveId, moveLabel, holdLastFrame: true, fighter: { name: 'Clipper' }, opponent: { name: 'Ryu Tanaka' }, fallback: FALLBACK, onDone: (...args) => told.push({ args, whileRendering: runner.rendering }), ...props });
    return { runner, told, render: () => runner.render(element.type, element.props) };
  };
  const faces = (tree) => buttons(tree).map((button) => text(button));

  for (const [moveId, title] of [['match_win', 'Match won'], ['match_loss', 'Match lost']]) {
    globalThis.__clipViews = viewsOf({ [moveId]: { fighter: ['side', 'front'] } });
    const { told, render } = mount(moveId, title);
    let tree = render();
    assert.deepEqual([tree.props['aria-label'], tree.props['data-kind'], tree.props['data-move'], tree.props['data-held'], tree.props['data-ended']], [`${title}, Unreal Engine clip`, 'moment', moveId, 'true', 'false']);
    assert.equal(text(findElement(tree, (node) => node.props?.className === 'unreal-clip-heading')), `Unreal Engine${title}`);
    assert.deepEqual([videoOf(tree).props.src, videoOf(tree).props.loop, videoOf(tree).props.muted, videoOf(tree).props.playsInline], [`/assets/unreal-clips/${moveId}/fighter-side.mp4`, false, true, true]);
    // The transport technique clips have, and both views.
    assert.deepEqual(faces(tree), ['Pause', 'Side', 'Front']);
    assert.deepEqual(buttons(tree).slice(1).map((button) => button.props['aria-pressed']), [true, false]);
    assert.equal(findElement(tree, (node) => node.props?.className === 'unreal-clip-note'), null);
    assert.equal(findElement(tree, (node) => node.props?.className === 'unreal-clip-viewport').props.style.backgroundImage, undefined, 'no still behind the picture');

    // It ends and rests there: Replay is offered, and the parent is told nothing.
    videoOf(tree).props.onEnded();
    tree = render();
    assert.deepEqual([tree.props['data-ended'], faces(tree)], ['true', ['Replay', 'Side', 'Front']]);
    assert.ok(videoOf(tree), 'the picture stays');
    assert.deepEqual(told, []);
    // Replay plays it again from the start.
    buttons(tree)[0].props.onClick();
    tree = render();
    assert.deepEqual([tree.props['data-ended'], faces(tree)], ['false', ['Pause', 'Side', 'Front']]);
    // Pause and Play.
    buttons(tree)[0].props.onClick();
    assert.deepEqual(faces(render()), ['Play', 'Side', 'Front']);
    buttons(render())[0].props.onClick();
    assert.deepEqual(faces(render()), ['Pause', 'Side', 'Front']);
    // The other view.
    buttons(render())[2].props.onClick();
    tree = render();
    assert.deepEqual([tree.props['data-camera'], videoOf(tree).props.src], ['front', `/assets/unreal-clips/${moveId}/fighter-front.mp4`]);
    assert.deepEqual(buttons(tree).slice(1).map((button) => button.props['aria-pressed']), [false, true]);

    // A view that cannot play gives way to the other one, and nothing is said.
    videoOf(tree).props.onError();
    tree = render();
    assert.deepEqual([tree.props['data-camera'], videoOf(tree).props.src, faces(tree)], ['side', `/assets/unreal-clips/${moveId}/fighter-side.mp4`, ['Pause']]);
    assert.deepEqual(told, []);
    // When that one cannot play either, the fallback shows and the parent is told, once, from the event.
    videoOf(tree).props.onError();
    assert.deepEqual(told, [{ args: [moveId], whileRendering: false }]);
    assert.equal(render(), FALLBACK);
    assert.equal(render(), FALLBACK);
    assert.equal(told.length, 1);
  }

  // One view only: no camera buttons.
  globalThis.__clipViews = viewsOf({ match_win: { fighter: ['side'] } });
  assert.deepEqual(faces(mount('match_win', 'Match won').render()), ['Pause']);
  // The view asked for, when it exists; the side view when it does not.
  globalThis.__clipViews = viewsOf({ match_win: { fighter: ['side', 'front'] }, match_loss: { fighter: ['side'] } });
  assert.equal(mount('match_win', 'Match won', { camera: 'front' }).render().props['data-camera'], 'front');
  assert.equal(mount('match_loss', 'Match lost', { camera: 'front' }).render().props['data-camera'], 'side');
  // A rival's take is never used.
  globalThis.__clipViews = viewsOf({ match_win: { opponent: ['side', 'front'] } });
  {
    const { told, render } = mount('match_win', 'Match won');
    assert.equal(render(), FALLBACK);
    assert.deepEqual(told, [{ args: ['match_win'], whileRendering: false }]);
  }

  // Reduced motion: it waits on its first frame for Play, and says why. It is not over.
  globalThis.__clipViews = viewsOf({ match_win: { fighter: ['side', 'front'] } });
  globalThis.window = motionWindow(true).window;
  {
    const { runner, told, render } = mount('match_win', 'Match won');
    const calls = [];
    const video = { muted: false, currentTime: 0, pause: () => calls.push('pause'), play: () => { calls.push('play'); return Promise.resolve(); } };
    const useRef = runner.useRef;
    let refs = 0;
    runner.useRef = (current) => { const slot = useRef(current); refs += 1; if (refs === 2) slot.current = video; return slot; };
    let tree = render();
    assert.deepEqual(faces(tree), ['Play', 'Side', 'Front']);
    assert.deepEqual(calls, ['pause'], 'nothing starts by itself');
    const note = findElement(tree, (node) => node.props?.className === 'unreal-clip-note');
    assert.deepEqual([text(note), tree.props['aria-describedby']], ['Reduced motion is on; press Play when ready.', note.props.id]);
    assert.deepEqual(told, []);
    // Play is the person's own request.
    buttons(tree)[0].props.onClick();
    tree = render();
    assert.deepEqual([faces(tree), calls], [['Pause', 'Side', 'Front'], ['pause', 'play']]);
    assert.deepEqual(told, []);
  }
  globalThis.window = undefined;
});

// ---- The stage chooser (src/components/GrapplingStage.jsx), run outside React ----

// The clip list as GrapplingStage and the moments module see it in these tests:
// `globalThis.__published` names the views that exist.
const clipList = asModule(`const has = (moveId, performerSide, camera) => globalThis.__published.includes(moveId + '/' + performerSide + '-' + camera);
const view = (moveId, performerSide, camera) => Object.freeze({ moveId, performerSide, camera, video: '/assets/unreal-clips/' + moveId + '/' + performerSide + '-' + camera + '.mp4', poster: '/assets/unreal-clips/' + moveId + '/' + performerSide + '-' + camera + '.webp' });
export const findUnrealClip = (moveId, performerSide = 'fighter', camera = 'side') => (has(moveId, performerSide, camera) ? view(moveId, performerSide, camera) : null);
export const unrealClipViews = (moveId, performerSide = 'fighter') => ['side', 'front'].filter((camera) => has(moveId, performerSide, camera)).map((camera) => view(moveId, performerSide, camera));`);
// The real moments module, looking in the stand-in clip list.
const momentsInThatList = asModule(`import { findMatchMoment as real } from ${JSON.stringify(repoModule('src/unreal/matchMoments.js'))};
import { findUnrealClip } from ${JSON.stringify(clipList)};
export * from ${JSON.stringify(repoModule('src/unreal/matchMoments.js'))};
export const findMatchMoment = (id, camera) => real(id, camera, findUnrealClip);`);
const loadGrapplingStage = () => loadComponent('src/components/GrapplingStage.jsx', {
  react: STAND_IN_REACT,
  './UnityGrapplingStage.jsx': standInComponent('UnityGrapplingStage'),
  './UnrealClipStage.jsx': standInComponent('UnrealClipStage'),
  './UnrealGrapplingStage.jsx': standInComponent('UnrealGrapplingStage'),
  '../unreal/renderer.js': repoModule('src/unreal/renderer.js'),
  '../unreal/techniqueClips.js': clipList,
  '../unreal/techniquePicture.js': repoModule('src/unreal/techniquePicture.js'),
  '../unreal/stances.js': repoModule('src/unreal/stances.js'),
  '../unreal/matchMoments.js': momentsInThatList,
});
const PICTURE = Object.freeze({ type: 'the position picture', props: {} });
const named = (name) => (node) => (node.type === PICTURE ? false : (node.type?.name ?? node.type) === name);
const ATHLETES = { fighter: { name: 'Clipper', stance: 'wrestling stance' }, fighterBelt: { belt: 'blue' }, opponent: { name: 'Ryu Tanaka', stance: 'wrestling stance' } };
const STANCE_VIEWS = ['standing_stance/fighter-side', 'standing_stance/fighter-front'];
const GREETING_VIEWS = ['match_greeting/fighter-side', 'match_greeting/fighter-front'];
// What the Arena passes while both athletes are on their feet and nothing has settled, and what
// it passes for a finished match the rival won with a double leg (src/components/CombatArenaView.jsx).
const idleProps = (extra = {}) => ({ idleStanding: true, moveId: undefined, performerSide: undefined, clipMoveId: null, clipPerformerSide: undefined, moveLabel: undefined, signal: undefined, ...ATHLETES, unavailableReason: 'The settled position is shown until a supported exchange succeeds.', fallback: PICTURE, ...extra });
const finishedProps = (extra = {}) => ({ idleStanding: false, moveId: 'double_leg', performerSide: 'opponent', clipMoveId: 'double_leg', clipPerformerSide: 'opponent', moveLabel: 'Double Leg Takedown', signal: 'double-leg-takedown-8-1', ...ATHLETES, unavailableReason: 'This exchange has no matching successful Unity animation yet.', fallback: PICTURE, ...extra });
const engineProps = (props) => {
  const { idleStanding, onRendererChange, clipMoveId, clipPerformerSide, onClipUnavailable, momentId, onMomentDone, ...rest } = props;
  return rest;
};
const release = () => {
  globalThis.window = { location: { href: 'https://jiuquest.com/', search: '' }, history: { state: null, replaceState() {} } };
  globalThis.__componentEnv = { DEV: false, VITE_COMBAT_ENGINE: 'unity' };
};

test('GrapplingStage plays the greeting in the stance loop\'s place, on the loop\'s view, and hands back to the loop', async (t) => {
  useGlobals(t, { window: undefined, __hookRunner: undefined, __published: undefined, __componentEnv: undefined });
  const { default: GrapplingStage } = await loadGrapplingStage();
  release();
  globalThis.__published = [...STANCE_VIEWS, ...GREETING_VIEWS];
  const runner = globalThis.__hookRunner = createHookRunner();
  const told = [];
  const onMomentDone = (...args) => told.push({ args, whileRendering: runner.rendering });
  const clips = (tree) => { const found = []; const walk = (node) => { if (Array.isArray(node)) node.forEach(walk); else if (node && typeof node === 'object') { if (named('UnrealClipStage')(node)) found.push(node); walk(node.props?.children); } }; walk(tree); return found; };

  // Before the match starts: the stance loop alone, exactly as before moments.
  let tree = runner.render(GrapplingStage, idleProps({ onMomentDone }));
  let [stance, ...more] = clips(tree);
  assert.deepEqual([stance.props.key, stance.props.kind, stance.props.moveId, stance.props.performerSide, stance.props.moveLabel, stance.props.camera, more.length], ['stance', undefined, 'standing_stance', 'fighter', 'Standing stance', null, 0]);
  assert.deepEqual(told, []);

  // The match starts on the feet: the greeting takes the loop's place.
  tree = runner.render(GrapplingStage, idleProps({ momentId: 'match_greeting', onMomentDone }));
  let [moment, ...rest] = clips(tree);
  assert.equal(rest.length, 0, 'one stage is drawn');
  assert.deepEqual([moment.props.key, moment.props.kind, moment.props.moveId, moment.props.moveLabel, moment.props.holdLastFrame, moment.props.camera], ['moment:match_greeting:', 'moment', 'match_greeting', 'Match greeting', false, 'side']);
  assert.deepEqual([moment.props.fighter, moment.props.opponent, moment.props.onDone], [ATHLETES.fighter, ATHLETES.opponent, onMomentDone]);
  // Until its own first frame is there, its box shows the still of the loop it takes the place of.
  assert.equal(moment.props.backdrop, '/assets/unreal-clips/standing_stance/fighter-side.webp');
  // What it hands back to is the stance loop, which hands on to the engine stage as it always did.
  assert.deepEqual([moment.props.fallback.props.key, moment.props.fallback.props.moveId], ['stance', 'standing_stance']);
  const engine = findElement(moment.props.fallback.props.fallback, named('UnityGrapplingStage'));
  assert.deepEqual(engine.props, engineProps(idleProps()), 'the engine stage gets the props it always got, and nothing about the moment');
  assert.deepEqual(told, [], 'a moment that shows is not over');

  // It is over (the clip stage says so through onDone; the Arena then stops asking): the loop is back.
  tree = runner.render(GrapplingStage, idleProps({ onMomentDone }));
  [stance, ...more] = clips(tree);
  assert.deepEqual([stance.props.key, stance.props.moveId, more.length], ['stance', 'standing_stance', 0]);
  assert.deepEqual(told, []);

  // The view chosen for the loop is the view the greeting opens on, and the loop comes back on it.
  stance.props.onCameraChange('front');
  tree = runner.render(GrapplingStage, idleProps({ onMomentDone }));
  assert.equal(clips(tree)[0].props.camera, 'front');
  tree = runner.render(GrapplingStage, idleProps({ momentId: 'match_greeting', onMomentDone }));
  [moment] = clips(tree);
  assert.deepEqual([moment.props.kind, moment.props.camera, moment.props.fallback.props.camera], ['moment', 'front', 'front']);
  // The still behind it is the loop's in that view: the picture that was on screen.
  assert.equal(moment.props.backdrop, '/assets/unreal-clips/standing_stance/fighter-front.webp');
  tree = runner.render(GrapplingStage, idleProps({ onMomentDone }));
  assert.deepEqual([clips(tree)[0].props.key, clips(tree)[0].props.camera], ['stance', 'front']);
  // A greeting with a side view only opens on the side view; the loop still comes back on the chosen one.
  globalThis.__published = [...STANCE_VIEWS, 'match_greeting/fighter-side'];
  tree = runner.render(GrapplingStage, idleProps({ momentId: 'match_greeting', onMomentDone }));
  [moment] = clips(tree);
  assert.deepEqual([moment.props.camera, moment.props.fallback.props.camera], ['side', 'front']);
  assert.equal(moment.props.backdrop, '/assets/unreal-clips/standing_stance/fighter-front.webp', 'the still is still the one that was on screen');
  // A loop with a side view only, of the player's own stance, shows from the side whatever view
  // was chosen for another loop before. The greeting opens on the view this loop is showing, the
  // side, with this loop's still behind it: one camera from the still through the greeting to the loop.
  globalThis.__published = [...STANCE_VIEWS, 'stance_karate/fighter-side', ...GREETING_VIEWS];
  tree = runner.render(GrapplingStage, idleProps({ fighter: { name: 'Clipper', stance: 'karate stance' }, momentId: 'match_greeting', onMomentDone }));
  [moment] = clips(tree);
  assert.deepEqual([moment.props.fallback.props.moveId, moment.props.camera, moment.props.backdrop], ['stance_karate', 'side', '/assets/unreal-clips/stance_karate/fighter-side.webp']);
  // The choice itself is kept: back on the standard loop, which has a front view, the greeting opens on the front again.
  tree = runner.render(GrapplingStage, idleProps({ momentId: 'match_greeting', onMomentDone }));
  [moment] = clips(tree);
  assert.deepEqual([moment.props.fallback.props.moveId, moment.props.camera, moment.props.backdrop], ['standing_stance', 'front', '/assets/unreal-clips/standing_stance/fighter-front.webp']);
  assert.deepEqual(told, []);
  // A greeting published with its front view alone is not shown, also to someone whose loop is on
  // the front view: a moment needs its side view. The loop stays, and the Arena is told once.
  globalThis.__published = [...STANCE_VIEWS, 'match_greeting/fighter-front'];
  tree = runner.render(GrapplingStage, idleProps({ momentId: 'match_greeting', onMomentDone }));
  [stance, ...more] = clips(tree);
  assert.deepEqual([stance.props.key, stance.props.kind, stance.props.camera, more.length], ['stance', undefined, 'front', 0]);
  assert.deepEqual(told, [{ args: ['match_greeting'], whileRendering: false }]);
  told.length = 0;
  runner.render(GrapplingStage, idleProps({ onMomentDone }));
  globalThis.__published = [...STANCE_VIEWS, 'match_greeting/fighter-side'];
  // Once another picture has shown, the choice is forgotten, as it always was.
  tree = runner.render(GrapplingStage, finishedProps({ clipMoveId: null, clipPerformerSide: undefined, onMomentDone }));
  assert.equal(clips(tree).length, 0);
  tree = runner.render(GrapplingStage, idleProps({ onMomentDone }));
  assert.deepEqual([clips(tree)[0].props.key, clips(tree)[0].props.camera], ['stance', null]);
  assert.deepEqual(told, []);
});

test('GrapplingStage holds the stance loop\'s Play and Pause beside its view, so a loop the player paused is still paused after the greeting', async (t) => {
  useGlobals(t, { window: undefined, __hookRunner: undefined, __published: undefined, __componentEnv: undefined });
  const { default: GrapplingStage } = await loadGrapplingStage();
  release();
  globalThis.__published = [...STANCE_VIEWS, 'stance_sumo/fighter-side', ...GREETING_VIEWS];
  const runner = globalThis.__hookRunner = createHookRunner();
  const told = [];
  const onMomentDone = (...args) => told.push({ args, whileRendering: runner.rendering });
  const loop = (tree) => findElement(tree, (node) => node.props?.key === 'stance');
  const momentOf = (tree) => findElement(tree, (node) => node.props?.kind === 'moment');

  // The loop is handed what was chosen (nothing yet: it decides for itself) and a way to say what is.
  let stance = loop(runner.render(GrapplingStage, idleProps({ onMomentDone })));
  assert.deepEqual([stance.props.wantsPlay, typeof stance.props.onWantsPlayChange], [null, 'function']);

  // The player pauses the loop, then starts a match on the feet. The greeting plays as for any
  // start on the feet (a pause on the loop is not a request for reduced motion), and the loop it
  // hands back to is the paused one.
  stance.props.onWantsPlayChange(false);
  assert.equal(loop(runner.render(GrapplingStage, idleProps({ onMomentDone }))).props.wantsPlay, false);
  let tree = runner.render(GrapplingStage, idleProps({ momentId: 'match_greeting', onMomentDone }));
  assert.deepEqual([momentOf(tree)?.props.moveId, momentOf(tree)?.props.fallback.props.key, momentOf(tree)?.props.fallback.props.wantsPlay], ['match_greeting', 'stance', false]);
  // The greeting is over (the Arena stops asking): the loop is back, still paused. Before the
  // pause was kept here, the loop that came back was a new one that played by itself.
  tree = runner.render(GrapplingStage, idleProps({ onMomentDone }));
  stance = loop(tree);
  assert.deepEqual([stance.props.moveId, stance.props.wantsPlay, momentOf(tree)], ['standing_stance', false, null]);
  // A new starting stance is the same loop stage: the pause holds, as it always did.
  const sumo = loop(runner.render(GrapplingStage, idleProps({ fighter: { name: 'Clipper', stance: 'sumo base' }, onMomentDone })));
  assert.deepEqual([sumo.props.moveId, sumo.props.wantsPlay], ['stance_sumo', false]);
  // And it holds through the next greeting (Restart match), also one cut short by choosing a technique.
  tree = runner.render(GrapplingStage, idleProps({ momentId: 'match_greeting', onMomentDone }));
  assert.equal(momentOf(tree)?.props.fallback.props.wantsPlay, false);
  assert.equal(loop(runner.render(GrapplingStage, idleProps({ onMomentDone }))).props.wantsPlay, false);

  // The player presses Play: the loop that comes back after the next greeting is playing.
  loop(runner.render(GrapplingStage, idleProps({ onMomentDone }))).props.onWantsPlayChange(true);
  tree = runner.render(GrapplingStage, idleProps({ momentId: 'match_greeting', onMomentDone }));
  assert.deepEqual([momentOf(tree)?.props.moveId, momentOf(tree)?.props.fallback.props.wantsPlay], ['match_greeting', true]);
  assert.equal(loop(runner.render(GrapplingStage, idleProps({ onMomentDone }))).props.wantsPlay, true);

  // Once another picture has shown, a pause is forgotten with the view, as it always was:
  // the next loop decides for itself again.
  loop(runner.render(GrapplingStage, idleProps({ onMomentDone }))).props.onWantsPlayChange(false);
  assert.equal(loop(runner.render(GrapplingStage, idleProps({ onMomentDone }))).props.wantsPlay, false);
  assert.equal(loop(runner.render(GrapplingStage, finishedProps({ clipMoveId: null, clipPerformerSide: undefined, onMomentDone }))), null);
  tree = runner.render(GrapplingStage, idleProps({ momentId: 'match_greeting', onMomentDone }));
  assert.deepEqual([momentOf(tree)?.props.moveId, momentOf(tree)?.props.fallback.props.wantsPlay], ['match_greeting', null]);
  assert.equal(loop(runner.render(GrapplingStage, idleProps({ onMomentDone }))).props.wantsPlay, null);
  // Every greeting here could be shown, so the Arena was never told that one could not.
  assert.deepEqual(told, []);
});

test('GrapplingStage shows no greeting where it cannot or should not play, keeps the stance loop mounted, and says so once', async (t) => {
  useGlobals(t, { window: undefined, __hookRunner: undefined, __published: undefined, __componentEnv: undefined });
  const { default: GrapplingStage } = await loadGrapplingStage();
  const cases = {
    'no greeting is published': { published: STANCE_VIEWS, shows: 'stance' },
    'only a rival\'s take is published': { published: [...STANCE_VIEWS, 'match_greeting/opponent-side', 'match_greeting/opponent-front'], shows: 'stance' },
    'another moment is published': { published: [...STANCE_VIEWS, 'match_win/fighter-side', 'match_loss/fighter-side'], shows: 'stance' },
    'the person asks for reduced motion': { published: [...STANCE_VIEWS, ...GREETING_VIEWS], reduce: true, shows: 'stance' },
    'the athletes are not on their feet': { published: [...STANCE_VIEWS, ...GREETING_VIEWS], props: finishedProps({ clipMoveId: null, clipPerformerSide: undefined }), shows: 'UnityGrapplingStage' },
    'the stance loop itself is not published': { published: GREETING_VIEWS, shows: 'UnityGrapplingStage' },
    'the local live preview draws the stance': { published: [...STANCE_VIEWS, ...GREETING_VIEWS], env: { DEV: true }, href: 'http://127.0.0.1:5178/?engine=unreal', shows: 'UnrealGrapplingStage' },
  };
  for (const [name, { published: list, reduce = false, props = idleProps(), env, href, shows }] of Object.entries(cases)) {
    release();
    if (href) { const url = new URL(href); globalThis.window.location = { href: url.href, search: url.search }; }
    if (env) globalThis.__componentEnv = env;
    if (reduce) globalThis.window.matchMedia = motionWindow(true).window.matchMedia;
    globalThis.__published = list;
    const runner = globalThis.__hookRunner = createHookRunner();
    const told = [];
    const onMomentDone = (...args) => told.push({ args, whileRendering: runner.rendering });
    // Without the greeting asked for, and with it: the same picture.
    const before = runner.render(GrapplingStage, { ...props, onMomentDone });
    assert.deepEqual(told, [], name);
    const tree = runner.render(GrapplingStage, { ...props, momentId: 'match_greeting', onMomentDone });
    assert.equal(findElement(tree, (node) => node.props?.kind === 'moment'), null, `${name}: no moment stage`);
    const shown = (root) => (shows === 'stance' ? findElement(root, (node) => node.props?.key === 'stance') : findElement(root, named(shows)));
    assert.ok(shown(tree), `${name}: ${shows} shows`);
    assert.deepEqual(shown(tree).props, shown(before).props, `${name}: with exactly the props it had`);
    // The Arena is told after the render, once, so it stops asking.
    assert.deepEqual(told, [{ args: ['match_greeting'], whileRendering: false }], name);
    runner.render(GrapplingStage, { ...props, momentId: 'match_greeting', onMomentDone });
    assert.equal(told.length, 1, name);
    // Asking for no moment says nothing.
    runner.render(GrapplingStage, { ...props, onMomentDone });
    assert.equal(told.length, 1, name);
  }
  // A greeting that shows under ?engine=snapshot and ?engine=unity too: they turn technique clips off, not the stance loop.
  for (const search of ['?engine=snapshot', '?engine=unity']) {
    release();
    globalThis.window.location = { href: `https://jiuquest.com/${search}`, search };
    globalThis.__published = [...STANCE_VIEWS, ...GREETING_VIEWS];
    const runner = globalThis.__hookRunner = createHookRunner();
    const tree = runner.render(GrapplingStage, idleProps({ momentId: 'match_greeting' }));
    assert.equal(findElement(tree, (node) => node.props?.kind === 'moment')?.props.moveId, 'match_greeting', search);
  }
});

test('GrapplingStage shows the end of a finished match over the final exchange, holding its last frame, and the final exchange is untouched under it', async (t) => {
  useGlobals(t, { window: undefined, __hookRunner: undefined, __published: undefined, __componentEnv: undefined });
  const { default: GrapplingStage } = await loadGrapplingStage();
  const DOUBLE_LEG = ['double_leg/fighter-side', 'double_leg/fighter-front', 'double_leg/opponent-side', 'double_leg/opponent-front'];
  const visits = {
    'release default': { env: { DEV: false, VITE_COMBAT_ENGINE: 'unity' }, href: 'https://jiuquest.com/', stage: 'UnityGrapplingStage', clips: true, moments: true },
    'no engine configured': { env: { DEV: false }, href: 'https://jiuquest.com/', stage: 'the position picture', clips: true, moments: true },
    'release ?engine=snapshot': { env: { DEV: false, VITE_COMBAT_ENGINE: 'unity' }, href: 'https://jiuquest.com/?engine=snapshot', stage: 'the position picture', clips: false, moments: true },
    'local live preview': { env: { DEV: true }, href: 'http://127.0.0.1:5178/?engine=unreal', stage: 'UnrealGrapplingStage', clips: false, moments: false },
  };
  for (const [visitName, visit] of Object.entries(visits)) {
    for (const [momentId, title] of [['match_win', 'Match won'], ['match_loss', 'Match lost']]) {
      for (const technique of [true, false]) {
        const label = `${visitName}, ${momentId}, ${technique ? 'the final exchange has a technique clip' : 'no technique clip'}`;
        const url = new URL(visit.href);
        globalThis.window = { location: { href: url.href, search: url.search }, history: { state: null, replaceState() {} } };
        globalThis.__componentEnv = visit.env;
        globalThis.__published = [...STANCE_VIEWS, `${momentId}/fighter-side`, `${momentId}/fighter-front`, ...(technique ? DOUBLE_LEG : [])];
        const runner = globalThis.__hookRunner = createHookRunner();
        const told = [];
        const onMomentDone = (...args) => told.push({ args, whileRendering: runner.rendering });
        // "Final exchange": what a finished match shows without a moment.
        const exchange = runner.render(GrapplingStage, finishedProps({ onMomentDone }));
        const usualClip = findElement(exchange, named('UnrealClipStage'));
        assert.equal(usualClip?.props.kind, technique && visit.clips ? 'technique' : undefined, label);
        const stage = (root) => (visit.stage === 'the position picture' ? PICTURE : findElement(root, named(visit.stage)));
        assert.deepEqual(told, [], label);

        // "Match result": the moment, over that same picture.
        const result = runner.render(GrapplingStage, finishedProps({ momentId, onMomentDone }));
        const moment = findElement(result, (node) => node.props?.kind === 'moment');
        if (!visit.moments) {
          assert.equal(moment, null, `${label}: never over the local live preview`);
          assert.deepEqual(stage(result).props, stage(exchange).props, label);
          assert.deepEqual(told, [{ args: [momentId], whileRendering: false }], label);
          continue;
        }
        assert.deepEqual([moment.props.key, moment.props.moveId, moment.props.moveLabel, moment.props.holdLastFrame, moment.props.camera, moment.props.backdrop, moment.props.onDone], [`moment:${momentId}:double-leg-takedown-8-1`, momentId, title, true, undefined, undefined, onMomentDone], label);
        // One stage is drawn, and the final exchange waits under it exactly as it would show.
        assert.equal(findElement(result, (node) => node !== moment && named('UnrealClipStage')(node) && node.props.kind !== 'moment'), null, label);
        const under = moment.props.fallback;
        if (usualClip) {
          assert.deepEqual({ ...under.props, fallback: undefined }, { ...usualClip.props, fallback: undefined }, label);
          if (stage(under.props.fallback) !== PICTURE) assert.deepEqual(stage(under.props.fallback).props, engineProps(finishedProps()), label);
        } else if (visit.stage === 'the position picture') {
          assert.equal(under, PICTURE, label);
        } else {
          assert.deepEqual([under.type.name, under.props], [visit.stage, engineProps(finishedProps())], `${label}: the engine stage gets the props it always got`);
        }
        assert.deepEqual(told, [], label);
        // Back to "Final exchange": the same tree as before the moment was asked for.
        const again = runner.render(GrapplingStage, finishedProps({ onMomentDone }));
        assert.equal(findElement(again, (node) => node.props?.kind === 'moment'), null, label);
        assert.deepEqual(findElement(again, named('UnrealClipStage'))?.props.kind, usualClip?.props.kind, label);
      }
    }
  }
  // An end-of-match moment is not shown over an unsettled standing position, an unpublished one is
  // not shown at all, and an id that is no moment is refused. Each is said once.
  release();
  for (const [name, props, list] of [
    ['asked for while the stance loop shows', idleProps({ momentId: 'match_win' }), [...STANCE_VIEWS, 'match_win/fighter-side']],
    ['not published', finishedProps({ momentId: 'match_loss' }), [...STANCE_VIEWS, 'match_win/fighter-side']],
    ['only its front view is published', finishedProps({ momentId: 'match_win' }), [...STANCE_VIEWS, 'match_win/fighter-front']],
    ['not a moment', finishedProps({ momentId: 'double_leg' }), [...STANCE_VIEWS, 'double_leg/fighter-side', 'double_leg/opponent-side']],
  ]) {
    globalThis.__published = list;
    const runner = globalThis.__hookRunner = createHookRunner();
    const told = [];
    const tree = runner.render(GrapplingStage, { ...props, onMomentDone: (...args) => told.push(args) });
    assert.equal(findElement(tree, (node) => node.props?.kind === 'moment'), null, name);
    assert.deepEqual(told, [[props.momentId]], name);
  }
});

test('GrapplingStage draws a match moment by these lines, and Training asks for none', () => {
  const stage = source('src/components/GrapplingStage.jsx');
  assert.match(stage, /import \{ MATCH_GREETING, MATCH_MOMENT_TITLES, findMatchMoment, isMatchMoment, prefersReducedMotion \} from '\.\.\/unreal\/matchMoments\.js';/);
  // The greeting only where the stance loop would show and motion is allowed; the end of a match
  // only once the athletes have settled. A loop the player paused is greeted like any other.
  assert.match(stage, /const greeting = momentId === MATCH_GREETING;/);
  assert.match(stage, /const momentFits = isMatchMoment\(momentId\) && engine !== 'unreal' && \(greeting \? Boolean\(idleClip\) && !prefersReducedMotion\(\) : !idleStanding\);/);
  // The view the loop is showing is worked out once: the chosen view where this loop has it, else
  // its side view. The greeting opens on that view, and the end of a match on its own.
  assert.match(stage, /const loopView = idleClip \? \(stanceCamera && findUnrealClip\(idle\.moveId, idle\.performerSide, stanceCamera\)\) \|\| idleClip : null;/);
  assert.match(stage, /const moment = momentFits \? findMatchMoment\(momentId, greeting \? loopView\.camera : undefined\) : null;/);
  assert.equal(stage.match(/\bstanceCamera\b/g).length, 5, 'declared, tested for the reset, read twice for the loop\'s view and handed to the loop: the greeting never reads the choice itself');
  // The greeting passes; the end of a match holds its last frame. Only the greeting gets a still
  // behind it: the stance loop's poster, in the view the loop is showing.
  assert.match(stage, /kind="moment" moveId=\{moment\.moveId\} moveLabel=\{MATCH_MOMENT_TITLES\[moment\.moveId\]\} holdLastFrame=\{!greeting\} camera=\{greeting \? moment\.camera : undefined\} backdrop=\{greeting \? loopView\.poster : undefined\} fighter=\{props\.fighter\} opponent=\{props\.opponent\} onDone=\{onMomentDone\} fallback=\{usual\} \/>/);
  // The still is trimmed as the video is, and only a match moment's box can have one.
  const css = source('src/components/UnrealClipStage.css');
  assert.match(css, /\.unreal-clip-stage\.is-moment \.unreal-clip-viewport \{\s+background-position: 50% 70%;\s+background-repeat: no-repeat;\s+background-size: cover;\s+\}/);
  assert.match(css, /\.unreal-clip-viewport video \{[^}]*object-fit: cover;[^}]*object-position: 50% 70%;[^}]*\}/);
  assert.equal(css.match(/background-size:/g).length, 1);
  assert.match(source('src/components/UnrealClipStage.jsx'), /<div ref=\{viewportRef\} className="unreal-clip-viewport" style=\{\{ '--clip-ratio': `\$\{clip\.width\} \/ \$\{clip\.height\}`, backgroundImage: backdrop \? `url\("\$\{backdrop\}"\)` : undefined \}\}>/);
  assert.equal(source('src/components/UnrealClipStage.jsx').match(/backgroundImage/g).length, 1, 'the stance loop and the technique clip have no still behind them');
  // A moment that cannot be shown is reported after the render.
  assert.match(stage, /const momentMissing = Boolean\(momentId\) && !moment;\r?\n {2}useEffect\(\(\) => \{\r?\n {4}if \(momentMissing\) onMomentDone\?\.\(momentId\);\r?\n {2}\}, \[momentMissing, momentId\]\);/);
  // The stance loop's view, and whether it was paused, are kept only while the loop, or the
  // greeting in its place, shows.
  assert.match(stage, /if \(!idleClip && stanceCamera !== null\) setStanceCamera\(null\);\r?\n {2}if \(!idleClip && stancePlays !== null\) setStancePlays\(null\);/);
  assert.match(stage, /<UnrealClipStage key="stance" [^>]* camera=\{stanceCamera\} onCameraChange=\{setStanceCamera\} wantsPlay=\{stancePlays\} onWantsPlayChange=\{setStancePlays\} [^>]*\/>/);
  // Training shows techniques, not matches.
  const training = source('src/App.jsx').split(/\r?\n/).find((line) => line.includes('<GrapplingStage '));
  assert.doesNotMatch(training, /moment/i);
});

// ---- The Arena (src/components/CombatArenaView.jsx), run outside React ----

const loadArena = () => loadComponent('src/components/CombatArenaView.jsx', {
  react: STAND_IN_REACT,
  'lucide-react': asModule('export const ArrowDown = () => null, ArrowUp = () => null, BookOpen = () => null, Check = () => null, Play = () => null, RotateCcw = () => null, Shield = () => null, Swords = () => null, Trophy = () => null;'),
  './TechniqueText.js': asModule('export const TechniqueStep = () => null;'),
  '../data/curriculum.js': repoModule('src/data/curriculum.js'),
  '../arena/outcome.js': repoModule('src/arena/outcome.js'),
  './GrapplingSnapshotStage.jsx': standInComponent('GrapplingSnapshotStage'),
  './GrapplingStage.jsx': standInComponent('GrapplingStage'),
  './StancePicker.jsx': standInComponent('StancePicker'),
  './UnrealAthlete.jsx': standInComponent('UnrealAthlete'),
  '../unity/bridge.js': repoModule('src/unity/bridge.js'),
  '../unreal/athlete.js': repoModule('src/unreal/athlete.js'),
  '../unreal/matchMoments.js': momentsInThatList,
  '../unreal/stances.js': repoModule('src/unreal/stances.js'),
  '../unreal/techniqueIds.js': repoModule('src/unreal/techniqueIds.js'),
});
const RIVAL = Object.freeze({ id: 'npc-ryu', name: 'Ryu Tanaka', belt: 'white', stripes: 0, giTop: '#112a58', giPants: '#f8fbff', stance: 'karate stance' });
// The match state App.jsx holds once a match has finished (createCombatState and resolveCombatTurn).
const finishedMatch = (playerWins, animationSignal) => {
  const move = allMoves.find((item) => item.id === (playerWins ? 'guillotine-choke' : 'protect-position'));
  return {
    npc: RIVAL, active: false, phase: 'finished', ...createArenaState('standing'), round: 1, startPosition: 'standing', selectedMoveId: null, order: [], secondsLeft: 10,
    playerExchanges: playerWins ? 1 : 0, npcExchanges: playerWins ? 0 : 1, playerPoints: 0, npcPoints: 0, bestPlayer: null, bestNpc: null,
    result: {
      round: 1, playerWins, actorIsPlayer: playerWins, matchPlayerWins: playerWins, finished: true, outcome: 'submission', techniqueName: move.name,
      headline: `${playerWins ? 'Clipper' : RIVAL.name} wins by submission with ${move.name}`, line: 'The exchange is settled.', move, startedFrom: 'standing', animationSignal, animationSucceeded: true,
    },
    greeting: false, resultView: null, log: [],
  };
};

test('the picture chosen for a finished match is kept with the match: it still shows after the player leaves the Arena and comes back', async (t) => {
  useGlobals(t, { window: undefined, document: { activeElement: null, body: null }, __hookRunner: undefined, __published: undefined });
  const { default: CombatArenaView } = await loadArena();
  globalThis.__published = [...STANCE_VIEWS, 'match_win/fighter-side', 'match_win/fighter-front', 'match_loss/fighter-side'];
  // The match lives outside the Arena screen, in App. A screen is one mounting of the Arena over
  // it: leaving the Arena throws the screen and all its own state away, and coming back makes a new one.
  const match = { combat: finishedMatch(true, 'guillotine-choke-1-1') };
  const setCombat = (update) => { match.combat = typeof update === 'function' ? update(match.combat) : update; };
  const openArena = () => {
    const runner = createHookRunner();
    return () => {
      globalThis.__hookRunner = runner;
      return runner.render(CombatArenaView, {
        fighter: { name: 'Clipper', giTop: '#ffffff', giPants: '#ffffff', stance: 'wrestling stance' }, beltStatus: { belt: 'white', stripes: 0 },
        combat: match.combat, setCombat, npcs: [RIVAL], unlockedMoves: [], chooseCombatMove() {}, resolveCombatTurn() {}, startCombat() {}, notify() {}, onTrain() {}, onStanceChange() {},
      });
    };
  };
  const header = (tree) => findElement(tree, (node) => node.props?.className === 'mat-window-header');
  const pressed = (tree) => (header(tree) ? buttons(header(tree)).map((button) => [text(button), button.props['aria-pressed']]) : null);
  const stageOf = (tree) => findElement(tree, named('GrapplingStage'));
  const asked = (tree) => stageOf(tree).props.momentId;
  const press = (tree, label) => buttons(header(tree)).find((button) => text(button) === label).props.onClick();
  const ON_RESULT = [['Match result', true], ['Final exchange', false]];
  const ON_EXCHANGE = [['Match result', false], ['Final exchange', true]];

  // The result arrives. The toggle is there in that very frame, on the match result, and the
  // picture the match opened on is then kept with the match.
  let draw = openArena();
  let tree = draw();
  assert.deepEqual([pressed(tree), asked(tree)], [ON_RESULT, 'match_win']);
  assert.deepEqual(match.combat.resultView, { signal: 'guillotine-choke-1-1', view: 'result' });
  assert.deepEqual([pressed(draw()), asked(draw())], [ON_RESULT, 'match_win']);

  // The player chooses the final exchange.
  press(draw(), 'Final exchange');
  assert.deepEqual(match.combat.resultView, { signal: 'guillotine-choke-1-1', view: 'exchange' });
  tree = draw();
  assert.deepEqual([pressed(tree), asked(tree)], [ON_EXCHANGE, null]);

  // "Open training", then back to the Arena: a new screen over the same match. The choice
  // stands from its first frame, and the match moment is not asked for, so it does not play again.
  draw = openArena();
  tree = draw();
  assert.deepEqual([pressed(tree), asked(tree)], [ON_EXCHANGE, null]);
  assert.deepEqual([pressed(draw()), asked(draw())], [ON_EXCHANGE, null]);
  assert.deepEqual(match.combat.resultView, { signal: 'guillotine-choke-1-1', view: 'exchange' });

  // Chosen back, it is the match result that stands after the next visit.
  press(draw(), 'Match result');
  draw = openArena();
  tree = draw();
  assert.deepEqual([pressed(tree), asked(tree)], [ON_RESULT, 'match_win']);
  // Pressing the choice that already shows changes nothing.
  const kept = match.combat;
  press(draw(), 'Match result');
  assert.equal(match.combat, kept);

  // The stage says the moment cannot be shown: there is nothing to choose, now and after a visit elsewhere.
  stageOf(draw()).props.onMomentDone('match_win');
  assert.deepEqual(match.combat.resultView, { signal: 'guillotine-choke-1-1', view: 'none' });
  for (const screen of [draw, openArena()]) {
    const drawn = screen();
    assert.deepEqual([header(drawn), asked(drawn)], [null, null]);
  }
  assert.equal(match.combat.resultView.view, 'none');
  // Another moment's end, or a greeting's, is not this result's business.
  match.combat = finishedMatch(true, 'guillotine-choke-1-2');
  draw = openArena();
  draw();
  for (const id of ['match_loss', 'match_greeting', 'double_leg', undefined]) stageOf(draw()).props.onMomentDone(id);
  assert.deepEqual(match.combat.resultView, { signal: 'guillotine-choke-1-2', view: 'result' });

  // The stage may say so before the opening picture has been kept (its effect runs before the
  // Arena's). The opening picture, kept afterwards, does not bring the toggle back.
  match.combat = finishedMatch(true, 'guillotine-choke-1-3');
  const early = stageOf(openArena()()).props.onMomentDone;
  match.combat = { ...match.combat, resultView: null };
  early('match_win');
  assert.deepEqual(match.combat.resultView, { signal: 'guillotine-choke-1-3', view: 'none' });
  draw = openArena();
  draw();
  assert.equal(match.combat.resultView.view, 'none');
  assert.equal(header(draw()), null);

  // Reduced motion: a finished match opens on the final exchange, with the toggle there. That is
  // settled once: turning reduced motion off while the result is on screen, or before coming
  // back to it, does not start the clip.
  const motion = motionWindow(true);
  globalThis.window = motion.window;
  match.combat = finishedMatch(false, 'protect-position-8-4');
  draw = openArena();
  tree = draw();
  assert.deepEqual([pressed(tree), asked(tree)], [ON_EXCHANGE, null]);
  assert.deepEqual(match.combat.resultView, { signal: 'protect-position-8-4', view: 'exchange' });
  motion.set(false);
  assert.deepEqual([pressed(draw()), asked(draw())], [ON_EXCHANGE, null]);
  draw = openArena();
  assert.deepEqual([pressed(draw()), asked(draw())], [ON_EXCHANGE, null]);
  // Asked for, it is the loss that shows.
  press(draw(), 'Match result');
  assert.deepEqual([pressed(draw()), asked(draw())], [ON_RESULT, 'match_loss']);
  globalThis.window = undefined;

  // A choice belongs to one result. Whatever was kept for an earlier one, the next finished
  // match opens on its own opening picture.
  match.combat = { ...finishedMatch(true, 'guillotine-choke-1-5'), resultView: { signal: 'protect-position-8-4', view: 'exchange' } };
  draw = openArena();
  tree = draw();
  assert.deepEqual([pressed(tree), asked(tree)], [ON_RESULT, 'match_win']);
  assert.deepEqual(match.combat.resultView, { signal: 'guillotine-choke-1-5', view: 'result' });

  // A new opponent resets the match, and the chosen picture with it.
  press(draw(), 'Final exchange');
  findElement(draw(), (node) => node.type === 'select' && node.props['aria-label'] === 'Choose opponent').props.onChange({ target: { value: RIVAL.id } });
  assert.deepEqual([match.combat.result, match.combat.resultView, match.combat.phase], [null, null, 'idle']);
  tree = draw();
  assert.deepEqual([header(tree), asked(tree)], [null, null]);

  // No toggle, and nothing kept, for a match whose moment is not published, for one whose front
  // view alone is, and for a settled exchange of a match that is still running.
  for (const [name, combat, list] of [
    ['the moment is not published', finishedMatch(false, 'protect-position-8-6'), [...STANCE_VIEWS, 'match_win/fighter-side']],
    ['only its front view is published', finishedMatch(true, 'guillotine-choke-1-7'), [...STANCE_VIEWS, 'match_win/fighter-front']],
    ['the match is still running', { ...finishedMatch(true, 'guillotine-choke-1-8'), active: true, phase: 'result', result: { ...finishedMatch(true, 'guillotine-choke-1-8').result, finished: false, matchPlayerWins: null } }, [...STANCE_VIEWS, 'match_win/fighter-side']],
  ]) {
    globalThis.__published = list;
    match.combat = combat;
    draw = openArena();
    tree = draw();
    assert.deepEqual([header(tree), asked(tree), match.combat.resultView], [null, null, null], name);
    assert.equal(match.combat, combat, `${name}: the match is left as it is`);
  }
});
