// Match moments: three short pre-rendered Unreal clips around a match. They
// are not techniques and not stances.
//
//   match_greeting  the two athletes slap hands and bump fists before a match
//                   that starts on the feet; it ends in the standing stance
//   match_win       a short celebration after a match the player won
//   match_loss      a tired, respectful reaction after a match the player lost
//
// Each is rendered once, with the player's athlete as the `fighter`, from the
// side and, if wanted, from the front (<id>/fighter-side.mp4, <id>/fighter-front.mp4).
// Until a moment's clip is published the game shows what it showed before.
// Nothing here starts a stream or selects the combat renderer.
// The ids themselves are in ./matchMomentIds.js, which has no imports, so the
// clip importer can read them without loading the clip list.
import { MATCH_GREETING, MATCH_LOSS, MATCH_MOMENT_IDS, MATCH_MOMENT_PERFORMER, MATCH_WIN, isMatchMoment } from './matchMomentIds.js';
import { findUnrealClip } from './techniqueClips.js';

export { MATCH_GREETING, MATCH_LOSS, MATCH_MOMENT_IDS, MATCH_MOMENT_PERFORMER, MATCH_WIN, isMatchMoment };

// The view a moment opens on, and the one it cannot do without.
export const MATCH_MOMENT_CAMERA = 'side';

// What the stage calls each moment.
export const MATCH_MOMENT_TITLES = Object.freeze({
  [MATCH_GREETING]: 'Match greeting',
  [MATCH_WIN]: 'Match won',
  [MATCH_LOSS]: 'Match lost',
});

// The published clip of a moment. A moment needs its side view: the checks
// that follow a newly published moment run on that view, so a moment whose
// side view is not published is not shown at all, also to someone who asks
// for the front. With the side view published, this is the view asked for
// when that view is published too, otherwise the side view. Null when the id
// is not a moment. A draft is never published (the importer leaves drafts
// out), and one that reached the list anyway is not played.
export function findMatchMoment(id, camera = MATCH_MOMENT_CAMERA, find = findUnrealClip) {
  if (!isMatchMoment(id)) return null;
  const view = (name) => {
    const clip = find(id, MATCH_MOMENT_PERFORMER, name);
    return clip && clip.draft !== true ? clip : null;
  };
  const side = view(MATCH_MOMENT_CAMERA);
  if (!side) return null;
  return camera === MATCH_MOMENT_CAMERA ? side : view(camera) ?? side;
}

// The moment a finished match ends on: the win or the loss, by who won the
// match (`matchPlayerWins`, src/App.jsx). Null while the match is running and
// for a result that does not say who won.
export function matchResultMoment(result) {
  if (result?.finished !== true || typeof result.matchPlayerWins !== 'boolean') return null;
  return result.matchPlayerWins ? MATCH_WIN : MATCH_LOSS;
}

// Whether the person asks for less motion. A moment never starts on its own then.
export function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
}
