// Keep the selected technique, its cards, and its feedback in one transition.
export function selectTrainingSession(current, move, shuffle) {
  if (current?.moveId === move.id) return current;
  return { moveId: move.id, order: shuffle(move.steps), result: null };
}

export function updateTrainingOrder(current, moveId, update) {
  if (current.moveId !== moveId) return current;
  return {
    ...current,
    order: typeof update === 'function' ? update(current.order) : update,
  };
}

export function updateTrainingResult(current, moveId, result) {
  if (current.moveId !== moveId) return current;
  return { ...current, result };
}
