import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { blueBeltGuide } from '../src/data/blueBeltGuide.js';
import { allMoves, moves, beltMoveCount, blueBeltPositionGroups, trainingStartPositions } from '../src/data/curriculum.js';
import { groupTechniques, sequenceSeconds, stepRuns } from '../src/data/techniqueSteps.js';
import { RichText, TechniqueStep } from '../src/components/TechniqueText.js';
import { createFighter, getBeltStatus, getTrainingTotals, isMoveUnlocked } from '../src/storage.js';
import { createArenaState, getPositionForSide, getArenaSnapshot, isArenaCounterApplicable, resolveArenaOutcome } from '../src/arena/outcome.js';
import { resolveUnityMove } from '../src/unity/bridge.js';

const blue = moves.filter((move) => move.belt === 'blue');
const move = (id) => { const found = allMoves.find((item) => item.id === id); assert.ok(found, id); return found; };

test('approved Word guide retains all 36 techniques and 141 source steps with exact text and bold', () => {
  assert.equal(blueBeltGuide.sourceSha256, '1c72bc9fd0d0a31193d043d5ea2b8ece060ea7a3d3b99abfbeb376c32dd78597');
  // Independently compared to the source DOCX. This pins wording, paragraph
  // boundaries, labels, whitespace, and per-character emphasis together.
  assert.equal(createHash('sha256').update(JSON.stringify(blueBeltGuide.techniques)).digest('hex'), '2295538eacaf35296a9af56d62a77b2438e10ae87ec88a9e36a6bcb17aa96ebc');
  assert.equal(blue.length, 36);
  assert.equal(beltMoveCount('blue'), 36);
  assert.equal(blue.reduce((count, technique) => count + technique.steps.length, 0), 141);
  assert.equal(new Set(allMoves.map((technique) => technique.id)).size, allMoves.length);
  for (const technique of blue) {
    assert.doesNotMatch(JSON.stringify(technique), /Lesson\s*\d|BBQD/i);
    assert.equal(new Set(technique.steps).size, technique.steps.length, 'plain step identities are unique within a technique');
    assert.deepEqual(technique.steps, technique.stepDetails.map((step) => step.runs.map((run) => run.text).join('')));
  }
});

test('source variations and irregular numbering are retained without lesson labels', () => {
  assert.equal(move('trap-roll-punch-block').name, 'Trap and Roll Escape punch block variation');
  assert.deepEqual(move('elbow-escape-fish-hook').stepDetails.map((step) => step.label), ['1.', '2.', '3.']);
  assert.deepEqual(move('elbow-escape-heel-drag').stepDetails.map((step) => step.label), ['1.', '2.', '2.']);
  assert.match(move('take-back-guard-head-arm').name, /\(Step 1: Head and Arm Control\)/);
  assert.match(move('take-back-guard-final-getup').name, /\(Step 2: Final Getup\)/);
  assert.match(move('standing-headlock-defense').steps[0], /\[confirm arm wording\]/);
  assert.match(move('take-back-guard-final-getup').steps[1], /tucking tucking/);
  assert.equal(move('headlock-scissors-choke').scenario, '');
});

test('safe rich text renders the original emphasis for learning and shuffled sequences', () => {
  const technique = move('trap-roll-escape');
  const html = renderToStaticMarkup(createElement(TechniqueStep, { move: technique, step: technique.steps[0] }));
  assert.equal(html, '<strong>Trap the opponent&#x27;s wrist</strong> against your chest using a thumbless monkey grip.');
  assert.deepEqual(stepRuns(technique, [...technique.steps].reverse().at(-1)), technique.stepDetails[0].runs);
  const escaped = renderToStaticMarkup(createElement(RichText, { runs: [{ text: '<img src=x onerror=alert(1)>', bold: true }] }));
  assert.equal(escaped, '<strong>&lt;img src=x onerror=alert(1)&gt;</strong>');
  assert.equal(renderToStaticMarkup(createElement(TechniqueStep, { move: move('basic-punch'), step: 'Clench your fist' })), 'Clench your fist');
});

test('each technique appears exactly once under the performing player starting position', () => {
  const groups = groupTechniques(blue, blueBeltPositionGroups);
  assert.equal(groups.flatMap((group) => group.moves).length, 36);
  assert.equal(new Set(groups.flatMap((group) => group.moves.map((technique) => technique.id))).size, 36);
  for (const [id, group] of [['trap-roll-escape', 'mount-bottom'], ['americana-armlock', 'mount-top'], ['kimura-guard', 'guard-bottom'], ['take-back-guard-final-getup', 'side-bottom'], ['headlock-escape-2', 'headlock'], ['standing-headlock-defense', 'standing-headlock'], ['blocking-standing-punch-from-ground', 'open-guard-bottom'], ['double-ankle-sweep', 'open-guard-bottom']]) {
    assert.equal(move(id).startingPositionId, group);
  }
  assert.equal(groupTechniques(moves.filter((technique) => technique.belt === 'purple'), blueBeltPositionGroups)[0].moves.length, 3);
});

test('retired moves and split variants cannot inherit progression or inflate current totals', () => {
  const fighter = createFighter({ progress: { 'mount-positional-control': 50, 'double-underhook-guard-pass': 50, 'take-the-back-guard': 50, 'trap-roll-escape': 5, 'rear-naked-choke': 11 } });
  assert.equal(fighter.progress['take-the-back-guard'], 50, 'archived progress is preserved, not destroyed');
  for (const id of ['mount-positional-control', 'double-underhook-guard-pass', 'take-the-back-guard']) assert.equal(allMoves.some((technique) => technique.id === id), false);
  for (const id of ['take-back-guard-head-arm', 'take-back-guard-final-getup', 'trap-roll-punch-block']) assert.equal(isMoveUnlocked(fighter, move(id)), false);
  assert.equal(getBeltStatus(fighter).learnedBlue, 2);
  assert.equal(getBeltStatus(fighter).blueTotal, 36);
  const clean = createFighter({ progress: { 'trap-roll-escape': 5, 'rear-naked-choke': 11 } });
  assert.deepEqual(getTrainingTotals(fighter), getTrainingTotals(clean));
  const complete = createFighter({ progress: Object.fromEntries(blue.map((technique) => [technique.id, 5])) });
  assert.equal(getBeltStatus(complete).belt, 'blue');
});

test('headlocks, rear clinch, guard-side and standing-over-guard keep inverse roles distinct', () => {
  for (const [position, opposite] of [['standing-headlock', 'standing-headlock-top'], ['rear-clinch', 'rear-clinch-defending'], ['open-guard-bottom', 'open-guard-top'], ['guard-side-bottom', 'guard-side-top']]) {
    const state = createArenaState(position);
    assert.equal(getPositionForSide(state), position);
    assert.equal(getPositionForSide(state, 'opponent'), opposite);
    assert.equal(getArenaSnapshot(state).exactPositionAvailable, false);
  }
  assert.equal(getArenaSnapshot('standing-headlock').key, 'standing');
  assert.equal(isArenaCounterApplicable(move('standing-headlock-defense'), 'headlock', move('protect-position')), false);
  assert.equal(move('headlock-scissors-choke').starts.includes('standing-headlock'), false);
  assert.equal(isArenaCounterApplicable(move('guillotine-defense'), 'guard-top', move('guillotine-choke')), false);
});

test('every replacement technique has a reachable position start for positional rounds', () => {
  for (const technique of blue) {
    assert.ok(trainingStartPositions.some(position => technique.starts.includes(getPositionForSide(createArenaState(position)))), technique.id);
  }
  assert.ok(trainingStartPositions.includes('open-guard-bottom'));
  assert.ok(trainingStartPositions.includes('standing-headlock'));
  assert.ok(trainingStartPositions.includes('guard-side-bottom'));
});

test('split back take follows its intermediate setup before obtaining rear control', () => {
  for (const side of ['fighter', 'opponent']) {
    const initial = createArenaState('guard-bottom', side);
    const setup = resolveArenaOutcome(initial, move('take-back-guard-head-arm'), side);
    assert.equal(getPositionForSide(setup, side), 'guard-side-bottom');
    assert.equal(setup.controlSide, null);
    assert.equal(move('take-back-guard-final-getup').starts.includes(getPositionForSide(setup, side)), true);
    const finish = resolveArenaOutcome(setup, move('take-back-guard-final-getup'), side);
    assert.equal(finish.controlSide, side);
    assert.equal(getPositionForSide(finish, side), 'back-control');
  }
});

test('guide finishes replace former inferred endpoints for both performers', () => {
  for (const side of ['fighter', 'opponent']) {
    for (const id of ['rear-takedown', 'double-ankle-sweep', 'side-mount-to-full-mount']) {
      const technique = move(id);
      assert.equal(getPositionForSide(resolveArenaOutcome(createArenaState(technique.starts[0], side), technique, side), side), 'mount-top');
    }
    const held = createArenaState('standing-headlock', side);
    assert.equal(getPositionForSide(resolveArenaOutcome(held, move('standing-headlock-defense'), side), side), 'mount-top');
  }
});

test('new variations never silently reuse a different technique animation', () => {
  for (const id of ['trap-roll-punch-block', 'elbow-escape-fish-hook', 'armbar-twisting-control', 'take-back-guard-final-getup']) assert.equal(resolveUnityMove(id), null);
  assert.equal(resolveUnityMove('rear-naked-choke'), 'rear_naked_choke');
});

test('full guide sequences get bounded reading time, while basic timers stay unchanged', () => {
  assert.equal(sequenceSeconds(move('basic-punch')), 10);
  for (const technique of blue) assert.ok(sequenceSeconds(technique) >= 20 && sequenceSeconds(technique) <= 120);
  assert.ok(sequenceSeconds(move('trap-roll-punch-block')) > sequenceSeconds(move('rear-naked-choke')));
});
