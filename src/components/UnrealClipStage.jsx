import { useEffect, useId, useReducer, useRef, useState } from 'react';
import { Pause, Play, RotateCcw, SkipForward } from 'lucide-react';
import { UNREAL_CLIP_LOOK, unrealClipViews } from '../unreal/techniqueClips.js';
import { CLIP_SPEEDS, PASSING_MOMENT_PATIENCE, clipFrameAt, clipFrameTime, initialPlayback, keepsMoment, nextViewAfterFailure, playbackReducer, scrubberText, shouldPlay, speedLabel, techniqueNote, transportFace } from '../unreal/clipPlayback.js';
import './UnrealClipStage.css';

const CAMERA_LABELS = { side: 'Side', front: 'Front' };
const reducedMotionQuery = () => (typeof window === 'undefined' ? null : window.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null);

// Plays one pre-rendered Unreal clip of a move. The video file is the whole
// picture: nothing is streamed and nothing is computed here. If no clip exists
// for the move, or the browser cannot play it, `fallback` is shown instead.
// kind 'stance' is a loop held on the feet. kind 'technique' plays once, rests
// on its last frame and offers Replay; with `study` (Training) it also offers
// speeds and a scrubber. `camera` and `rate` may be held by the parent so a
// remount keeps the person's choice. A technique clip calls `onUnavailable`
// with its move id once, after it has handed over to `fallback` because none
// of its views can play. kind 'moment' is a match moment: the greeting before
// a match, or the end of a match the player won or lost (see MomentClip).
export default function UnrealClipStage({ kind = 'stance', ...props }) {
  if (kind === 'moment') return <MomentClip {...props} />;
  return kind === 'technique' ? <TechniqueClip {...props} /> : <StanceClip {...props} />;
}

// A still of the frame a video shows now, drawn into a canvas of the clip's
// size. Null where nothing can be drawn: no video element, or no canvas here.
function frameStill(video, clip) {
  if (!video || typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
  try {
    const still = document.createElement('canvas');
    still.width = clip.width;
    still.height = clip.height;
    const context = still.getContext('2d');
    if (!context) return null;
    context.drawImage(video, 0, 0, clip.width, clip.height);
    return still;
  } catch {
    return null;
  }
}

// `opening` is a still of the frame the loop starts on, from the greeting that
// played to its end there (see MomentClip's onLastFrame). The loop takes it
// when it mounts, for the file it opens on.
function StanceClip({ moveId, performerSide = 'fighter', moveLabel, fighter, opponent, compact = false, fallback = null, camera: chosenCamera, onCameraChange, wantsPlay: chosenPlay, onWantsPlayChange, opening = null }) {
  const views = unrealClipViews(moveId, performerSide);
  const [ownCamera, setOwnCamera] = useState(null);
  const camera = chosenCamera ?? ownCamera;
  // Another view is another picture: the greeting's last frame (below) goes.
  const setCamera = (value) => { setOwnCamera(value); setHandover(null); onCameraChange?.(value); };
  const clip = views.find((view) => view.camera === camera) ?? views[0] ?? null;
  const videoRef = useRef(null);
  // What the person wants. People who ask for reduced motion start paused.
  // Like the camera, it may be held by the parent, which is told of every
  // change: a loop that comes back after something took its place is then
  // still paused if it was paused.
  const [ownPlay, setOwnPlay] = useState(() => !reducedMotionQuery()?.matches);
  const wantsPlay = chosenPlay ?? ownPlay;
  const setWantsPlay = (value) => { setOwnPlay(value); onWantsPlayChange?.(value); };
  // The file that could not play, if one did. Another move or camera is another
  // file and gets its own try.
  const [failedVideo, setFailedVideo] = useState(null);
  // The greeting's last frame, laid over the file it was taken for (with what
  // draws it into the canvas on the page), until that file shows a frame of
  // its own while playing. The file's poster, a frame halfway through the
  // loop, then never shows between the greeting and the loop. A loop the
  // player paused shows the still until Play is pressed.
  const [handover, setHandover] = useState(() => (opening && clip ? {
    video: clip.video,
    draw: (canvas) => { canvas?.getContext('2d')?.drawImage(opening, 0, 0, canvas.width, canvas.height); },
  } : null));
  const covered = handover !== null && handover.video === clip?.video;
  // Another file (another stance's loop, say: a new stance is the same stage)
  // is another picture. The still never lies over it, and goes for good.
  if (handover !== null && !covered) setHandover(null);

  useEffect(() => {
    const query = reducedMotionQuery();
    const change = () => { if (query.matches) setWantsPlay(false); };
    query?.addEventListener('change', change);
    return () => query?.removeEventListener('change', change);
  }, []);

  // Runs for each new video element (a camera change makes a new one) and
  // whenever Play or Pause is pressed.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = true;
    if (!wantsPlay) { video.pause(); return; }
    // A browser may refuse to start a video nobody asked for. Then wait for Play.
    // Other rejections (the element was replaced or removed) are not refusals.
    video.play()?.catch((error) => { if (error?.name === 'NotAllowedError') setWantsPlay(false); });
  }, [wantsPlay, clip?.video]);

  // The still goes once the file has shown a frame of its own while it plays:
  // the first frame the browser presents, or where it cannot say so, the first
  // time the clock has moved.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !covered || !wantsPlay) return undefined;
    let stopped = false;
    const shown = () => { if (!stopped) setHandover(null); };
    if (typeof video.requestVideoFrameCallback === 'function') {
      const handle = video.requestVideoFrameCallback(shown);
      return () => { stopped = true; video.cancelVideoFrameCallback?.(handle); };
    }
    const moved = () => { if (video.currentTime > 0) shown(); };
    video.addEventListener('timeupdate', moved);
    return () => { stopped = true; video.removeEventListener('timeupdate', moved); };
  }, [covered, wantsPlay, clip?.video]);

  if (!clip || failedVideo === clip.video) return fallback;

  const title = moveLabel || 'Technique';
  const fighterName = fighter?.name || 'Your fighter';
  const opponentName = opponent?.name || 'Opponent';
  return (
    <section className={compact ? 'unreal-clip-stage compact' : 'unreal-clip-stage'} aria-label={`${title}, Unreal Engine clip`} data-kind="stance" data-move={clip.moveId} data-camera={clip.camera}>
      <header className="unreal-clip-heading">
        <span>Unreal Engine</span>
        <strong>{title}</strong>
      </header>
      <div className="unreal-clip-viewport" style={{ '--clip-ratio': `${clip.width} / ${clip.height}` }}>
        <video
          key={clip.video}
          ref={videoRef}
          src={clip.video}
          poster={clip.poster}
          width={clip.width}
          height={clip.height}
          loop={clip.loops}
          muted
          playsInline
          disableRemotePlayback
          preload="auto"
          aria-label={`${title}. ${fighterName} in the white gi and ${opponentName} in the navy gi, seen from the ${clip.camera}.`}
          onError={() => setFailedVideo(clip.video)}
        />
        {covered && <canvas ref={handover.draw} className="unreal-clip-handover" width={clip.width} height={clip.height} aria-hidden="true" />}
      </div>
      <div className="unreal-clip-controls">
        <button type="button" className="unreal-clip-play" onClick={() => setWantsPlay(!wantsPlay)}>
          {wantsPlay ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
          {wantsPlay ? 'Pause' : 'Play'}
        </button>
        {views.length > 1 && (
          <div className="unreal-clip-cameras" role="group" aria-label="Camera view">
            {views.map((view) => (
              <button key={view.camera} type="button" aria-pressed={view.camera === clip.camera} onClick={() => setCamera(view.camera)}>
                {CAMERA_LABELS[view.camera] ?? view.camera}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="unreal-clip-legend">
        <span><i style={{ background: UNREAL_CLIP_LOOK.fighter.swatch }} aria-hidden="true" />{fighterName} (you): {UNREAL_CLIP_LOOK.fighter.gi} gi</span>
        <span><i style={{ background: UNREAL_CLIP_LOOK.opponent.swatch }} aria-hidden="true" />{opponentName}: {UNREAL_CLIP_LOOK.opponent.gi} gi</span>
        <small>Athletes and colors are fixed in this clip.</small>
      </div>
    </section>
  );
}

function TechniqueClip({ moveId, performerSide = 'fighter', trainingClip, moveLabel, fighter, opponent, study = false, fallback = null, camera: chosenCamera, onCameraChange, rate: chosenRate, onRateChange, onUnavailable }) {
  const id = useId();
  const viewportRef = useRef(null);
  const videoRef = useRef(null);
  // Where to put the new file after a camera change: a frame, or null.
  const resumeFrame = useRef(null);
  const [failed, setFailed] = useState([]);
  const [ownCamera, setOwnCamera] = useState(null);
  const allViews = trainingClip ? [trainingClip] : unrealClipViews(moveId, performerSide);
  const views = allViews.filter((view) => !failed.includes(view.camera));
  const wanted = chosenCamera ?? ownCamera;
  const clip = views.find((view) => view.camera === wanted) ?? views[0] ?? null;
  const [state, dispatch] = useReducer(playbackReducer, undefined, () => initialPlayback({
    reducedMotion: Boolean(reducedMotionQuery()?.matches),
    hidden: typeof document !== 'undefined' && document.hidden === true,
    canWatchView: typeof window !== 'undefined' && typeof window.IntersectionObserver === 'function',
    rate: chosenRate ?? 1,
  }));
  const rate = CLIP_SPEEDS.includes(chosenRate) ? chosenRate : state.rate;
  const playing = shouldPlay(state);

  useEffect(() => {
    const query = reducedMotionQuery();
    const change = () => dispatch({ type: 'reduced-motion', on: query.matches });
    query?.addEventListener('change', change);
    return () => query?.removeEventListener('change', change);
  }, []);

  // Pause while the tab is hidden; what was asked for is kept, so it resumes.
  useEffect(() => {
    const change = () => dispatch({ type: 'hidden', hidden: document.hidden });
    document.addEventListener('visibilitychange', change);
    return () => document.removeEventListener('visibilitychange', change);
  }, []);

  // The autoplay waits until at least half the picture is on screen.
  const hasClip = Boolean(clip);
  useEffect(() => {
    // Watch the picture itself, not the section with its controls and note.
    const viewport = viewportRef.current;
    if (!viewport || state.seen || typeof window.IntersectionObserver !== 'function') return undefined;
    const observer = new window.IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.5)) dispatch({ type: 'visible', visible: true });
    }, { threshold: [0.5] });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [state.seen, hasClip]);

  // Apply the state to the one <video>: for each new file, each start from
  // frame 0, and each change of what is wanted.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = true;
    if (!playing) { video.pause(); return; }
    // A browser may refuse to start a video nobody asked for. Then wait for Play.
    video.play()?.catch((error) => { if (error?.name === 'NotAllowedError') dispatch({ type: 'refused' }); });
  }, [playing, state.run, clip?.video]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.defaultPlaybackRate = rate;
    video.playbackRate = rate;
  }, [rate, clip?.video]);

  // Follow the frame on screen while it plays.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !clip || !playing) return undefined;
    const report = () => { if (!video.seeking && !video.ended) dispatch({ type: 'frame', frame: clipFrameAt(clip, video.currentTime) }); };
    if (typeof video.requestVideoFrameCallback === 'function') {
      let stopped = false;
      let handle = 0;
      const tick = () => { if (stopped) return; report(); handle = video.requestVideoFrameCallback(tick); };
      handle = video.requestVideoFrameCallback(tick);
      return () => { stopped = true; video.cancelVideoFrameCallback?.(handle); };
    }
    video.addEventListener('timeupdate', report);
    return () => video.removeEventListener('timeupdate', report);
  }, [playing, clip?.video]);

  // No view is left, so the fallback shows. Say so once, after that render,
  // so the parent can follow what is on screen.
  const toldUnavailable = useRef(false);
  useEffect(() => {
    if (hasClip || toldUnavailable.current) return;
    toldUnavailable.current = true;
    onUnavailable?.(moveId);
  }, [hasClip]);

  if (!clip) return fallback;

  const title = moveLabel || 'Technique';
  const fighterName = fighter?.name || 'Your fighter';
  const opponentName = opponent?.name || 'Opponent';
  const performerName = performerSide === 'opponent' ? opponentName : fighterName;
  const performs = (side) => (side === performerSide ? ' · performs the technique' : '');
  const face = transportFace(state);
  const lastFrame = clip.frames - 1;
  const noteId = `${id}-note`;

  const press = () => {
    const video = videoRef.current;
    if (state.ended && video) {
      video.currentTime = 0;
      video.play()?.catch(() => {});
    }
    dispatch({ type: 'press' });
  };
  const pickCamera = (camera) => {
    if (camera === clip.camera) return;
    const target = views.find((view) => view.camera === camera);
    const keepMoment = keepsMoment(clip, target);
    const video = videoRef.current;
    resumeFrame.current = keepMoment ? (state.ended ? lastFrame : clipFrameAt(clip, video?.currentTime ?? 0)) : null;
    dispatch({ type: 'camera', keepMoment });
    setOwnCamera(camera);
    onCameraChange?.(camera);
  };
  const pickRate = (value) => {
    dispatch({ type: 'rate', rate: value });
    onRateChange?.(value);
  };
  const seek = (frame) => {
    const video = videoRef.current;
    dispatch({ type: 'seek', frame });
    if (video) {
      video.pause();
      video.currentTime = clipFrameTime(clip, frame);
    }
  };
  const loaded = () => {
    const video = videoRef.current;
    if (video && resumeFrame.current !== null) video.currentTime = clipFrameTime(clip, resumeFrame.current);
    resumeFrame.current = null;
  };
  // A view that cannot play: try the other one, then hand over to the fallback.
  const failedView = () => {
    const gone = [...failed, clip.camera];
    resumeFrame.current = null;
    setFailed(gone);
    if (nextViewAfterFailure(allViews, gone)) dispatch({ type: 'camera', keepMoment: false });
  };

  return (
    <section
      className={study ? 'unreal-clip-stage is-technique is-study' : 'unreal-clip-stage is-technique'}
      aria-label={`${title}, Unreal Engine clip`}
      aria-describedby={noteId}
      data-kind="technique"
      data-move={clip.moveId}
      data-performer={performerSide}
      data-camera={clip.camera}
      data-ended={state.ended ? 'true' : 'false'}
    >
      <div className="unreal-clip-frame">
        <header className="unreal-clip-heading">
          <span>Unreal Engine clip</span>
          <strong>{title}</strong>
          {clip.choreographyReviewed === false && <em className="unreal-clip-draft">Draft choreography</em>}
        </header>
        <div ref={viewportRef} className="unreal-clip-viewport" style={{ '--clip-ratio': `${clip.width} / ${clip.height}` }}>
          <video
            key={clip.video}
            ref={videoRef}
            src={clip.video}
            poster={clip.poster}
            width={clip.width}
            height={clip.height}
            loop={clip.loops}
            muted
            playsInline
            disableRemotePlayback
            preload="auto"
            aria-label={`${title}. ${performerName} performs the technique. ${fighterName} in the white gi and ${opponentName} in the navy gi, seen from the ${clip.camera}.`}
            onLoadedData={loaded}
            onEnded={() => dispatch({ type: 'ended', lastFrame })}
            onError={failedView}
          />
        </div>
        <div className="unreal-clip-controls">
          <button type="button" className="unreal-clip-play" onClick={press}>
            {face === 'Pause' ? <Pause size={16} aria-hidden="true" /> : face === 'Replay' ? <RotateCcw size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
            {face}
          </button>
          {study && (
            <div className="unreal-clip-speeds" role="group" aria-label="Playback speed">
              {CLIP_SPEEDS.map((value) => (
                <button key={value} type="button" aria-pressed={value === rate} onClick={() => pickRate(value)}>{speedLabel(value)}</button>
              ))}
            </div>
          )}
          {views.length > 1 && (
            <div className="unreal-clip-cameras" role="group" aria-label="Camera view">
              {views.map((view) => (
                <button key={view.camera} type="button" aria-pressed={view.camera === clip.camera} onClick={() => pickCamera(view.camera)}>
                  {CAMERA_LABELS[view.camera] ?? view.camera}
                </button>
              ))}
            </div>
          )}
          {study && (
            <input
              className="unreal-clip-scrubber"
              type="range"
              aria-label="Review movement"
              min={0}
              max={lastFrame}
              step={1}
              value={Math.min(state.frame, lastFrame)}
              aria-valuetext={scrubberText(clip, state.frame)}
              onChange={(event) => seek(Number(event.target.value))}
            />
          )}
        </div>
        <div className="unreal-clip-legend">
          <span data-side="fighter"><i style={{ background: UNREAL_CLIP_LOOK.fighter.swatch }} aria-hidden="true" />{fighterName} (you): {UNREAL_CLIP_LOOK.fighter.gi} gi{performs('fighter')}</span>
          <span data-side="opponent"><i style={{ background: UNREAL_CLIP_LOOK.opponent.swatch }} aria-hidden="true" />{opponentName}: {UNREAL_CLIP_LOOK.opponent.gi} gi{performs('opponent')}</span>
          <small>Athletes and colors are fixed in this clip.</small>
        </div>
      </div>
      <p className="unreal-clip-note" id={noteId}>{clip.draft === true && clip.draftNotice ? `${clip.draftNotice} ` : ''}{techniqueNote({ choreographyReviewed: clip.choreographyReviewed, reducedMotion: state.reducedMotion })}</p>
    </section>
  );
}

// A match moment (src/unreal/matchMoments.js). It plays once from the start,
// silent and inline, and never loops.
//   holdLastFrame  true for the end of a match: the clip rests on its last
//                  frame and offers Replay, and under reduced motion it waits
//                  for Play, as a technique clip does.
//                  false for the greeting, a passing moment: when it ends, is
//                  skipped or cannot play, and at once under reduced motion,
//                  `fallback` takes its place, so the box is never empty. It
//                  also gives way when its picture takes too long to start
//                  moving, or to move again after running out of data
//                  (PASSING_MOMENT_PATIENCE; see `wait` below).
//   onDone         told the move id once, when the moment has nothing more to
//                  show: a passing moment that is over, or any moment none of
//                  whose views can play.
//   backdrop       a still of the picture whose place the moment takes (the
//                  stance loop's poster, for the greeting). It fills the box
//                  until the moment's own first frame is there, so the box is
//                  not black while the files arrive.
//   onLastFrame    for a passing moment that ends on the first frame of what
//                  follows it: told a still of its last frame (a canvas) when
//                  it plays to its end, just before onDone, so what follows
//                  can show that frame until its own first frame is there.
//                  Not told when the moment is skipped or gives way early.
function MomentClip({ moveId, performerSide = 'fighter', moveLabel, fighter, opponent, holdLastFrame = false, fallback = null, backdrop, camera: chosenCamera, onCameraChange, onDone, onLastFrame }) {
  const id = useId();
  const viewportRef = useRef(null);
  const videoRef = useRef(null);
  // Where to put the new file after a camera change: a frame, or null.
  const resumeFrame = useRef(null);
  const toldDone = useRef(false);
  // A passing moment's wait for its picture (see `wait` below): the timer that
  // ends the wait, and what that timer then does, as the newest render made it.
  const waitTimer = useRef(null);
  const whenWaitIsUp = useRef(null);
  const [failed, setFailed] = useState([]);
  const [ownCamera, setOwnCamera] = useState(null);
  // A passing moment that has ended, was skipped, could not start or kept its
  // box waiting too long.
  const [passed, setPassed] = useState(false);
  const allViews = unrealClipViews(moveId, performerSide);
  const views = allViews.filter((view) => !failed.includes(view.camera));
  const wanted = chosenCamera ?? ownCamera;
  const clip = views.find((view) => view.camera === wanted) ?? views[0] ?? null;
  const [state, dispatch] = useReducer(playbackReducer, undefined, () => initialPlayback({
    reducedMotion: Boolean(reducedMotionQuery()?.matches),
    hidden: typeof document !== 'undefined' && document.hidden === true,
    // A passing moment belongs to the start of a match: it does not wait to be seen.
    canWatchView: holdLastFrame && typeof window !== 'undefined' && typeof window.IntersectionObserver === 'function',
  }));
  const playing = shouldPlay(state);
  // Nothing more to show: no view can play, or a passing moment is over.
  // Under reduced motion a passing moment is over before it starts.
  const over = !clip || (!holdLastFrame && (passed || state.reducedMotion));

  const finish = () => {
    if (toldDone.current) return;
    toldDone.current = true;
    onDone?.(moveId);
  };
  // The end of a passing moment. The parent is told in the same step, so what
  // follows is drawn once, in its own place.
  const pass = () => { setPassed(true); finish(); };

  // A passing moment keeps its box waiting only so long: for its picture to
  // start moving, and to move again once it has run out of data. When a wait
  // is up the moment is over, so a slow or stalled file never holds the box on
  // a still and the moment never plays late. One wait runs at a time, and the
  // picture moving ends it. A moment that holds its last frame has no such
  // limit: it rests on its first frame until it can play, as a technique clip
  // does.
  const wait = (milliseconds) => {
    if (holdLastFrame || waitTimer.current !== null) return;
    waitTimer.current = setTimeout(() => { waitTimer.current = null; whenWaitIsUp.current?.(); }, milliseconds);
  };
  const stopWaiting = () => {
    if (waitTimer.current === null) return;
    clearTimeout(waitTimer.current);
    waitTimer.current = null;
  };
  useEffect(() => { whenWaitIsUp.current = pass; });

  useEffect(() => {
    const query = reducedMotionQuery();
    const change = () => dispatch({ type: 'reduced-motion', on: query.matches });
    query?.addEventListener('change', change);
    return () => query?.removeEventListener('change', change);
  }, []);

  // Pause while the tab is hidden; what was asked for is kept, so it resumes.
  useEffect(() => {
    const change = () => dispatch({ type: 'hidden', hidden: document.hidden });
    document.addEventListener('visibilitychange', change);
    return () => document.removeEventListener('visibilitychange', change);
  }, []);

  // The wait for the first moving frame starts with the moment itself.
  useEffect(() => {
    if (over) return undefined;
    wait(PASSING_MOMENT_PATIENCE.start);
    return stopWaiting;
  }, [over]);

  // A moment that holds waits until at least half the picture is on screen.
  const hasClip = Boolean(clip);
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || state.seen || typeof window.IntersectionObserver !== 'function') return undefined;
    const observer = new window.IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.5)) dispatch({ type: 'visible', visible: true });
    }, { threshold: [0.5] });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [state.seen, hasClip]);

  // Apply the state to the one <video>: for each new file, each start from
  // frame 0, and each change of what is wanted.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = true;
    if (!playing) { video.pause(); return; }
    // A browser may refuse to start a video nobody asked for. A moment that
    // holds then waits for Play; a passing one is over.
    video.play()?.catch((error) => {
      if (error?.name !== 'NotAllowedError') return;
      if (holdLastFrame) dispatch({ type: 'refused' });
      else pass();
    });
  }, [playing, state.run, clip?.video]);

  // `fallback` is showing. Say so once, after that render, unless a handler
  // has said it already. A passing moment that gave way does not come back.
  useEffect(() => {
    if (!over) return;
    if (!holdLastFrame) setPassed(true);
    finish();
  }, [over]);

  if (over) return fallback;

  const title = moveLabel || 'Match moment';
  const fighterName = fighter?.name || 'Your fighter';
  const opponentName = opponent?.name || 'Opponent';
  const face = transportFace(state);
  const lastFrame = clip.frames - 1;
  const noteId = `${id}-note`;
  const waits = holdLastFrame && state.reducedMotion;

  const press = () => {
    const video = videoRef.current;
    if (state.ended && video) {
      video.currentTime = 0;
      video.play()?.catch(() => {});
    }
    dispatch({ type: 'press' });
  };
  const pickCamera = (camera) => {
    if (camera === clip.camera) return;
    const target = views.find((view) => view.camera === camera);
    const keepMoment = keepsMoment(clip, target);
    const video = videoRef.current;
    resumeFrame.current = keepMoment ? (state.ended ? lastFrame : clipFrameAt(clip, video?.currentTime ?? 0)) : null;
    dispatch({ type: 'camera', keepMoment });
    setOwnCamera(camera);
    onCameraChange?.(camera);
  };
  const loaded = () => {
    const video = videoRef.current;
    if (video && resumeFrame.current !== null) video.currentTime = clipFrameTime(clip, resumeFrame.current);
    resumeFrame.current = null;
  };
  const ended = () => {
    if (holdLastFrame) { dispatch({ type: 'ended', lastFrame }); return; }
    // Played to its end: its last frame is on screen, for what follows to keep.
    if (!toldDone.current && onLastFrame) {
      const still = frameStill(videoRef.current, clip);
      if (still) onLastFrame(still);
    }
    pass();
  };
  // A view that cannot play. A moment that holds tries its other view, then
  // hands over to the fallback; a passing one hands over at once.
  const failedView = () => {
    if (!holdLastFrame) { pass(); return; }
    const gone = [...failed, clip.camera];
    resumeFrame.current = null;
    setFailed(gone);
    if (nextViewAfterFailure(allViews, gone)) dispatch({ type: 'camera', keepMoment: false });
    else finish();
  };

  return (
    <section
      className="unreal-clip-stage is-moment"
      aria-label={`${title}, Unreal Engine clip`}
      aria-describedby={waits ? noteId : undefined}
      data-kind="moment"
      data-move={clip.moveId}
      data-camera={clip.camera}
      data-held={holdLastFrame ? 'true' : 'false'}
      data-ended={state.ended ? 'true' : 'false'}
    >
      <div className="unreal-clip-frame">
        <header className="unreal-clip-heading">
          <span>Unreal Engine</span>
          <strong>{title}</strong>
        </header>
        <div ref={viewportRef} className="unreal-clip-viewport" style={{ '--clip-ratio': `${clip.width} / ${clip.height}`, backgroundImage: backdrop ? `url("${backdrop}")` : undefined }}>
          <video
            key={clip.video}
            ref={videoRef}
            src={clip.video}
            poster={clip.poster}
            width={clip.width}
            height={clip.height}
            loop={false}
            muted
            playsInline
            disableRemotePlayback
            preload="auto"
            aria-label={`${title}. ${fighterName} in the white gi and ${opponentName} in the navy gi, seen from the ${clip.camera}.`}
            onLoadedData={loaded}
            onPlaying={stopWaiting}
            onWaiting={() => wait(PASSING_MOMENT_PATIENCE.stall)}
            onEnded={ended}
            onError={failedView}
          />
        </div>
        <div className="unreal-clip-controls">
          {holdLastFrame ? (
            <button type="button" className="unreal-clip-play" onClick={press}>
              {face === 'Pause' ? <Pause size={16} aria-hidden="true" /> : face === 'Replay' ? <RotateCcw size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
              {face}
            </button>
          ) : (
            <button type="button" className="unreal-clip-play" onClick={pass}>
              <SkipForward size={16} aria-hidden="true" />
              Skip
            </button>
          )}
          {holdLastFrame && views.length > 1 && (
            <div className="unreal-clip-cameras" role="group" aria-label="Camera view">
              {views.map((view) => (
                <button key={view.camera} type="button" aria-pressed={view.camera === clip.camera} onClick={() => pickCamera(view.camera)}>
                  {CAMERA_LABELS[view.camera] ?? view.camera}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="unreal-clip-legend">
          <span><i style={{ background: UNREAL_CLIP_LOOK.fighter.swatch }} aria-hidden="true" />{fighterName} (you): {UNREAL_CLIP_LOOK.fighter.gi} gi</span>
          <span><i style={{ background: UNREAL_CLIP_LOOK.opponent.swatch }} aria-hidden="true" />{opponentName}: {UNREAL_CLIP_LOOK.opponent.gi} gi</span>
          <small>Athletes and colors are fixed in this clip.</small>
        </div>
      </div>
      {waits && <p className="unreal-clip-note" id={noteId}>Reduced motion is on; press Play when ready.</p>}
    </section>
  );
}
