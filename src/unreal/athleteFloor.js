// The mat under the Unreal athlete on his stage (the Fighter Creator and the
// rank path): the "Japanese Tatami Mats" surface the owner bought on Fab,
// rendered as the athlete's camera sees it by tools/build_unreal_athlete_floor.mjs.
//
// Two pictures, both scaled with the athlete and centred where he stands:
//   picture     the lit floor on black. The stage adds it to its black studio,
//               so it only adds light. It covers the lowest `heightShare` of
//               the athlete's height.
//   silhouette  the athlete's outline in his own 900 by 1760 picture. The floor
//               is cut out there, so the mat lies behind him in any gi.
//
// Only the rendered floor is published. The surface's own maps are not in this
// repository. Nothing here starts a stream or selects the combat renderer.
import floor from './athleteFloor.data.js';

export const UNREAL_ATHLETE_FLOOR = floor;

// The floor is cut out where the outline is: of the outline and a layer that
// covers the whole stage, the stage keeps what only one of them covers.
const CUT_OUT = `url(${floor.silhouette.url}), linear-gradient(#000, #000)`;

// What the stage's floor element carries inline; the rest is in UnrealAthlete.css.
export const UNREAL_ATHLETE_FLOOR_STYLE = Object.freeze({
  '--athlete-floor-share': floor.heightShare,
  backgroundImage: `url(${floor.picture.url})`,
  WebkitMaskImage: CUT_OUT,
  maskImage: CUT_OUT,
});
