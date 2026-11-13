import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { UNREAL_CLIPS, UNREAL_CLIP_CAMERAS, UNREAL_CLIP_LOOK, findUnrealClip, unrealClipViews } from '../src/unreal/techniqueClips.js';
import { UNITY_PREVIEWS } from '../src/unity/bridge.js';
import { resolveCombatRenderer } from '../src/unreal/renderer.js';
import { UNREAL_STANCES } from '../src/unreal/stances.js';

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
    assert.equal(poster.toString('latin1', 0, 4) + poster.toString('latin1', 8, 16), 'RIFFWEBPVP8 ', `${name} poster is a lossy WebP`);
    assert.deepEqual([poster.readUInt16LE(26) & 0x3fff, poster.readUInt16LE(28) & 0x3fff], [clip.width, clip.height], `${name} poster matches the video size`);
    assert.match(clip.posterSourceSha256, /^[0-9a-f]{64}$/);
    assert.notEqual(clip.posterSourceSha256, clip.posterSha256, 'the published poster is a smaller copy of the delivered one');

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
  // A clip shows a move, or a fighting stance held or left on the feet.
  const stanceClips = UNREAL_STANCES.flatMap((stance) => [stance.loopMoveId, stance.entryMoveId]).filter(Boolean);
  const moves = new Set([...UNITY_PREVIEWS.map((move) => move.id), ...stanceClips]);
  const keys = UNREAL_CLIPS.map((clip) => `${clip.moveId}/${clip.performerSide}-${clip.camera}`);
  assert.equal(new Set(keys).size, keys.length);
  for (const clip of UNREAL_CLIPS) {
    assert.ok(moves.has(clip.moveId), `${clip.moveId} is a move or stance the game knows`);
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

test('a looping clip is a stance held on the feet, and a clip that plays once is a technique that opens on frame 0', () => {
  const stanceLoops = new Set(UNREAL_STANCES.map((stance) => stance.loopMoveId));
  // The four techniques Unity animates today (src/unity/bridge.js curriculumMoves).
  const techniques = new Set(['rear_naked_choke', 'double_leg', 'trap_roll_escape', 'triangle_choke']);
  assert.ok(UNREAL_CLIPS.some((clip) => clip.moveId === 'standing_stance'), 'the standard stance is published');
  for (const clip of UNREAL_CLIPS) {
    const name = `${clip.moveId}/${clip.performerSide}-${clip.camera}`;
    if (clip.loops) {
      assert.ok(stanceLoops.has(clip.moveId), `${name} loops, so it is a stance held on the feet`);
      assert.equal(clip.posterFrame, null, `${name} loops, so its poster is the pack's`);
    } else {
      assert.ok(techniques.has(clip.moveId) || clip.moveId.startsWith('enter_'), `${name} plays once, so it is a technique or a stance entry`);
      assert.equal(clip.posterFrame, 0, `${name} plays once, so its poster is its first frame`);
    }
  }
  assert.ok(UNREAL_CLIPS.every((clip) => clip.choreographyReviewed === false), 'no clip has had a qualified choreography review');
  // A move with no files of its own finds nothing: it never borrows another move's clip.
  const published = new Set(UNREAL_CLIPS.map((clip) => clip.moveId));
  for (const move of UNITY_PREVIEWS) {
    if (!published.has(move.id)) assert.equal(findUnrealClip(move.id), null, `${move.id} must not borrow another move's clip`);
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
  assert.match(stage, /\{idleClip\s+\? <UnrealClipStage key="stance" moveId=\{idle\.moveId\} performerSide=\{idle\.performerSide\} moveLabel=\{IDLE_CLIP\.label\} [^>]*fallback=\{stage\} \/>/);
  // A technique shows its clip only when the picture rule says so (its behaviour is in
  // tests/unrealTechniquePicture.test.js), starts again for each new exchange, and hands
  // over to the same stage when it cannot play.
  assert.match(stage, /const picture = !idleStanding && chooseTechniquePicture\(\{[^}]*views: unrealClipViews \}\);/);
  assert.match(stage, /picture && picture\.kind === 'clip'\s+\? <UnrealClipStage key=\{`technique:\$\{picture\.moveId\}:\$\{picture\.performerSide\}:\$\{props\.signal \?\? ''\}`\} kind="technique" [^>]*fallback=\{stage\} \/>\s+: stage\}/);
});
