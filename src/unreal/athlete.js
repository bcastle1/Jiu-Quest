// The Unreal athlete as tintable still layers. Unreal rendered the same frozen
// frame three times: white gi, black gi, and black gi with a white belt.
// tools/build_unreal_athlete_layers.py turns those aligned renders into four
// layers that the page adds together:
//
//   picture = base + jacket * giTop + pants * giPants + belt * beltColor
//
// base is the black-gi, black-belt render. With every color white the sum gives
// back the white-gi render; every other color is computed, not rendered.
// Nothing here starts a stream or selects the combat renderer.
export const FIGHTER_LOOKS = Object.freeze(['unreal', 'classic']);

// New fighters start as the Unreal athlete.
export const NEW_FIGHTER_LOOK = 'unreal';

// Choices only the classic art can show. The Unreal athlete has one build and
// its own faces, hairstyles and beards (src/unreal/athleteHeadOptions.js), so
// the Fighter Creator hides these while it is selected.
export const CLASSIC_ONLY_CHOICES = Object.freeze(['gender', 'skinTone', 'hairColor', 'hairStyle', 'emblem']);

const ASSET_ROOT = '/assets/unreal-athlete/athlete-01';

export const UNREAL_ATHLETE = Object.freeze({
  id: 'athlete-01',
  view: 'front',
  width: 900,
  height: 1760,
  layers: Object.freeze({
    base: `${ASSET_ROOT}/front-base.webp`,
    jacket: `${ASSET_ROOT}/front-jacket.webp`,
    pants: `${ASSET_ROOT}/front-pants.webp`,
    belt: `${ASSET_ROOT}/front-belt.webp`,
  }),
  // Head and collar inside the 900 x 1760 layer, for round portraits.
  portrait: Object.freeze({ left: 280, top: 18, size: 300 }),
  // The published layer files. A re-encode or a swapped file fails the tests.
  files: Object.freeze({
    base: Object.freeze({ bytes: 35790, sha256: '6a9e772bc6f11c03917bbae8ffe1380dc7360b976deeeeb8d252d46ad9e7b9c4' }),
    jacket: Object.freeze({ bytes: 16748, sha256: '48b5f1e960723166ffdcff4b5992578a97e487f19f8863b7930c3cf991434269' }),
    pants: Object.freeze({ bytes: 19040, sha256: 'f733d2eef8902f5d2edfddb058d7a0c3cd394018351606a08bfdcb9d7a47895c' }),
    belt: Object.freeze({ bytes: 6614, sha256: '205694e9c4640181278f274710b221de8b5669a7a96038eab79f5163cecb289a' }),
  }),
  // The three Athletic V2 original-face front reference renders used by the layer builder.
  sources: Object.freeze({
    'gi-white.png': '0d313620a258884d4a3e527bd93d217993696df3ed876ba61215b7fa45435887',
    'gi-black.png': '25b27b4777c62fc5554ed2619f64b2d8ee9c50ababc2bea285b4f649e6056570',
    'belt-white.png': 'cfcd6f89f2dd4ebd8952e06c474af890ec98ff00419a9d609ba97ab5e172bd09',
  }),
});

const HEX = /^#[\da-f]{6}$/i;
// Only six-digit hex colors reach a style attribute.
export const safeHexColor = (value, fallback = '#f8fbff') => (typeof value === 'string' && HEX.test(value) ? value.toLowerCase() : fallback);
const safeColor = safeHexColor;

export function normalizeFighterLook(value, fallback = NEW_FIGHTER_LOOK) {
  return FIGHTER_LOOKS.includes(value) ? value : fallback;
}

// The look for a fighter saved before the Unreal athlete existed. A fighter that
// still has the stock face, hair, skin and emblem moves to the new athlete. One
// that had any of them changed keeps the classic art those choices were made
// for, so nobody loses a fighter they designed. A saved look always wins.
export function savedFighterLook(fighter, stock) {
  if (FIGHTER_LOOKS.includes(fighter?.look)) return fighter.look;
  const customized = CLASSIC_ONLY_CHOICES.some((key) => fighter?.[key] != null && fighter[key] !== stock?.[key]);
  return customized ? 'classic' : 'unreal';
}

export function usesUnrealAthlete(fighter) {
  return fighter?.look === 'unreal';
}

// Only six-digit hex colors reach a style attribute. Anything else falls back
// to a white gi and a white belt.
export function unrealAthleteColors(fighter, beltColor) {
  return {
    jacket: safeColor(fighter?.giTop, '#f8fbff'),
    pants: safeColor(fighter?.giPants, '#f8fbff'),
    belt: safeColor(beltColor, '#f8fbff'),
  };
}
