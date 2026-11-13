import test from 'node:test';
import assert from 'node:assert/strict';
import { TECHNIQUE_OPENING_CAMERA, TECHNIQUE_PERFORMERS, chooseTechniquePicture, techniqueClipReady, techniqueMoves } from '../src/unreal/techniquePicture.js';
import { unrealClipViews } from '../src/unreal/techniqueClips.js';

// A fake finder over a list of `move/performer-camera` names, in the same
// button order as unrealClipViews (side before front).
const fakeViews = (...names) => {
  const clips = names.map((name) => {
    const [moveId, rest] = name.split('/');
    const [performerSide, camera] = rest.split('-');
    return Object.freeze({ moveId, performerSide, camera });
  });
  return (moveId, performerSide = 'fighter') => ['side', 'front']
    .map((camera) => clips.find((clip) => clip.moveId === moveId && clip.performerSide === performerSide && clip.camera === camera))
    .filter(Boolean);
};

const both = fakeViews('double_leg/fighter-side', 'double_leg/fighter-front', 'double_leg/opponent-side', 'double_leg/opponent-front');
const releaseDefault = { engine: 'unity', search: '' };

test('the two performers and the opening view are fixed', () => {
  assert.deepEqual([...TECHNIQUE_PERFORMERS], ['fighter', 'opponent']);
  assert.ok(Object.isFrozen(TECHNIQUE_PERFORMERS));
  assert.deepEqual({ ...TECHNIQUE_OPENING_CAMERA }, { rear_naked_choke: 'front' });
  assert.ok(Object.isFrozen(TECHNIQUE_OPENING_CAMERA));
});

test('fighter files alone switch nothing, in Training or in the Arena, for either performer', () => {
  const views = fakeViews('double_leg/fighter-side', 'double_leg/fighter-front');
  assert.equal(techniqueClipReady('double_leg', views), false);
  for (const engine of ['unity', 'snapshot']) {
    // Training: performerSide defaults to the fighter.
    assert.deepEqual(chooseTechniquePicture({ moveId: 'double_leg', engine, views }), { kind: 'engine' });
    // Arena: whoever won the exchange performs.
    for (const performerSide of TECHNIQUE_PERFORMERS) {
      assert.deepEqual(chooseTechniquePicture({ moveId: 'double_leg', performerSide, engine, views }), { kind: 'engine' });
    }
  }
});

test('with both performers ready, each gets a clip of their own performance', () => {
  assert.equal(techniqueClipReady('double_leg', both), true);
  for (const performerSide of TECHNIQUE_PERFORMERS) {
    const picture = chooseTechniquePicture({ moveId: 'double_leg', performerSide, ...releaseDefault, views: both });
    assert.deepEqual(picture, { kind: 'clip', moveId: 'double_leg', performerSide, camera: 'side' });
    assert.ok(Object.isFrozen(picture));
  }
  // Training passes no performer: the player performs.
  assert.equal(chooseTechniquePicture({ moveId: 'double_leg', ...releaseDefault, views: both }).performerSide, 'fighter');
});

test('the rival never gets the player clip', () => {
  const asked = [];
  const views = (moveId, side) => { asked.push(side); return both(moveId, side); };
  const picture = chooseTechniquePicture({ moveId: 'double_leg', performerSide: 'opponent', ...releaseDefault, views });
  assert.equal(picture.performerSide, 'opponent');
  assert.equal(asked.at(-1), 'opponent');
  // A performer with no files of its own gets no clip, even when the move is ready.
  assert.deepEqual(chooseTechniquePicture({ moveId: 'double_leg', performerSide: 'referee', ...releaseDefault, views: both }), { kind: 'engine' });
});

test('another move files are never used', () => {
  for (const moveId of ['rear_naked_choke', 'triangle_choke', 'trap_roll_escape']) {
    assert.equal(techniqueClipReady(moveId, both), false);
    for (const performerSide of TECHNIQUE_PERFORMERS) {
      assert.deepEqual(chooseTechniquePicture({ moveId, performerSide, ...releaseDefault, views: both }), { kind: 'engine' });
    }
  }
});

test('a technique with front views only counts as ready', () => {
  const views = fakeViews('triangle_choke/fighter-front', 'triangle_choke/opponent-front');
  assert.equal(techniqueClipReady('triangle_choke', views), true);
  assert.deepEqual(chooseTechniquePicture({ moveId: 'triangle_choke', performerSide: 'opponent', ...releaseDefault, views }), { kind: 'clip', moveId: 'triangle_choke', performerSide: 'opponent', camera: 'front' });
});

test('the rear naked choke opens on the front view when there is one, and on the side when not', () => {
  const withFront = fakeViews('rear_naked_choke/fighter-side', 'rear_naked_choke/fighter-front', 'rear_naked_choke/opponent-side', 'rear_naked_choke/opponent-front');
  const sideOnly = fakeViews('rear_naked_choke/fighter-side', 'rear_naked_choke/opponent-side');
  for (const performerSide of TECHNIQUE_PERFORMERS) {
    assert.equal(chooseTechniquePicture({ moveId: 'rear_naked_choke', performerSide, ...releaseDefault, views: withFront }).camera, 'front');
    assert.equal(chooseTechniquePicture({ moveId: 'rear_naked_choke', performerSide, ...releaseDefault, views: sideOnly }).camera, 'side');
  }
  // Other moves open on the first view in button order.
  assert.equal(chooseTechniquePicture({ moveId: 'double_leg', ...releaseDefault, views: both }).camera, 'side');
});

test('an explicit ?engine=snapshot or ?engine=unity keeps clips off; the release default plays them', () => {
  for (const search of ['?engine=snapshot', '?engine=unity', 'engine=snapshot', '?tab=train&engine=unity']) {
    for (const engine of ['unity', 'snapshot']) {
      assert.deepEqual(chooseTechniquePicture({ moveId: 'double_leg', engine, search, views: both }), { kind: 'engine' }, `${engine} ${search}`);
    }
  }
  assert.equal(chooseTechniquePicture({ moveId: 'double_leg', engine: 'unity', search: '', views: both }).kind, 'clip');
  // No engine configured at all (pnpm dev, pnpm build, Vercel): clips still play.
  assert.equal(chooseTechniquePicture({ moveId: 'double_leg', engine: 'snapshot', views: both }).kind, 'clip');
  assert.equal(chooseTechniquePicture({ moveId: 'double_leg', engine: 'snapshot', search: '?seed=4', views: both }).kind, 'clip');
});

test('the local live Unreal preview never shows a clip', () => {
  assert.deepEqual(chooseTechniquePicture({ moveId: 'double_leg', engine: 'unreal', search: '?engine=unreal', views: both }), { kind: 'engine' });
  assert.deepEqual(chooseTechniquePicture({ moveId: 'double_leg', performerSide: 'opponent', engine: 'unreal', views: both }), { kind: 'engine' });
});

test('a missing move gives the engine picture and never asks for files', () => {
  const views = () => { throw new Error('asked for files without a move'); };
  for (const moveId of [undefined, null, '']) {
    assert.deepEqual(chooseTechniquePicture({ moveId, ...releaseDefault, views }), { kind: 'engine' });
    assert.equal(techniqueClipReady(moveId, views), false);
  }
});

test('Training heading: moving for a clip or a mapped Unity move, still otherwise', () => {
  const none = fakeViews();
  // A clip.
  assert.equal(techniqueMoves({ engine: 'snapshot', moveId: 'double_leg', search: '', views: both }), true);
  assert.equal(techniqueMoves({ engine: 'unity', moveId: 'double_leg', search: '', views: both }), true);
  // Unity with a mapped move and no clip.
  assert.equal(techniqueMoves({ engine: 'unity', moveId: 'rear_naked_choke', search: '', views: none }), true);
  assert.equal(techniqueMoves({ engine: 'unity', moveId: 'rear_naked_choke', search: '?engine=unity', views: both }), true);
  // The local live preview with a mapped move.
  assert.equal(techniqueMoves({ engine: 'unreal', moveId: 'double_leg', search: '?engine=unreal', views: both }), true);
  // An unmapped move (resolveUnityMove gave nothing).
  for (const engine of ['unity', 'unreal', 'snapshot']) {
    assert.equal(techniqueMoves({ engine, moveId: undefined, search: '', views: both }), false, engine);
  }
  // No clip and no animating engine.
  assert.equal(techniqueMoves({ engine: 'snapshot', moveId: 'rear_naked_choke', search: '', views: none }), false);
  // ?engine=snapshot turns it off, even where a clip exists.
  assert.equal(techniqueMoves({ engine: 'snapshot', moveId: 'double_leg', search: '?engine=snapshot', views: both }), false);
  assert.equal(techniqueMoves({ engine: 'unity', moveId: 'rear_naked_choke', search: '?engine=snapshot', views: none }), false);
});

// Coverage report: every `pnpm test` shows which techniques play Unreal clips.
// A technique switches over only with both performers; one performer alone is
// allowed in the files (an import in progress) but changes nothing on screen.
test('coverage: which of the four techniques have Unreal clips for each performer', (t) => {
  const TECHNIQUES = ['double_leg', 'rear_naked_choke', 'triangle_choke', 'trap_roll_escape'];
  for (const moveId of TECHNIQUES) {
    const sides = TECHNIQUE_PERFORMERS.map((side) => `${side}: ${unrealClipViews(moveId, side).map((clip) => clip.camera).join('+') || 'none'}`);
    const ready = techniqueClipReady(moveId, unrealClipViews);
    t.diagnostic(`${moveId}: ${sides.join(', ')} -> ${ready ? 'plays Unreal clips' : 'plays as before (Unity on the release build)'}`);
    // A fighter-only import is allowed (spec 2.2), so a technique with one
    // performer is reported, not failed; it must simply not switch over.
    const sidesWithClips = TECHNIQUE_PERFORMERS.filter((side) => unrealClipViews(moveId, side).length > 0);
    if (sidesWithClips.length === 1) t.diagnostic(`${moveId}: only ${sidesWithClips[0]} has clips, so it keeps playing as before`);
    assert.equal(ready, sidesWithClips.length === TECHNIQUE_PERFORMERS.length, `${moveId} switches over only with both performers`);
    const picture = chooseTechniquePicture({ moveId, engine: 'unity', search: '', views: unrealClipViews });
    assert.equal(picture.kind, ready ? 'clip' : 'engine', `${moveId} on the release default`);
  }
});
