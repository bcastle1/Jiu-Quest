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
// A technique switches to clips as a whole: only once every performer the game
// can show has at least one accepted view (techniqueClipPerformers). That is
// both performers, or the fighter alone for a technique the rival never
// performs from its clip start. Clips never borrow another move's or the other
// performer's file, and are never mirrored.
//
// One exception: the exact owner-published draft (OWNER_PUBLISHED_DRAFT below)
// plays for its own performer before the technique has switched over; the
// other performer keeps the engine picture.

export const TECHNIQUE_PERFORMERS = Object.freeze(['fighter', 'opponent']);

// The techniques whose opponent clip the game can never show, by clip id, in
// curriculum order. Training plays only the fighter's clip, and the Arena plays
// the opponent's only after the rival wins with the technique from its clip
// start, which the rival never does with these. Each one switches to clips with
// the fighter's views alone. tests/unrealRivalReach.test.js works this list out
// again from the game's own rules and fails when it is stale.
export const FIGHTER_ONLY_CLIP_IDS = Object.freeze([
  // The rival is never in their clip start: under a headlock (Headlock Trap,
  // Defending Standing Headlock) or on its back under a standing player (Open
  // Guard From Bottom).
  'headlock_scissors_choke', 'double_ankle_sweep', 'headlock_escape_2', 'standing_headlock_defense', 'blocking_standing_punch_from_ground', 'hook_sweep',
  // The rival never uses a preview technique (chooseNpcMove in src/App.jsx).
  'purple_omoplata', 'purple_darce', 'purple_x_guard_sweep', 'brown_pressure_pass', 'brown_knee_cut', 'brown_crucifix',
  'black_berimbolo', 'black_leg_drag', 'black_bow_arrow',
]);

const FIGHTER_ONLY = Object.freeze(['fighter']);

// The performers a technique needs a view of before it switches to clips: the
// fighter alone for a technique in FIGHTER_ONLY_CLIP_IDS, both otherwise.
// `clipMoveId` is the clip id, as in the clip list.
export function techniqueClipPerformers(clipMoveId) {
  return FIGHTER_ONLY_CLIP_IDS.includes(clipMoveId) ? FIGHTER_ONLY : TECHNIQUE_PERFORMERS;
}

// The view a technique opens on when the person has not picked one. The rear
// naked choke is read from the front, as the Unity stage showed it.
export const TECHNIQUE_OPENING_CAMERA = Object.freeze({ rear_naked_choke: 'front' });

const ENGINE = Object.freeze({ kind: 'engine' });

// The owner approved the original unfinished take on 2026-11-16 and its
// neck/shoulder appearance refresh on 2026-11-18. These pins identify the refresh.
// The movement remains a draft; this is not choreography acceptance. Further
// renders or another performer/camera need their own publication decision.
// The exception ends when the technique switches over by the normal rule, which
// needs an accepted view of every performer it needs: an accepted fighter take
// imported on its own takes this draft's place without making the technique
// ready (docs/unreal-integration.md, "Owner-published double-leg draft").
export const OWNER_PUBLISHED_DRAFT = Object.freeze({
  moveId: 'double_leg', performerSide: 'fighter', camera: 'side',
  sha256: '7f382d14aba50babfa33d7476d02962adcb1794b2464792c25952d0c368c464a',
  bytes: 595137,
  posterSha256: '10c68614e23cff5ace444ab8341decd052d58c0853d29e179c445e246c876ded',
  posterBytes: 271426,
  ownerDraftPublishedOn: '2026-11-18',
  draftNotice: 'Lunge, forward drive, and grips are still being refined.',
});

export function isOwnerPublishedDraft(clip) {
  return Boolean(clip) && clip.draft === true && clip.choreographyReviewed === false
    && Object.entries(OWNER_PUBLISHED_DRAFT).every(([key, value]) => clip[key] === value)
    && clip.video === '/assets/unreal-clips/double_leg/fighter-side.mp4'
    && clip.poster === '/assets/unreal-clips/double_leg/fighter-side.webp';
}

const engineParam = (search = '') => new URLSearchParams(search).get('engine');

// Every performer the technique needs (techniqueClipPerformers) has at least
// one accepted view of this exact move. `moveId` is the clip id, as in the clip
// list.
export function techniqueClipReady(moveId, views) {
  return Boolean(moveId) && techniqueClipPerformers(moveId).every((side) => views(moveId, side).some((clip) => clip.draft !== true));
}

export function chooseTechniquePicture({ moveId, clipMoveId = moveId, performerSide = 'fighter', engine, search = '', views }) {
  // The local live preview draws every technique itself. A clip never covers it.
  if (engine === 'unreal' || !clipMoveId) return ENGINE;
  // An explicit ?engine=snapshot (position pictures only) or ?engine=unity
  // (keep testing Unity) turns technique clips off for the visit.
  const forced = engineParam(search);
  if (forced === 'snapshot' || forced === 'unity') return ENGINE;
  // Only this exact approved draft can show before bilateral acceptance. The
  // rival keeps its engine fallback; old front/opponent takes are not borrowed.
  const draft = views(clipMoveId, performerSide).find((clip) => isOwnerPublishedDraft(clip)
    && clip.moveId === clipMoveId && clip.performerSide === performerSide);
  if (draft) return Object.freeze({ kind: 'clip', moveId: clipMoveId, performerSide, camera: draft.camera });
  if (!techniqueClipReady(clipMoveId, views)) return ENGINE;
  // The requested performer's own views only: a technique that switched over
  // with the fighter's views alone gives the rival no clip.
  const found = views(clipMoveId, performerSide).filter((clip) => clip.draft !== true);
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
