// Plain text remains the scoring identity; formatting never changes step order.
export function stepRuns(move, step) {
  const index = move.steps.indexOf(step);
  return move.stepDetails?.[index]?.runs ?? [{ text: step, bold: false }];
}

export function groupTechniques(techniques, groups) {
  if (!techniques.some((move) => move.startingPositionId)) {
    return [{ id: 'all', label: '', moves: techniques }];
  }
  return groups.map((group) => ({ ...group, moves: techniques.filter((move) => move.startingPositionId === group.id) }))
    .filter((group) => group.moves.length);
}

// Full guide paragraphs need time to read as well as reorder. Basic moves retain
// their existing timer; guide techniques get about 200 words/minute plus moves.
export function sequenceSeconds(move) {
  if (!move?.stepDetails) return 10;
  const words = move.steps.join(' ').trim().split(/\s+/).length;
  return Math.min(120, Math.max(20, Math.ceil(words * 0.3 + move.steps.length * 2)));
}
