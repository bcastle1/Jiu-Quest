// Written by tools/build_unreal_athlete_heads.mjs from Unreal renders. Do not edit by hand.
// Where the head pictures of the Unreal athlete are published and how large they are.
// src/unreal/athleteHeads.js names each picture; athleteHeads.pins.js pins every file.
export default Object.freeze({
  renderer: 'Unreal Engine 5.8.4, Movie Render Queue, 64 spatial samples per still',
  baseFaces: Object.freeze(['dean']),
  athlete: Object.freeze({
    width: 900,
    height: 1760,
    folder: '/assets/unreal-athlete/athlete-01/heads',
    headBox: Object.freeze([261, 0, 324, 306]),
    thumbSize: 128,
  }),
  standing: Object.freeze({
    width: 1620,
    height: 1080,
    folder: '/assets/unreal-positions/standing/heads',
    lead: Object.freeze({ headBox: Object.freeze([500, 80, 250, 280]) }),
    other: Object.freeze({ headBox: Object.freeze([880, 40, 250, 280]) }),
  }),
});
