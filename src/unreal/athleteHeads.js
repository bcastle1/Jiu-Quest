// The head a player chose for the Unreal athlete (face, hairstyle, hair colour,
// beard), as pictures. The choices are in athleteHeadOptions.js. The pictures
// are written by tools/build_unreal_athlete_heads.mjs, which also writes
// athleteHeads.data.js (where they are and how large) and athleteHeads.pins.js
// (the size and SHA-256 of every file, read by the tests and never by the page).
//
// Every choice is an Unreal render of the published athlete with another head.
// The page shows it as the picture it already shows, with these changes:
//
//   base    the published base for the first face; for any other face a base
//           picture of its own (another skin also shows on hands, feet and chest)
//   jacket  the published jacket layer for the first face; for any other face a
//           jacket layer of its own, which differs beside the neck only (another
//           neck uncovers and covers other parts of the collar)
//   head    a small picture laid over the head, when the choice is not the one
//           the face's base shows
//
// The pants and belt layers are the published ones, and all layers are added on
// top as before, so gi colours work the same for every head. Nothing here starts
// a stream or selects the combat renderer.
import data from './athleteHeads.data.js';
import { UNREAL_ATHLETE } from './athlete.js';
import { ATHLETE_FACES, ATHLETE_HAIRS, athleteFace, athleteHeadKey, athleteHeadOf, isBaseAthleteHead } from './athleteHeadOptions.js';

export const ATHLETE_HEADS = data;
const PUBLISHED_FACE = ATHLETE_FACES[0].id;
const { athlete, standing } = data;
const fileKey = (key) => key.replaceAll('/', '-');
// A face other than the published one needs a base picture and a jacket layer of its own.
const hasBase = (face) => face === PUBLISHED_FACE || data.baseFaces.includes(face);
// The jacket layer of each place in a standing still.
const JACKET_LAYER = Object.freeze({ lead: 'leadJacket', other: 'otherJacket' });

// Where each picture is published. A head is named by its key, face/hair/colour/beard.
export const athleteBaseUrl = (face) => (face === PUBLISHED_FACE ? UNREAL_ATHLETE.layers.base : `${athlete.folder}/base-${face}.webp`);
export const athleteJacketUrl = (face) => (face === PUBLISHED_FACE ? UNREAL_ATHLETE.layers.jacket : `${athlete.folder}/jacket-${face}.webp`);
export const athleteHeadUrl = (key) => `${athlete.folder}/${fileKey(key)}.webp`;
export const standingBaseUrl = (still, role, face) => (face === PUBLISHED_FACE ? still.layers.base : `${standing.folder}/${role}-base-${face}.webp`);
export const standingJacketUrl = (still, role, face) => (face === PUBLISHED_FACE ? still.layers[JACKET_LAYER[role]] : `${standing.folder}/${role}-jacket-${face}.webp`);
export const standingHeadUrl = (role, key) => `${standing.folder}/${role}-${fileKey(key)}.webp`;

// The small picture of a face with a hairstyle, for the Fighter Creator's buttons.
export function athleteHeadThumb(face, hair) {
  const known = ATHLETE_FACES.some((option) => option.id === face) && ATHLETE_HAIRS.some((option) => option.id === hair);
  return known ? `${athlete.folder}/thumb-${face}-${hair}.webp` : null;
}

// A box in picture pixels as CSS percentages of the picture.
function placed(url, box, width, height) {
  const [left, top, boxWidth, boxHeight] = box;
  return {
    url,
    style: {
      left: `${(left / width) * 100}%`,
      top: `${(top / height) * 100}%`,
      width: `${(boxWidth / width) * 100}%`,
      height: `${(boxHeight / height) * 100}%`,
    },
  };
}

// The athlete as published before a player could choose a head.
export const PUBLISHED_ATHLETE_PICTURE = Object.freeze({ key: null, baseKey: null, base: UNREAL_ATHLETE.layers.base, jacket: UNREAL_ATHLETE.layers.jacket, head: null });

// The front-view athlete of one fighter: the base picture, the jacket layer that
// fits its neck and, when the head is not the one that base shows, the picture
// laid over it. `key` names the choice; `baseKey` names the choice the base
// picture shows by itself, which is what stays if the head picture cannot load.
export function athleteHeadPicture(fighter) {
  const head = athleteHeadOf(fighter);
  // A face without a published base shows the published athlete, never a wrong head.
  if (!hasBase(head.face)) return PUBLISHED_ATHLETE_PICTURE;
  const key = athleteHeadKey(head);
  return {
    key,
    baseKey: athleteHeadKey({ face: head.face, ...athleteFace(head.face).base }),
    base: athleteBaseUrl(head.face),
    jacket: athleteJacketUrl(head.face),
    head: isBaseAthleteHead(head) ? null : placed(athleteHeadUrl(key), athlete.headBox, athlete.width, athlete.height),
  };
}

// The standing still of two athletes. `lead` and `other` are the fighters in
// those places; an opponent has no head choices and is the published athlete.
// Returns the base picture, the layers that replace published ones (the jacket
// layer of an athlete with another face) and the pictures laid over each chosen
// head.
//
// One athlete at a time can have another face: a base exists for another face on
// the lead or on the other athlete, not on both. With two such faces the lead's
// is shown and the other athlete keeps the published one.
export function standingHeadPictures(still, { lead, other }) {
  const heads = { lead: athleteHeadOf(lead), other: athleteHeadOf(other) };
  let base = still.layers.base;
  const layers = {};
  const faces = { lead: PUBLISHED_FACE, other: PUBLISHED_FACE };
  for (const role of ['lead', 'other']) {
    const face = heads[role].face;
    if (face === PUBLISHED_FACE || !hasBase(face)) continue;
    base = standingBaseUrl(still, role, face);
    layers[JACKET_LAYER[role]] = standingJacketUrl(still, role, face);
    faces[role] = face;
    break;
  }
  const pictures = [];
  for (const role of ['lead', 'other']) {
    // An athlete whose face the base does not show keeps the base's head as it is.
    if (faces[role] !== heads[role].face || isBaseAthleteHead(heads[role])) continue;
    pictures.push({ role, ...placed(standingHeadUrl(role, athleteHeadKey(heads[role])), standing[role].headBox, standing.width, standing.height) });
  }
  return { key: [base, ...pictures.map((picture) => picture.url)].join('|'), base, layers, heads: pictures };
}
