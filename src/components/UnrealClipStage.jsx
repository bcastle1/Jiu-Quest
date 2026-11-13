import { useEffect, useId, useReducer, useRef, useState } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { UNREAL_CLIP_LOOK, unrealClipViews } from '../unreal/techniqueClips.js';
import { CLIP_SPEEDS, clipFrameAt, clipFrameTime, initialPlayback, keepsMoment, nextViewAfterFailure, playbackReducer, scrubberText, shouldPlay, speedLabel, techniqueNote, transportFace } from '../unreal/clipPlayback.js';
import './UnrealClipStage.css';

const CAMERA_LABELS = { side: 'Side', front: 'Front' };
const reducedMotionQuery = () => (typeof window === 'undefined' ? null : window.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null);

// Plays one pre-rendered Unreal clip of a move. The video file is the whole
// picture: nothing is streamed and nothing is computed here. If no clip exists
// for the move, or the browser cannot play it, `fallback` is shown instead.
// kind 'stance' is a loop held on the feet. kind 'technique' plays once, rests
// on its last frame and offers Replay; with `study` (Training) it also offers
// speeds and a scrubber. `camera` and `rate` may be held by the parent so a
// remount keeps the person's choice.
export default function UnrealClipStage({ kind = 'stance', ...props }) {
  return kind === 'technique' ? <TechniqueClip {...props} /> : <StanceClip {...props} />;
}

function StanceClip({ moveId, performerSide = 'fighter', moveLabel, fighter, opponent, compact = false, fallback = null, camera: chosenCamera, onCameraChange }) {
  const views = unrealClipViews(moveId, performerSide);
  const [ownCamera, setOwnCamera] = useState(null);
  const camera = chosenCamera ?? ownCamera;
  const setCamera = (value) => { setOwnCamera(value); onCameraChange?.(value); };
  const clip = views.find((view) => view.camera === camera) ?? views[0] ?? null;
  const videoRef = useRef(null);
  // What the person wants. People who ask for reduced motion start paused.
  const [wantsPlay, setWantsPlay] = useState(() => !reducedMotionQuery()?.matches);
  // The file that could not play, if one did. Another move or camera is another
  // file and gets its own try.
  const [failedVideo, setFailedVideo] = useState(null);

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
      </div>
      <div className="unreal-clip-controls">
        <button type="button" className="unreal-clip-play" onClick={() => setWantsPlay((value) => !value)}>
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
        <small>Gi and belt colors are fixed in this clip.</small>
      </div>
    </section>
  );
}

function TechniqueClip({ moveId, performerSide = 'fighter', moveLabel, fighter, opponent, study = false, fallback = null, camera: chosenCamera, onCameraChange, rate: chosenRate, onRateChange }) {
  const id = useId();
  const viewportRef = useRef(null);
  const videoRef = useRef(null);
  // Where to put the new file after a camera change: a frame, or null.
  const resumeFrame = useRef(null);
  const [failed, setFailed] = useState([]);
  const [ownCamera, setOwnCamera] = useState(null);
  const allViews = unrealClipViews(moveId, performerSide);
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
          <small>Gi and belt colors are fixed in this clip.</small>
        </div>
      </div>
      <p className="unreal-clip-note" id={noteId}>{techniqueNote({ choreographyReviewed: clip.choreographyReviewed, reducedMotion: state.reducedMotion })}</p>
    </section>
  );
}
