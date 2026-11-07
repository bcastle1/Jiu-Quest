import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Quaternion, Vector3 } from 'three';
import { readPairedPose } from './helpers/readPairedPose.js';

const clip = readPairedPose(await readFile(new URL('../public/animations/bjj/standing_stance.glb', import.meta.url)));
const roles = ['JQ_Attacker', 'JQ_Defender'];
const frames = clip.subframeTimes.map(time => ({ time, world: clip.sample(time) }));
const position = matrix => new Vector3().setFromMatrixPosition(matrix);
const rotation = matrix => new Quaternion().setFromRotationMatrix(matrix).normalize();

test('standing idle shifts each pelvis while both soles stay planted, including between exported keys', () => {
  assert.ok(frames.length > clip.times.length * 3, 'inspect quarter/mid/three-quarter subframes, not only authored keys');
  for (const role of roles) {
    const actor = clip.actor(role), hips = actor.joint('pelvis');
    const positions = frames.map(frame => position(frame.world[hips]));
    const xRange = Math.max(...positions.map(p => p.x)) - Math.min(...positions.map(p => p.x));
    const yRange = Math.max(...positions.map(p => p.y)) - Math.min(...positions.map(p => p.y));
    assert.ok(xRange >= .024 && xRange <= .05, `${role}: visible but bounded lateral weight shift (${xRange}m)`);
    assert.ok(yRange < .02, `${role}: no bouncing or jumping (${yRange}m)`);
    for (const name of ['foot_l', 'ball_l', 'foot_r', 'ball_r']) {
      const joint = actor.joint(name), planted = frames[0].world[joint];
      for (const { time, world } of frames) {
        assert.ok(position(world[joint]).distanceTo(position(planted)) < .0015,
          `${role}/${name}: planted contact drift exceeds 1.5mm at ${time}s`);
        assert.ok(rotation(world[joint]).angleTo(rotation(planted)) < .015,
          `${role}/${name}: planted sole rolls more than 0.86 degrees at ${time}s`);
      }
    }
  }
});

test('standing idle closes the complete paired loop without changing body scale or joint lengths', () => {
  assert.ok(Math.abs(clip.times[0]) < 1e-7, 'loop must start at t=0 without an exported frame-1 leading hold');
  assert.ok(Math.abs(clip.duration - 1.8) < 1e-6, 'idle keeps its reviewed 1.8-second duration');
  const first = frames[0].world, last = frames.at(-1).world;
  for (const role of roles) {
    const actor = clip.actor(role);
    for (const node of actor.nodes) {
      assert.ok(position(first[node]).distanceTo(position(last[node])) < 1e-5, `${role}: loop-position discontinuity`);
      assert.ok(rotation(first[node]).angleTo(rotation(last[node])) < 1e-4, `${role}: loop-rotation discontinuity`);
      for (const frame of frames) {
        const scale = new Vector3().setFromMatrixScale(frame.world[node]);
        assert.ok(scale.distanceTo(new Vector3(1, 1, 1)) < 1e-4, `${role}: body/joint scale must stay natural`);
      }
    }
    for (const side of ['l', 'r']) for (const [from, to] of [['thigh_', 'calf_'], ['calf_', 'foot_']]) {
      const a = actor.joint(from + side), b = actor.joint(to + side);
      const restLength = position(first[a]).distanceTo(position(first[b]));
      for (const frame of frames) assert.ok(Math.abs(position(frame.world[a]).distanceTo(position(frame.world[b])) - restLength) < 1e-4,
        `${role}/${from}${side}: fixed feet cannot stretch the leg`);
    }
    const pelvis = actor.joint('pelvis'), epsilon = clip.duration / 1000;
    const entering = position(clip.sample(epsilon)[pelvis]).sub(position(first[pelvis])).divideScalar(epsilon);
    const leaving = position(last[pelvis]).sub(position(clip.sample(clip.duration - epsilon)[pelvis])).divideScalar(epsilon);
    assert.ok(entering.distanceTo(leaving) < .015, `${role}: loop velocity must not visibly reverse or stop`);
  }
});
