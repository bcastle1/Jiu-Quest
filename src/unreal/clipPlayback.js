// Playback rules for a pre-rendered technique clip: a video that plays once and
// rests on its last frame. Pure, with no imports, so node:test covers it. The
// stage component (src/components/UnrealClipStage.jsx) holds the one <video>,
// reports what happens to it as events, and applies the state this returns.

// The speeds offered while studying a technique in Training.
export const CLIP_SPEEDS = Object.freeze([0.25, 0.5, 1]);
export const speedLabel = (rate) => `${rate}×`;

// wantsPlay  what the person (or the autoplay) asks for
// explicit   Play or Replay was pressed: playback no longer waits to be seen
// seen       at least half the picture has been on screen (or this cannot be told)
// hidden     the tab is hidden
// ended      the clip reached its last frame and rests there
// frame      the frame on screen, 0-based
// rate       playback speed, one of CLIP_SPEEDS
// run        goes up each time the clip is asked to start again from frame 0
export function initialPlayback({ reducedMotion = false, hidden = false, canWatchView = false, rate = 1 } = {}) {
  return Object.freeze({
    wantsPlay: !reducedMotion,
    explicit: false,
    // Without a way to tell whether the picture is on screen, do not wait.
    seen: !canWatchView,
    hidden: Boolean(hidden),
    reducedMotion: Boolean(reducedMotion),
    ended: false,
    frame: 0,
    rate: CLIP_SPEEDS.includes(rate) ? rate : 1,
    run: 0,
  });
}

const next = (state, values) => Object.freeze({ ...state, ...values });

// Whether the <video> should be running right now.
export function shouldPlay(state) {
  return state.wantsPlay && !state.ended && !state.hidden && (state.explicit || state.seen);
}

// The face of the one transport button: Play, Pause or Replay.
export function transportFace(state) {
  if (state.ended) return 'Replay';
  return shouldPlay(state) ? 'Pause' : 'Play';
}

const fromStart = (state) => next(state, { wantsPlay: true, explicit: true, ended: false, frame: 0, run: state.run + 1 });

export function playbackReducer(state, event) {
  switch (event?.type) {
    // The transport button. After the end, one press plays from frame 0.
    case 'press':
      if (state.ended) return fromStart(state);
      if (shouldPlay(state)) return next(state, { wantsPlay: false });
      return next(state, { wantsPlay: true, explicit: true });
    // An explicit request to play from frame 0. It never waits.
    case 'replay': return fromStart(state);
    // The clip does not loop: it rests on its last frame.
    case 'ended': return next(state, { ended: true, frame: event.lastFrame ?? state.frame });
    case 'frame': return state.frame === event.frame ? state : next(state, { frame: event.frame });
    // The scrubber: hold the chosen frame still.
    case 'seek': return next(state, { wantsPlay: false, ended: false, frame: event.frame });
    case 'rate': return CLIP_SPEEDS.includes(event.rate) && event.rate !== state.rate ? next(state, { rate: event.rate }) : state;
    // Half the picture is on screen. Once seen, it stays seen.
    case 'visible': return event.visible && !state.seen ? next(state, { seen: true }) : state;
    // The tab was hidden or shown. What was asked for is kept, so playback resumes.
    case 'hidden': return state.hidden === Boolean(event.hidden) ? state : next(state, { hidden: Boolean(event.hidden) });
    case 'reduced-motion': return next(state, { reducedMotion: Boolean(event.on), wantsPlay: event.on ? false : state.wantsPlay });
    // The browser refused to start a video nobody pressed Play on. Not a failure.
    case 'refused': return next(state, { wantsPlay: false });
    // The other camera view. Keep the moment when the files are the same length;
    // otherwise the new file starts from frame 0.
    case 'camera': return event.keepMoment ? state : next(state, { ended: false, frame: 0 });
    // Another start of the same clip (a new exchange, say). Speed is kept, and
    // the person's reduced-motion choice still holds.
    case 'restart': return next(state, { wantsPlay: !state.reducedMotion, explicit: false, ended: false, frame: 0, run: state.run + 1 });
    default: return state;
  }
}

// The frame a moment of a clip falls in. The end of the file is its last frame.
export function clipFrameAt(clip, seconds) {
  return Math.min(clip.frames - 1, Math.max(0, Math.floor((Number(seconds) || 0) * clip.fps + 1e-6)));
}

// The moment to seek to for a frame: its middle, so the browser never lands on
// the frame before, and never on the end of the file (which would end the clip).
export function clipFrameTime(clip, frame) {
  return (Math.min(clip.frames - 1, Math.max(0, Math.round(Number(frame) || 0))) + 0.5) / clip.fps;
}

// The scrubber's spoken value: "1.5 of 4.2 seconds".
export function scrubberText(clip, frame) {
  const total = clip.durationSeconds ?? clip.frames / clip.fps;
  const at = Math.min(Math.max(0, frame), clip.frames - 1) / clip.fps;
  return `${at.toFixed(1)} of ${total.toFixed(1)} seconds`;
}

// Changing camera keeps the moment only between files of the same length.
export const keepsMoment = (from, to) => Boolean(from && to) && from.frames === to.frames && from.fps === to.fps;

// After a view fails: the camera to try next, or null when none is left and the
// stage hands over to its fallback. `views` are clips or camera names in button
// order; `failed` lists the cameras that could not play.
export function nextViewAfterFailure(views, failed) {
  const gone = new Set(failed);
  const left = views.map((view) => (typeof view === 'string' ? view : view.camera)).filter((camera) => !gone.has(camera));
  return left[0] ?? null;
}

// The words under a technique clip. A reviewed clip does not say it is a prototype.
export function techniqueNote({ choreographyReviewed = false, reducedMotion = false } = {}) {
  return [
    'Pre-rendered video. Animated visual reference.',
    choreographyReviewed === true ? null : 'Choreography is a prototype and has not been coach-reviewed.',
    'Playback does not award points or training repetitions.',
    reducedMotion ? 'Reduced motion is on; press Play when ready.' : null,
  ].filter(Boolean).join(' ');
}
