import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BELTS, allMoves, blueBeltPositionGroups, moves, positionLabels, starterMoves, trainingStartPositions } from '../src/data/curriculum.js';
import { groupTechniques } from '../src/data/techniqueSteps.js';
import { createArenaState, getPositionForSide, isArenaCounterApplicable, resolveArenaOutcome } from '../src/arena/outcome.js';
import { FIGHTER_ONLY_CLIP_IDS, TECHNIQUE_PERFORMERS, techniqueClipPerformers } from '../src/unreal/techniquePicture.js';
import { resolveArenaClipPlayback, unrealClipMoveId, unrealClipStart } from '../src/unreal/techniqueIds.js';

// Which performers' clips of a technique can the game ever show? Training plays
// only the fighter's clip: the player's athlete performs. The Arena plays a
// clip only after an exchange the technique won from its clip start, performed
// by whoever won it (resolveArenaClipPlayback). So an opponent clip shows only
// after the rival wins with the technique from its clip start.
//
// This file walks every Arena state the game can reach with the game's own
// outcome code (src/arena/outcome.js), its curriculum (src/data) and its rival
// rule (chooseNpcMove, cut from src/App.jsx and run as written there), and works
// FIGHTER_ONLY_CLIP_IDS (src/unreal/techniquePicture.js) out again. The search
// allows more than the game does: it ignores scores and the round limit, the
// player may use any curriculum technique, a rival may have any belt, and
// either side may win any exchange its counter rule allows. So a clip the search
// never asks for is never shown.

const source = (path) => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8');
const app = source('src/App.jsx');
const arenaView = source('src/components/CombatArenaView.jsx');
const appLines = app.split(/\r?\n/);
const clipIdOf = (move) => unrealClipMoveId(move.id);
const ALL_CLIP_IDS = Object.freeze(allMoves.map(clipIdOf));

// chooseNpcMove as src/App.jsx writes it, line for line: the rival's whole
// rule. A change to it fails here, so whoever changes how the rival chooses
// also looks at FIGHTER_ONLY_CLIP_IDS; the search below then says what the list
// has to become.
const RIVAL_RULE = Object.freeze([
  'function chooseNpcMove(npc, position, opposingMove) {',
  '  const known = allMoves.filter((move) => {',
  '    if (move.belt === "white") return true;',
  '    const beltRank = BELTS.indexOf(move.belt);',
  '    const npcRank = BELTS.indexOf(npc.belt);',
  '    return beltRank <= Math.max(1, npcRank + 1) && !move.preview;',
  '  });',
  '  const fitting = known.filter((move) => move.starts.includes(position) && isArenaCounterApplicable(move, { position }, opposingMove));',
  '  return shuffle(fitting)[0] ?? starterMoves.find((move) => move.id === "protect-position");',
  '}',
]);

// The function src/App.jsx defines with this first line, up to its closing
// brace at the start of a line; null when there is none.
function cutFunction(firstLine) {
  const start = appLines.indexOf(firstLine);
  const end = start < 0 ? -1 : appLines.indexOf('}', start);
  return end < 0 ? null : appLines.slice(start, end + 1);
}
const rivalRule = cutFunction(RIVAL_RULE[0]);

// The rival's rule, run as src/App.jsx writes it, with the names it uses bound
// to what App.jsx imports them as (pinned below). App.jsx's `shuffle` puts the
// fitting techniques in a random order, so any of them can come first:
// rivalChoices tries each one first in turn.
let shuffleOrder = (list) => list;
const chooseNpcMove = rivalRule && new Function('allMoves', 'BELTS', 'isArenaCounterApplicable', 'starterMoves', 'shuffle', `${rivalRule.join('\n')}\nreturn chooseNpcMove;`)(allMoves, BELTS, isArenaCounterApplicable, starterMoves, (list) => shuffleOrder(list));

// Every technique chooseNpcMove can return for this rival, in this position,
// against the technique the player chose.
function rivalChoices(npc, position, opposingMove) {
  const chosen = new Set();
  let fitting = 1;
  for (let first = 0; first < fitting; first += 1) {
    shuffleOrder = (list) => { fitting = Math.max(fitting, list.length); return [...list.slice(first), ...list.slice(0, first)]; };
    chosen.add(chooseNpcMove(npc, position, opposingMove));
  }
  shuffleOrder = (list) => list;
  return [...chosen];
}

// Every belt a rival can have. A belt BELTS does not name, or none, ranks like
// white: BELTS.indexOf gives -1.
const RIVAL_BELTS = Object.freeze([...BELTS, undefined]);

// The Arena's offer to the player (CombatArenaView.jsx), pinned below.
const startsFrom = (move, position) => move.id === 'protect-position' || move.starts?.includes(position);

// Every position a match can start from, read from the screens: the Arena's
// start buttons with a fixed position (Standing Start, Kneeling Start), its
// Position Start options, and the start poses a profile can choose, which the
// Overview's Open Arena button starts from.
function matchStarts() {
  const buttons = [...arenaView.matchAll(/\bbegin\(([^()]*)\)/g)].map((match) => match[1]);
  const fixed = buttons.filter((argument) => /^"[a-z-]+"$/.test(argument)).map((argument) => JSON.parse(argument));
  const profile = /value=\{fighter\.startPose\}\r?\n\s*options=\{(\[[^\]]*\])\}/.exec(app);
  return { buttons, fixed, positionStart: [...trainingStartPositions], profile: profile ? JSON.parse(profile[1]) : null };
}

// Every Arena state the game can reach from those starts, and what happens in
// each. The player chooses any curriculum technique the Arena offers from the
// player's position. The rival answers with any technique chooseNpcMove can
// return, for any rival belt. Either side may win, the player only when the
// player's counter applies (resolveCombatTurn). Each win is recorded as the
// Arena records it, and leads on to the state resolveArenaOutcome gives.
function searchArena() {
  const key = (state) => `${state.position}|${state.topSide}|${state.controlSide}`;
  const states = new Map();
  const queue = [];
  const reach = (state) => {
    if (states.has(key(state))) return;
    states.set(key(state), state);
    queue.push(state);
  };
  const { fixed, positionStart, profile } = matchStarts();
  for (const start of new Set([...fixed, ...positionStart, ...(profile ?? [])])) reach(createArenaState(start));
  const rivalPositions = new Set();
  const playerPositions = new Set();
  // For each clip id, the positions the rival was offered that technique in.
  const rivalOffers = new Map();
  // The clips resolveArenaClipPlayback asks for after a win, by performer.
  const asked = Object.fromEntries(TECHNIQUE_PERFORMERS.map((side) => [side, new Set()]));
  const choices = new Map();
  while (queue.length) {
    const state = queue.shift();
    const playerAt = getPositionForSide(state, 'fighter');
    const rivalAt = getPositionForSide(state, 'opponent');
    playerPositions.add(playerAt);
    rivalPositions.add(rivalAt);
    for (const playerMove of allMoves.filter((move) => startsFrom(move, playerAt) && move.starts.includes(playerAt))) {
      for (const belt of RIVAL_BELTS) {
        const choiceKey = `${belt}|${rivalAt}|${playerMove.id}`;
        if (!choices.has(choiceKey)) choices.set(choiceKey, rivalChoices({ belt }, rivalAt, playerMove));
        for (const rivalMove of choices.get(choiceKey)) {
          if (!rivalOffers.has(clipIdOf(rivalMove))) rivalOffers.set(clipIdOf(rivalMove), new Set());
          rivalOffers.get(clipIdOf(rivalMove)).add(rivalAt);
          const playerCounterApplies = isArenaCounterApplicable(playerMove, state, rivalMove, 'fighter');
          for (const exchangePlayerWins of playerCounterApplies ? [true, false] : [false]) {
            const winnerMove = exchangePlayerWins ? playerMove : rivalMove;
            const losingMove = exchangePlayerWins ? rivalMove : playerMove;
            const result = { move: winnerMove, actorIsPlayer: exchangePlayerWins, animationSucceeded: true, startedFrom: getPositionForSide(state, exchangePlayerWins ? 'fighter' : 'opponent') };
            const clip = resolveArenaClipPlayback(result);
            if (clip) asked[clip.performerSide].add(clip.clipMoveId);
            reach(resolveArenaOutcome(state, winnerMove, exchangePlayerWins ? 'fighter' : 'opponent', { opposingMove: losingMove }));
          }
        }
      }
    }
  }
  return { states, playerPositions, rivalPositions, rivalOffers, asked };
}
let searched = null;
const arena = () => (searched ??= searchArena());

// The clip ids whose opponent clip the Arena never asks for, in curriculum
// order: what FIGHTER_ONLY_CLIP_IDS has to be.
const neverAskedOfRival = () => ALL_CLIP_IDS.filter((id) => !arena().asked.opponent.has(id));

test('the rival chooses by chooseNpcMove in src/App.jsx, line for line, and the search runs that very code', () => {
  assert.ok(rivalRule, 'src/App.jsx defines chooseNpcMove(npc, position, opposingMove)');
  assert.deepEqual(rivalRule, [...RIVAL_RULE], 'the rival\'s rule changed: update RIVAL_RULE, then FIGHTER_ONLY_CLIP_IDS as the next tests say');
  assert.equal(appLines.filter((line) => /\bfunction chooseNpcMove\b/.test(line)).length, 1, 'one definition');
  // The rival chooses in one place only: each exchange, from the rival's own
  // side, against the technique the player chose.
  assert.equal(app.match(/\bchooseNpcMove\(/g).length, 2, 'the definition and one call');
  assert.match(app, /const npcPosition = getPositionForSide\(combat, "opponent"\);/);
  assert.match(app, /const playerMoveForTurn = allMoves\.find\(\(move\) => move\.id === combat\.selectedMoveId\);/);
  assert.match(app, /const npcMoveForTurn = chooseNpcMove\(combat\.npc, npcPosition, playerMoveForTurn\);/);
  // The names it uses are the curriculum's and the outcome code's, as imported here.
  const curriculumImport = /^import \{\r?\n((?:  [A-Za-z]+,\r?\n)+)\} from "\.\/data\/curriculum";\r?$/m.exec(app);
  assert.ok(curriculumImport, 'App.jsx imports the curriculum by name');
  const names = curriculumImport[1].split(/,\r?\n/).map((name) => name.trim()).filter(Boolean);
  for (const name of ['allMoves', 'BELTS', 'starterMoves']) assert.ok(names.includes(name), `App.jsx imports ${name} from the curriculum`);
  assert.match(app, /^import \{ createArenaState, getPositionForSide, getArenaPositionLabel, isArenaCounterApplicable, resolveArenaOutcome \} from "\.\/arena\/outcome\.js";\r?$/m);
  for (const name of ['allMoves', 'BELTS', 'starterMoves', 'isArenaCounterApplicable']) {
    assert.doesNotMatch(app, new RegExp(`\\b(?:const|let|var|function) ${name}\\b`), `App.jsx does not define its own ${name}`);
  }
  // shuffle returns every fitting technique in a random order, so any of them can come first.
  assert.deepEqual(cutFunction('function shuffle(list) {'), [
    'function shuffle(list) {',
    '  return [...list]',
    '    .map((item) => ({ item, sort: Math.random() }))',
    '    .sort((a, b) => a.sort - b.sort)',
    '    .map(({ item }) => item);',
    '}',
  ]);

  // The code as run here: what a rival can choose.
  const ids = (list) => list.map((move) => move.id).sort();
  const doubleLeg = allMoves.find((move) => move.id === 'double-leg-takedown');
  // A white belt knows the white and blue techniques; every rival knows Protect Your Position.
  const white = ids(rivalChoices({ belt: 'white' }, 'standing', doubleLeg));
  assert.ok(white.includes('double-leg-takedown') && white.includes('protect-position') && white.includes('basic-kick'), white.join(' '));
  assert.deepEqual(white, ids(allMoves.filter((move) => (move.belt === 'white' || move.belt === 'blue') && move.starts.includes('standing') && isArenaCounterApplicable(move, { position: 'standing' }, doubleLeg))));
  // A rival with no belt the game knows chooses as a white belt does.
  assert.deepEqual(ids(rivalChoices({ belt: undefined }, 'standing', doubleLeg)), white);
  assert.deepEqual(ids(rivalChoices({ belt: 'red' }, 'standing', doubleLeg)), white);
  // No rival ever chooses a preview technique, whatever its belt.
  for (const belt of RIVAL_BELTS) {
    for (const move of allMoves.filter((item) => item.preview)) {
      for (const position of move.starts) {
        assert.ok(!rivalChoices({ belt }, position, doubleLeg).includes(move), `${belt} rival, ${move.id}`);
      }
    }
  }
  // Where nothing fits, the rival protects its position.
  assert.deepEqual(ids(rivalChoices({ belt: 'black' }, 'not a position', doubleLeg)), ['protect-position']);
});

test('every exchange is settled as resolveCombatTurn settles it: the player\'s counter rule, the winner, and the next state from resolveArenaOutcome', () => {
  // The player is offered a technique only where it starts, seen from the player's side.
  assert.match(arenaView, /^function startsFrom\(move, position\) \{\r?\n {2}return move\.id === "protect-position" \|\| move\.starts\?\.includes\(position\);\r?\n\}\r?$/m);
  assert.match(arenaView, /const fittingMoves = learnedMoves\.filter\(\(move\) => startsFrom\(move, position\)\);/);
  assert.match(arenaView, /const position = getPositionForSide\(combat, "fighter"\);/);
  assert.match(app, /if \(!combat\.active \|\| combat\.phase === "ordering" \|\| !move\.starts\.includes\(getPositionForSide\(combat\)\)\) \{/);
  assert.match(app, /if \(!move \|\| !move\.starts\.includes\(getPositionForSide\(current\)\)\) return \{ \.\.\.current, phase: "selecting", selectedMoveId: null \};/);
  // The player wins only where the player's counter applies; then either side can.
  assert.match(app, /const npcMove = npcMoveForTurn;/);
  assert.match(app, /const playerCounterApplies = isArenaCounterApplicable\(move, current, npcMove, "fighter"\);/);
  assert.match(app, /if \(!playerCounterApplies\) playerScore\.total = 0;/);
  assert.match(app, /const exchangePlayerWins = playerCounterApplies && playerScore\.total >= npcScore\.total;/);
  assert.match(app, /const winnerMove = exchangePlayerWins \? move : npcMove;/);
  assert.match(app, /const losingMove = exchangePlayerWins \? npcMove : move;/);
  // The next state, and the result the Arena picks its clip by.
  assert.match(app, /const nextArenaState = resolveArenaOutcome\(current, winnerMove, exchangePlayerWins \? "fighter" : "opponent", \{ opposingMove: losingMove \}\);/);
  const result = /const result = \{(?<body>[\s\S]*?)\n {6}\};/.exec(app)?.groups.body;
  assert.ok(result, 'src/App.jsx builds the exchange result');
  for (const field of ['actorIsPlayer: exchangePlayerWins,', 'move: winnerMove,', 'startedFrom: getPositionForSide(current, exchangePlayerWins ? "fighter" : "opponent"),', 'animationSucceeded: true,']) {
    assert.ok(result.split(/\r?\n/).some((line) => line.trim() === field), field);
  }
  assert.match(app, /\n {8}\.\.\.nextArenaState,\r?\n/);
  // Technique clips play in two places only: Training (the player performs) and
  // the Arena (whoever won the settled exchange performs).
  const stages = Object.fromEntries(readdirSync(fileURLToPath(new URL('../src/components/', import.meta.url))).filter((name) => /\.jsx?$/.test(name)).map((name) => [`src/components/${name}`, source(`src/components/${name}`)]));
  stages['src/App.jsx'] = app;
  const using = Object.entries(stages).filter(([, text]) => /<GrapplingStage\b/.test(text)).map(([path, text]) => [path, text.match(/<GrapplingStage\b/g).length]).sort();
  assert.deepEqual(using, [['src/App.jsx', 1], ['src/components/CombatArenaView.jsx', 1]]);
  assert.deepEqual(Object.entries(stages).filter(([, text]) => /kind="technique"/.test(text) && /<UnrealClipStage\b/.test(text)).map(([path]) => path), ['src/components/GrapplingStage.jsx']);
  const training = appLines.find((line) => line.includes('<GrapplingStage '));
  assert.match(training, /clipMoveId=\{clipMoveId\}/);
  assert.doesNotMatch(training, /[pP]erformerSide/, 'Training names no performer, so the fighter performs');
  assert.match(arenaView, /clipPerformerSide=\{clipPlayback\?\.performerSide\}/);
  assert.match(arenaView, /const clipPlayback = resolveArenaClipPlayback\(combat\.result\);/);
});

test('a match starts from Standing Start, Kneeling Start, any Position Start option or a profile start pose, and from nowhere else', () => {
  const { buttons, fixed, positionStart, profile } = matchStarts();
  // The start buttons: two with a fixed position, and Position Start with the chosen option.
  assert.deepEqual(buttons, ['"standing"', '"kneeling"', 'positionStart']);
  assert.deepEqual(fixed, ['standing', 'kneeling']);
  assert.match(arenaView, /onClick=\{\(\) => begin\("standing"\)\}><Play size=\{15\} \/>Standing Start<\/button>/);
  assert.match(arenaView, /onClick=\{\(\) => begin\("kneeling"\)\}>Kneeling Start<\/button>/);
  assert.match(arenaView, /onClick=\{\(\) => begin\(positionStart\)\}>Position Start<\/button>/);
  assert.match(arenaView, /\{trainingStartPositions\.map\(\(position\) => <option key=\{position\} value=\{position\}>\{getArenaPositionLabel\(position\)\}<\/option>\)\}/);
  assert.match(arenaView, /onChange=\{\(event\) => setPositionStart\(event\.target\.value\)\}/);
  assert.match(arenaView, /const \[positionStart, setPositionStart\] = useState\('mount-bottom'\);/);
  assert.ok(positionStart.includes('mount-bottom'), 'the Position Start choice begins on one of its options');
  // Every start goes through startCombat, which sets the state from the start position.
  assert.match(arenaView, /const begin = \(startPosition\) => \{\r?\n {4}startCombat\(opponent, startPosition\);/);
  // Restart match starts again from where this match started.
  assert.match(arenaView, /const startPosition = createArenaState\(combat\.startPosition\)\.position;\r?\n {4}startCombat\(opponent, startPosition\);/);
  assert.deepEqual([...arenaView.matchAll(/\bstartCombat\(([^()]*)\)/g)].map((match) => match[1]), ['opponent, startPosition', 'opponent, startPosition']);
  assert.match(app, /const startCombat = \(npc = combat\.npc, startPosition = fighter\.startPose\) => \{/);
  assert.match(app, /\n {6}\.\.\.createArenaState\(startPosition\),\r?\n {6}startPosition,\r?\n/);
  // The Overview's Open Arena button starts from the profile's start pose, one of the profile's options.
  assert.deepEqual([...app.matchAll(/\bstartCombat\(([^()]*)\)/g)].map((match) => match[1]), ['npcs[0], fighter.startPose']);
  assert.deepEqual(profile, ['standing', 'kneeling']);
  assert.match(app, /label="Start position"\r?\n\s+value=\{fighter\.startPose\}\r?\n\s+options=\{\["standing", "kneeling"\]\}\r?\n\s+onChange=\{\(startPose\) => updateFighter\(\{ startPose \}\)\}/);
  assert.match(source('src/storage.js'), /startPose: overrides\.startPose \?\? "standing",/);
  // So the search starts from these, the Position Start options in the curriculum's order.
  assert.deepEqual([...new Set([...fixed, ...positionStart, ...profile])], ['standing', 'kneeling', ...trainingStartPositions.filter((position) => !['standing', 'kneeling'].includes(position))]);
});

test('FIGHTER_ONLY_CLIP_IDS is exactly the techniques the rival never performs from their clip start, in curriculum order', (t) => {
  const { states, playerPositions, rivalPositions, rivalOffers, asked } = arena();
  const never = neverAskedOfRival();
  const listed = [...FIGHTER_ONLY_CLIP_IDS];
  assert.deepEqual(listed, never, [
    'FIGHTER_ONLY_CLIP_IDS in src/unreal/techniquePicture.js is stale.',
    `Add: ${never.filter((id) => !listed.includes(id)).join(', ') || 'none'}.`,
    `Remove: ${listed.filter((id) => !never.includes(id)).join(', ') || 'none'}.`,
    `It should be, in curriculum order: ${never.join(', ')}.`,
  ].join(' '));
  // The same list in the words of the rule: the rival "performs a technique from
  // its clip start" when some state the game reaches puts the rival at the
  // technique's clip start with the technique offered to it.
  const performedByRival = ALL_CLIP_IDS.filter((id, index) => rivalOffers.get(id)?.has(unrealClipStart(allMoves[index])));
  assert.deepEqual(performedByRival, ALL_CLIP_IDS.filter((id) => asked.opponent.has(id)));
  assert.deepEqual(ALL_CLIP_IDS.filter((id) => !performedByRival.includes(id)), listed);
  // Nothing outside the curriculum is asked for.
  for (const side of TECHNIQUE_PERFORMERS) for (const id of asked[side]) assert.ok(ALL_CLIP_IDS.includes(id), id);
  t.diagnostic(`Arena states the game can reach: ${states.size}. The player's positions: ${[...playerPositions].sort().join(', ')}.`);
  t.diagnostic(`The rival's positions: ${[...rivalPositions].sort().join(', ')}.`);
  t.diagnostic(`Opponent clips the Arena can ask for: ${asked.opponent.size} of ${ALL_CLIP_IDS.length}. Fighter only: ${listed.length} (${listed.join(', ')}).`);
});

test('each fighter-only technique is a preview, which the rival never uses, or starts its clip where the rival never is', (t) => {
  const { rivalPositions, rivalOffers } = arena();
  const reasons = { preview: [], position: [] };
  for (const id of FIGHTER_ONLY_CLIP_IDS) {
    const move = allMoves[ALL_CLIP_IDS.indexOf(id)];
    assert.ok(move, `${id} is a curriculum technique's clip id`);
    const start = unrealClipStart(move);
    if (move.preview) {
      // chooseNpcMove leaves out every preview technique, for every rival belt.
      assert.equal(rivalOffers.has(id), false, `the rival is never offered the preview ${id}, anywhere`);
      reasons.preview.push(id);
      t.diagnostic(`${id}: The rival never uses preview techniques.`);
    } else {
      assert.equal(rivalPositions.has(start), false, `${id}: the rival is never in ${start}`);
      reasons.position.push(id);
      t.diagnostic(`${id}: The rival is never in ${positionLabels[start]} (${start}) in the game.`);
    }
  }
  // Every preview technique is fighter only.
  assert.deepEqual(allMoves.filter((move) => move.preview).map(clipIdOf), reasons.preview);
  assert.equal(reasons.preview.length + reasons.position.length, FIGHTER_ONLY_CLIP_IDS.length);
  // Today the others start under a headlock or on the back under a standing
  // opponent: the player is never on top in those positions.
  assert.deepEqual([...new Set(reasons.position.map((id) => unrealClipStart(allMoves[ALL_CLIP_IDS.indexOf(id)])))].sort(), ['headlock', 'open-guard-bottom', 'standing-headlock']);
  for (const position of ['headlock-top', 'open-guard-top', 'standing-headlock-top']) assert.equal(arena().playerPositions.has(position), false, position);
});

test('techniqueClipPerformers asks for the fighter alone for exactly those techniques, and for both performers for every other one', () => {
  const never = new Set(neverAskedOfRival());
  for (const id of ALL_CLIP_IDS) {
    const performers = techniqueClipPerformers(id);
    assert.ok(Object.isFrozen(performers), id);
    if (never.has(id)) assert.deepEqual([...performers], ['fighter'], id);
    else assert.equal(performers, TECHNIQUE_PERFORMERS, id);
    // Only performers the game can show are asked for: the fighter always, the rival where it performs the technique.
    for (const side of performers) assert.ok(side === 'fighter' || arena().asked.opponent.has(id), `${id}: ${side}`);
  }
});

test('every technique\'s fighter clip can be seen: Training lists it, or the player wins with it from its clip start in the Arena', (t) => {
  // Training lists the techniques of the belt tab chosen, blue to black belt,
  // grouped by starting position, and plays the one opened.
  assert.match(app, /const beltMoves = useMemo\(\r?\n {4}\(\) => moves\.filter\(\(move\) => move\.belt === selectedBelt\),/);
  assert.match(app, /\{BELTS\.slice\(1\)\.map\(\(belt\) => \(/);
  assert.match(app, /const techniqueGroups = groupTechniques\(beltMoves, blueBeltPositionGroups\);/);
  assert.match(app, /\{group\.moves\.map\(\(move\) => \{/);
  assert.match(app, /onClick=\{\(\) => setSelectedMoveId\(move\.id\)\}/);
  assert.match(app, /\(\) => allMoves\.find\(\(move\) => move\.id === selectedMoveId\) \?\? moves\[0\],/);
  assert.match(app, /const clipMoveId = unrealClipMoveId\(selectedMove\.id\);/);
  const listed = new Set(BELTS.slice(1).flatMap((belt) => groupTechniques(moves.filter((move) => move.belt === belt), blueBeltPositionGroups).flatMap((group) => group.moves)).map(clipIdOf));
  const wonByPlayer = arena().asked.fighter;
  const unseen = ALL_CLIP_IDS.filter((id) => !listed.has(id) && !wonByPlayer.has(id));
  assert.deepEqual(unseen, [], `fighter clips no player can ever see: ${unseen.join(', ')}`);
  // The white-belt starters are not listed in Training: their fighter clips play only in the Arena.
  const arenaOnly = ALL_CLIP_IDS.filter((id) => !listed.has(id));
  assert.deepEqual(arenaOnly, starterMoves.map(clipIdOf));
  t.diagnostic(`Training lists ${listed.size} of ${ALL_CLIP_IDS.length} techniques. The player's Arena wins from the clip start can show ${wonByPlayer.size}. Only in the Arena: ${arenaOnly.join(', ')}.`);
  const notInArena = ALL_CLIP_IDS.filter((id) => !wonByPlayer.has(id));
  if (notInArena.length) t.diagnostic(`Fighter clips shown only in Training (the player never wins with them from their clip start in the Arena): ${notInArena.join(', ')}.`);
});
