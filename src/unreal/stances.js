// The fighting stances a player can pick, and the pre-rendered Unreal clip that
// shows each one on the feet. A stance is where a standing animation begins.
//
// Clips are named by stance id (see docs/unreal-stances.md):
//   standing_stance   both athletes in the wrestling stance. Every technique
//                     that starts on the feet starts from this pose.
//   stance_<id>       one athlete holds the named stance, the other the
//                     wrestling stance. `performerSide` says which one.
//   enter_<id>        that athlete settling from the named stance into the
//                     wrestling stance, so a technique clip can follow it.
// A stance whose clip Unreal has not rendered yet falls back to the standard
// one. Nothing here starts a stream or selects the combat renderer.
import pictures from './stancePictures.data.js';
import { findUnrealClip } from './techniqueClips.js';

export const DEFAULT_STANCE = 'wrestling stance';
export const STANDARD_STANCE_MOVE = 'standing_stance';

const IDS = Object.freeze({
  'wrestling stance': 'wrestling',
  'sumo base': 'sumo',
  'boxer shell': 'boxing',
  'karate stance': 'karate',
  'muay thai guard': 'muay_thai',
  'sambo crouch': 'sambo',
  'capoeira rhythm': 'capoeira',
});

// What each stance is for, in a few words. The Profile and the Arena both show it.
export const stanceCopy = Object.freeze({
  'wrestling stance': 'low hips, forward pressure',
  'sumo base': 'wide base, heavy center',
  'boxer shell': 'hands high, sharp angle',
  'karate stance': 'long range, quick entry',
  'muay thai guard': 'upright clinch threat',
  'sambo crouch': 'low hooks, takedown chain',
  'capoeira rhythm': 'mobile feints, spinning lane',
});

const titleCase = (text) => text.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());

// In the picker's order. The pictures are illustrations of the Unreal athlete.
export const UNREAL_STANCES = Object.freeze(pictures.map((picture) => {
  const id = IDS[picture.stance];
  const standard = picture.stance === DEFAULT_STANCE;
  return Object.freeze({
    stance: picture.stance,
    id,
    label: titleCase(picture.stance),
    copy: stanceCopy[picture.stance],
    picture: picture.src,
    width: picture.width,
    height: picture.height,
    loopMoveId: standard ? STANDARD_STANCE_MOVE : `stance_${id}`,
    entryMoveId: standard ? null : `enter_${id}`,
  });
}));

export function findStance(stance) {
  return UNREAL_STANCES.find((item) => item.stance === stance) ?? UNREAL_STANCES.find((item) => item.stance === DEFAULT_STANCE);
}

// The clip to loop while both athletes are on their feet.
//   moveId, performerSide  which clip to play
//   stance                 the player's stance, as asked for
//   exact                  true when the clip shows the player in that stance
// The player's own stance comes first. A rival's stance is shown only when the
// player is in the standard one, because a clip holds one named stance.
export function stanceLoop(fighterStance, opponentStance, find = findUnrealClip) {
  const mine = findStance(fighterStance);
  const theirs = findStance(opponentStance);
  const standard = { moveId: STANDARD_STANCE_MOVE, performerSide: 'fighter', stance: mine.stance, exact: mine.stance === DEFAULT_STANCE };
  if (mine.stance !== DEFAULT_STANCE) {
    return find(mine.loopMoveId, 'fighter') ? { moveId: mine.loopMoveId, performerSide: 'fighter', stance: mine.stance, exact: true } : standard;
  }
  if (theirs.stance !== DEFAULT_STANCE && find(theirs.loopMoveId, 'opponent')) {
    return { moveId: theirs.loopMoveId, performerSide: 'opponent', stance: mine.stance, exact: true };
  }
  return standard;
}

// The clip that takes the player from their stance into the standard one before
// a technique that starts on the feet. Null when none is needed or none exists.
export function stanceEntry(fighterStance, camera, find = findUnrealClip) {
  const mine = findStance(fighterStance);
  return mine.entryMoveId ? find(mine.entryMoveId, 'fighter', camera) ?? null : null;
}
