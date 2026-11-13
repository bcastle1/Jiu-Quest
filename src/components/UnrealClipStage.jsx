import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { UNREAL_CLIP_LOOK, unrealClipViews } from '../unreal/techniqueClips.js';
import './UnrealClipStage.css';

const CAMERA_LABELS = { side: 'Side', front: 'Front' };
const reducedMotionQuery = () => (typeof window === 'undefined' ? null : window.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null);

// Plays one pre-rendered Unreal clip of a move. The video file is the whole
// picture: nothing is streamed and nothing is computed here. If no clip exists
// for the move, or the browser cannot play it, `fallback` is shown instead.
export default function UnrealClipStage({ moveId, performerSide = 'fighter', moveLabel, fighter, opponent, compact = false, fallback = null }) {
  const views = unrealClipViews(moveId, performerSide);
  const [camera, setCamera] = useState(null);
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
    <section className={compact ? 'unreal-clip-stage compact' : 'unreal-clip-stage'} aria-label={`${title}, Unreal Engine clip`} data-move={clip.moveId} data-camera={clip.camera}>
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
