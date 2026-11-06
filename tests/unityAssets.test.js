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
    assert.equal(gltf.images?.length, 4, 'the pair shares four optimized skin/eyes/cotton images; anime hair and brows need no texture');
    assert.ok(bytes.length < 7 * 1024 * 1024, 'paired clip stays below the reviewed browser asset budget');
    for (const image of gltf.images) {
      assert.equal(image.uri, undefined, 'textures must be embedded, with no third-party fetches');
      assert.ok(Number.isInteger(image.bufferView), 'each image is in the GLB');
      assert.ok(['image/jpeg', 'image/png'].includes(image.mimeType));
    }
    for (const material of gltf.materials) {
      assert.equal(material.alphaMode ?? 'OPAQUE', 'OPAQUE', 'solid anime geometry avoids alpha overdraw and transparent sorting');
      if (/_(Hair|Brows)$/.test(material.name)) {
        assert.equal(material.pbrMetallicRoughness?.baseColorTexture, undefined, 'authored solid hair and brow shapes use direct cosmetic color');
      }
    }
    for (const mesh of gltf.meshes) for (const primitive of mesh.primitives) {
      assert.equal(primitive.attributes.JOINTS_1, undefined, 'at most four influences per vertex');
      assert.equal(primitive.attributes.WEIGHTS_1, undefined, 'reviewed Blender and runtime skinning agree');
    }
    for (const skin of gltf.skins) assert.equal(skin.joints.length, 65, 'anime styling preserves the existing 65-bone rig');
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
      for (const part of ['ChestPatch', 'Lapel_L', 'Lapel_R']) {
        const attachment = gltf.nodes.find((node) => node.name === `${role}_${part}`);
        assert.ok(attachment, `${role} ${part} reserved attachment node`);
        assert.equal(attachment.mesh, undefined, 'rigid chest decorations must not render');
        assert.equal(attachment.skin, undefined, 'empty attachment nodes cannot carry a mesh skin');
      }
      for (const part of ['Body', 'Eyes', 'Brows', 'GiJacket', 'GiPantsMesh', 'Belt', 'HairCrew', 'HairLong', 'HairSlick', 'HairMohawk', 'HairSpikes']) {
        const garment = gltf.nodes.find((node) => node.name === `${role}_${part}`);
        assert.ok(Number.isInteger(garment?.mesh), `${role} ${part} essential mesh preserved`);
        assert.ok(gltf.meshes[garment.mesh]?.primitives.length > 0, `${role} ${part} retains geometry`);
      }
      for (const slot of manifest.replacementContract.materialSlots) {
        assert.ok(gltf.materials.some((material) => material.name === `${role}_${slot}` || new RegExp(`^${role}_${slot}_Ref_[0-9A-F]{6}(?:\\.\\d+)?$`).test(material.name)), `${role} ${slot} slot`);
      }
      assert.deepEqual(gltf.nodes[rootIndex].scale ?? [1, 1, 1], [1, 1, 1], 'athletes retain natural size');
      const binOffset = 20 + bytes.readUInt32LE(12) + 8;
      for (const channel of channels.filter((entry) => entry.target.node === rootIndex && entry.target.path === 'scale')) {
        const accessor = gltf.accessors[animation.samplers[channel.sampler].output];
        const view = gltf.bufferViews[accessor.bufferView];
        assert.equal(accessor.componentType, 5126);
        for (let index = 0; index < accessor.count; index++) for (let axis = 0; axis < 3; axis++) {
          const value = bytes.readFloatLE(binOffset + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0) + index * (view.byteStride ?? 12) + axis * 4);
          assert.ok(Math.abs(value - 1) < 1e-5, 'crouching and ground transitions cannot shrink a fighter');
        }
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
