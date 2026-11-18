import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createLayerInput, faceBodyPasses, validateLayerInputReceipt, verifiedAthleticV2Batch } from '../tools/build_unreal_athlete_heads.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const tool = join(ROOT, 'tools', 'build_unreal_athlete_heads.mjs');
const frontBase = '/assets/unreal-athlete/athlete-01/front-base.webp';
const frontJacket = '/assets/unreal-athlete/athlete-01/front-jacket.webp';
const standingBase = '/assets/unreal-positions/standing/base.webp';
const urls = [frontBase, frontJacket, standingBase,
  '/assets/unreal-positions/standing/lead-jacket.webp',
  '/assets/unreal-positions/standing/other-jacket.webp'];
const asset = (root, url) => join(root, url.slice(1));
const digest = (data) => createHash('sha256').update(data).digest('hex');

function fixture(t) {
  const parent = resolve(tmpdir());
  const directory = mkdtempSync(join(parent, 'jiuquest-head-input-test-'));
  // Only remove this test's direct temporary child, never a supplied input root.
  t.after(() => {
    assert.equal(dirname(directory), parent);
    rmSync(directory, { recursive: true, force: true });
  });
  const input = join(directory, 'input-public');
  for (const url of urls) {
    const target = asset(input, url);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(asset(join(ROOT, 'public'), url), target);
  }
  return { directory, input };
}

test('default input remains the builder checkout public root and pins the actual five files', () => {
  const input = createLayerInput();
  assert.equal(input.root, resolve(ROOT, 'public'));
  assert.deepEqual(Object.keys(input.files), urls);
  for (const url of urls) {
    const data = readFileSync(asset(input.root, url));
    assert.deepEqual(input.files[url], { bytes: data.length, sha256: digest(data) });
    assert.deepEqual(input.read(url), data);
  }
  assert.throws(() => input.read('/assets/elsewhere.webp'), /unknown head-builder layer input/);
});

test('an explicit input root uses and pins its own bytes, with a stable snapshot during the build', (t) => {
  const { input: root } = fixture(t);
  // A different real WebP with the same dimensions proves the selected root is
  // used. This tests input routing; native-reference checks still belong to a build.
  const different = readFileSync(join(ROOT, 'public/assets/unreal-athlete/athlete-01/front-pants.webp'));
  writeFileSync(asset(root, frontJacket), different);
  const input = createLayerInput(root);
  assert.equal(input.root, resolve(root));
  assert.deepEqual(input.read(frontJacket), different);
  assert.deepEqual(input.files[frontJacket], { bytes: different.length, sha256: digest(different) });
  assert.notEqual(input.files[frontJacket].sha256, createLayerInput().files[frontJacket].sha256);
  writeFileSync(asset(root, frontJacket), 'changed after the reader opened');
  const returned = input.read(frontJacket);
  returned.fill(0);
  assert.deepEqual(input.read(frontJacket), different, 'file changes and callers cannot change the pinned snapshot');
});

test('an incomplete input root is refused instead of falling back to checkout files', (t) => {
  const { directory, input } = fixture(t);
  assert.throws(() => createLayerInput(join(directory, 'absent')), /layer input public root is not a directory/);
  rmSync(asset(input, frontJacket));
  assert.throws(() => createLayerInput(input), /layer input is missing:.*front-jacket\.webp/);
});

test('input layers must retain the expected opaque WebP format and scene size', (t) => {
  const { input } = fixture(t);
  copyFileSync(asset(input, standingBase), asset(input, frontBase));
  assert.throws(() => createLayerInput(input), /is 1620 x 1080, expected 900 x 1760/);
  writeFileSync(asset(input, frontBase), 'this is not a body layer');
  assert.throws(() => createLayerInput(input), /layer input must be an opaque VP8 WebP/);
});

test('the CLI checks the explicit input before dependencies, catalog work, or output writes', (t) => {
  const { directory } = fixture(t);
  const pack = join(directory, 'heads.json');
  writeFileSync(pack, '{}');
  const output = join(directory, 'output-public');
  const module = join(directory, 'output', 'athleteHeads.data.js');
  const absent = join(directory, 'missing-input');
  const result = spawnSync(process.execPath, [tool, pack, '--public', output, '--module', module,
    '--layer-input-public', absent], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /layer input public root is not a directory/);
  assert.ok(result.stderr.includes(absent));
  assert.equal(existsSync(output), false);
  assert.equal(existsSync(module), false);
  assert.equal(existsSync(module.replace('.data.js', '.pins.js')), false);
});

test('a missing layer-input flag value is refused before opening the catalog', () => {
  for (const flag of ['--layer-input-public', '--layer-input-receipt']) {
    for (const suffix of [[], ['--public', 'somewhere']]) {
      const result = spawnSync(process.execPath, [tool, 'no-such-catalog.json', flag, ...suffix], { encoding: 'utf8' });
      assert.equal(result.status, 1);
      assert.ok(result.stderr.includes(`${flag} needs a value`));
    }
  }
});

// Synthetic native identifiers exercise receipt matching only. These fixtures
// are never a native delivery or evidence that the repository assets are V2.
function receiptFixture(layerFiles = createLayerInput().files) {
  const names = { front: ['black', 'white', 'beltWhite'],
    standing: ['base', 'leadGiWhite', 'otherGiWhite', 'leadBeltWhite', 'otherBeltWhite'] };
  const pack = { athleticRender: { version: 2 } };
  const receipt = { schema: 1, nativeSources: {}, layers: structuredClone(layerFiles) };
  for (const [scene, keys] of Object.entries(names)) {
    receipt.nativeSources[scene] = {};
    pack[scene] = { reference: {} };
    for (const key of keys) {
      const sha256 = digest(`synthetic native test/${scene}/${key}`);
      pack[scene].reference[key] = { sha256 };
      receipt.nativeSources[scene][key] = sha256;
    }
  }
  return { pack, receipt, layerFiles };
}

test('an Athletic receipt binds all eight native references and five actual layer hashes', () => {
  const { pack, receipt, layerFiles } = receiptFixture();
  assert.equal(validateLayerInputReceipt(pack, layerFiles, receipt), true);
  assert.throws(() => validateLayerInputReceipt(pack, layerFiles), /requires --layer-input-receipt/);
  assert.equal(validateLayerInputReceipt({}, layerFiles), false, 'legacy builds retain their optional receipt behavior');
  const legacy = structuredClone(pack);
  delete legacy.athleticRender;
  assert.equal(validateLayerInputReceipt(legacy, layerFiles, receipt), true, 'a supplied legacy receipt is still checked');
});

test('each native reference must belong to the catalog batch, including belt passes', () => {
  const { pack, receipt, layerFiles } = receiptFixture();
  for (const [scene, sources] of Object.entries(receipt.nativeSources)) {
    for (const key of Object.keys(sources)) {
      const stale = structuredClone(receipt);
      stale.nativeSources[scene][key] = digest('another native batch');
      assert.throws(() => validateLayerInputReceipt(pack, layerFiles, stale), new RegExp(`native source mismatch: ${scene}/${key}`));
      const incomplete = structuredClone(pack);
      delete incomplete[scene].reference[key];
      assert.throws(() => validateLayerInputReceipt(incomplete, layerFiles, receipt), /heads.json lacks a valid/);
    }
  }
});

test('a receipt refuses stale body bytes, missing layers, extra layers, and unknown schema', () => {
  const { pack, receipt, layerFiles } = receiptFixture();
  for (const url of urls) {
    for (const field of ['bytes', 'sha256']) {
      const stale = structuredClone(receipt);
      stale.layers[url][field] = field === 'bytes' ? stale.layers[url].bytes + 1 : digest('old layer');
      assert.throws(() => validateLayerInputReceipt(pack, layerFiles, stale), /does not match the body layer bytes/);
    }
  }
  const incomplete = structuredClone(receipt);
  delete incomplete.layers[frontBase];
  assert.throws(() => validateLayerInputReceipt(pack, layerFiles, incomplete), /exactly the five/);
  const extra = structuredClone(receipt);
  extra.layers['/assets/other.webp'] = extra.layers[frontBase];
  assert.throws(() => validateLayerInputReceipt(pack, layerFiles, extra), /exactly the five/);
  assert.throws(() => validateLayerInputReceipt(pack, {}, receipt), /all five actual/);
  assert.throws(() => validateLayerInputReceipt(pack, layerFiles, { ...receipt, schema: 2 }), /schema 1/);
});

test('CLI receipt failures stop before creating output or entering the catalog build', (t) => {
  const { directory, input } = fixture(t);
  const { pack, receipt } = receiptFixture(createLayerInput(input).files);
  const packPath = join(directory, 'synthetic-heads.json');
  const receiptPath = join(directory, 'synthetic-receipt.json');
  writeFileSync(packPath, JSON.stringify(pack));
  const cases = [
    { name: 'absent', receipt: null, error: /requires --layer-input-receipt/ },
    { name: 'old-body', receipt: structuredClone(receipt), error: /does not match the body layer bytes/ },
    { name: 'wrong-batch', receipt: structuredClone(receipt), error: /native source mismatch/ },
  ];
  cases[1].receipt.layers[frontBase].sha256 = digest('stale body layer');
  cases[2].receipt.nativeSources.standing.otherBeltWhite = digest('another batch belt');
  for (const sample of cases) {
    const output = join(directory, `${sample.name}-public`);
    const module = join(directory, sample.name, 'athleteHeads.data.js');
    const args = [tool, packPath, '--public', output, '--module', module, '--layer-input-public', input];
    if (sample.receipt) {
      writeFileSync(receiptPath, JSON.stringify(sample.receipt));
      args.push('--layer-input-receipt', receiptPath);
    }
    const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.equal(result.status, 1, sample.name);
    assert.match(result.stderr, sample.error, sample.name);
    assert.equal(existsSync(output), false, sample.name);
    assert.equal(existsSync(dirname(module)), false, sample.name);
  }
});

test('the V2 native pair is limited to Dean and preserves both black and white pass pixels', () => {
  const image = (value) => ({ width: 15, height: 15, data: Buffer.alloc(15 * 15 * 3, value) });
  const black = image(85), white = image(195), donorBlack = image(10), donorWhite = image(110);
  const gi = new Uint8Array(15 * 15).fill(1);
  const use = (v2, face) => faceBodyPasses(v2, face, black, white, donorBlack, donorWhite, gi);
  const native = use(true, 'dean');
  assert.equal(native.baseImage, black);
  assert.equal(native.whiteImage, white);
  assert.equal(native.pixelsTakenFromReference, 0);
  for (const legacy of [use(false, 'dean'), use(true, 'another-face')]) {
    const center = 3 * (7 * 15 + 7);
    assert.equal(legacy.baseImage.data[center], 10);
    assert.equal(legacy.whiteImage.data[center], 110);
    assert.ok(legacy.pixelsTakenFromReference > 0);
  }
});

test('the V2 exception requires both declared pins and verifies their actual files', () => {
  const configSha256 = '7ba0ed3be16366e8d15ab5ea14d6a454e11d5bb571b839de54216e547ceff3f4';
  const preparationIndexSha256 = '9df51a17fcbed1eec970ecdafa0c69c0cf18491ae991c1fd5ba64a1c24fc4927';
  assert.equal(verifiedAthleticV2Batch(), false);
  assert.equal(verifiedAthleticV2Batch({ configSha256 }), false);
  assert.equal(verifiedAthleticV2Batch({ preparationIndexSha256 }), false);
  const render = { configSha256, preparationIndexSha256, config: tool, preparationIndex: tool };
  assert.throws(() => verifiedAthleticV2Batch(render), /Athletic V2 batch identity mismatch/);
});
