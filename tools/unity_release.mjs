import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UNITY = 'unity/JiuQuestCombat';
const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const json = (file) => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const sorted = (items) => items.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
const fail = (message) => { throw new Error(message); };
const writeJson = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); };
const clipBytes = (name, bytes) => name.endsWith('.json') ? Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n')) : bytes;

function walk(root, dir) {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const relative = `${dir}/${entry.name}`;
    if (entry.isSymbolicLink()) fail(`Symlink is not a release input: ${relative}`);
    return entry.isDirectory() ? walk(root, relative) : [relative];
  });
}

// Text checkout line endings differ on Windows and Linux. Binary GLBs do not.
export function sourceSnapshot(root = REPO) {
  const names = sorted([
    ...walk(root, `${UNITY}/Assets/JiuQuest`),
    ...walk(root, `${UNITY}/Packages`).filter((name) => name.endsWith('.json')),
    ...walk(root, `${UNITY}/ProjectSettings`),
    ...walk(root, 'public/animations/bjj').filter((name) => /\.(glb|json)$/.test(name)),
  ]);
  const files = names.map((name) => {
    const raw = fs.readFileSync(path.join(root, name));
    const content = name.endsWith('.glb') ? raw : Buffer.from(raw.toString('utf8').replace(/\r\n/g, '\n'));
    return { path: name, sha256: digest(content) };
  });
  return { format: 1, fingerprint: digest(JSON.stringify(files)), files };
}

export function verifySnapshot(expected, root = REPO) {
  const current = sourceSnapshot(root);
  if (expected.format !== 1 || expected.fingerprint !== current.fingerprint || JSON.stringify(expected.files) !== JSON.stringify(current.files)) {
    fail('Unity source or animation assets changed after this player was built. Rebuild Unity before packaging.');
  }
  return current;
}

function playerPaths(manifest) {
  if (manifest.protocolVersion !== 1 || manifest.unityVersion !== '6000.3.28f1' || manifest.streamingAssetsUrl !== '/unity/StreamingAssets') fail('Unexpected player version or asset route.');
  const files = ['loaderUrl', 'dataUrl', 'frameworkUrl', 'codeUrl'].map((key) => {
    const value = manifest[key];
    if (typeof value !== 'string' || !/^\/unity\/Build\/[a-zA-Z0-9_.-]+$/.test(value)) fail(`Unsafe player path: ${key}`);
    return value.slice('/unity/'.length);
  });
  if (!files[0].endsWith('.loader.js') || !files[1].endsWith('.data.unityweb') || !files[2].endsWith('.framework.js.unityweb') || !files[3].endsWith('.wasm.unityweb') || new Set(files).size !== 4) fail('Release requires a gzip player with decompression fallback.');
  return [...files, 'build-manifest.json', 'build-privacy-check.json', 'build-source.json'];
}

function clipPaths(manifest) {
  const moves = manifest.supportedMoves;
  if (!Array.isArray(moves) || moves.length !== 16 || new Set(moves).size !== 16 || moves.some((move) => !/^[a-z_]+$/.test(move))) fail('Unexpected authored move inventory.');
  return [...moves.map((move) => `${move}.glb`), 'manifest.json'];
}

function checkedFile(root, relative) {
  const absolute = path.join(root, relative);
  if (!fs.lstatSync(absolute).isFile()) fail(`Not a regular file: ${relative}`);
  const bytes = fs.readFileSync(absolute);
  return { path: relative, bytes: bytes.length, sha256: digest(bytes), content: bytes.toString('base64') };
}

export function validateBundle(bundle) {
  if (bundle.format !== 1 || !Array.isArray(bundle.files)) fail('Unknown Unity release bundle.');
  const byPath = new Map();
  for (const entry of bundle.files) {
    if (byPath.has(entry.path) || typeof entry.content !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(entry.content)) fail('Duplicate or malformed release file.');
    const bytes = Buffer.from(entry.content, 'base64');
    if (bytes.length !== entry.bytes || digest(bytes) !== entry.sha256) fail(`Unity payload hash mismatch: ${entry.path}`);
    byPath.set(entry.path, bytes);
  }
  const parse = (name) => JSON.parse((byPath.get(name) || fail(`Missing ${name}`)).toString('utf8'));
  const manifest = parse('build-manifest.json');
  const allowed = playerPaths(manifest);
  if (byPath.size !== allowed.length || allowed.some((name) => !byPath.has(name))) fail('Unexpected file in Unity release bundle.');
  const privacy = parse('build-privacy-check.json');
  if (privacy.generatedPerformanceMetadataExcluded !== true || !(privacy.packedAssetsChecked > 0)) fail('Unity build privacy verification is missing.');
  const source = parse('build-source.json');
  const wasm = zlib.gunzipSync(byPath.get(manifest.codeUrl.slice('/unity/'.length)), { maxOutputLength: 128 * 1024 * 1024 });
  if (!wasm.subarray(0, 4).equals(Buffer.from([0, 97, 115, 109]))) fail('Release does not contain a gzip WebAssembly player.');
  return { byPath, manifest, source, clips: clipPaths(manifest) };
}

export function pack(root = REPO) {
  const output = path.join(root, 'public/unity');
  const manifest = json(path.join(output, 'build-manifest.json'));
  const snapshot = json(path.join(output, 'build-source.json'));
  verifySnapshot(snapshot, root);
  const buildHashes = new Map(fs.readFileSync(path.join(output, 'build-sha256.txt'), 'utf8').trim().split(/\r?\n/).map((line) => [line.slice(66), line.slice(0, 64)]));
  const files = playerPaths(manifest).map((name) => checkedFile(output, name));
  const clips = clipPaths(manifest).map((name) => {
    const original = checkedFile(path.join(root, 'public/animations/bjj'), name);
    const staged = checkedFile(output, `StreamingAssets/Bjj/${name}`);
    if (original.sha256 !== staged.sha256 || buildHashes.get(staged.path) !== staged.sha256) fail(`Staged choreography differs: ${name}`);
    const canonical = clipBytes(name, Buffer.from(original.content, 'base64'));
    return { path: name, bytes: canonical.length, sha256: digest(canonical) };
  });
  for (const file of files) if (buildHashes.get(file.path) !== file.sha256) fail(`Build verification mismatch: ${file.path}`);
  const bundle = { format: 1, files };
  validateBundle(bundle);
  const archive = zlib.gzipSync(Buffer.from(JSON.stringify(bundle)), { level: 9 });
  const release = {
    format: 1, player: 'player.bundle.gz', bytes: archive.length, sha256: digest(archive),
    sourceFingerprint: snapshot.fingerprint, unityVersion: manifest.unityVersion, generatedUtc: manifest.generatedUtc,
    compression: 'gzip-with-decompression-fallback',
    files: files.map(({ content, ...metadata }) => metadata), clips,
  };
  fs.mkdirSync(path.join(root, 'releases/unity'), { recursive: true });
  fs.writeFileSync(path.join(root, 'releases/unity/player.bundle.gz'), archive);
  writeJson(path.join(root, 'releases/unity/release.json'), release);
  return release;
}

export function restore(root = REPO) {
  const release = json(path.join(root, 'releases/unity/release.json'));
  if (release.format !== 1 || release.player !== 'player.bundle.gz') fail('Unknown release descriptor.');
  const archive = fs.readFileSync(path.join(root, 'releases/unity/player.bundle.gz'));
  if (archive.length > 64 * 1024 * 1024 || archive.length !== release.bytes || digest(archive) !== release.sha256) fail('Unity release archive hash mismatch.');
  const bundle = JSON.parse(zlib.gunzipSync(archive, { maxOutputLength: 128 * 1024 * 1024 }).toString('utf8'));
  const { byPath, manifest, source, clips } = validateBundle(bundle);
  verifySnapshot(source, root);
  if (release.sourceFingerprint !== source.fingerprint || JSON.stringify(release.files) !== JSON.stringify(bundle.files.map(({ content, ...metadata }) => metadata))) fail('Release descriptor differs from player.');
  if (!Array.isArray(release.clips) || JSON.stringify(release.clips.map((clip) => clip.path)) !== JSON.stringify(clips)) fail('Choreography inventory mismatch.');
  // Validate every byte before writing. No archive-supplied path is extracted.
  for (const clip of release.clips) {
    const content = clipBytes(clip.path, fs.readFileSync(path.join(root, 'public/animations/bjj', clip.path)));
    if (content.length !== clip.bytes || digest(content) !== clip.sha256) fail(`Choreography hash mismatch: ${clip.path}`);
    byPath.set(`StreamingAssets/Bjj/${clip.path}`, content);
  }
  const output = path.join(root, 'public/unity');
  // Replace only this repo's generated player directory, after all validation.
  // Leaving old hashed builds here would silently ship stale player contents.
  if (fs.lstatSync(path.join(root, 'public')).isSymbolicLink()) fail('Public output cannot be a symlink.');
  if (fs.existsSync(output)) {
    if (fs.lstatSync(output).isSymbolicLink() || !fs.existsSync(path.join(output, 'build-manifest.json'))) fail('Refusing to replace an unrecognized player output directory.');
    if (path.resolve(output) !== path.resolve(root, 'public', 'unity')) fail('Player output escaped the repository.');
    fs.rmSync(output, { recursive: true });
  }
  for (const [name, bytes] of byPath) {
    const file = path.join(output, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
  }
  return { files: byPath.size, playerBytes: release.bytes, sourceFingerprint: source.fingerprint, moves: manifest.supportedMoves.length };
}

export function verifySite(site, root = REPO) {
  const release = json(path.join(root, 'releases/unity/release.json'));
  const expected = [...release.files, ...release.clips.map((clip) => ({ ...clip, path: `StreamingAssets/Bjj/${clip.path}` }))];
  const actualPaths = sorted(walk(site, 'unity').map((name) => name.slice('unity/'.length)));
  if (JSON.stringify(actualPaths) !== JSON.stringify(sorted(expected.map((entry) => entry.path)))) fail('Website contains unexpected or missing Unity files.');
  for (const entry of expected) {
    const bytes = fs.readFileSync(path.join(site, 'unity', entry.path));
    if (bytes.length !== entry.bytes || digest(bytes) !== entry.sha256) fail(`Website is missing the exact approved player: ${entry.path}`);
  }
  if (!fs.readFileSync(path.join(site, 'index.html'), 'utf8').includes('/assets/')) fail('Website entry point is missing.');
  if (fs.readFileSync(path.join(site, 'CNAME'), 'utf8').trim() !== 'jiuquest.com') fail('Unexpected production domain.');
  return { verifiedFiles: expected.length, sourceFingerprint: release.sourceFingerprint, archiveSha256: release.sha256 };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const command = process.argv[2];
    const outputIndex = process.argv.indexOf('--output');
    const output = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined;
    let result;
    if (command === 'snapshot' && output) { result = sourceSnapshot(); writeJson(output, result); }
    else if (command === 'verify-snapshot' && output) result = verifySnapshot(json(output));
    else if (command === 'pack') result = pack();
    else if (command === 'restore') result = restore();
    else if (command === 'verify-site') result = verifySite(path.resolve(process.argv[3] || 'dist'));
    else fail('Usage: unity_release.mjs snapshot|verify-snapshot --output FILE, pack, restore, or verify-site [DIST]');
    console.log(JSON.stringify({ command, ...result, files: Array.isArray(result.files) ? result.files.length : result.files }, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
