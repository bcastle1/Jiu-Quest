// The ids of the three match moments: short pre-rendered Unreal clips around
// a match. They are not techniques and not stances.
//
//   match_greeting  the two athletes slap hands and bump fists before a match
//                   that starts on the feet; it ends in the standing stance
//   match_win       a short celebration after a match the player won
//   match_loss      a tired, respectful reaction after a match the player lost
//
// This module has no imports. The clip importer (tools/import_unreal_clips.mjs)
// reads the ids from here, so it never loads the clip list it writes and can
// run when that file is missing or broken. What the game does with a moment
// is in ./matchMoments.js, which hands these names on.
export const MATCH_GREETING = 'match_greeting';
export const MATCH_WIN = 'match_win';
export const MATCH_LOSS = 'match_loss';
export const MATCH_MOMENT_IDS = Object.freeze([MATCH_GREETING, MATCH_WIN, MATCH_LOSS]);

// A moment's clips are always the player's athlete's: there is no rival's take.
export const MATCH_MOMENT_PERFORMER = 'fighter';

export function isMatchMoment(id) {
  return MATCH_MOMENT_IDS.includes(id);
}
