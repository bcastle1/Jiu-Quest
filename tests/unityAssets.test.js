import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const assetRoot = new URL('../public/animations/bjj/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', assetRoot), 'utf8'));

// The new renderer imports these authored files at runtime. Validate the binary
// contract, including BOTH actors, rather than only checking that URLs exist.
for (const [move, path] of Object.entries(manifest.animations)) {
  test(`${move}: paired animation is a complete skinned GLB with a shared timeline`, async () => {
    assert.equal(path, `/animations/bjj/${move}.glb`);
    const bytes = await readFile(new URL(`${move}.glb`, assetRoot));
    assert.equal(bytes.readUInt32LE(0), 0x46546c67, 'GLB magic');
    assert.equal(bytes.readUInt32LE(4), 2, 'glTF 2.0');
    assert.equal(bytes.readUInt32LE(8), bytes.length, 'complete binary download');
    assert.equal(bytes.readUInt32LE(16), 0x4e4f534a, 'first chunk is JSON');
    const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
    assert.ok(gltf.skins?.length > 0, 'characters must be skinned, not still meshes');
    assert.equal(gltf.textures?.length ?? 0, 0, 'the current semantic-color renderer does not support texture-bearing replacements');
    assert.ok(gltf.materials.every((material) => !material.alphaMode || material.alphaMode === 'OPAQUE'), 'the current preview material contract is opaque');
    assert.equal(gltf.animations.length, 1, 'both actors must share one timeline');
    const animation = gltf.animations[0];
    const animatedNodes = new Set(animation.channels.map((channel) => channel.target.node));
    const collect = (index, result = new Set()) => {
      assert.ok(!result.has(index), 'character graph cannot contain a cycle');
      result.add(index);
      for (const child of gltf.nodes[index].children ?? []) collect(child, result);
      return result;
    };
    const intervals = [];
    for (const role of ['JQ_Attacker', 'JQ_Defender']) {
      const rootIndex = gltf.nodes.findIndex((node) => node.name === role);
      assert.ok(rootIndex >= 0, `${role} root is present`);
      const actorNodes = collect(rootIndex);
      const channels = animation.channels.filter((channel) => actorNodes.has(channel.target.node));
      assert.ok(channels.length > 3, `${role} needs skeletal motion, not just root motion`);
      assert.ok([...actorNodes].some((index) => animatedNodes.has(index)), `${role} is animated`);
      for (const slot of manifest.replacementContract.materialSlots) {
        assert.ok(gltf.materials.some((material) => material.name === `${role}_${slot}`), `${role} ${slot} slot`);
      }
      const times = channels.map((channel) => gltf.accessors[animation.samplers[channel.sampler].input]);
      const start = Math.min(...times.map((accessor) => accessor.min?.[0]));
      const end = Math.max(...times.map((accessor) => accessor.max?.[0]));
      assert.ok(Number.isFinite(start) && Number.isFinite(end) && end > start, 'nonempty finite timeline');
      intervals.push([start, end]);
    }
    assert.deepEqual(intervals[0], intervals[1], 'paired actors must have identical time bounds');
    for (const buffer of gltf.buffers ?? []) assert.equal(buffer.uri, undefined, 'GLBs may not depend on remote buffers');
  });
}
