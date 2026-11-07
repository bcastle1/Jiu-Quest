import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Vector3 } from 'three';
import { readPairedPose } from './helpers/readPairedPose.js';

const position = matrix => new Vector3().setFromMatrixPosition(matrix);

for (const move of ['standing_stance', 'grip_fighting', 'reset_neutral']) {
  test(`${move}: ready fingers bend through their joints without stretching between animation keys`, async () => {
    const clip = readPairedPose(await readFile(new URL(`../public/animations/bjj/${move}.glb`, import.meta.url)));
    const frames = clip.subframeTimes.map(time => ({ time, world: clip.sample(time) }));
    for (const role of ['JQ_Attacker', 'JQ_Defender']) {
      const actor = clip.actor(role);
      for (const side of ['l', 'r']) for (const digit of ['index', 'middle', 'ring', 'pinky']) {
        const joints = [1, 2, 3].map(n => actor.joint(`${digit}_0${n}_${side}`));
        const lengths = [0, 1].map(n => position(frames[0].world[joints[n]]).distanceTo(position(frames[0].world[joints[n + 1]])));
        for (const { time, world } of frames) {
          const points = joints.map(joint => position(world[joint]));
          const proximal = points[1].clone().sub(points[0]), middle = points[2].clone().sub(points[1]);
          const bend = proximal.angleTo(middle);
          assert.ok(bend > .12 && bend < .9, `${role}/${digit}_${side}: finger must remain loosely curled, not straight or folded shut at ${time}s (${bend}rad)`);
          for (const n of [0, 1]) assert.ok(Math.abs(points[n].distanceTo(points[n + 1]) - lengths[n]) < 1e-5,
            `${role}/${digit}_${side}: finger segment stretches at ${time}s`);
        }
      }
    }
  });
}
