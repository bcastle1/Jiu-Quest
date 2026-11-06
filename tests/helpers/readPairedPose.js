// CPU-only glTF animation sampling for exported motion regression checks.
import assert from 'node:assert/strict';
import { Matrix4, Quaternion, Vector3 } from 'three';

export function readPairedPose(bytes) {
  assert.equal(bytes.readUInt32LE(0), 0x46546c67);
  const jsonLength = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength));
  const binary = bytes.subarray(28 + jsonLength);
  assert.equal(gltf.animations.length, 1, 'one shared paired timeline');
  const animation = gltf.animations[0], arrays = new Map();
  function accessor(index) {
    if (arrays.has(index)) return arrays.get(index);
    const a = gltf.accessors[index], view = gltf.bufferViews[a.bufferView];
    assert.equal(a.componentType, 5126, 'motion values are float32');
    assert.equal(a.sparse, undefined);
    const width = { SCALAR: 1, VEC3: 3, VEC4: 4 }[a.type];
    assert.ok(width, 'only TRS and time accessors are sampled');
    const rows = Array.from({ length: a.count }, (_, row) => Array.from({ length: width }, (_, component) =>
      binary.readFloatLE((view.byteOffset || 0) + (a.byteOffset || 0) + row * (view.byteStride || width * 4) + component * 4)));
    arrays.set(index, rows);
    return rows;
  }
  const channels = animation.channels.map(channel => {
    const sampler = animation.samplers[channel.sampler];
    const interpolation = sampler.interpolation || 'LINEAR';
    assert.ok(['LINEAR', 'STEP'].includes(interpolation), 'unsupported interpolation must not silently pass');
    return { node: channel.target.node, path: channel.target.path, interpolation,
      times: accessor(sampler.input).map(row => row[0]), values: accessor(sampler.output) };
  });
  const parents = [];
  gltf.nodes.forEach((node, parent) => (node.children || []).forEach(child => { parents[child] = parent; }));
  const times = [...new Set(channels.flatMap(channel => channel.times))].sort((a, b) => a - b);
  const duration = times.at(-1);
  const subframeTimes = times.flatMap((time, i) => i === times.length - 1 ? [time]
    : [time, time + (times[i + 1] - time) * .25, time + (times[i + 1] - time) * .5, time + (times[i + 1] - time) * .75]);
  function sample(time) {
    const poses = gltf.nodes.map(node => {
      const position = new Vector3(), rotation = new Quaternion(), scale = new Vector3(1, 1, 1);
      if (node.matrix) new Matrix4().fromArray(node.matrix).decompose(position, rotation, scale);
      else { position.fromArray(node.translation || [0, 0, 0]); rotation.fromArray(node.rotation || [0, 0, 0, 1]); scale.fromArray(node.scale || [1, 1, 1]); }
      return { position, rotation, scale };
    });
    for (const channel of channels) {
      let i = 0;
      while (i < channel.times.length - 2 && channel.times[i + 1] <= time) i++;
      const next = Math.min(i + 1, channel.times.length - 1);
      const t = channel.interpolation === 'STEP' ? 0 : Math.max(0, Math.min(1, (time - channel.times[i]) / (channel.times[next] - channel.times[i] || 1)));
      const pose = poses[channel.node], a = channel.values[i], b = channel.values[next];
      if (channel.path === 'rotation') pose.rotation.fromArray(a).slerp(new Quaternion().fromArray(b), t);
      else {
        assert.ok(['translation', 'scale'].includes(channel.path));
        pose[channel.path === 'translation' ? 'position' : 'scale'].fromArray(a).lerp(new Vector3().fromArray(b), t);
      }
    }
    const world = [];
    function matrix(index) {
      if (world[index]) return world[index];
      const pose = poses[index], local = new Matrix4().compose(pose.position, pose.rotation, pose.scale);
      return world[index] = parents[index] == null ? local : matrix(parents[index]).clone().multiply(local);
    }
    gltf.nodes.forEach((_, index) => matrix(index));
    return world;
  }
  function actor(role) {
    const root = gltf.nodes.findIndex(node => node.name === role);
    assert.ok(root >= 0);
    const nodes = [];
    function visit(index) { nodes.push(index); for (const child of gltf.nodes[index].children || []) visit(child); }
    visit(root);
    const joint = name => { const index = nodes.find(index => gltf.nodes[index].name === name); assert.notEqual(index, undefined, `${role}/${name}`); return index; };
    return { root, nodes, joint };
  }
  return { gltf, duration, times, subframeTimes, sample, actor };
}
