import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';

const assetRoot = new URL('../public/animations/bjj/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', assetRoot), 'utf8'));

// Cosmetic colors multiply the authored atlas. A colored or transparent texel
// would change the player's chosen gi, belt or hair color unexpectedly.
function assertNeutralAtlas(png, name) {
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${name}: PNG color atlas`);
  let width, height, channels;
  const data = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset), type = png.toString('ascii', offset + 4, offset + 8);
    const chunk = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = chunk.readUInt32BE(0); height = chunk.readUInt32BE(4);
      assert.equal(chunk[8], 8, `${name}: byte color depth`);
      assert.ok([2, 6].includes(chunk[9]), `${name}: RGB or RGBA`);
      channels = chunk[9] === 2 ? 3 : 4;
      assert.equal(chunk[12], 0, `${name}: noninterlaced`);
    } else if (type === 'IDAT') data.push(chunk);
    offset += length + 12;
  }
  assert.ok(width > 0 && height > 0 && width <= 1024 && height <= 1024, `${name}: bounded atlas dimensions`);
  const stride = width * channels, raw = inflateSync(Buffer.concat(data));
  assert.equal(raw.length, height * (stride + 1));
  let previous = Buffer.alloc(stride), minimum = 255, maximum = 0;
  const paeth = (a, b, c) => {
    const p = a + b - c, da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c);
    return da <= db && da <= dc ? a : db <= dc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], row = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    assert.ok(filter <= 4, `${name}: valid PNG filter`);
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? row[x - channels] : 0, up = previous[x], upperLeft = x >= channels ? previous[x - channels] : 0;
      const predictor = [0, left, up, Math.floor((left + up) / 2), paeth(left, up, upperLeft)][filter];
      row[x] = (row[x] + predictor) & 255;
    }
    for (let x = 0; x < stride; x += channels) {
      assert.equal(row[x], row[x + 1], `${name}: neutral R/G`);
      assert.equal(row[x], row[x + 2], `${name}: neutral R/B`);
      if (channels === 4) assert.equal(row[x + 3], 255, `${name}: opaque texels`);
      minimum = Math.min(minimum, row[x]); maximum = Math.max(maximum, row[x]);
    }
    previous = row;
  }
  assert.ok(maximum > minimum, `${name}: contains authored tonal detail`);
}

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
    assert.equal(gltf.images?.length, 6, 'both actors share the four source images and two original cloth/hair atlases');
    assert.ok(bytes.length < 9 * 1024 * 1024, 'reference-detail paired clip stays below its 9 MiB asset budget');
    const binOffset = 20 + bytes.readUInt32LE(12) + 8;
    const imageBytes = [];
    for (const image of gltf.images) {
      assert.equal(image.uri, undefined, 'textures must be embedded, with no third-party fetches');
      assert.ok(Number.isInteger(image.bufferView), 'each image is in the GLB');
      assert.ok(['image/jpeg', 'image/png'].includes(image.mimeType));
      const view = gltf.bufferViews[image.bufferView];
      const start = binOffset + (view.byteOffset ?? 0);
      imageBytes.push(bytes.subarray(start, start + view.byteLength));
    }
    assert.equal(new Set(imageBytes.map(image => createHash('sha256').update(image).digest('hex'))).size,
      imageBytes.length, 'embedded images are shared rather than duplicated per actor or garment');
    const atlasSources = { cloth: new Set(), hair: new Set() }, foldNormalSources = new Set();
    const textureCoord = info => info.extensions?.KHR_texture_transform?.texCoord ?? info.texCoord ?? 0;
    for (const material of gltf.materials) {
      assert.equal(material.alphaMode ?? 'OPAQUE', 'OPAQUE', 'solid anime geometry avoids alpha overdraw and transparent sorting');
      const pbr = material.pbrMetallicRoughness ?? {};
      const slotName = material.name.replace(/_Ref_[0-9A-F]{6}(?:\.\d+)?$/, '');
      const cloth = /_(GiTop|GiPants|Belt)$/.test(slotName), hair = /_Hair$/.test(slotName);
      if (cloth || hair) {
        assert.deepEqual(pbr.baseColorFactor ?? [1, 1, 1, 1], [1, 1, 1, 1], 'neutral atlas factor must not double-darken cosmetic tint');
        assert.equal(material.name.includes('_Ref_'), false, 'neutral atlases use the runtime white reference');
        assert.ok(pbr.baseColorTexture, `${material.name}: original color atlas`);
        assert.equal(textureCoord(pbr.baseColorTexture), cloth ? 1 : 0, 'cloth construction artwork uses UV1; hair uses UV0');
        atlasSources[cloth ? 'cloth' : 'hair'].add(gltf.textures[pbr.baseColorTexture.index].source);
        if (cloth) {
          assert.ok(material.normalTexture && pbr.metallicRoughnessTexture, 'woven cloth retains authored normal and roughness maps');
          assert.equal(textureCoord(material.normalTexture), 1, 'fold relief follows the garment panels on UV1');
          foldNormalSources.add(gltf.textures[material.normalTexture.index].source);
          assert.equal(textureCoord(pbr.metallicRoughnessTexture), 0, 'original roughness keeps UV0');
        }
      }
      if (/_Brows$/.test(material.name)) {
        assert.equal(pbr.baseColorTexture, undefined, 'joined brows and upper lids keep direct cosmetic color');
      }
    }
    for (const [kind, sources] of Object.entries(atlasSources)) {
      assert.equal(sources.size, 1, `${kind}: one shared atlas for the pair`);
      const index = [...sources][0];
      assert.ok(Number.isInteger(index), `${kind}: embedded image source`);
      assertNeutralAtlas(imageBytes[index], `${move} ${kind}`);
    }
    assert.notEqual([...atlasSources.cloth][0], [...atlasSources.hair][0], 'cloth and hair have distinct authored artwork');
    assert.equal(foldNormalSources.size, 1, 'both athletes share one fold normal atlas');
    const foldNormalIndex = [...foldNormalSources][0], foldNormal = imageBytes[foldNormalIndex];
    assert.notEqual(foldNormalIndex, [...atlasSources.cloth][0], 'normal vectors are separate from tintable color');
    assert.equal(foldNormal.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(foldNormal.readUInt32BE(16), 1024);
    assert.equal(foldNormal.readUInt32BE(20), 1024);
    for (const mesh of gltf.meshes) for (const primitive of mesh.primitives) {
      assert.equal(primitive.attributes.JOINTS_1, undefined, 'at most four influences per vertex');
      assert.equal(primitive.attributes.WEIGHTS_1, undefined, 'reviewed Blender and runtime skinning agree');
      const material = gltf.materials[primitive.material], pbr = material.pbrMetallicRoughness ?? {};
      for (const texture of [pbr.baseColorTexture, pbr.metallicRoughnessTexture, material.normalTexture, material.occlusionTexture, material.emissiveTexture].filter(Boolean)) {
        const uvIndex = primitive.attributes[`TEXCOORD_${textureCoord(texture)}`];
        assert.ok(Number.isInteger(uvIndex), `${mesh.name}: material texture has its declared UV set`);
        const uv = gltf.accessors[uvIndex];
        assert.equal(uv.type, 'VEC2');
        assert.equal(uv.count, gltf.accessors[primitive.attributes.POSITION].count, 'UV coordinates cover every rendered vertex');
      }
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
