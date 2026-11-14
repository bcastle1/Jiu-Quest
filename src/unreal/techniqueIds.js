// The Unreal clip id of a curriculum technique: the folder its clip files are
// published in (<clip id>/<performer>-<camera>.mp4) and the `moveId` its clips
// carry in the clip list. Every curriculum technique has one, so every
// technique can take clips. Pure: the Unity move table is the only import, and
// nothing here reads the curriculum.
//
//   - A technique Unity animates keeps the id Unity gave it:
//     'double-leg-takedown' is 'double_leg'.
//   - Every other technique is its curriculum id with each '-' written as '_':
//     'americana-armlock' is 'americana_armlock', 'headlock-escape-2' is
//     'headlock_escape_2'.
//
// Having a clip id does not mean a clip exists. What is shown is still decided
// by the picture rule (./techniquePicture.js) from the published clip list.
import { resolveUnityMove } from '../unity/bridge.js';

// Null for anything that is not a non-empty string.
export function unrealClipMoveId(curriculumMoveId) {
  if (typeof curriculumMoveId !== 'string' || curriculumMoveId === '') return null;
  return resolveUnityMove(curriculumMoveId) ?? curriculumMoveId.replaceAll('-', '_');
}

// The position a technique's clips are rendered from, its clip start: the first
// of the positions it starts in (`move.starts[0]`). Null when the move names no
// start.
export function unrealClipStart(move) {
  const start = Array.isArray(move?.starts) ? move.starts[0] : undefined;
  return typeof start === 'string' && start !== '' ? start : null;
}

// The clip a settled Arena exchange asks for: the technique that won it,
// performed by whoever won it, when the exchange started from that technique's
// clip start. `startedFrom` is the position the exchange started in, seen from
// the winner's side (src/App.jsx). A technique that starts in more than one
// position plays its clip only after its clip start. After another start, and
// for a result that does not say where it started, the exchange shows what it
// shows without clips. The other conditions are resolveArenaUnityPlayback's,
// for any technique rather than only the ones Unity animates.
export function resolveArenaClipPlayback(result) {
  if (result?.animationSucceeded !== true || typeof result.actorIsPlayer !== 'boolean') return null;
  const start = unrealClipStart(result.move);
  if (start === null || result.startedFrom !== start) return null;
  const clipMoveId = unrealClipMoveId(result.move?.id);
  return clipMoveId === null ? null : { clipMoveId, performerSide: result.actorIsPlayer ? 'fighter' : 'opponent' };
}
