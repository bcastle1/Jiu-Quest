import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { HELD_UNREAL_POSITION_STILLS, UNREAL_POSITION_STILLS, chooseUnrealPositionStill, findUnrealPositionStill, unrealPositionTints } from '../src/unreal/positionStills.js';
import { createArenaState, getArenaSnapshot } from '../src/arena/outcome.js';
import { beltColors } from '../src/data/curriculum.js';

const repoPath = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const repoFile = (path) => readFileSync(repoPath(path));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const SPLIT = ['base', 'leadBelt', 'leadJacket', 'leadPants', 'otherBelt', 'otherJacket', 'otherPants'];
const WHOLE = ['base', 'leadBelt', 'leadGi', 'otherBelt', 'otherGi'];
const PASSES = ['base.png', 'lead-belt-white.png', 'lead-gi-white.png', 'other-belt-white.png', 'other-gi-white.png'];
const snapshotOf = (position) => getArenaSnapshot(createArenaState(position));

test('every published position layer is the pinned file, at the size the still declares', () => {
  assert.ok(UNREAL_POSITION_STILLS.length > 0);
  for (const still of UNREAL_POSITION_STILLS) {
    const names = Object.keys(still.layers).sort();
    assert.ok([SPLIT, WHOLE].some((set) => JSON.stringify(set) === JSON.stringify(names)), `${still.position} layers: ${names}`);
    assert.deepEqual(Object.keys(still.files).sort(), names);
    assert.ok(Math.abs(still.width / still.height - 3 / 2) < 0.002, 'the still fills the three-to-two stage');
    for (const name of names) {
      const file = name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
      assert.equal(still.layers[name], `/assets/unreal-positions/${still.position}/${file}.webp`);
      const bytes = repoFile(`public${still.layers[name]}`);
      assert.equal(bytes.length, still.files[name].bytes, `${still.position}/${name} size`);
      assert.equal(sha256(bytes), still.files[name].sha256, `${still.position}/${name} was replaced or re-encoded`);
      assert.equal(bytes.toString('latin1', 0, 4) + bytes.toString('latin1', 8, 16), 'RIFFWEBPVP8 ', `${still.position}/${name} is a lossy WebP`);
      assert.deepEqual([bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff], [still.width, still.height], `${still.position}/${name} pixel size`);
    }
    // The Unreal renders the layers were built from, as the render pack listed them.
    assert.deepEqual(Object.keys(still.sources).sort(), PASSES);
    for (const digest of Object.values(still.sources)) assert.match(digest, /^[0-9a-f]{64}$/);
    assert.equal(new Set(Object.values(still.sources)).size, PASSES.length, 'five different renders');
    assert.equal(typeof still.poseReviewed, 'boolean');
    assert.ok(still.families.length > 0);
    assert.throws(() => { still.layers.base = 'changed'; }, TypeError);
    assert.throws(() => { still.families.push('mount'); }, TypeError);
  }
  assert.throws(() => { UNREAL_POSITION_STILLS.push({}); }, TypeError);
});

test('stills name real Arena pictures, with no repeats and no stray files', () => {
  const keys = UNREAL_POSITION_STILLS.map((still) => still.position);
  assert.equal(new Set(keys).size, keys.length);
  for (const still of UNREAL_POSITION_STILLS) {
    for (const family of still.families) assert.equal(snapshotOf(family).key, still.position, `${family} is pictured by ${still.position}`);
  }
  const published = [];
  for (const position of readdirSync(repoPath('public/assets/unreal-positions'))) {
    for (const file of readdirSync(repoPath(`public/assets/unreal-positions/${position}`))) published.push(`/assets/unreal-positions/${position}/${file}`);
  }
  assert.deepEqual(published.sort(), UNREAL_POSITION_STILLS.flatMap((still) => Object.values(still.layers)).sort());
});

test('only the standing position has an Unreal still so far', () => {
  assert.deepEqual(UNREAL_POSITION_STILLS.map((still) => still.position), ['standing']);
  const standing = findUnrealPositionStill('standing');
  assert.deepEqual([standing.width, standing.height, standing.camera, standing.poseReviewed], [1620, 1080, 'side', false]);
  assert.deepEqual(standing.families, ['standing']);
  assert.deepEqual(Object.keys(standing.layers).sort(), SPLIT, 'the standing gis are split at the jacket hem');
  for (const key of ['guard', 'mount', 'side-control', 'back-control', 'kneeling', 'half-guard', 'turtle', undefined]) assert.equal(findUnrealPositionStill(key), null);
});

test('a still replaces the classic picture only where it is at least as exact', () => {
  // The rule itself, with no still held back.
  const choose = (snapshot) => chooseUnrealPositionStill(snapshot, []);
  assert.equal(snapshotOf('standing').family, 'standing');
  // The neutral stance is exactly what the still shows.
  assert.deepEqual(choose(snapshotOf('standing')), { still: findUnrealPositionStill('standing'), exact: true });
  // The classic clinch picture shows the grips; the still does not, so it stays out.
  assert.equal(snapshotOf('clinch').exactPositionAvailable, true);
  assert.equal(choose(snapshotOf('clinch')), null);
  // Neither picture shows these setups, so the still stands in as a general reference.
  for (const position of ['rear-clinch', 'standing-headlock']) {
    assert.equal(snapshotOf(position).exactPositionAvailable, false);
    assert.deepEqual(choose(snapshotOf(position)), { still: findUnrealPositionStill('standing'), exact: false });
  }
  for (const position of ['guard-top', 'guard-bottom', 'mount-top', 'mount-bottom', 'side-top', 'back-control', 'kneeling']) assert.equal(choose(snapshotOf(position)), null, position);
  assert.equal(choose(null), null);
});

test('the upright standing still is held back, so players see the crouched classic picture', () => {
  // Empty this list, and this test with it, when the still is rendered again from the crouched clip.
  assert.deepEqual(HELD_UNREAL_POSITION_STILLS, ['standing']);
  assert.throws(() => { HELD_UNREAL_POSITION_STILLS.push('guard'); }, TypeError);
  for (const position of ['standing', 'rear-clinch', 'standing-headlock']) assert.equal(chooseUnrealPositionStill(snapshotOf(position)), null, position);
  assert.equal(chooseUnrealPositionStill(null), null);
  // The files stay published and pinned, ready for the new render to replace them.
  assert.ok(findUnrealPositionStill('standing'));
});

test('each layer takes its own athlete\'s color, and only a safe color', () => {
  const still = findUnrealPositionStill('standing');
  const lead = { giTop: '#112A58', giPants: '#f8fbff' };
  const other = { giTop: '#151922', giPants: 'url(javascript:alert(1))' };
  const tints = unrealPositionTints(still, { lead, other, leadBeltColor: beltColors.blue, otherBeltColor: ['#000000'] });
  assert.deepEqual(tints.map((tint) => [tint.name, tint.color]), [
    ['leadJacket', '#112a58'], ['leadPants', '#f8fbff'], ['leadBelt', beltColors.blue],
    ['otherJacket', '#151922'], ['otherPants', '#f8fbff'], ['otherBelt', '#f8fbff'],
  ]);
  for (const tint of tints) assert.equal(tint.url, still.layers[tint.name]);
  // Missing athletes still paint: white gis and white belts.
  assert.deepEqual(unrealPositionTints(still, {}).map((tint) => tint.color), Array(6).fill('#f8fbff'));
  // A still whose gis could not be split paints each whole gi in the jacket color.
  const whole = { layers: { base: '/b.webp', leadGi: '/lg.webp', otherGi: '/og.webp', leadBelt: '/lb.webp', otherBelt: '/ob.webp' } };
  assert.deepEqual(unrealPositionTints(whole, { lead, other, leadBeltColor: '#08090d', otherBeltColor: '#8b3ffc' }).map((tint) => [tint.name, tint.color]), [
    ['leadGi', '#112a58'], ['leadBelt', '#08090d'], ['otherGi', '#151922'], ['otherBelt', '#8b3ffc'],
  ]);
});

test('the snapshot stage asks the selection rule for Unreal-look players and keeps the classic picture as the fallback', () => {
  const stage = repoFile('src/components/GrapplingSnapshotStage.jsx').toString('utf8');
  assert.match(stage, /const unreal = unrealStills && usesUnrealAthlete\(fighter\) \? chooseUnrealPositionStill\(snapshot\) : null;/);
  // The Lab describes a grip exchange for Standing, which the classic picture shows and the still does not.
  assert.match(repoFile('src/components/GrapplingPositionLab.jsx').toString('utf8'), /<GrapplingSnapshotStage [^>]*unrealStills=\{false\} \/>/);
  assert.match(stage, /const showStill = Boolean\(unreal\) && stillStatus !== 'error';/);
  assert.match(stage, /if \(showStill\) return undefined;/, 'the classic picture is not rendered behind a still');
  assert.match(stage, /\{showStill\s*\? <UnrealPositionStill still=\{unreal\.still\}[^>]*lead=\{lead\} other=\{other\} leadBelt=\{leadBelt\} otherBelt=\{otherBelt\}[^>]*\/>\s*: <canvas /);
  const component = repoFile('src/components/UnrealPositionStill.jsx').toString('utf8');
  assert.match(component, /if \(!complete\) loads\.delete\(still\.position\);/, 'a failed load is tried again next time');
  // The data and its helpers bring in nothing that could start a renderer.
  const module = repoFile('src/unreal/positionStills.js').toString('utf8');
  assert.deepEqual([...module.matchAll(/^import .* from '(.+)';$/gm)].map((match) => match[1]), ['./positionStills.data.js', './athlete.js']);
  assert.doesNotMatch(repoFile('src/unreal/positionStills.data.js').toString('utf8'), /^import /m);
});
