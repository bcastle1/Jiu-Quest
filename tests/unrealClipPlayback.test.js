import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CLIP_SPEEDS, clipFrameAt, clipFrameTime, initialPlayback, keepsMoment, nextViewAfterFailure,
  playbackReducer, scrubberText, shouldPlay, speedLabel, techniqueNote, transportFace,
} from '../src/unreal/clipPlayback.js';

const clip = Object.freeze({ camera: 'side', frames: 126, fps: 30, durationSeconds: 4.2 });
const run = (state, ...events) => events.reduce(playbackReducer, state);

test('the playback rules have no imports', () => {
  const source = readFileSync(fileURLToPath(new URL('../src/unreal/clipPlayback.js', import.meta.url)), 'utf8');
  assert.doesNotMatch(source, /^\s*import\b/m);
});

test('a request plays, or waits paused under reduced motion', () => {
  const plain = initialPlayback();
  assert.equal(shouldPlay(plain), true);
  assert.equal(transportFace(plain), 'Pause');
  assert.equal(plain.frame, 0);

  const reduced = initialPlayback({ reducedMotion: true });
  assert.equal(shouldPlay(reduced), false);
  assert.equal(transportFace(reduced), 'Play');
  assert.equal(reduced.frame, 0);
  // One press plays.
  assert.equal(shouldPlay(run(reduced, { type: 'press' })), true);
  // Turning reduced motion on while it plays pauses it.
  assert.equal(shouldPlay(run(plain, { type: 'reduced-motion', on: true })), false);
});

test('an autoplay waits until the picture is seen; Play and Replay never wait', () => {
  const waiting = initialPlayback({ canWatchView: true });
  assert.equal(shouldPlay(waiting), false);
  assert.equal(transportFace(waiting), 'Play');
  assert.equal(shouldPlay(run(waiting, { type: 'visible', visible: false })), false);
  assert.equal(shouldPlay(run(waiting, { type: 'visible', visible: true })), true);
  assert.equal(shouldPlay(run(waiting, { type: 'press' })), true, 'Play does not wait');
  assert.equal(shouldPlay(run(waiting, { type: 'replay' })), true, 'Replay does not wait');
  // No way to tell: do not wait.
  assert.equal(shouldPlay(initialPlayback({ canWatchView: false })), true);
});

test('a hidden tab pauses and resumes what was playing', () => {
  const playing = initialPlayback();
  const hidden = run(playing, { type: 'hidden', hidden: true });
  assert.equal(shouldPlay(hidden), false);
  assert.equal(shouldPlay(run(hidden, { type: 'hidden', hidden: false })), true);
  // A paused clip stays paused when the tab comes back.
  const paused = run(playing, { type: 'press' }, { type: 'hidden', hidden: true }, { type: 'hidden', hidden: false });
  assert.equal(shouldPlay(paused), false);
  // Opened in a hidden tab: waits until shown.
  assert.equal(shouldPlay(initialPlayback({ hidden: true })), false);
});

test('ended gives Replay, and one press restarts at frame 0', () => {
  const ended = run(initialPlayback(), { type: 'frame', frame: 80 }, { type: 'ended', lastFrame: 125 });
  assert.equal(ended.ended, true);
  assert.equal(ended.frame, 125, 'it rests on its last frame');
  assert.equal(shouldPlay(ended), false);
  assert.equal(transportFace(ended), 'Replay');
  const again = run(ended, { type: 'press' });
  assert.equal(again.ended, false);
  assert.equal(again.frame, 0);
  assert.equal(again.run, ended.run + 1, 'the stage is told to start from frame 0');
  assert.equal(shouldPlay(again), true);
  assert.equal(transportFace(again), 'Pause');
  // Replay after reduced motion is an explicit request and plays too.
  const reducedEnded = run(initialPlayback({ reducedMotion: true }), { type: 'press' }, { type: 'ended', lastFrame: 125 });
  assert.equal(shouldPlay(run(reducedEnded, { type: 'press' })), true);
});

test('a seek pauses and clears ended', () => {
  const ended = run(initialPlayback(), { type: 'ended', lastFrame: 125 });
  const sought = run(ended, { type: 'seek', frame: 40 });
  assert.equal(sought.ended, false);
  assert.equal(sought.frame, 40);
  assert.equal(shouldPlay(sought), false);
  assert.equal(transportFace(sought), 'Play');
  const whilePlaying = run(initialPlayback(), { type: 'seek', frame: 3 });
  assert.equal(shouldPlay(whilePlaying), false);
});

test('a refused autoplay is not a failure: it waits for Play', () => {
  const refused = run(initialPlayback(), { type: 'refused' });
  assert.equal(shouldPlay(refused), false);
  assert.equal(transportFace(refused), 'Play');
  assert.equal(shouldPlay(run(refused, { type: 'press' })), true);
});

test('frame and time convert both ways without drift (126 frames at 30 fps)', () => {
  for (let frame = 0; frame < clip.frames; frame += 1) {
    const time = clipFrameTime(clip, frame);
    assert.ok(time > frame / clip.fps && time < (frame + 1) / clip.fps, `frame ${frame} seeks inside itself`);
    assert.equal(clipFrameAt(clip, time), frame);
    assert.equal(clipFrameAt(clip, frame / clip.fps), frame, `the start of frame ${frame}`);
  }
  assert.ok(clipFrameTime(clip, 125) < clip.durationSeconds, 'the last frame is never the end of the file');
  assert.equal(clipFrameAt(clip, clip.durationSeconds), 125, 'the end of the file is the last frame');
  assert.equal(clipFrameAt(clip, -1), 0);
  assert.equal(clipFrameTime(clip, 500), clipFrameTime(clip, 125));
  assert.equal(scrubberText(clip, 0), '0.0 of 4.2 seconds');
  assert.equal(scrubberText(clip, 45), '1.5 of 4.2 seconds');
  assert.equal(scrubberText(clip, 125), '4.2 of 4.2 seconds');
});

test('a failed view moves to the other one, then to the fallback', () => {
  const views = [{ camera: 'side' }, { camera: 'front' }];
  assert.equal(nextViewAfterFailure(views, ['side']), 'front');
  assert.equal(nextViewAfterFailure(views, ['front']), 'side');
  assert.equal(nextViewAfterFailure(views, ['side', 'front']), null);
  assert.equal(nextViewAfterFailure([{ camera: 'side' }], ['side']), null);
  assert.equal(nextViewAfterFailure(['side', 'front'], []), 'side');
});

test('changing camera keeps the moment only between files of the same length', () => {
  assert.equal(keepsMoment(clip, { ...clip, camera: 'front' }), true);
  assert.equal(keepsMoment(clip, { ...clip, camera: 'front', frames: 120 }), false);
  const ended = run(initialPlayback(), { type: 'ended', lastFrame: 125 });
  assert.deepEqual(run(ended, { type: 'camera', keepMoment: true }), ended);
  const moved = run(ended, { type: 'camera', keepMoment: false });
  assert.equal(moved.ended, false);
  assert.equal(moved.frame, 0);
});

test('speed is kept across a restart', () => {
  assert.deepEqual(CLIP_SPEEDS, [0.25, 0.5, 1]);
  assert.deepEqual(CLIP_SPEEDS.map(speedLabel), ['0.25×', '0.5×', '1×']);
  const slow = run(initialPlayback(), { type: 'rate', rate: 0.25 });
  assert.equal(slow.rate, 0.25);
  assert.equal(run(slow, { type: 'rate', rate: 3 }).rate, 0.25, 'only the offered speeds');
  const restarted = run(slow, { type: 'ended', lastFrame: 125 }, { type: 'restart' });
  assert.equal(restarted.rate, 0.25);
  assert.equal(restarted.frame, 0);
  assert.equal(restarted.ended, false);
  assert.equal(run(slow, { type: 'press' }, { type: 'ended', lastFrame: 125 }, { type: 'press' }).rate, 0.25, 'Replay keeps the speed');
  // A remount (a new exchange) starts at the speed the parent kept.
  assert.equal(initialPlayback({ rate: 0.5 }).rate, 0.5);
  assert.equal(initialPlayback({ rate: 2 }).rate, 1);
});

test('the note says what the clip is, and adds the reduced-motion sentence', () => {
  assert.equal(techniqueNote({ choreographyReviewed: false }), 'Pre-rendered video. Animated visual reference. Choreography is a prototype and has not been coach-reviewed. Playback does not award points or training repetitions.');
  assert.equal(techniqueNote({ choreographyReviewed: false, reducedMotion: true }), 'Pre-rendered video. Animated visual reference. Choreography is a prototype and has not been coach-reviewed. Playback does not award points or training repetitions. Reduced motion is on; press Play when ready.');
  assert.doesNotMatch(techniqueNote({ choreographyReviewed: true }), /prototype/);
});
