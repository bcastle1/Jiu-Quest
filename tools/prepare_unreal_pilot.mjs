import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export const PILOT_CLIPS = ['standing_stance', 'rear_naked_choke', 'armbar'];
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const projectRelative = 'unreal/JiuQuestCharacters';

export function parseGlb(bytes) {
  assert.ok(bytes.length >= 28, 'Truncated GLB');
  assert.equal(bytes.readUInt32LE(0), 0x46546c67, 'GLB magic');
  assert.equal(bytes.readUInt32LE(4), 2, 'glTF version');
  assert.equal(bytes.readUInt32LE(8), bytes.length, 'GLB length');
  let json, bin;
  for (let offset = 12; offset < bytes.length;) {
    assert.ok(offset + 8 <= bytes.length, 'Truncated chunk header');
    const size = bytes.readUInt32LE(offset), type = bytes.readUInt32LE(offset + 4);
    assert.equal(size % 4, 0, 'Chunk alignment');
    assert.ok(offset + 8 + size <= bytes.length, 'Truncated chunk');
    const data = bytes.subarray(offset + 8, offset + 8 + size);
    if (type === 0x4e4f534a) { assert.equal(json, undefined); json = JSON.parse(data.toString('utf8')); }
    else if (type === 0x004e4942) { assert.equal(bin, undefined); bin = data; }
    offset += 8 + size;
  }
  assert.ok(json && bin, 'Embedded JSON and BIN required');
  assert.equal(json.buffers.length, 1);
  assert.equal(json.buffers[0].uri, undefined, 'External buffers prohibited');
  assert.ok(json.buffers[0].byteLength <= bin.length);
  return {json, bin};
}

export function describeClip(bytes, expected) {
  assert.equal(bytes.length, expected.bytes, 'Source size differs from pinned baseline');
  assert.equal(sha256(bytes), expected.sha256, 'Source hash differs from pinned baseline');
  const {json: j, bin} = parseGlb(bytes);
  for (const role of ['Attacker', 'Defender']) {
    assert.ok(j.nodes.some(n => n.name === `JQ_${role}`), 'Missing paired root');
    const skin = j.skins.find(s => s.name === `JQ_${role}_Rig`);
    assert.equal(skin?.joints.length, 65, 'Unexpected source skeleton');
  }
  assert.equal(j.animations.length, 1, 'One paired source animation expected');
  const times = j.animations[0].samplers.map(s => j.accessors[s.input]);
  assert.ok(times.every(a => a.componentType === 5126 && a.type === 'SCALAR' && a.min && a.max));
  const images = j.images.map((im, index) => {
    assert.equal(im.uri, undefined, 'Only embedded images accepted');
    const view = j.bufferViews[im.bufferView];
    assert.ok(view && (view.buffer ?? 0) === 0, 'Invalid image buffer view');
    const start = view.byteOffset ?? 0, end = start + view.byteLength;
    assert.ok(start >= 0 && end <= bin.length, 'Image outside BIN');
    const extension = {'image/png': 'png', 'image/jpeg': 'jpg'}[im.mimeType];
    assert.ok(extension, 'Unexpected image type');
    const data = bin.subarray(start, end), hash = sha256(data);
    return {index, sourceName: im.name, file: `textures/${hash}.${extension}`, sha256: hash, bytes: data.length};
  });
  const texture = info => {
    if (!info) return null;
    assert.ok(!info.extensions, 'Texture transforms/extensions need explicit import handling');
    const tx = j.textures[info.index];
    assert.ok(tx && images[tx.source], 'Invalid texture source');
    return {image: tx.source, uv: info.texCoord ?? 0, scale: info.scale ?? 1};
  };
  const materials = j.materials.map(m => {
    const p = m.pbrMetallicRoughness ?? {};
    return {name: m.name, doubleSided: m.doubleSided ?? false,
      baseColor: p.baseColorFactor ?? [1, 1, 1, 1], metallic: p.metallicFactor ?? 1,
      roughness: p.roughnessFactor ?? 1, colorTexture: texture(p.baseColorTexture),
      roughnessTexture: texture(p.metallicRoughnessTexture), normalTexture: texture(m.normalTexture)};
  });
  for (const material of materials.filter(m => /GiTop|GiPants|_Belt$/.test(m.name))) {
    assert.equal(material.normalTexture?.uv, 1, 'Cloth normals must retain UV1');
    assert.equal(material.colorTexture?.uv, 1, 'Cloth color must retain UV1');
    assert.equal(material.roughnessTexture?.uv, 0, 'Cloth roughness must retain UV0');
  }
  return {...expected, durationSeconds: Math.max(...times.map(a => a.max[0])),
    firstKeySeconds: Math.min(...times.map(a => a.min[0])), images, materials,
    skins: j.skins.map(s => ({name: s.name, joints: s.joints.length})),
    sourceNodes: j.nodes.map((n, index) => ({index, name: n.name, mesh: n.mesh, skin: n.skin,
      children: n.children, translation: n.translation, rotation: n.rotation, scale: n.scale})),
    animationChannels: j.animations[0].channels.length};
}

export function buildPlan(repoRoot) {
  const project = path.join(repoRoot, projectRelative);
  const pinned = JSON.parse(fs.readFileSync(path.join(project, 'pilot-assets.json')));
  assert.deepEqual(pinned.clips.map(c => c.name), PILOT_CLIPS);
  assert.match(pinned.baselineCommit, /^[0-9a-f]{40}$/);
  const clips = pinned.clips.map(expected => {
    assert.equal(expected.source, `public/animations/bjj/${expected.name}.glb`);
    return describeClip(fs.readFileSync(path.join(repoRoot, expected.source)), expected);
  });
  const fingerprint = sha256(Buffer.from(JSON.stringify(pinned)));
  return {format: 1, status: 'source_verified_not_imported', baselineCommit: pinned.baselineCommit,
    fingerprint, engine: '5.8', clips, expectedRoles: ['JQ_Attacker', 'JQ_Defender'],
    normalConvention: 'glTF OpenGL tangent normals; Unreal texture import must flip green',
    animationValidation: 'Unreal actor bindings, root transforms, durations and paired contact are not yet verified'};
}

export function stage(repoRoot, plan) {
  assert.match(plan.fingerprint, /^[0-9a-f]{64}$/);
  assert.deepEqual(plan.clips.map(c => c.name), PILOT_CLIPS);
  const base = path.resolve(repoRoot, projectRelative, 'Saved/PilotStaging');
  const destination = path.join(base, plan.fingerprint);
  fs.mkdirSync(destination, {recursive: true});
  const put = (relative, bytes) => {
    const file = path.resolve(destination, relative);
    assert.ok(file.startsWith(destination + path.sep), 'Staged path escaped destination');
    fs.mkdirSync(path.dirname(file), {recursive: true});
    if (fs.existsSync(file)) assert.equal(sha256(fs.readFileSync(file)), sha256(bytes), 'Refusing to replace changed staged file');
    else fs.writeFileSync(file, bytes, {flag: 'wx'});
    assert.equal(sha256(fs.readFileSync(file)), sha256(bytes));
  };
  for (const clip of plan.clips) {
    assert.equal(clip.source, `public/animations/bjj/${clip.name}.glb`);
    const bytes = fs.readFileSync(path.join(repoRoot, clip.source));
    assert.equal(sha256(bytes), clip.sha256, 'Source changed during staging');
    put(`${clip.name}.glb`, bytes);
    const {json, bin} = parseGlb(bytes);
    for (const im of clip.images) {
      const v = json.bufferViews[json.images[im.index].bufferView], start = v.byteOffset ?? 0;
      put(im.file, bin.subarray(start, start + v.byteLength));
    }
  }
  put('manifest.json', Buffer.from(JSON.stringify(plan, null, 2) + '\n'));
  fs.writeFileSync(path.join(base, 'current.json'), JSON.stringify({fingerprint: plan.fingerprint, manifest: `${plan.fingerprint}/manifest.json`}, null, 2) + '\n');
  return {destination, manifest: path.join(destination, 'manifest.json')};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  assert.ok(process.argv.slice(2).every(a => a === '--stage'), 'Usage: node tools/prepare_unreal_pilot.mjs [--stage]');
  const plan = buildPlan(repoRoot);
  const result = {status: plan.status, baselineCommit: plan.baselineCommit, fingerprint: plan.fingerprint,
    clips: plan.clips.map(c => ({name: c.name, bytes: c.bytes, sha256: c.sha256, durationSeconds: c.durationSeconds}))};
  if (process.argv.includes('--stage')) result.staged = stage(repoRoot, plan);
  console.log(JSON.stringify(result, null, 2));
}
