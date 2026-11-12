// Two-athlete position stills rendered in Unreal Engine, as tintable layers.
// Unreal rendered one frozen frame five times: everything black, then each
// athlete's gi in white, then each athlete's belt in white.
// tools/build_unreal_position_layers.py turns those renders into layers the
// page adds together, each multiplied by a color:
//
//   picture = base + leadJacket * lead.giTop + leadPants * lead.giPants + leadBelt * lead belt
//                  + otherJacket * other.giTop + otherPants * other.giPants + otherBelt * other belt
//
// "lead" is the athlete on top or in control. In a neutral position it is the
// athlete on the left, which is the player. The still is a picture of a
// settled position, never an animation of a technique.
import stills from './positionStills.data.js';
import { safeHexColor } from './athlete.js';

export const UNREAL_POSITION_STILLS = stills;

// Arena snapshot key, for example "standing".
export function findUnrealPositionStill(key) {
  return stills.find((still) => still.position === key) ?? null;
}

// The still for one settled position, or null when the classic picture is the
// better one. A still that shows the exact position always wins. A still that
// is only a general reference replaces a classic picture that is also only a
// general reference, and never one that shows the exact position.
export function chooseUnrealPositionStill(snapshot) {
  const still = findUnrealPositionStill(snapshot?.key);
  if (!still) return null;
  const exact = still.families.includes(snapshot.family);
  return exact || !snapshot.exactPositionAvailable ? { still, exact } : null;
}

// The layers that take a color, in paint order. A still whose gi could not be
// split at the hem has one gi layer per athlete, painted in the jacket color.
const TINTS = Object.freeze([
  ['leadGi', 'lead', 'giTop'], ['leadJacket', 'lead', 'giTop'], ['leadPants', 'lead', 'giPants'], ['leadBelt', 'lead', 'belt'],
  ['otherGi', 'other', 'giTop'], ['otherJacket', 'other', 'giTop'], ['otherPants', 'other', 'giPants'], ['otherBelt', 'other', 'belt'],
]);

export function unrealPositionTints(still, { lead, other, leadBeltColor, otherBeltColor }) {
  const athletes = {
    lead: { giTop: lead?.giTop, giPants: lead?.giPants, belt: leadBeltColor },
    other: { giTop: other?.giTop, giPants: other?.giPants, belt: otherBeltColor },
  };
  return TINTS.filter(([name]) => still.layers[name]).map(([name, athlete, field]) => ({
    name,
    url: still.layers[name],
    color: safeHexColor(athletes[athlete][field]),
  }));
}
