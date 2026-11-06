import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { sourceSnapshot, verifySnapshot, validateBundle, pack, restore, verifySite } from '../tools/unity_release.mjs';

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jiuquest-release-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const put = (name, value) => { fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); fs.writeFileSync(path.join(root, name), value); };
  put('unity/JiuQuestCombat/Assets/JiuQuest/Runtime.cs', 'class Runtime {}\r\n');
  put('unity/JiuQuestCombat/Packages/manifest.json', '{}\n');
  put('unity/JiuQuestCombat/ProjectSettings/ProjectVersion.txt', '6000.3.28f1\n');
  const moves = Array.from({ length: 16 }, (_, index) => `move_${String.fromCharCode(97 + index)}`);
  for (const move of moves) put(`public/animations/bjj/${move}.glb`, `binary:${move}`);
  put('public/animations/bjj/manifest.json', '{}\n');
  const manifest = { protocolVersion: 1, unityVersion: '6000.3.28f1', streamingAssetsUrl: '/unity/StreamingAssets', supportedMoves: moves,
    loaderUrl: '/unity/Build/abc.loader.js', dataUrl: '/unity/Build/def.data.unityweb', frameworkUrl: '/unity/Build/ghi.framework.js.unityweb', codeUrl: '/unity/Build/jkl.wasm.unityweb' };
  const payload = {
    'Build/abc.loader.js': Buffer.from('window.createUnityInstance = () => {};'),
    'Build/def.data.unityweb': zlib.gzipSync(Buffer.from('data')),
    'Build/ghi.framework.js.unityweb': zlib.gzipSync(Buffer.from('framework')),
    'Build/jkl.wasm.unityweb': zlib.gzipSync(Buffer.from([0, 97, 115, 109, 1, 0, 0, 0])),
    'build-manifest.json': Buffer.from(JSON.stringify(manifest)),
    'build-privacy-check.json': Buffer.from(JSON.stringify({ generatedPerformanceMetadataExcluded: true, packedAssetsChecked: 42 })),
    'build-source.json': Buffer.from(JSON.stringify(sourceSnapshot(root))),
  };
  for (const name of [...moves.map((move) => `${move}.glb`), 'manifest.json']) payload[`StreamingAssets/Bjj/${name}`] = fs.readFileSync(path.join(root, 'public/animations/bjj', name));
  for (const [name, bytes] of Object.entries(payload)) put(`public/unity/${name}`, bytes);
  put('public/unity/build-sha256.txt', Object.entries(payload).map(([name, bytes]) => `${hash(bytes)}  ${name}`).join('\n'));
  return { root, put, payload };
}

test('source provenance survives checkout line endings and rejects source changes', (t) => {
  const { root, put } = fixture(t);
  const snapshot = sourceSnapshot(root);
  put('unity/JiuQuestCombat/Assets/JiuQuest/Runtime.cs', 'class Runtime {}\n');
  assert.doesNotThrow(() => verifySnapshot(snapshot, root));
  put('unity/JiuQuestCombat/Assets/JiuQuest/Runtime.cs', 'class DifferentRuntime {}\n');
  assert.throws(() => verifySnapshot(snapshot, root), /changed after/);
});

test('release round trip restores exact engine and all separate clips without a Unity license', (t) => {
  const { root, payload, put } = fixture(t);
  const release = pack(root);
  fs.rmSync(path.join(root, 'public/unity'), { recursive: true });
  const result = restore(root);
  assert.equal(result.files, 24);
  assert.equal(result.moves, 16);
  for (const [name, bytes] of Object.entries(payload)) assert.deepEqual(fs.readFileSync(path.join(root, 'public/unity', name)), bytes);
  assert.equal(release.files.length, 7);
  fs.cpSync(path.join(root, 'public/unity'), path.join(root, 'dist/unity'), { recursive: true });
  put('dist/index.html', '<script src="/assets/app.js"></script>');
  put('dist/CNAME', 'jiuquest.com');
  assert.equal(verifySite(path.join(root, 'dist'), root).verifiedFiles, 24);
  put('dist/unity/Build/abc.loader.js', 'wrong');
  assert.throws(() => verifySite(path.join(root, 'dist'), root), /exact approved player/);
});

test('release rejects a corrupted archive before writing output', (t) => {
  const { root, put } = fixture(t);
  pack(root);
  const existing = fs.readFileSync(path.join(root, 'public/unity/build-manifest.json'));
  put('releases/unity/player.bundle.gz', 'corrupt');
  assert.throws(() => restore(root), /archive hash mismatch/);
  assert.deepEqual(fs.readFileSync(path.join(root, 'public/unity/build-manifest.json')), existing);
});

test('release restoration tolerates Git checkout line endings in the clip manifest', (t) => {
  const { root, put } = fixture(t);
  pack(root);
  put('public/animations/bjj/manifest.json', '{}\r\n');
  assert.doesNotThrow(() => restore(root));
  assert.equal(fs.readFileSync(path.join(root, 'public/unity/StreamingAssets/Bjj/manifest.json'), 'utf8'), '{}\n');
});

test('release rejects updated choreography and stale staged copies', (t) => {
  const { root, put } = fixture(t);
  pack(root);
  put('public/animations/bjj/move_a.glb', 'changed');
  assert.throws(() => restore(root), /changed after/);
  assert.throws(() => pack(root), /changed after/);
});

test('bundle allowlist blocks traversal even when content hashes are internally consistent', (t) => {
  const { root } = fixture(t);
  pack(root);
  const bundle = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root, 'releases/unity/player.bundle.gz'))));
  bundle.files.push({ path: '../../escape.txt', bytes: 4, sha256: hash('evil'), content: Buffer.from('evil').toString('base64') });
  assert.throws(() => validateBundle(bundle), /Unexpected file/);
});

test('pack refuses a player without privacy verification', (t) => {
  const { root, put, payload } = fixture(t);
  payload['build-privacy-check.json'] = Buffer.from('{"generatedPerformanceMetadataExcluded":false}');
  put('public/unity/build-privacy-check.json', payload['build-privacy-check.json']);
  put('public/unity/build-sha256.txt', Object.entries(payload).map(([name, bytes]) => `${hash(bytes)}  ${name}`).join('\n'));
  assert.throws(() => pack(root), /privacy verification/);
});
