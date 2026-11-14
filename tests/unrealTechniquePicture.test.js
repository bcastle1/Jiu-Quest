import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { allMoves } from '../src/data/curriculum.js';
import { resolveArenaUnityPlayback, resolveUnityMove } from '../src/unity/bridge.js';
import { UNREAL_STANCES } from '../src/unreal/stances.js';
import { TECHNIQUE_OPENING_CAMERA, TECHNIQUE_PERFORMERS, chooseTechniquePicture, techniqueClipReady, techniqueMoves } from '../src/unreal/techniquePicture.js';
import { UNREAL_CLIPS, unrealClipViews } from '../src/unreal/techniqueClips.js';
import { resolveArenaClipPlayback, unrealClipMoveId } from '../src/unreal/techniqueIds.js';

const source = (path) => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8');

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

// A technique Unity does not animate. The engine has no move id for it: Training
// passes null (resolveUnityMove) and the Arena passes nothing. It has a clip id
// like every other technique: 'kimura-guard' is 'kimura_guard'.
const kimura = fakeViews('kimura_guard/fighter-side', 'kimura_guard/fighter-front', 'kimura_guard/opponent-side', 'kimura_guard/opponent-front');
const noEngineMove = [null, undefined];

// Side and front views, for both performers, of each clip id given.
const fullViews = (...clipMoveIds) => fakeViews(...clipMoveIds.flatMap((id) => [`${id}/fighter-side`, `${id}/fighter-front`, `${id}/opponent-side`, `${id}/opponent-front`]));

// The next three say in plain functions what the components do. A test further
// down pins the source lines they repeat, so they cannot drift apart unnoticed.
// What GrapplingStage asks the rule, given its props (src/components/GrapplingStage.jsx).
const stagePicture = ({ moveId, performerSide, clipMoveId, clipPerformerSide }, engine, search, views) => chooseTechniquePicture({ moveId, clipMoveId: clipMoveId === undefined ? moveId : clipMoveId, performerSide: clipPerformerSide ?? performerSide, engine, search, views });
// The props Training gives the stage for the technique on screen (src/App.jsx).
const trainingProps = (move) => ({ moveId: resolveUnityMove(move.id), clipMoveId: unrealClipMoveId(move.id) });
// The props the Arena gives it for a settled exchange (src/components/CombatArenaView.jsx).
const arenaProps = (result) => {
  const unityPlayback = resolveArenaUnityPlayback(result);
  const clipPlayback = resolveArenaClipPlayback(result);
  return { moveId: unityPlayback?.moveId, performerSide: unityPlayback?.performerSide, clipMoveId: clipPlayback ? clipPlayback.clipMoveId : null, clipPerformerSide: clipPlayback?.performerSide };
};

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

test('the picture rule imports nothing: it reads neither the curriculum nor the clip list', () => {
  const rule = source('src/unreal/techniquePicture.js');
  assert.deepEqual([...rule.matchAll(/^import (?:[^'"]* from )?['"]([^'"]+)['"];?$/gm)].map((match) => match[1]), []);
  assert.doesNotMatch(rule, /\bimport\s*\(|\brequire\s*\(/);
});

test('a technique the engine cannot animate plays its clips once both performers have views of its clip id', () => {
  assert.equal(techniqueClipReady('kimura_guard', kimura), true);
  for (const moveId of noEngineMove) {
    for (const performerSide of TECHNIQUE_PERFORMERS) {
      const picture = chooseTechniquePicture({ moveId, clipMoveId: 'kimura_guard', performerSide, ...releaseDefault, views: kimura });
      // The clip result carries the clip id: the id the clip stage finds its files by.
      assert.deepEqual(picture, { kind: 'clip', moveId: 'kimura_guard', performerSide, camera: 'side' });
      assert.ok(Object.isFrozen(picture));
    }
    // Training passes no performer: the player performs.
    assert.equal(chooseTechniquePicture({ moveId, clipMoveId: 'kimura_guard', ...releaseDefault, views: kimura }).performerSide, 'fighter');
    // No engine configured at all (pnpm dev, pnpm build, Vercel): the clip still plays.
    assert.equal(chooseTechniquePicture({ moveId, clipMoveId: 'kimura_guard', engine: 'snapshot', views: kimura }).kind, 'clip');
    assert.equal(chooseTechniquePicture({ moveId, clipMoveId: 'kimura_guard', engine: 'snapshot', search: '?seed=4', views: kimura }).kind, 'clip');
  }
});

test('such a technique stays on the engine picture until both performers have views of its own clip id', () => {
  const lists = {
    'no clip at all': fakeViews(),
    'the player only': fakeViews('kimura_guard/fighter-side', 'kimura_guard/fighter-front'),
    'the rival only': fakeViews('kimura_guard/opponent-side', 'kimura_guard/opponent-front'),
    'another technique only': both,
  };
  for (const [name, views] of Object.entries(lists)) {
    assert.equal(techniqueClipReady('kimura_guard', views), false, name);
    for (const moveId of noEngineMove) {
      for (const engine of ['unity', 'snapshot']) {
        // Training: performerSide defaults to the fighter.
        assert.deepEqual(chooseTechniquePicture({ moveId, clipMoveId: 'kimura_guard', engine, views }), { kind: 'engine' }, `${name}, ${engine}`);
        // Arena: whoever won the exchange performs.
        for (const performerSide of TECHNIQUE_PERFORMERS) {
          assert.deepEqual(chooseTechniquePicture({ moveId, clipMoveId: 'kimura_guard', performerSide, engine, views }), { kind: 'engine' }, `${name}, ${engine}, ${performerSide}`);
        }
      }
    }
  }
  // Its own clips serve no other technique, however close the name.
  for (const clipMoveId of ['americana_armlock', 'kimura', 'kimura_guard_2', 'double_leg']) {
    assert.equal(techniqueClipReady(clipMoveId, kimura), false, clipMoveId);
    for (const performerSide of TECHNIQUE_PERFORMERS) {
      assert.deepEqual(chooseTechniquePicture({ moveId: null, clipMoveId, performerSide, ...releaseDefault, views: kimura }), { kind: 'engine' }, clipMoveId);
    }
  }
  // A performer with no files of its own gets no clip, even when the technique is ready.
  assert.deepEqual(chooseTechniquePicture({ moveId: null, clipMoveId: 'kimura_guard', performerSide: 'referee', ...releaseDefault, views: kimura }), { kind: 'engine' });
});

test('?engine=snapshot, ?engine=unity and the local live preview keep its clips off as well', () => {
  for (const moveId of noEngineMove) {
    for (const performerSide of TECHNIQUE_PERFORMERS) {
      for (const search of ['?engine=snapshot', '?engine=unity', 'engine=snapshot', '?tab=train&engine=unity']) {
        for (const engine of ['unity', 'snapshot']) {
          assert.deepEqual(chooseTechniquePicture({ moveId, clipMoveId: 'kimura_guard', performerSide, engine, search, views: kimura }), { kind: 'engine' }, `${engine} ${search}`);
        }
      }
      // The local live preview draws the picture itself, whatever the address says.
      for (const search of [undefined, '', '?engine=unreal']) {
        assert.deepEqual(chooseTechniquePicture({ moveId, clipMoveId: 'kimura_guard', performerSide, engine: 'unreal', search, views: kimura }), { kind: 'engine' }, `unreal ${search}`);
      }
    }
  }
});

test('files are looked up by the clip id alone, never by the engine move id', () => {
  const asked = [];
  const recording = (views) => (moveId, side) => { asked.push(moveId); return views(moveId, side); };
  // Only a test gives the engine one move and the clip another: for the four
  // techniques Unity animates the two ids are the same.
  const picture = chooseTechniquePicture({ moveId: 'double_leg', clipMoveId: 'kimura_guard', performerSide: 'opponent', ...releaseDefault, views: recording(kimura) });
  assert.deepEqual(picture, { kind: 'clip', moveId: 'kimura_guard', performerSide: 'opponent', camera: 'side' });
  assert.deepEqual([...new Set(asked)], ['kimura_guard']);
  // Clips of the engine's move are not lent to the clip id.
  asked.length = 0;
  assert.deepEqual(chooseTechniquePicture({ moveId: 'double_leg', clipMoveId: 'kimura_guard', ...releaseDefault, views: recording(both) }), { kind: 'engine' });
  assert.deepEqual([...new Set(asked)], ['kimura_guard']);
  // The opening view is the clip id's too.
  const chokes = fullViews('rear_naked_choke', 'kimura_guard');
  assert.equal(chooseTechniquePicture({ moveId: null, clipMoveId: 'rear_naked_choke', ...releaseDefault, views: chokes }).camera, 'front');
  assert.equal(chooseTechniquePicture({ moveId: 'rear_naked_choke', clipMoveId: 'kimura_guard', ...releaseDefault, views: chokes }).camera, 'side');
});

test('a call that names no clip id uses the engine move id as the clip id, as every call did before', () => {
  const calls = [
    { moveId: 'double_leg', ...releaseDefault, views: both },
    { moveId: 'double_leg', performerSide: 'opponent', ...releaseDefault, views: both },
    { moveId: 'double_leg', performerSide: 'referee', ...releaseDefault, views: both },
    { moveId: 'double_leg', engine: 'snapshot', views: both },
    { moveId: 'double_leg', engine: 'snapshot', search: '?engine=snapshot', views: both },
    { moveId: 'double_leg', engine: 'unity', search: '?engine=unity', views: both },
    { moveId: 'double_leg', engine: 'unreal', search: '?engine=unreal', views: both },
    { moveId: 'double_leg', ...releaseDefault, views: fakeViews('double_leg/fighter-side') },
    { moveId: 'rear_naked_choke', ...releaseDefault, views: both },
    { moveId: 'rear_naked_choke', ...releaseDefault, views: fullViews('rear_naked_choke') },
    { moveId: 'kimura_guard', ...releaseDefault, views: kimura },
    { moveId: undefined, ...releaseDefault, views: both },
    { moveId: null, ...releaseDefault, views: both },
    { moveId: '', ...releaseDefault, views: both },
  ];
  for (const call of calls) {
    const named = { ...call, clipMoveId: call.moveId };
    const name = JSON.stringify({ ...call, views: undefined });
    assert.deepEqual(chooseTechniquePicture(call), chooseTechniquePicture(named), name);
    assert.equal(techniqueMoves(call), techniqueMoves(named), name);
    // A clip id left undefined is a clip id not named.
    assert.deepEqual(chooseTechniquePicture({ ...call, clipMoveId: undefined }), chooseTechniquePicture(named), name);
    assert.equal(techniqueMoves({ ...call, clipMoveId: undefined }), techniqueMoves(named), name);
  }
  // What such a call gets is what it got before clip ids existed.
  assert.deepEqual(chooseTechniquePicture({ moveId: 'double_leg', ...releaseDefault, views: both }), { kind: 'clip', moveId: 'double_leg', performerSide: 'fighter', camera: 'side' });
  assert.deepEqual(chooseTechniquePicture({ moveId: 'rear_naked_choke', ...releaseDefault, views: both }), { kind: 'engine' });
  assert.equal(techniqueMoves({ engine: 'snapshot', moveId: 'double_leg', search: '', views: both }), true);
  assert.equal(techniqueMoves({ engine: 'snapshot', moveId: 'rear_naked_choke', search: '', views: both }), false);
});

test('an empty clip id gives the engine picture and never asks for files, whatever the engine can animate', () => {
  const views = () => { throw new Error('asked for files without a clip id'); };
  for (const clipMoveId of [null, '']) {
    for (const moveId of ['double_leg', undefined, null, '']) {
      for (const performerSide of [undefined, ...TECHNIQUE_PERFORMERS]) {
        assert.deepEqual(chooseTechniquePicture({ moveId, clipMoveId, performerSide, ...releaseDefault, views }), { kind: 'engine' });
      }
      // The heading then follows the engine alone.
      assert.equal(techniqueMoves({ engine: 'unity', moveId, clipMoveId, search: '', views }), moveId === 'double_leg');
      assert.equal(techniqueMoves({ engine: 'snapshot', moveId, clipMoveId, search: '', views }), false);
    }
  }
});

test('Training heading for a technique the engine cannot animate: moving with its clip, still without', () => {
  const none = fakeViews();
  const playerOnly = fakeViews('kimura_guard/fighter-side', 'kimura_guard/fighter-front');
  for (const moveId of noEngineMove) {
    for (const engine of ['unity', 'snapshot']) {
      // With its clip, on the release build and where no engine is configured.
      assert.equal(techniqueMoves({ engine, moveId, clipMoveId: 'kimura_guard', search: '', views: kimura }), true, engine);
      assert.equal(techniqueMoves({ engine, moveId, clipMoveId: 'kimura_guard', views: kimura }), true, engine);
      // Without it nothing moves: no clip, one performer only, or another technique's clips.
      for (const views of [none, playerOnly, both]) {
        assert.equal(techniqueMoves({ engine, moveId, clipMoveId: 'kimura_guard', search: '', views }), false, engine);
      }
      // An explicit ?engine=snapshot or ?engine=unity turns the clip off, and the engine has no animation of the move.
      for (const search of ['?engine=snapshot', '?engine=unity']) {
        assert.equal(techniqueMoves({ engine, moveId, clipMoveId: 'kimura_guard', search, views: kimura }), false, `${engine} ${search}`);
      }
    }
    // The local live preview never shows a clip and has no animation of the move either.
    assert.equal(techniqueMoves({ engine: 'unreal', moveId, clipMoveId: 'kimura_guard', search: '?engine=unreal', views: kimura }), false);
  }
  // A technique the engine does animate keeps its heading when the clip id is named:
  // moving on Unity and on the local preview without any clip, still under ?engine=snapshot.
  assert.equal(techniqueMoves({ engine: 'unity', moveId: 'rear_naked_choke', clipMoveId: 'rear_naked_choke', search: '', views: none }), true);
  assert.equal(techniqueMoves({ engine: 'unity', moveId: 'rear_naked_choke', clipMoveId: 'rear_naked_choke', search: '?engine=unity', views: none }), true);
  assert.equal(techniqueMoves({ engine: 'unreal', moveId: 'rear_naked_choke', clipMoveId: 'rear_naked_choke', search: '?engine=unreal', views: none }), true);
  assert.equal(techniqueMoves({ engine: 'snapshot', moveId: 'rear_naked_choke', clipMoveId: 'rear_naked_choke', search: '', views: none }), false);
  assert.equal(techniqueMoves({ engine: 'unity', moveId: 'rear_naked_choke', clipMoveId: 'rear_naked_choke', search: '?engine=snapshot', views: none }), false);
});

test('Training and the Arena hand the stage the clip id beside the engine move id, and the stage keeps it from the engine stages', () => {
  const stage = source('src/components/GrapplingStage.jsx');
  // The two clip props and the clip's give-way callback are taken out before
  // the rest is spread, so the Unity stage, the local Unreal stage and the
  // fallback get the props they always got.
  assert.match(stage, /export default function GrapplingStage\(\{ idleStanding = false, onRendererChange, clipMoveId, clipPerformerSide, onClipUnavailable, \.\.\.props \}\) \{/);
  assert.doesNotMatch(stage, /props\.(?:clip(?:MoveId|PerformerSide)|onClipUnavailable)/);
  // The callback goes to the technique clip stage and nowhere else.
  assert.equal(stage.match(/onClipUnavailable/g).length, 3, 'named in the comment, taken out, handed on');
  assert.match(stage, /kind="technique" [^>]* onUnavailable=\{onClipUnavailable\} fallback=\{stage\} \/>/);
  assert.match(stage, /<UnrealClipStage key="stance" (?:(?!onUnavailable)[^>])* \/>/);
  assert.match(stage, /const stage = engine === 'unreal' \? <UnrealGrapplingStage \{\.\.\.props\} moveId=[^>]* \/> : engine === 'unity' \? <UnityGrapplingStage \{\.\.\.props\} \/> : props\.fallback;/);
  // The rule gets both ids. A caller that names no clip id gets the engine's;
  // one that passes null gets no clip.
  assert.match(stage, /chooseTechniquePicture\(\{ moveId: props\.moveId, clipMoveId: clipMoveId === undefined \? props\.moveId : clipMoveId, performerSide: clipPerformerSide \?\? props\.performerSide, engine, search: window\.location\.search, views: unrealClipViews \}\);/);
  // The clip stage plays what the rule chose.
  assert.match(stage, /kind="technique" moveId=\{picture\.moveId\} performerSide=\{picture\.performerSide\} /);

  // Training: the clip id of the technique on screen, worked out once, for the heading and for the stage.
  const app = source('src/App.jsx');
  assert.match(app, /import \{ unrealClipMoveId \} from '\.\/unreal\/techniqueIds\.js';/);
  assert.match(app, /const clipMoveId = unrealClipMoveId\(selectedMove\.id\);/);
  // The heading leaves the clip out once that clip has given way; the stage keeps its clip id.
  assert.match(app, /const movementPreview = techniqueMoves\(\{ engine: renderer, moveId: resolveUnityMove\(selectedMove\.id\), clipMoveId: clipGaveWay === clipMoveId \? null : clipMoveId, search: window\.location\.search, views: unrealClipViews \}\);/);
  assert.match(app, /<GrapplingStage onRendererChange=\{setRenderer\} moveId=\{resolveUnityMove\(selectedMove\.id\)\} clipMoveId=\{clipMoveId\} onClipUnavailable=\{setClipGaveWay\} moveLabel=\{selectedMove\.name\} /);

  // Arena: the clip of the settled exchange beside Unity's playback, which
  // stays as it was. An exchange that asks for no clip passes null, so the
  // stage does not fall back to the engine move id.
  const arena = source('src/components/CombatArenaView.jsx');
  assert.match(arena, /import \{ resolveArenaClipPlayback \} from "\.\.\/unreal\/techniqueIds\.js";/);
  assert.match(arena, /const unityPlayback = resolveArenaUnityPlayback\(combat\.result\);/);
  assert.match(arena, /const clipPlayback = resolveArenaClipPlayback\(combat\.result\);/);
  assert.match(arena, /<GrapplingStage\s+idleStanding=\{idleStanding\}\s+moveId=\{unityPlayback\?\.moveId\}\s+performerSide=\{unityPlayback\?\.performerSide\}\s+clipMoveId=\{clipPlayback \? clipPlayback\.clipMoveId : null\}\s+clipPerformerSide=\{clipPlayback\?\.performerSide\}\s+moveLabel=\{combat\.result\?\.techniqueName\}\s+signal=\{combat\.result\?\.animationSignal\}/);
});

test('every curriculum technique plays its own clips in Training and in the Arena once both performers have them', () => {
  const clipIds = allMoves.map((move) => unrealClipMoveId(move.id));
  for (const [index, move] of allMoves.entries()) {
    const clipMoveId = clipIds[index];
    const views = fullViews(clipMoveId);
    const camera = TECHNIQUE_OPENING_CAMERA[clipMoveId] ?? 'side';
    // Won from the technique's clip start, the first position it starts in.
    const won = (actorIsPlayer) => ({ move, actorIsPlayer, animationSucceeded: true, startedFrom: move.starts[0] });

    // Training: the player performs, and the heading says the technique moves.
    assert.deepEqual(stagePicture(trainingProps(move), 'unity', '', views), { kind: 'clip', moveId: clipMoveId, performerSide: 'fighter', camera }, move.id);
    assert.equal(techniqueMoves({ engine: 'unity', ...trainingProps(move), search: '', views }), true, move.id);
    // Arena: whoever won the exchange performs.
    assert.deepEqual(stagePicture(arenaProps(won(true)), 'unity', '', views), { kind: 'clip', moveId: clipMoveId, performerSide: 'fighter', camera }, move.id);
    assert.deepEqual(stagePicture(arenaProps(won(false)), 'unity', '', views), { kind: 'clip', moveId: clipMoveId, performerSide: 'opponent', camera }, move.id);
    // No exchange on screen, or one that did not succeed, asks for no clip.
    for (const result of [null, undefined, { ...won(true), animationSucceeded: false }, { ...won(true), actorIsPlayer: undefined }]) {
      assert.deepEqual(stagePicture(arenaProps(result), 'unity', '', views), { kind: 'engine' }, move.id);
    }
    // One that does not say where it started (a result recorded before clip
    // starts existed) asks for no clip at all: the Arena passes null, so the
    // stage does not look the clip up by the engine move id either, not even
    // for Unity's four. Unity still gets the move it got before.
    for (const actorIsPlayer of [true, false]) {
      const unsaid = { ...won(actorIsPlayer), startedFrom: undefined };
      const props = arenaProps(unsaid);
      assert.equal(props.clipMoveId, null, move.id);
      assert.deepEqual(stagePicture(props, 'unity', '', views), { kind: 'engine' }, move.id);
      assert.deepEqual([props.moveId, props.performerSide], [resolveUnityMove(move.id) ?? undefined, resolveUnityMove(move.id) === null ? undefined : actorIsPlayer ? 'fighter' : 'opponent'], move.id);
    }
    // Position pictures only, Unity kept for the visit, the local live preview: no clip.
    for (const [engine, search] of [['snapshot', '?engine=snapshot'], ['unity', '?engine=snapshot'], ['unity', '?engine=unity'], ['unreal', '?engine=unreal'], ['unreal', '']]) {
      assert.deepEqual(stagePicture(trainingProps(move), engine, search, views), { kind: 'engine' }, `${move.id} ${engine} ${search}`);
      for (const actorIsPlayer of [true, false]) {
        assert.deepEqual(stagePicture(arenaProps(won(actorIsPlayer)), engine, search, views), { kind: 'engine' }, `${move.id} ${engine} ${search}`);
      }
    }
    // One performer's clips alone switch nothing, for either winner.
    for (const onePerformer of [fakeViews(`${clipMoveId}/fighter-side`, `${clipMoveId}/fighter-front`), fakeViews(`${clipMoveId}/opponent-side`, `${clipMoveId}/opponent-front`)]) {
      assert.deepEqual(stagePicture(trainingProps(move), 'unity', '', onePerformer), { kind: 'engine' }, move.id);
      for (const actorIsPlayer of [true, false]) {
        assert.deepEqual(stagePicture(arenaProps(won(actorIsPlayer)), 'unity', '', onePerformer), { kind: 'engine' }, move.id);
      }
    }
    // Every other technique's clips together are not this technique's.
    const others = fullViews(...clipIds.filter((id) => id !== clipMoveId));
    assert.deepEqual(stagePicture(trainingProps(move), 'unity', '', others), { kind: 'engine' }, move.id);
    for (const actorIsPlayer of [true, false]) {
      assert.deepEqual(stagePicture(arenaProps(won(actorIsPlayer)), 'unity', '', others), { kind: 'engine' }, move.id);
    }
  }
});

// Coverage report: every `pnpm test` shows which techniques play Unreal clips.
// Every curriculum technique is checked by its clip id, as Training and the
// Arena ask for it. The report stays short: one line for each technique that
// has any clip, then one line of totals. A technique switches over only with
// both performers; one performer alone is allowed in the files (an import in
// progress) but changes nothing on screen.
test('coverage: which curriculum techniques have Unreal clips for each performer', (t) => {
  const counts = { playing: 0, onePerformer: 0, none: 0 };
  for (const move of allMoves) {
    const { moveId, clipMoveId } = trainingProps(move);
    const cameras = Object.fromEntries(TECHNIQUE_PERFORMERS.map((side) => [side, unrealClipViews(clipMoveId, side).map((clip) => clip.camera)]));
    const sidesWithClips = TECHNIQUE_PERFORMERS.filter((side) => cameras[side].length > 0);
    const ready = techniqueClipReady(clipMoveId, unrealClipViews);
    // A fighter-only import is allowed (spec 2.2), so a technique with one
    // performer is reported, not failed; it must simply not switch over.
    assert.equal(ready, sidesWithClips.length === TECHNIQUE_PERFORMERS.length, `${clipMoveId} switches over only with both performers`);
    counts[ready ? 'playing' : sidesWithClips.length ? 'onePerformer' : 'none'] += 1;
    const asBefore = moveId ? 'Unity on the release build' : 'the position picture';
    if (sidesWithClips.length) {
      const sides = TECHNIQUE_PERFORMERS.map((side) => `${side}: ${cameras[side].join('+') || 'none'}`).join(', ');
      t.diagnostic(`${clipMoveId}: ${sides} -> ${ready ? 'plays Unreal clips' : `only ${sidesWithClips[0]} has clips, so it keeps playing as before (${asBefore})`}`);
    }

    // On the release default, in Training (the player) and in the Arena (either winner).
    const picture = stagePicture(trainingProps(move), 'unity', '', unrealClipViews);
    assert.equal(picture.kind, ready ? 'clip' : 'engine', `${clipMoveId} on the release default`);
    // A technique Unity animates gets the same answer from a call with its engine move id alone.
    if (moveId !== null) assert.equal(chooseTechniquePicture({ moveId, engine: 'unity', search: '', views: unrealClipViews }).kind, ready ? 'clip' : 'engine', `${moveId} on the release default`);
    assert.equal(techniqueMoves({ engine: 'unity', moveId, clipMoveId, search: '', views: unrealClipViews }), ready || moveId !== null, `${clipMoveId} heading on the release default`);
    for (const actorIsPlayer of [true, false]) {
      const settled = stagePicture(arenaProps({ move, actorIsPlayer, animationSucceeded: true, startedFrom: move.starts[0] }), 'unity', '', unrealClipViews);
      assert.equal(settled.kind, ready ? 'clip' : 'engine', `${clipMoveId} in the Arena on the release default`);
      if (ready) assert.deepEqual([settled.moveId, settled.performerSide], [clipMoveId, actorIsPlayer ? 'fighter' : 'opponent']);
    }
    // Clip ids change the picture of one kind of technique only: one the engine
    // cannot animate, once it is ready. Every other technique gets what a call
    // with the engine move id alone gets, which is what every call was before.
    if (!ready || moveId !== null) {
      for (const [engine, search] of [['unity', ''], ['snapshot', ''], ['snapshot', '?engine=snapshot'], ['unity', '?engine=snapshot'], ['unity', '?engine=unity'], ['unreal', '?engine=unreal']]) {
        for (const performerSide of [undefined, ...TECHNIQUE_PERFORMERS]) {
          assert.deepEqual(chooseTechniquePicture({ moveId, clipMoveId, performerSide, engine, search, views: unrealClipViews }), chooseTechniquePicture({ moveId, performerSide, engine, search, views: unrealClipViews }), `${clipMoveId} ${engine} ${search}`);
        }
        assert.equal(techniqueMoves({ engine, moveId, clipMoveId, search, views: unrealClipViews }), techniqueMoves({ engine, moveId, search, views: unrealClipViews }), `${clipMoveId} heading ${engine} ${search}`);
      }
    }
  }
  assert.equal(counts.playing + counts.onePerformer + counts.none, allMoves.length);
  t.diagnostic(`${counts.playing} of ${allMoves.length} curriculum techniques play Unreal clips. Clips for one performer only: ${counts.onePerformer}. No clip: ${counts.none}. Both of those play as before.`);

  // The report leaves no clip out: every published clip is a stance clip or
  // belongs to one of these techniques.
  const clipIds = new Set(allMoves.map((move) => unrealClipMoveId(move.id)));
  const stanceClips = new Set(UNREAL_STANCES.flatMap((stance) => [stance.loopMoveId, stance.entryMoveId]).filter(Boolean));
  for (const clip of UNREAL_CLIPS) {
    assert.ok(clipIds.has(clip.moveId) || stanceClips.has(clip.moveId), `${clip.moveId} is neither a stance clip nor a curriculum technique's clip`);
  }
});

test('in the Arena a technique that starts in more than one position plays its clip only after a win from its clip start; after another start it shows what it shows today', () => {
  const multi = allMoves.filter((move) => move.starts.length > 1);
  assert.equal(multi.length, 8);
  for (const move of multi) {
    const clipMoveId = unrealClipMoveId(move.id);
    assert.equal(resolveUnityMove(move.id), null, `${move.id} is not one Unity animates`);
    const views = fullViews(clipMoveId);
    for (const [index, startedFrom] of move.starts.entries()) {
      for (const actorIsPlayer of [true, false]) {
        const result = { move, actorIsPlayer, animationSucceeded: true, startedFrom };
        const props = arenaProps(result);
        for (const engine of ['unity', 'snapshot']) {
          // What GrapplingStage asked the rule on origin/main: the engine move id alone.
          const today = chooseTechniquePicture({ moveId: props.moveId, performerSide: props.performerSide, engine, search: '', views });
          assert.deepEqual(today, { kind: 'engine' });
          const expected = index === 0 ? { kind: 'clip', moveId: clipMoveId, performerSide: actorIsPlayer ? 'fighter' : 'opponent', camera: 'side' } : today;
          assert.deepEqual(stagePicture(props, engine, '', views), expected, `${move.id} from ${startedFrom}, ${engine}`);
        }
      }
    }
  }
});

// Training's heading for the technique on screen, given the clip id whose clip
// gave way, if one did. The lines of src/App.jsx this repeats are pinned in
// 'Training and the Arena hand the stage the clip id ...' and in the test after
// next.
const trainingHeading = (move, engine, search, views, gaveWay = null) => {
  const { moveId, clipMoveId } = trainingProps(move);
  return techniqueMoves({ engine, moveId, clipMoveId: gaveWay === clipMoveId ? null : clipMoveId, search, views });
};

test('once a technique clip gives way, Training\'s heading follows the picture left on screen: moving only where the engine animates the technique', () => {
  const after = { unity: { moving: [], still: [] }, snapshot: { moving: [], still: [] } };
  for (const move of allMoves) {
    const { clipMoveId } = trainingProps(move);
    const views = fullViews(clipMoveId);
    for (const engine of ['unity', 'snapshot']) {
      // The clip plays: the technique moves.
      assert.equal(trainingHeading(move, engine, '', views), true, move.id);
      // It gave way to GrapplingStage's own stage: on the release build that is
      // Unity, which animates only the techniques it has; with no engine
      // configured it is the position picture.
      const fallbackMoves = engine === 'unity' && resolveUnityMove(move.id) !== null;
      const heading = trainingHeading(move, engine, '', views, clipMoveId);
      assert.equal(heading, fallbackMoves, `${move.id} on ${engine}`);
      after[engine][heading ? 'moving' : 'still'].push(clipMoveId);
      // The heading it would have with no clip published, as on origin/main.
      assert.equal(heading, techniqueMoves({ engine, moveId: resolveUnityMove(move.id), search: '', views: fakeViews() }), move.id);
      // Another clip id giving way says nothing about this technique's clip.
      assert.equal(trainingHeading(move, engine, '', views, 'another_technique'), true, move.id);
      // The stage keeps getting the clip id, so the clip stage keeps its place and its fallback.
      assert.equal(stagePicture(trainingProps(move), engine, '', views).kind, 'clip', move.id);
    }
    // Where clips are off for the visit, nothing gave way and the heading is as before.
    for (const search of ['?engine=snapshot', '?engine=unity']) {
      assert.equal(trainingHeading(move, 'unity', search, views, clipMoveId), trainingHeading(move, 'unity', search, views), `${move.id} ${search}`);
    }
  }
  assert.deepEqual(after.unity.moving.sort(), ['double_leg', 'rear_naked_choke', 'trap_roll_escape', 'triangle_choke']);
  assert.equal(after.unity.still.length, allMoves.length - 4);
  assert.deepEqual(after.snapshot.moving, []);
});

test('Training remembers which clip gave way only while that technique is open, and the heading and its line follow it', () => {
  const app = source('src/App.jsx');
  assert.match(app, /const \[clipGaveWay, setClipGaveWay\] = useState\(null\);/);
  // Opening another technique forgets it; coming back tries the clip again.
  assert.match(app, /useEffect\(\(\) => \{ setClipGaveWay\(null\); \}, \[clipMoveId\]\);/);
  assert.equal(app.match(/\bsetClipGaveWay\b/g).length, 3, 'declared, cleared on a new technique, handed to the stage');
  assert.equal(app.match(/\bclipGaveWay\b/g).length, 2, 'declared, and read by the heading only');
  // The stage is told nothing new: it keeps the real clip id, so nothing remounts.
  assert.match(app, /<GrapplingStage onRendererChange=\{setRenderer\} moveId=\{resolveUnityMove\(selectedMove\.id\)\} clipMoveId=\{clipMoveId\} onClipUnavailable=\{setClipGaveWay\} /);
  // Both the heading and the line under it follow movementPreview.
  assert.match(app, /<h3>\{movementPreview \? 'Movement preview' : 'Position reference'\}<\/h3><p>\{movementPreview \? 'Review the draft movement where a matching animation is available\. Follow the technique steps for the required setup\.' : 'A reference for the starting position\. Follow the steps below for the exact setup and full sequence\.'\}<\/p>/);
  // The Arena has no heading and passes no callback.
  assert.doesNotMatch(source('src/components/CombatArenaView.jsx'), /onClipUnavailable/);
});

test('on the picture, a legend label that wraps keeps its dot beside its own text, for stance and technique clips alike', () => {
  const css = source('src/components/UnrealClipStage.css');
  // The first wide layout: heading, controls and legend sit on the picture.
  const start = css.indexOf('@container unreal-clip (min-width: 620px) {');
  assert.ok(start >= 0);
  let depth = 0;
  let end = start;
  for (let index = css.indexOf('{', start); index < css.length; index += 1) {
    if (css[index] === '{') depth += 1;
    if (css[index] === '}') depth -= 1;
    if (depth === 0) { end = index; break; }
  }
  const overlay = css.slice(start, end);
  // The legend still sits top right, at most a third of the picture wide, its lines against the right edge ...
  assert.match(overlay, /\.unreal-clip-legend \{\s+top: 0;\s+right: 0;\s+flex-direction: column;\s+align-items: flex-end;\s+gap: 0\.25rem;\s+max-width: 32%;\s+padding: 0\.9rem 1rem;\s+text-align: right;\s+\}/);
  // ... but the text of each line starts right after its dot, so a label that wraps keeps its dot beside it.
  assert.match(overlay, /\.unreal-clip-legend span \{\s+text-align: left;\s+\}/);
  assert.equal(css.match(/\.unreal-clip-legend span \{/g).length, 2, 'the base rule and the overlay one, nothing else');
  // Each line is a flex row with the dot first: the dot, then the label as one text box.
  assert.match(css, /\.unreal-clip-legend span \{\s+display: inline-flex;\s+\/\* The dot stays beside the first line when a long label wraps\. \*\/\s+align-items: flex-start;/);
  const stage = source('src/components/UnrealClipStage.jsx');
  assert.match(stage, /<span><i style=\{\{ background: UNREAL_CLIP_LOOK\.fighter\.swatch \}\} aria-hidden="true" \/>\{fighterName\} \(you\): /);
  assert.match(stage, /<span><i style=\{\{ background: UNREAL_CLIP_LOOK\.opponent\.swatch \}\} aria-hidden="true" \/>\{opponentName\}: /);
  assert.match(stage, /<span data-side="fighter"><i style=\{\{ background: UNREAL_CLIP_LOOK\.fighter\.swatch \}\} aria-hidden="true" \/>\{fighterName\} \(you\): /);
  assert.match(stage, /<span data-side="opponent"><i style=\{\{ background: UNREAL_CLIP_LOOK\.opponent\.swatch \}\} aria-hidden="true" \/>\{opponentName\}: /);
  // Training's study bar already sets its legend's text to the left.
  assert.match(css, /\.unreal-clip-stage\.is-study \.unreal-clip-legend \{\s+position: static;\s+flex-direction: row;\s+align-items: center;\s+max-width: none;\s+padding: 0\.75rem 1rem 0\.95rem;\s+text-align: left;\s+\}/);
});

// The stage components, run outside React. Vite's esbuild (a dependency of
// the site) compiles a component file's JSX into plain element objects, and
// each of its imports is swapped for the real module or a stand-in. 'react'
// becomes the small hook runner below, so a test can render, call an element's
// handler as the browser would (a video's error event), and see exactly when
// effects run.
const asModule = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const repoModule = (path) => new URL(`../${path}`, import.meta.url).href;
const STAND_IN_JSX = asModule(`export const __Fragment = 'fragment';
export const __h = (type, props, ...children) => ({ type, props: children.length ? { ...props, children: children.length > 1 ? children : children[0] } : { ...props } });`);
const STAND_IN_REACT = asModule(['useEffect', 'useId', 'useReducer', 'useRef', 'useState'].map((name) => `export const ${name} = (...args) => globalThis.__hookRunner.${name}(...args);`).join('\n'));
const standInComponent = (name) => asModule(`export default function ${name}() { return null; }`);

async function loadComponent(path, imports) {
  const { transformWithEsbuild } = await import('vite');
  const code = source(path).replaceAll('import.meta.env', 'globalThis.__componentEnv');
  const compiled = (await transformWithEsbuild(code, path, { loader: 'jsx', jsx: 'transform', jsxFactory: '__h', jsxFragment: '__Fragment', sourcemap: false })).code;
  const swapped = [];
  const body = compiled.replace(/^import (?:(.+) from )?"([^"]+)";$/gm, (line, names, specifier) => {
    assert.ok(Object.hasOwn(imports, specifier), `${path} imports ${specifier}, which the test has no stand-in for`);
    swapped.push(specifier);
    return imports[specifier] === null ? '' : `import ${names ? `${names} from ` : ''}${JSON.stringify(imports[specifier])};`;
  });
  assert.deepEqual(swapped.sort(), Object.keys(imports).sort(), `${path}: its imports`);
  return import(asModule(`import { __h, __Fragment } from ${JSON.stringify(STAND_IN_JSX)};\n${body}`));
}

// Hooks for one component at a time. render() is one commit: the component
// runs, then the effects whose inputs changed, again while an effect changes
// state. A handler called between renders changes state as an event would.
function createHookRunner() {
  const slots = [];
  let cursor = 0;
  let effects = [];
  let changed = false;
  const runner = {
    rendering: false,
    useReducer(reducer, initialArg, init) {
      const slot = slots[cursor] ??= { state: init ? init(initialArg) : initialArg };
      cursor += 1;
      slot.reducer = reducer;
      slot.dispatch ??= (action) => {
        const next = slot.reducer(slot.state, action);
        if (!Object.is(next, slot.state)) { slot.state = next; changed = true; }
      };
      return [slot.state, slot.dispatch];
    },
    useState: (initial) => runner.useReducer((state, action) => (typeof action === 'function' ? action(state) : action), initial, (value) => (typeof value === 'function' ? value() : value)),
    useRef(current) {
      const slot = slots[cursor] ??= { current };
      cursor += 1;
      return slot;
    },
    useEffect(effect, deps) {
      const slot = slots[cursor] ??= {};
      cursor += 1;
      if (slot.deps && deps && deps.length === slot.deps.length && deps.every((dep, index) => Object.is(dep, slot.deps[index]))) return;
      effects.push(() => { slot.cleanup?.(); slot.cleanup = effect(); slot.deps = deps; });
    },
    useId: () => ':clip:',
    render(component, props) {
      for (let pass = 0; pass < 10; pass += 1) {
        cursor = 0;
        effects = [];
        changed = false;
        runner.rendering = true;
        let tree;
        try { tree = component(props); } finally { runner.rendering = false; }
        for (const effect of effects) effect();
        if (!changed) return tree;
      }
      throw new Error('the component keeps changing its own state');
    },
  };
  return runner;
}

const findElement = (node, test) => {
  if (Array.isArray(node)) return node.map((child) => findElement(child, test)).find(Boolean) ?? null;
  if (!node || typeof node !== 'object') return null;
  return test(node) ? node : findElement(node.props?.children, test);
};

// Globals for the length of one test.
const useGlobals = (t, values) => {
  const before = Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  Object.assign(globalThis, values);
  t.after(() => {
    for (const [key, descriptor] of before) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
};

// One published view of a clip, shaped like an entry of the clip list.
const clipView = (moveId, performerSide, camera) => Object.freeze({
  moveId, performerSide, camera, video: `/assets/unreal-clips/${moveId}/${performerSide}-${camera}.mp4`, poster: `/assets/unreal-clips/${moveId}/${performerSide}-${camera}.webp`,
  width: 1280, height: 720, fps: 30, frames: 54, durationSeconds: 1.8, loops: false, posterFrame: 0, choreographyReviewed: false,
});
const viewsOf = (published) => (moveId, performerSide = 'fighter') => (Object.hasOwn(published, moveId) ? published[moveId][performerSide] ?? [] : []).map((camera) => clipView(moveId, performerSide, camera));

test('a technique clip tells its parent once, after it has handed over to its fallback because every view failed, and never while rendering', async (t) => {
  // No window: no reduced-motion query and no IntersectionObserver, so the clip plays at once.
  useGlobals(t, { document: { hidden: false, addEventListener() {}, removeEventListener() {} }, __hookRunner: undefined, __clipViews: undefined });
  const { default: UnrealClipStage } = await loadComponent('src/components/UnrealClipStage.jsx', {
    react: STAND_IN_REACT,
    'lucide-react': asModule('export const Pause = () => null, Play = () => null, RotateCcw = () => null;'),
    '../unreal/techniqueClips.js': asModule(`export { UNREAL_CLIP_LOOK } from ${JSON.stringify(repoModule('src/unreal/techniqueClips.js'))};\nexport const unrealClipViews = (...args) => globalThis.__clipViews(...args);`),
    '../unreal/clipPlayback.js': repoModule('src/unreal/clipPlayback.js'),
    './UnrealClipStage.css': null,
  });
  globalThis.__clipViews = viewsOf({ establish_clinch: { fighter: ['side', 'front'], opponent: ['front'] }, standing_stance: { fighter: ['side'] } });
  const fallback = Object.freeze({ type: 'the engine stage', props: {} });
  const stageFor = (props) => {
    const element = UnrealClipStage(props);
    return { component: element.type, props: element.props };
  };
  const video = (tree) => findElement(tree, (node) => node.type === 'video');

  // Both views fail, one after the other.
  {
    const runner = globalThis.__hookRunner = createHookRunner();
    const told = [];
    const onUnavailable = (...args) => told.push({ args, whileRendering: runner.rendering });
    const { component, props } = stageFor({ kind: 'technique', moveId: 'establish_clinch', performerSide: 'fighter', moveLabel: 'Establish the Clinch Control', study: true, fallback, onUnavailable });
    assert.equal(component.name, 'TechniqueClip');
    let tree = runner.render(component, props);
    assert.equal(video(tree).props.src, '/assets/unreal-clips/establish_clinch/fighter-side.mp4');
    assert.deepEqual(told, []);
    // The side view cannot play: the front view takes over, and nothing is said.
    video(tree).props.onError();
    tree = runner.render(component, props);
    assert.equal(video(tree).props.src, '/assets/unreal-clips/establish_clinch/fighter-front.mp4');
    assert.deepEqual(told, []);
    // The front view cannot play either: the fallback shows, and the parent is
    // told the clip id, once, after that render.
    video(tree).props.onError();
    tree = runner.render(component, props);
    assert.equal(tree, fallback);
    assert.deepEqual(told, [{ args: ['establish_clinch'], whileRendering: false }]);
    // Later renders say nothing more, also to a new callback.
    const late = [];
    for (const callback of [onUnavailable, (...args) => late.push(args)]) {
      assert.equal(runner.render(component, { ...props, onUnavailable: callback }), fallback);
    }
    assert.equal(told.length, 1);
    assert.deepEqual(late, []);
  }

  // The rival's clip with one view: its failure hands over at once.
  {
    const runner = globalThis.__hookRunner = createHookRunner();
    const told = [];
    const { component, props } = stageFor({ kind: 'technique', moveId: 'establish_clinch', performerSide: 'opponent', fallback, onUnavailable: (...args) => told.push({ args, whileRendering: runner.rendering }) });
    const tree = runner.render(component, props);
    assert.equal(video(tree).props.src, '/assets/unreal-clips/establish_clinch/opponent-front.mp4');
    video(tree).props.onError();
    assert.deepEqual(told, [], 'not from the handler either: only once the fallback is on screen');
    assert.equal(runner.render(component, props), fallback);
    assert.deepEqual(told, [{ args: ['establish_clinch'], whileRendering: false }]);
  }

  // No callback given: the clip gives way as before.
  {
    const runner = globalThis.__hookRunner = createHookRunner();
    const { component, props } = stageFor({ kind: 'technique', moveId: 'establish_clinch', fallback });
    let tree = runner.render(component, props);
    for (let step = 0; step < 2; step += 1) { video(tree).props.onError(); tree = runner.render(component, props); }
    assert.equal(tree, fallback);
  }

  // A clip with no view at all shows the fallback from the first render, and
  // says so once, after it.
  {
    const runner = globalThis.__hookRunner = createHookRunner();
    const told = [];
    const { component, props } = stageFor({ kind: 'technique', moveId: 'kimura_guard', fallback, onUnavailable: (...args) => told.push({ args, whileRendering: runner.rendering }) });
    assert.equal(runner.render(component, props), fallback);
    assert.equal(runner.render(component, props), fallback);
    assert.deepEqual(told, [{ args: ['kimura_guard'], whileRendering: false }]);
  }

  // A stance clip never calls it.
  {
    const runner = globalThis.__hookRunner = createHookRunner();
    const told = [];
    const { component, props } = stageFor({ moveId: 'standing_stance', fallback, onUnavailable: () => told.push('told') });
    assert.equal(component.name, 'StanceClip');
    const tree = runner.render(component, props);
    video(tree).props.onError();
    assert.equal(runner.render(component, props), fallback);
    assert.deepEqual(told, []);
  }
});

test('GrapplingStage hands onClipUnavailable to the technique clip stage only, and every engine stage gets exactly the props it got before', async (t) => {
  useGlobals(t, { window: undefined, __hookRunner: undefined, __clipViews: undefined, __componentEnv: undefined });
  const { default: GrapplingStage } = await loadComponent('src/components/GrapplingStage.jsx', {
    react: STAND_IN_REACT,
    './UnityGrapplingStage.jsx': standInComponent('UnityGrapplingStage'),
    './UnrealClipStage.jsx': standInComponent('UnrealClipStage'),
    './UnrealGrapplingStage.jsx': standInComponent('UnrealGrapplingStage'),
    '../unreal/renderer.js': repoModule('src/unreal/renderer.js'),
    '../unreal/techniqueClips.js': asModule(`export { findUnrealClip } from ${JSON.stringify(repoModule('src/unreal/techniqueClips.js'))};\nexport const unrealClipViews = (...args) => globalThis.__clipViews(...args);`),
    '../unreal/techniquePicture.js': repoModule('src/unreal/techniquePicture.js'),
    '../unreal/stances.js': repoModule('src/unreal/stances.js'),
  });
  const visits = {
    'release default': { env: { DEV: false, VITE_COMBAT_ENGINE: 'unity' }, href: 'https://jiuquest.com/', stage: 'UnityGrapplingStage' },
    'no engine configured': { env: { DEV: false }, href: 'https://jiuquest.com/', stage: 'the position picture' },
    'local live preview': { env: { DEV: true }, href: 'http://127.0.0.1:5178/?engine=unreal', stage: 'UnrealGrapplingStage' },
  };
  const ready = viewsOf({ establish_clinch: { fighter: ['side', 'front'], opponent: ['side', 'front'] } });
  const picture = Object.freeze({ type: 'the position picture', props: {} });
  const onClipUnavailable = () => {};
  // What Training passes (compact) and what the Arena passes (a rival's win).
  const callers = {
    Training: { onRendererChange() {}, moveId: null, clipMoveId: 'establish_clinch', onClipUnavailable, moveLabel: 'Establish the Clinch Control', fighter: { name: 'Clipper' }, opponent: { name: 'Ryu Tanaka' }, fighterBelt: { belt: 'blue' }, compact: true, fallback: picture },
    Arena: { idleStanding: false, moveId: undefined, performerSide: undefined, clipMoveId: 'establish_clinch', clipPerformerSide: 'opponent', onClipUnavailable, moveLabel: 'Establish the Clinch Control', signal: 'establish-clinch-3-1', fighter: { name: 'Clipper' }, fighterBelt: { belt: 'blue' }, opponent: { name: 'Ryu Tanaka' }, unavailableReason: 'This exchange has no matching successful Unity animation yet.', fallback: picture },
  };
  const engineProps = (props) => {
    const { idleStanding, onRendererChange, clipMoveId, clipPerformerSide, onClipUnavailable: callback, ...rest } = props;
    return rest;
  };
  const named = (name) => (node) => node.type === picture ? false : (node.type?.name ?? node.type) === name;
  for (const [visitName, visit] of Object.entries(visits)) {
    const url = new URL(visit.href);
    globalThis.window = { location: { href: url.href, search: url.search }, history: { state: null, replaceState() {} } };
    globalThis.__componentEnv = visit.env;
    for (const [caller, props] of Object.entries(callers)) {
      for (const [list, views] of [['clips published', ready], ['no clips', viewsOf({})]]) {
        globalThis.__clipViews = views;
        globalThis.__hookRunner = createHookRunner();
        const tree = globalThis.__hookRunner.render(GrapplingStage, props);
        const label = `${visitName}, ${caller}, ${list}`;
        const clip = findElement(tree, named('UnrealClipStage'));
        const expectedStage = visit.stage === 'UnrealGrapplingStage' ? { ...engineProps(props), moveId: props.moveId, moveLabel: props.moveLabel } : engineProps(props);
        const stage = visit.stage === 'the position picture' ? picture : findElement(clip ? clip.props.fallback : tree, named(visit.stage));
        assert.ok(stage, `${label}: the engine stage`);
        if (stage !== picture) assert.deepEqual(stage.props, expectedStage, `${label}: the engine stage gets the props it always got`);
        if (list === 'clips published' && visitName !== 'local live preview') {
          assert.equal(clip.props.kind, 'technique', label);
          assert.equal(clip.props.onUnavailable, onClipUnavailable, `${label}: the technique clip stage gets the callback`);
          assert.equal(clip.props.fallback, stage, `${label}: and hands over to the engine stage`);
        } else {
          assert.equal(clip, null, `${label}: no clip stage`);
        }
      }
    }
  }
  // The stance loop of an unsettled standing position never gets it.
  globalThis.window = { location: { href: 'https://jiuquest.com/', search: '' }, history: { state: null, replaceState() {} } };
  globalThis.__componentEnv = visits['release default'].env;
  globalThis.__clipViews = ready;
  globalThis.__hookRunner = createHookRunner();
  const idle = globalThis.__hookRunner.render(GrapplingStage, { ...callers.Arena, idleStanding: true, clipMoveId: undefined, clipPerformerSide: undefined, moveLabel: undefined, signal: undefined });
  const stance = findElement(idle, named('UnrealClipStage'));
  assert.equal(stance.props.key, 'stance');
  assert.equal(Object.hasOwn(stance.props, 'onUnavailable'), false);
  assert.equal(findElement(stance.props.fallback, named('UnityGrapplingStage')).props.onClipUnavailable, undefined);
});

test('GrapplingStage plays no clip when the clip id is null, and takes the engine move id as the clip id only when none is named', async (t) => {
  useGlobals(t, { window: undefined, __hookRunner: undefined, __clipViews: undefined, __componentEnv: undefined });
  const { default: GrapplingStage } = await loadComponent('src/components/GrapplingStage.jsx', {
    react: STAND_IN_REACT,
    './UnityGrapplingStage.jsx': standInComponent('UnityGrapplingStage'),
    './UnrealClipStage.jsx': standInComponent('UnrealClipStage'),
    './UnrealGrapplingStage.jsx': standInComponent('UnrealGrapplingStage'),
    '../unreal/renderer.js': repoModule('src/unreal/renderer.js'),
    '../unreal/techniqueClips.js': asModule(`export { findUnrealClip } from ${JSON.stringify(repoModule('src/unreal/techniqueClips.js'))};\nexport const unrealClipViews = (...args) => globalThis.__clipViews(...args);`),
    '../unreal/techniquePicture.js': repoModule('src/unreal/techniquePicture.js'),
    '../unreal/stances.js': repoModule('src/unreal/stances.js'),
  });
  // The release default, with the double leg's clips published for both performers.
  globalThis.window = { location: { href: 'https://jiuquest.com/', search: '' }, history: { state: null, replaceState() {} } };
  globalThis.__componentEnv = { DEV: false, VITE_COMBAT_ENGINE: 'unity' };
  globalThis.__clipViews = viewsOf({ double_leg: { fighter: ['side', 'front'], opponent: ['side', 'front'] } });
  const picture = Object.freeze({ type: 'the position picture', props: {} });
  const named = (name) => (node) => node.type === picture ? false : (node.type?.name ?? node.type) === name;
  // A rival's double leg win, as the Arena passes it, with the clip props left to each case.
  const win = { idleStanding: false, moveId: 'double_leg', performerSide: 'opponent', moveLabel: 'Double Leg Takedown', signal: 'double-leg-takedown-2-1', fighter: { name: 'Clipper' }, fighterBelt: { belt: 'blue' }, opponent: { name: 'Ryu Tanaka' }, unavailableReason: 'This exchange has no matching successful Unity animation yet.', fallback: picture };
  const unityProps = { moveId: 'double_leg', performerSide: 'opponent', moveLabel: 'Double Leg Takedown', signal: 'double-leg-takedown-2-1', fighter: { name: 'Clipper' }, fighterBelt: { belt: 'blue' }, opponent: { name: 'Ryu Tanaka' }, unavailableReason: 'This exchange has no matching successful Unity animation yet.', fallback: picture };
  const render = (props) => {
    globalThis.__hookRunner = createHookRunner();
    const tree = globalThis.__hookRunner.render(GrapplingStage, props);
    return { clip: findElement(tree, named('UnrealClipStage')), unity: findElement(tree, named('UnityGrapplingStage')), tree };
  };
  // Null or '' (the Arena's exchange that asks for no clip): no clip, though the
  // engine's move has one. Unity gets exactly what it got before.
  for (const clipMoveId of [null, '']) {
    const { clip, unity } = render({ ...win, clipMoveId, clipPerformerSide: undefined });
    assert.equal(clip, null, `clip id ${JSON.stringify(clipMoveId)}`);
    assert.deepEqual(unity.props, unityProps, `clip id ${JSON.stringify(clipMoveId)}`);
  }
  // No clip id named at all: the engine move id is the clip id, as every caller had it before.
  for (const props of [win, { ...win, clipMoveId: undefined, clipPerformerSide: undefined }, { ...win, clipMoveId: 'double_leg', clipPerformerSide: 'opponent' }]) {
    const { clip } = render(props);
    assert.deepEqual([clip?.props.kind, clip?.props.moveId, clip?.props.performerSide], ['technique', 'double_leg', 'opponent'], JSON.stringify(props.clipMoveId));
    assert.deepEqual(findElement(clip.props.fallback, named('UnityGrapplingStage')).props, unityProps);
  }
});
