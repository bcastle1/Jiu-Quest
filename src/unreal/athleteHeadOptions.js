// The head choices of the Unreal athlete: face, hairstyle, hair colour and beard.
// Plain data and small pure functions, with no imports, so that the site, the
// tests and tools/build_unreal_athlete_heads.mjs all read the same list.
//
// Every combination is a picture rendered in Unreal Engine: the published
// athlete with another head on the same body, in the same pose, light and camera.
// The faces are the athlete of the first renders ("Standard") and the MetaHuman
// preset "Dean" from Fab, built on the athlete's body. The hairstyles are the
// two purchased grooms (buzz cut with a skin fade, short coily buzz cut with a
// low shadow fade), Dean's own coil buzz cut and the first athlete's side-swept
// fringe, both from the MetaHuman library, and a shaved head. The beard is the
// stubble beard and moustache Dean comes with.

// `base` is the combination a face's base picture shows; every other
// combination of that face is a small picture laid over its head. `detail` is
// a line under the name on the button: the first face is the one every clip
// shows, whatever a player chose.
export const ATHLETE_FACES = Object.freeze([
  Object.freeze({ id: 'original', label: 'Standard', detail: 'As in the clips', base: Object.freeze({ hair: 'fringe', hairColor: 'black', beard: 'none' }) }),
  Object.freeze({ id: 'dean', label: 'Dean', base: Object.freeze({ hair: 'coil-buzz', hairColor: 'black', beard: 'stubble' }) }),
]);

export const ATHLETE_HAIRS = Object.freeze([
  Object.freeze({ id: 'fringe', label: 'Side-swept fringe' }),
  Object.freeze({ id: 'skin-fade', label: 'Buzz cut, skin fade' }),
  Object.freeze({ id: 'coily-fade', label: 'Short coily, low fade' }),
  Object.freeze({ id: 'coil-buzz', label: 'Coil buzz cut' }),
  Object.freeze({ id: 'shaved', label: 'Shaved' }),
]);

// `swatch` is the colour of the button, not a value the renderer used.
export const ATHLETE_HAIR_COLORS = Object.freeze([
  Object.freeze({ id: 'black', label: 'Black', swatch: '#17151a' }),
  Object.freeze({ id: 'brown', label: 'Brown', swatch: '#4a3122' }),
  Object.freeze({ id: 'blond', label: 'Blond', swatch: '#c9a567' }),
  Object.freeze({ id: 'grey', label: 'Grey', swatch: '#8f9197' }),
]);

export const ATHLETE_BEARDS = Object.freeze([
  Object.freeze({ id: 'none', label: 'Clean-shaven' }),
  Object.freeze({ id: 'stubble', label: 'Stubble' }),
]);

// A new fighter, and every fighter saved before these choices existed, is the
// athlete exactly as published before them.
export const DEFAULT_ATHLETE_HEAD = Object.freeze({ face: 'original', hair: 'fringe', hairColor: 'black', beard: 'none' });

// The fighter fields that hold the choices, in the order of the picture key.
export const ATHLETE_HEAD_FIELDS = Object.freeze({ face: 'athleteFace', hair: 'athleteHair', hairColor: 'athleteHairColor', beard: 'athleteBeard' });

const LISTS = Object.freeze({ face: ATHLETE_FACES, hair: ATHLETE_HAIRS, hairColor: ATHLETE_HAIR_COLORS, beard: ATHLETE_BEARDS });
const known = (part, id) => typeof id === 'string' && LISTS[part].some((option) => option.id === id);

// The head of a fighter (or of anything with the four fields): known ids only,
// each unknown or missing one replaced by the default.
export function athleteHeadOf(fighter) {
  const head = {};
  for (const [part, field] of Object.entries(ATHLETE_HEAD_FIELDS)) {
    head[part] = known(part, fighter?.[field]) ? fighter[field] : DEFAULT_ATHLETE_HEAD[part];
  }
  return head;
}

// The same as fighter fields, for saving.
export function athleteHeadFields(fighter) {
  const head = athleteHeadOf(fighter);
  return Object.fromEntries(Object.entries(ATHLETE_HEAD_FIELDS).map(([part, field]) => [field, head[part]]));
}

// A shaved head without a beard has no hair to colour: every hair colour is the
// same picture, filed under black.
export function athleteHeadKey(head) {
  const hairColor = head.hair === 'shaved' && head.beard === 'none' ? 'black' : head.hairColor;
  return `${head.face}/${head.hair}/${hairColor}/${head.beard}`;
}

export function athleteFace(id) {
  return ATHLETE_FACES.find((face) => face.id === id) ?? ATHLETE_FACES[0];
}

// True when the face's base picture already shows this head.
export function isBaseAthleteHead(head) {
  return athleteHeadKey(head) === athleteHeadKey({ face: head.face, ...athleteFace(head.face).base });
}

// Every picture key, in a fixed order: per face, per hairstyle, per colour, per beard.
export function athleteHeadKeys() {
  const keys = [];
  for (const face of ATHLETE_FACES) {
    for (const hair of ATHLETE_HAIRS) {
      for (const color of ATHLETE_HAIR_COLORS) {
        for (const beard of ATHLETE_BEARDS) {
          const key = athleteHeadKey({ face: face.id, hair: hair.id, hairColor: color.id, beard: beard.id });
          if (!keys.includes(key)) keys.push(key);
        }
      }
    }
  }
  return keys;
}

export const isDefaultAthleteHead = (head) => athleteHeadKey(head) === athleteHeadKey(DEFAULT_ATHLETE_HEAD);
