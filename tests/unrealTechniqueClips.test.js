import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { UNREAL_CLIPS, UNREAL_CLIP_CAMERAS, UNREAL_CLIP_LOOK, findUnrealClip, unrealClipViews } from '../src/unreal/techniqueClips.js';
import { allMoves } from '../src/data/curriculum.js';
import { UNITY_PREVIEWS } from '../src/unity/bridge.js';
import { MATCH_MOMENT_IDS, MATCH_MOMENT_PERFORMER, isMatchMoment } from '../src/unreal/matchMoments.js';
import { resolveCombatRenderer } from '../src/unreal/renderer.js';
import { UNREAL_STANCES } from '../src/unreal/stances.js';
import { unrealClipMoveId } from '../src/unreal/techniqueIds.js';
import { MATCH_MOMENT_CLIP } from '../tools/import_unreal_clips.mjs';
import { isOwnerPublishedDraft } from '../src/unreal/techniquePicture.js';

// The clip id of every curriculum technique: any of them can take clips.
const TECHNIQUE_CLIP_IDS = allMoves.map((move) => unrealClipMoveId(move.id));

const repoPath = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const repoFile = (path) => readFileSync(repoPath(path));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('every published clip is the pinned file and something a browser can start playing early', () => {
  assert.ok(UNREAL_CLIPS.length > 0);
  for (const clip of UNREAL_CLIPS) {
    const name = `${clip.moveId}/${clip.performerSide}-${clip.camera}`;
    assert.equal(clip.video, `/assets/unreal-clips/${name}.mp4`);
    assert.equal(clip.poster, `/assets/unreal-clips/${name}.webp`);
    const video = repoFile(`public${clip.video}`);
    assert.equal(video.length, clip.bytes, `${name} size`);
    assert.equal(sha256(video), clip.sha256, `${name} was replaced or re-encoded`);
    assert.equal(video.toString('latin1', 4, 8), 'ftyp', `${name} is an MP4`);
    const [index, media] = [video.indexOf('moov'), video.indexOf('mdat')];
    assert.ok(index > 0 && index < media, `${name} carries its index before its media`);

    const poster = repoFile(`public${clip.poster}`);
    assert.equal(poster.length, clip.posterBytes, `${name} poster size`);
    assert.equal(sha256(poster), clip.posterSha256, `${name} poster was replaced`);
    if (isOwnerPublishedDraft(clip)) {
      assert.equal(poster.toString('latin1', 0, 4) + poster.toString('latin1', 8, 16), 'RIFFWEBPVP8L', 'the approved draft retains its canonical lossless poster');
      const dimensions = poster.readUInt32LE(21);
      assert.deepEqual([(dimensions & 0x3fff) + 1, ((dimensions >>> 14) & 0x3fff) + 1], [clip.width, clip.height]);
      assert.equal(clip.posterSourceSha256, clip.posterSha256, 'the canonical poster is copied unchanged');
    } else {
      assert.equal(poster.toString('latin1', 0, 4) + poster.toString('latin1', 8, 16), 'RIFFWEBPVP8 ', `${name} poster is a lossy WebP`);
      assert.deepEqual([poster.readUInt16LE(26) & 0x3fff, poster.readUInt16LE(28) & 0x3fff], [clip.width, clip.height], `${name} poster matches the video size`);
      assert.notEqual(clip.posterSourceSha256, clip.posterSha256, 'the published poster is a smaller copy of the delivered one');
    }
    assert.match(clip.posterSourceSha256, /^[0-9a-f]{64}$/);

    assert.deepEqual([clip.width, clip.height, clip.fps], [1280, 720, 30]);
    assert.ok(Number.isInteger(clip.frames) && clip.frames > 0);
    assert.ok(Math.abs(clip.frames / clip.fps - clip.durationSeconds) < 0.001, `${name} duration`);
    assert.equal(typeof clip.loops, 'boolean');
    assert.equal(typeof clip.choreographyReviewed, 'boolean');
    assert.throws(() => { clip.sha256 = 'changed'; }, TypeError);
  }
  assert.throws(() => { UNREAL_CLIPS.push({}); }, TypeError);
});

test('clips name real moves, performers and cameras, with no repeats and no stray files', () => {
  // A clip shows a curriculum technique, named by its clip id, a fighting
  // stance held or left on the feet, or a match moment (the greeting before a
  // match, or the end of one). These are the names the importer takes.
  const stanceClips = UNREAL_STANCES.flatMap((stance) => [stance.loopMoveId, stance.entryMoveId]).filter(Boolean);
  const moves = new Set([...TECHNIQUE_CLIP_IDS, ...stanceClips, ...MATCH_MOMENT_IDS]);
  assert.equal(moves.size, TECHNIQUE_CLIP_IDS.length + stanceClips.length + MATCH_MOMENT_IDS.length, 'the three kinds of clip never share a name');
  const keys = UNREAL_CLIPS.map((clip) => `${clip.moveId}/${clip.performerSide}-${clip.camera}`);
  assert.equal(new Set(keys).size, keys.length);
  for (const clip of UNREAL_CLIPS) {
    assert.ok(moves.has(clip.moveId), `${clip.moveId} is a curriculum technique's clip id, a stance clip or a match moment`);
    assert.ok(['fighter', 'opponent'].includes(clip.performerSide));
    assert.ok(UNREAL_CLIP_CAMERAS.includes(clip.camera));
  }
  // Nothing is published that the list does not pin.
  const published = [];
  for (const move of readdirSync(repoPath('public/assets/unreal-clips'))) {
    for (const file of readdirSync(repoPath(`public/assets/unreal-clips/${move}`))) published.push(`/assets/unreal-clips/${move}/${file}`);
  }
  assert.deepEqual(published.sort(), UNREAL_CLIPS.flatMap((clip) => [clip.video, clip.poster]).sort());
});

test('a looping clip is a stance held on the feet, and a clip that plays once is a technique, a stance entry or a match moment whose poster is frame 0, except the owner-published draft\'s canonical frame 63', () => {
  const stanceLoops = new Set(UNREAL_STANCES.map((stance) => stance.loopMoveId));
  // Any curriculum technique, by its clip id (src/unreal/techniqueIds.js). The
  // four Unity animates keep Unity's ids.
  const techniques = new Set(TECHNIQUE_CLIP_IDS);
  for (const id of ['rear_naked_choke', 'double_leg', 'trap_roll_escape', 'triangle_choke', 'basic_tackle', 'headlock_escape_2']) assert.ok(techniques.has(id), id);
  assert.ok(UNREAL_CLIPS.some((clip) => clip.moveId === 'standing_stance'), 'the standard stance is published');
  for (const clip of UNREAL_CLIPS) {
    const name = `${clip.moveId}/${clip.performerSide}-${clip.camera}`;
    if (clip.loops) {
      assert.ok(stanceLoops.has(clip.moveId), `${name} loops, so it is a stance held on the feet`);
      assert.equal(clip.posterFrame, null, `${name} loops, so its poster is the pack's`);
    } else {
      assert.ok(techniques.has(clip.moveId) || clip.moveId.startsWith('enter_') || isMatchMoment(clip.moveId), `${name} plays once, so it is a technique, a stance entry or a match moment`);
      assert.equal(clip.posterFrame, isOwnerPublishedDraft(clip) ? 63 : 0, `${name}: approved draft keeps its canonical frame 63 poster; normal imports open on frame 0`);
    }
    // A match moment never loops, shows the player's athlete only, and is as
    // long as the importer allows (tools/import_unreal_clips.mjs).
    if (isMatchMoment(clip.moveId)) {
      assert.deepEqual([clip.loops, clip.performerSide], [false, MATCH_MOMENT_PERFORMER], `${name} is a match moment`);
      assert.ok(clip.frames >= MATCH_MOMENT_CLIP.minFrames && clip.frames <= MATCH_MOMENT_CLIP.maxFrames, `${name} has ${clip.frames} frames`);
    }
  }
  assert.ok(UNREAL_CLIPS.every((clip) => clip.choreographyReviewed === false), 'no clip has had a qualified choreography review');
  // A move with no files of its own finds nothing: it never borrows another move's clip.
  // That holds for every curriculum technique and for every move Unity previews.
  const published = new Set(UNREAL_CLIPS.map((clip) => clip.moveId));
  for (const moveId of new Set([...TECHNIQUE_CLIP_IDS, ...UNITY_PREVIEWS.map((move) => move.id)])) {
    if (published.has(moveId)) continue;
    assert.equal(findUnrealClip(moveId), null, `${moveId} must not borrow another move's clip`);
    assert.deepEqual([unrealClipViews(moveId), unrealClipViews(moveId, 'opponent')], [[], []], `${moveId} has no view of its own`);
  }
});

test('lookups return the exact view asked for, side first', () => {
  assert.deepEqual([...UNREAL_CLIP_CAMERAS], ['side', 'front']);
  assert.equal(findUnrealClip('standing_stance').video, '/assets/unreal-clips/standing_stance/fighter-side.mp4');
  assert.equal(findUnrealClip('standing_stance', 'fighter', 'front').video, '/assets/unreal-clips/standing_stance/fighter-front.mp4');
  assert.equal(findUnrealClip('standing_stance', 'opponent', 'side').video, '/assets/unreal-clips/standing_stance/opponent-side.mp4');
  assert.deepEqual(unrealClipViews('standing_stance').map((clip) => [clip.performerSide, clip.camera]), [['fighter', 'side'], ['fighter', 'front']]);
  assert.deepEqual(unrealClipViews('standing_stance', 'opponent').map((clip) => clip.camera), ['side', 'front']);
  for (const [move, performer, camera] of [['standing_stance', 'fighter', 'overhead'], ['standing_stance', 'referee', 'side'], ['', 'fighter', 'side'], [undefined, undefined, undefined], ['__proto__', 'fighter', 'side']]) {
    assert.equal(findUnrealClip(move, performer, camera), null);
  }
  assert.deepEqual(unrealClipViews('armbar'), []);
  assert.deepEqual([UNREAL_CLIP_LOOK.fighter.gi, UNREAL_CLIP_LOOK.opponent.gi, UNREAL_CLIP_LOOK.belt], ['white', 'navy', 'black']);
  for (const swatch of [UNREAL_CLIP_LOOK.fighter.swatch, UNREAL_CLIP_LOOK.opponent.swatch]) assert.match(swatch, /^#[0-9a-f]{6}$/);
});

test('a clip is a video file and nothing more: no renderer, stream or storage code', () => {
  const imports = (path) => [...repoFile(path).toString('utf8').matchAll(/^import (?:[^'"]* from )?['"]([^'"]+)['"];?$/gm)].map((match) => match[1]);
  assert.deepEqual(imports('src/unreal/techniqueClips.js'), ['./techniqueClips.data.js']);
  assert.deepEqual(imports('src/unreal/techniqueClips.data.js'), []);
  assert.deepEqual(imports('src/components/UnrealClipStage.jsx'), ['react', 'lucide-react', '../unreal/techniqueClips.js', '../unreal/clipPlayback.js', './UnrealClipStage.css']);
  // Having a clip is not an input to renderer selection.
  assert.equal(resolveCombatRenderer('https://jiuquest.com/?clip=standing_stance'), resolveCombatRenderer('https://jiuquest.com/'));
});

test('the Arena shows the clip only for an unsettled standing position, and never over the local live preview', () => {
  const stage = repoFile('src/components/GrapplingStage.jsx').toString('utf8');
  assert.match(stage, /const IDLE_CLIP = Object\.freeze\(\{ moveId: 'standing_stance', label: 'Standing stance' \}\);/);
  // The stance the clip shows is the player's when Unreal has rendered it, else the standard one.
  assert.match(stage, /const idle = stanceLoop\(props\.fighter\?\.stance, props\.opponent\?\.stance\);/);
  assert.match(stage, /const idleClip = idleStanding && engine !== 'unreal' && findUnrealClip\(idle\.moveId, idle\.performerSide\);/);
  // `usual` is the picture without a match moment: the stance loop for an
  // unsettled standing position, else the technique's clip or the engine stage.
  assert.match(stage, /const usual = idleClip\s+\? <UnrealClipStage key="stance" moveId=\{idle\.moveId\} performerSide=\{idle\.performerSide\} moveLabel=\{IDLE_CLIP\.label\} [^>]*fallback=\{stage\} \/>/);
  // A technique shows its clip only when the picture rule says so (its behaviour is in
  // tests/unrealTechniquePicture.test.js), starts again for each new exchange, and hands
  // over to the same stage when it cannot play.
  assert.match(stage, /const picture = !idleStanding && chooseTechniquePicture\(\{[^}]*views: unrealClipViews \}\);/);
  assert.match(stage, /picture && picture\.kind === 'clip'\s+\? <UnrealClipStage key=\{`technique:\$\{picture\.moveId\}:\$\{picture\.performerSide\}:\$\{props\.signal \?\? ''\}`\} kind="technique" [^>]*fallback=\{stage\} \/>\s+: stage;/);
  // That picture is what is drawn, unless a match moment takes its place and
  // hands back to it (tests/unrealMatchMoments.test.js). Nothing else is drawn.
  assert.match(stage, /\{moment\s+\? <UnrealClipStage key=\{`moment:\$\{moment\.moveId\}:\$\{props\.signal \?\? ''\}`\} kind="moment" [^>]*fallback=\{usual\} \/>\s+: usual\}\s+<\/>;/);
  assert.equal(stage.match(/<UnrealClipStage\b/g).length, 3, 'the stance loop, the technique clip and the match moment');
});
