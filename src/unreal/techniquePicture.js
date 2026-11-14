// The one rule that chooses the picture for a technique, in Training and for a
// settled exchange in the Arena. Pure, no imports: the caller passes what it
// knows, including `views`, the finder for a move's published camera views
// (normally `unrealClipViews` from ./techniqueClips.js).
//
// A technique goes by two ids. `moveId` is the engine's: the move Unity or the
// local live preview animates, and nothing when the engine has no animation
// for the technique. `clipMoveId` is the Unreal clip id, which every curriculum
// technique has (`unrealClipMoveId` in ./techniqueIds.js). A clip is looked up
// by `clipMoveId` only. A caller that passes no `clipMoveId` gets `moveId` as
// the clip id; one that passes null or '' gets no clip.
//
//   { kind: 'clip', moveId, performerSide, camera }
//       a pre-rendered Unreal clip of this exact move and this exact performer;
//       `moveId` is the clip id, as in the clip list
//   { kind: 'engine' }
//       whatever plays today: the Unity player on the release build, the local
//       live Unreal preview on a developer's machine, the position picture
//       elsewhere
//
// A technique switches to clips as a whole: only once both performers have at
// least one accepted view. Clips never borrow another move's or the other
// performer's file, and are never mirrored.

export const TECHNIQUE_PERFORMERS = Object.freeze(['fighter', 'opponent']);

// The view a technique opens on when the person has not picked one. The rear
// naked choke is read from the front, as the Unity stage showed it.
export const TECHNIQUE_OPENING_CAMERA = Object.freeze({ rear_naked_choke: 'front' });

const ENGINE = Object.freeze({ kind: 'engine' });

const engineParam = (search = '') => new URLSearchParams(search).get('engine');

// Both performers have at least one accepted view of this exact move. `moveId`
// is the clip id, as in the clip list.
export function techniqueClipReady(moveId, views) {
  return Boolean(moveId) && TECHNIQUE_PERFORMERS.every((side) => views(moveId, side).length > 0);
}

export function chooseTechniquePicture({ moveId, clipMoveId = moveId, performerSide = 'fighter', engine, search = '', views }) {
  // The local live preview draws every technique itself. A clip never covers it.
  if (engine === 'unreal' || !clipMoveId) return ENGINE;
  // An explicit ?engine=snapshot (position pictures only) or ?engine=unity
  // (keep testing Unity) turns technique clips off for the visit.
  const forced = engineParam(search);
  if (forced === 'snapshot' || forced === 'unity') return ENGINE;
  if (!techniqueClipReady(clipMoveId, views)) return ENGINE;
  const found = views(clipMoveId, performerSide);
  if (!found.length) return ENGINE; // e.g. performerSide 'referee'
  const camera = (found.find((clip) => clip.camera === TECHNIQUE_OPENING_CAMERA[clipMoveId]) ?? found[0]).camera;
  return Object.freeze({ kind: 'clip', moveId: clipMoveId, performerSide, camera });
}

// Training's heading: true when the technique itself will be shown moving, as
// a clip or by an engine that animates its `moveId`.
export function techniqueMoves({ engine, moveId, clipMoveId = moveId, search = '', views }) {
  if (chooseTechniquePicture({ moveId, clipMoveId, engine, search, views }).kind === 'clip') return true;
  return Boolean(moveId) && (engine === 'unity' || engine === 'unreal') && engineParam(search) !== 'snapshot';
}
