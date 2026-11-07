import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Quaternion, Vector3 } from 'three';
import { readPairedPose } from './helpers/readPairedPose.js';

// The override permits checking a staged export before replacing the canonical
// clip, and proving these result checks reject the previous bad landing.
const asset = process.env.JIUQUEST_DOUBLELEG_TEST_ASSET
  || new URL('../public/animations/bjj/double_leg.glb', import.meta.url);
const clip = readPairedPose(await readFile(asset));
const position = matrix => new Vector3().setFromMatrixPosition(matrix);
const rotation = matrix => new Quaternion().setFromRotationMatrix(matrix).normalize();
const landmarks = [.44, .5, .55, .62, .66, .7, .74, .78, .9, 1].map(p => p * clip.duration);
const times = [...new Set([...clip.subframeTimes, ...landmarks])].sort((a, b) => a - b);
const frames = times.map(time => ({ time, progress: time / clip.duration, world: clip.sample(time) }));
const defender = clip.actor('JQ_Defender');

function leg(world, side) {
  const hip = position(world[defender.joint('thigh_' + side)]);
  const knee = position(world[defender.joint('calf_' + side)]);
  const ankle = position(world[defender.joint('foot_' + side)]);
  const ball = position(world[defender.joint('ball_' + side)]);
  for (const point of [hip, knee, ankle, ball]) assert.ok(point.toArray().every(Number.isFinite), 'finite joint positions');
  const upper = knee.clone().sub(hip), shin = ankle.clone().sub(knee);
  const toes = ball.clone().sub(ankle);
  for (const segment of [upper, shin, toes]) assert.ok(segment.length() > 1e-5, 'nonzero leg and foot segments');
  return { upper: upper.normalize(), shin: shin.normalize(), toes: toes.normalize() };
}

test('double-leg descent keeps the receiving knees from folding shut between keys', () => {
  assert.ok(frames.length > clip.times.length * 3, 'inspect quarter/mid/three-quarter subframes');
  for (const { time, progress, world } of frames) {
    if (progress < .44 - 1e-8 || progress > .78 + 1e-8) continue;
    for (const side of ['l', 'r']) {
      const { upper, shin } = leg(world, side);
      const flexion = upper.angleTo(shin) * 180 / Math.PI;
      // Zero is a straight leg. This authored landing stays below a deep fold;
      // the old ankle path cut through the falling hip and reached ~169 degrees.
      assert.ok(flexion <= 140, `Defender/${side}: knee folds ${flexion} degrees at ${time}s`);
    }
  }
});

test('double-leg receiving toes follow the knee bend and feet do not spin during landing', () => {
  for (let i = 0; i < frames.length; i++) {
    const { time, progress, world } = frames[i];
    if (progress < .5 - 1e-8) continue;
    for (const side of ['l', 'r']) {
      const { upper, shin, toes } = leg(world, side);
      const forward = upper.clone().sub(shin.clone().multiplyScalar(upper.dot(shin)));
      assert.ok(forward.length() > 1e-6, `Defender/${side}: landing knee has a stable bend plane at ${time}s`);
      const alignment = toes.dot(forward.normalize());
      assert.ok(alignment >= 0, `Defender/${side}: toes point opposite the knee bend at ${time}s (${alignment})`);
      if (i === 0) continue;
      const previous = frames[i - 1], elapsed = time - previous.time;
      if (elapsed <= 1e-6) continue; // Ignore float32 duplicate-time roundoff.
      const foot = defender.joint('foot_' + side);
      const angularSpeed = rotation(previous.world[foot]).angleTo(rotation(world[foot])) * 180 / Math.PI / elapsed;
      assert.ok(Number.isFinite(angularSpeed) && angularSpeed <= 720,
        `Defender/${side}: foot spins ${angularSpeed} degrees/second at ${time}s`);
    }
  }
});

test('double-leg motion preserves both athletes scale and original thigh/shin lengths', () => {
  // Reviewed shared rig dimensions in meters, independent of target positions.
  const lengths = { thigh: .4288002, shin: .4587885 };
  for (const role of ['JQ_Attacker', 'JQ_Defender']) {
    const actor = clip.actor(role);
    for (const { time, world } of frames) {
      for (const node of actor.nodes) {
        const scale = new Vector3().setFromMatrixScale(world[node]);
        assert.ok(scale.toArray().every(Number.isFinite) && scale.distanceTo(new Vector3(1, 1, 1)) < 1e-4,
          `${role}: body or joint scaling at ${time}s`);
      }
      for (const side of ['l', 'r']) {
        const hip = position(world[actor.joint('thigh_' + side)]);
        const knee = position(world[actor.joint('calf_' + side)]);
        const ankle = position(world[actor.joint('foot_' + side)]);
        for (const [segment, actual] of [['thigh', hip.distanceTo(knee)], ['shin', knee.distanceTo(ankle)]]) {
          assert.ok(Number.isFinite(actual) && Math.abs(actual - lengths[segment]) < 1e-4,
            `${role}/${segment}_${side}: segment length changed at ${time}s (${actual}m)`);
        }
      }
    }
  }
});
