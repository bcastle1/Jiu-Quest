// The Unreal athlete as tintable still layers. Unreal rendered the same frame in
// several gi and belt colors; tools/build_unreal_athlete_layers.py turns those
// pixel-aligned captures into four layers that the page adds together:
//
//   picture = base + jacket * giTop + pants * giPants + belt * beltColor
//
// base is the black-gi, black-belt capture. Checked against the real navy
// capture, the same sum lands within about 3 of 255 per channel on the gi.
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
  width: 450,
  height: 880,
  layers: Object.freeze({
    base: `${ASSET_ROOT}/front-base.webp`,
    jacket: `${ASSET_ROOT}/front-jacket.webp`,
    pants: `${ASSET_ROOT}/front-pants.webp`,
    belt: `${ASSET_ROOT}/front-belt.webp`,
  }),
  // Head and collar inside the 450 x 880 layer, for round portraits.
  portrait: Object.freeze({ left: 149, top: 20, size: 150 }),
  // The published layer files. A re-encode or a swapped file fails the tests.
  files: Object.freeze({
    base: Object.freeze({ bytes: 13318, sha256: '9ae7bcb3e829b0b058151a70ba119ad1d0c7efeda7079772ac2e122c63712efd' }),
    jacket: Object.freeze({ bytes: 8112, sha256: 'ffcab4c539e15f99fe7c5a9326861383d61fc6e100485873999b65a1f2848b78' }),
    pants: Object.freeze({ bytes: 7980, sha256: '05a16ff252ed80b431514522b58d75b1aa90142f895f273e27505806e6282bf1' }),
    belt: Object.freeze({ bytes: 2806, sha256: '879a10b37ec7976f8b1b7aaf3b93796c25374570883f96381e8a49ff0b008ad1' }),
  }),
  // The Unreal captures the layers were derived from (Unreal-gi-color-preview).
  sources: Object.freeze({
    'white-front.png': '39566ce057b3b21a65b76cfa97d73af4c4713abf7fbd35cdbd1f55b869150be1',
    'black-front.png': '97c8caaf85b3a86580b9c679860a2d934b258d76432692ef7dd80d3df4ddf090',
    'navy-front.png': '2682e1fbdb4249f91bf84fab4732ad66fccc950e8b516f9b576bc166fb36d280',
    'navy-blue-belt-front.png': '62cdf6e0d1a3c2c52b6049865e81e86a0e38cc37e3839da97f0c0f72e86b9aee',
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
