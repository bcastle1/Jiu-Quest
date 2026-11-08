import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildPlan, describeClip, parseGlb, sha256, stage} from './prepare_unreal_pilot.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
test('the three pinned source clips retain both rigs, duration and separate material UV channels', () => {
  const plan = buildPlan(root);
  assert.equal(plan.clips.length, 3);
  for (const clip of plan.clips) {
    assert.equal(clip.skins.length, 2);
    assert.ok(clip.durationSeconds > 0);
    assert.equal(clip.images.length, 7);
    for (const m of clip.materials.filter(m => /GiTop|GiPants/.test(m.name))) {
      assert.equal(m.normalTexture.uv, 1);
      assert.equal(m.colorTexture.uv, 1);
      assert.equal(m.roughnessTexture.uv, 0);
    }
  }
});
test('truncated GLBs and changed pinned source bytes are rejected', () => {
  const expected = buildPlan(root).clips[0];
  const bytes = fs.readFileSync(path.join(root, expected.source));
  assert.throws(() => parseGlb(bytes.subarray(0, bytes.length - 4)));
  const damaged = Buffer.from(bytes); damaged[damaged.length - 9] ^= 1;
  assert.throws(() => describeClip(damaged, expected), /hash/);
});
test('external image references cannot enter the offline pilot', () => {
  const expected = buildPlan(root).clips[0];
  const bytes = fs.readFileSync(path.join(root, expected.source));
  const {json, bin} = parseGlb(bytes);
  json.images[0].uri = 'https://example.invalid/not-local.png';
  const encoded = Buffer.from(JSON.stringify(json));
  const padded = Buffer.alloc(Math.ceil(encoded.length / 4) * 4, 0x20); encoded.copy(padded);
  const modified = Buffer.alloc(28 + padded.length + bin.length);
  modified.writeUInt32LE(0x46546c67, 0); modified.writeUInt32LE(2, 4); modified.writeUInt32LE(modified.length, 8);
  modified.writeUInt32LE(padded.length, 12); modified.writeUInt32LE(0x4e4f534a, 16); padded.copy(modified, 20);
  modified.writeUInt32LE(bin.length, 20 + padded.length); modified.writeUInt32LE(0x004e4942, 24 + padded.length); bin.copy(modified, 28 + padded.length);
  assert.throws(() => describeClip(modified, {...expected, bytes:modified.length, sha256:sha256(modified)}), /embedded images/);
});
test('staging is exact and idempotent, and refuses altered existing output', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'jq-unreal-stage-'));
  try {
    const plan = buildPlan(root);
    for (const clip of plan.clips) {
      const target = path.join(temporary, clip.source);
      fs.mkdirSync(path.dirname(target), {recursive:true});
      fs.copyFileSync(path.join(root, clip.source), target);
    }
    const first = stage(temporary, plan), second = stage(temporary, plan);
    assert.equal(first.manifest, second.manifest);
    const staged = path.join(first.destination, 'standing_stance.glb');
    assert.deepEqual(fs.readFileSync(staged), fs.readFileSync(path.join(root, plan.clips[0].source)));
    fs.writeFileSync(staged, 'tampered');
    assert.throws(() => stage(temporary, plan), /Refusing/);
  } finally {
    assert.ok(path.resolve(temporary).startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(temporary).startsWith('jq-unreal-stage-'));
    fs.rmSync(temporary, {recursive:true, force:true});
  }
});
