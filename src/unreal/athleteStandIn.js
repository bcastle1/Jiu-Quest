// The player's athlete where the Unreal athlete cannot be shown.
//
// The classic position pictures (src/arena/appearance.js) and the Unity scene
// (src/unity/bridge.js) draw an athlete from the classic appearance fields:
// gender, skin tone, hair color and hairstyle. A player who chose the Unreal
// athlete cannot see or change those fields in the Fighter Creator, so in those
// pictures they are taken from the head chosen there instead: the nearest
// classic value for the face, the hairstyle and the hair color. The beard has
// no classic counterpart.
//
// Nothing is saved: the fighter keeps its own classic fields, and gets them
// back by choosing the Classic look again.
import { usesUnrealAthlete } from './athlete.js';
import { athleteHeadOf } from './athleteHeadOptions.js';

// Both faces are men; the skin tones are the nearest swatches of the classic palette.
const FACE = Object.freeze({
  original: Object.freeze({ gender: 'boy', skinTone: '#d99b71' }),
  dean: Object.freeze({ gender: 'boy', skinTone: '#a86b4d' }),
});

// The nearest classic hairstyle (customizationOptions.hairStyles in src/storage.js).
const HAIR_STYLE = Object.freeze({
  fringe: 'wave cut',
  'skin-fade': 'short fade',
  'coily-fade': 'curly guard',
  'coil-buzz': 'crew cut',
  shaved: 'bald',
});

// The same four colors in the classic hair palette.
const HAIR_COLOR = Object.freeze({ black: '#11131c', brown: '#3b251b', blond: '#d7c09a', grey: '#6b6f86' });

export const ATHLETE_STAND_IN = Object.freeze({ face: FACE, hairStyle: HAIR_STYLE, hairColor: HAIR_COLOR });

// The classic appearance that stands for the head of one fighter.
export function standInAppearance(fighter) {
  const head = athleteHeadOf(fighter);
  return { ...FACE[head.face], hairStyle: HAIR_STYLE[head.hair], hairColor: HAIR_COLOR[head.hairColor] };
}

// The fighter as the classic pictures and the Unity scene should draw it. A
// fighter with the Classic look, an opponent and anything else without the
// Unreal athlete comes back as it is (the same object).
export function classicStandIn(fighter) {
  return usesUnrealAthlete(fighter) ? { ...fighter, ...standInAppearance(fighter) } : fighter;
}
