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

// Choices only the classic art can show. The Unreal athlete has one face, build
// and hairstyle, so the Fighter Creator hides these while it is selected.
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
    base: Object.freeze({ bytes: 57290, sha256: '548aa77231b2e102488bc1b3f1a451e21fbd05827b823a84eb1ec32855bd37d1' }),
    jacket: Object.freeze({ bytes: 20658, sha256: '6c9401f330bb21b4e1f591b3d46b16c12f560f916efc23227ac05315a835f5e7' }),
    pants: Object.freeze({ bytes: 35636, sha256: '9f682459c573f2a0d3b0eb4adfee3938e90edf0af6934eadb7ce3cdd3ce39d10' }),
    belt: Object.freeze({ bytes: 6876, sha256: '168f7d13fd8ea0f3ca19809915e1c86c8e66b8188c0378fc4c07a289f41267f0' }),
  }),
  // The Unreal renders the layers were derived from: Unreal-render-pack,
  // athlete-01/front, the hip-belt variant of the purchased-gi character.
  sources: Object.freeze({
    'gi-white.png': '5204d085df4aa17ba8828c77fc03cdd57b2c0ccbf8bf1ed041e207abf208a8f3',
    'gi-black.png': '86300d214f158de9ab9812e5213710165572993791d3ff7759a278c3bd73f65b',
    'belt-white.png': 'c6e5b37046c4ae52bd23fa066820d407d001eb9056edd16c4cff15801ee955f2',
  }),
});

const HEX = /^#[\da-f]{6}$/i;
const safeColor = (value, fallback) => (typeof value === 'string' && HEX.test(value) ? value.toLowerCase() : fallback);

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
