import assert from 'node:assert/strict';
import test from 'node:test';
import { allMoves, moves } from '../src/data/curriculum.js';
import { selectTrainingSession, updateTrainingOrder, updateTrainingResult } from '../src/trainingSession.js';

const move = (id) => {
  const technique = allMoves.find((item) => item.id === id);
  assert.ok(technique, id);
  return technique;
};
const reverse = (steps) => [...steps].reverse();

test('the initial training selection already contains its own complete cards', () => {
  const technique = move('rear-naked-choke');
  const current = selectTrainingSession(null, technique, reverse);
  assert.equal(current.moveId, technique.id);
  assert.deepEqual(current.order, reverse(technique.steps));
  assert.notEqual(current.order, technique.steps);
  assert.equal(current.result, null);
});

test('switching standard trap and roll to punch block replaces four cards with five in the same state', () => {
  const standard = move('trap-roll-escape');
  const variation = move('trap-roll-punch-block');
  const previous = updateTrainingResult(selectTrainingSession(null, standard, reverse), standard.id, { title: 'Clean rep logged.' });
  assert.equal(previous.order.length, 4);
  const current = selectTrainingSession(previous, variation, reverse);
  assert.equal(current.moveId, variation.id);
  assert.equal(current.order.length, 5);
  assert.deepEqual([...current.order].sort(), [...variation.steps].sort());
  assert.equal(current.result, null);
  assert.equal(previous.order.length, 4);
  assert.equal(previous.result.title, 'Clean rep logged.');
});

test('all 36 guide selections immediately have exactly their own cards and no previous result', () => {
  const blue = moves.filter((technique) => technique.belt === 'blue');
  assert.equal(blue.length, 36);
  let current = null;
  for (const technique of blue) {
    current = selectTrainingSession(current, technique, reverse);
    assert.equal(current.moveId, technique.id);
    assert.deepEqual([...current.order].sort(), [...technique.steps].sort(), technique.id);
    assert.equal(current.result, null, technique.id);
    current = updateTrainingResult(current, technique.id, { title: 'Previous feedback' });
  }
});

test('reselecting the current move preserves the edited order and feedback without reshuffling', () => {
  const technique = move('trap-roll-escape');
  let current = selectTrainingSession(null, technique, reverse);
  current = updateTrainingOrder(current, technique.id, (order) => [...order.slice(1), order[0]]);
  current = updateTrainingResult(current, technique.id, { title: 'Try again' });
  assert.equal(selectTrainingSession(current, technique, () => assert.fail('must not reshuffle')), current);
});

test('technique identity resets feedback even when two techniques share every step', () => {
  const first = { id: 'first', steps: ['Shared step'] };
  const second = { id: 'second', steps: ['Shared step'] };
  const previous = updateTrainingResult(selectTrainingSession(null, first, reverse), first.id, { title: 'Old result' });
  assert.deepEqual(selectTrainingSession(previous, second, reverse), { moveId: second.id, order: ['Shared step'], result: null });
});

test('queued card and feedback actions from the old technique cannot affect a new selection', () => {
  const oldMove = move('trap-roll-escape');
  const nextMove = move('trap-roll-punch-block');
  const current = selectTrainingSession(selectTrainingSession(null, oldMove, reverse), nextMove, reverse);
  assert.equal(updateTrainingOrder(current, oldMove.id, () => assert.fail('stale updater must not run')), current);
  assert.equal(updateTrainingOrder(current, oldMove.id, oldMove.steps), current);
  assert.equal(updateTrainingResult(current, oldMove.id, { title: 'Stale result' }), current);
});

test('active reorder and retry keep feedback and selection, and result updates keep the cards', () => {
  const technique = move('trap-roll-escape');
  const result = { title: 'Try again' };
  const initial = selectTrainingSession(null, technique, reverse);
  const feedback = updateTrainingResult(initial, technique.id, result);
  assert.equal(feedback.order, initial.order);
  const reordered = updateTrainingOrder(feedback, technique.id, reverse);
  assert.deepEqual(reordered.order, technique.steps);
  const retry = updateTrainingOrder(reordered, technique.id, reverse(technique.steps));
  assert.equal(retry.moveId, technique.id);
  assert.equal(retry.result, result);
  assert.deepEqual(retry.order, reverse(technique.steps));
  assert.deepEqual(initial.order, reverse(technique.steps));
});
