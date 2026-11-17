import { useEffect, useState } from 'react';
import UnityGrapplingStage from './UnityGrapplingStage.jsx';
import UnrealClipStage from './UnrealClipStage.jsx';
import UnrealGrapplingStage from './UnrealGrapplingStage.jsx';
import { localUnrealAllowed, resolveCombatRenderer } from '../unreal/renderer.js';
import { findUnrealClip, unrealClipViews } from '../unreal/techniqueClips.js';
import { chooseTechniquePicture } from '../unreal/techniquePicture.js';
import { stanceLoop } from '../unreal/stances.js';
import { MATCH_GREETING, MATCH_MOMENT_TITLES, findMatchMoment, isMatchMoment, prefersReducedMotion } from '../unreal/matchMoments.js';

// With both athletes on their feet and no exchange result on screen, the
// picture is the pre-rendered stance loop. The player's stance picks the clip
// once Unreal has rendered that stance; until then it is the standard one.
const IDLE_CLIP = Object.freeze({ moveId: 'standing_stance', label: 'Standing stance' });

// `clipMoveId` is the technique's Unreal clip id and `clipPerformerSide` is who
// performs it in the clip. Every curriculum technique has a clip id, also one
// the engine cannot animate (no `moveId`). A caller that passes no `clipMoveId`
// gets the engine's `moveId` as the clip id; null asks for no clip.
// `onClipUnavailable` is told the clip id once a technique clip gives way to
// `stage` because none of its views can play.
// `momentId` asks for a match moment (src/unreal/matchMoments.js) in the place
// of the usual picture: the greeting before a match that starts on the feet,
// or the win or the loss after a finished match. `onMomentDone` is told that
// id when the moment is over or cannot be shown here. All five are taken out
// here, so the engine stages below receive exactly the props they always
// received.
export default function GrapplingStage({ idleStanding = false, onRendererChange, clipMoveId, clipPerformerSide, onClipUnavailable, momentId, onMomentDone, ...props }) {
  const local = localUnrealAllowed(window.location.href, import.meta.env.DEV);
  const [engine, setEngine] = useState(() => resolveCombatRenderer(window.location.href, { development: import.meta.env.DEV, configuredEngine: import.meta.env.VITE_COMBAT_ENGINE }));
  // The person's choice of view and speed outlives the remount on a new move.
  const [camera, setCamera] = useState(null);
  const [rate, setRate] = useState(1);
  // The view the person chose for the stance loop, and whether they paused it
  // or started it again (null until they do, or the browser does it for them).
  // Both are kept here while the loop, or the greeting in its place, is what
  // shows, so the loop comes back as it was left: on the same view, and still
  // paused if it was paused. Any other picture forgets them.
  const [stanceCamera, setStanceCamera] = useState(null);
  const [stancePlays, setStancePlays] = useState(null);
  // A still of the frame the greeting ended on, when it played to its end on
  // the first frame of the loop that follows (see `endsOnLoop` below). The loop
  // that mounts in its place takes it, so it is held here for that one render.
  const [handover, setHandover] = useState(null);
  useEffect(() => {
    if (handover !== null) setHandover(null);
  }, [handover]);
  const choose = event => {
    const value = event.target.value, url = new URL(window.location.href);
    url.searchParams.set('engine', value);
    window.history.replaceState(window.history.state, '', url);
    setEngine(value);
    onRendererChange?.(value);
  };
  const stage = engine === 'unreal' ? <UnrealGrapplingStage {...props} moveId={idleStanding ? IDLE_CLIP.moveId : props.moveId} moveLabel={idleStanding ? IDLE_CLIP.label : props.moveLabel} /> : engine === 'unity' ? <UnityGrapplingStage {...props} /> : props.fallback;
  // The local live preview renders the stance itself. Every other renderer
  // shows the clip, and falls back to its own picture if the clip cannot play.
  const idle = stanceLoop(props.fighter?.stance, props.opponent?.stance);
  const idleClip = idleStanding && engine !== 'unreal' && findUnrealClip(idle.moveId, idle.performerSide);
  if (!idleClip && stanceCamera !== null) setStanceCamera(null);
  if (!idleClip && stancePlays !== null) setStancePlays(null);
  // The view the loop is showing: the one the person chose where this loop has
  // it, otherwise the side view. A loop with a side view only shows from the
  // side whatever was chosen for another loop before. The greeting opens on
  // this view, and its box shows this view's still until the greeting's own
  // first frame is there.
  const loopView = idleClip ? (stanceCamera && findUnrealClip(idle.moveId, idle.performerSide, stanceCamera)) || idleClip : null;
  // A technique plays its Unreal clips once every performer it needs has one,
  // or where it is the one owner-published draft, for that draft's own
  // performer only (src/unreal/techniquePicture.js); until then, and if every
  // view fails, `stage` plays as it does today.
  const picture = !idleStanding && chooseTechniquePicture({ moveId: props.moveId, clipMoveId: clipMoveId === undefined ? props.moveId : clipMoveId, performerSide: clipPerformerSide ?? props.performerSide, engine, search: window.location.search, views: unrealClipViews });
  // The picture without a match moment: exactly what showed before moments.
  const usual = idleClip
    ? <UnrealClipStage key="stance" moveId={idle.moveId} performerSide={idle.performerSide} moveLabel={IDLE_CLIP.label} camera={stanceCamera} onCameraChange={setStanceCamera} wantsPlay={stancePlays} onWantsPlayChange={setStancePlays} opening={handover} fighter={props.fighter} opponent={props.opponent} compact={props.compact} fallback={stage} />
    : picture && picture.kind === 'clip'
      ? <UnrealClipStage key={`technique:${picture.moveId}:${picture.performerSide}:${props.signal ?? ''}`} kind="technique" moveId={picture.moveId} performerSide={picture.performerSide} moveLabel={props.moveLabel} study={Boolean(props.compact)} camera={camera ?? picture.camera} onCameraChange={setCamera} rate={rate} onRateChange={setRate} fighter={props.fighter} opponent={props.opponent} onUnavailable={onClipUnavailable} fallback={stage} />
      : stage;
  // A match moment takes that picture's place once its clip is published, and
  // never over the local live preview. The greeting plays only where the
  // stance loop would, on the view the loop is showing, and not at all for
  // someone who asks for reduced motion. The end of a match holds its last
  // frame.
  const greeting = momentId === MATCH_GREETING;
  const momentFits = isMatchMoment(momentId) && engine !== 'unreal' && (greeting ? Boolean(idleClip) && !prefersReducedMotion() : !idleStanding);
  const published = momentFits ? findMatchMoment(momentId, greeting ? loopView.camera : undefined) : null;
  // The greeting is rendered to rise out of the standard stance loop of the
  // player's athlete and to settle back into that loop's first frame, in one
  // view. It plays only over that loop, in that view: there it runs in and out
  // without a seam, and its last frame is handed to the loop that follows, so
  // the loop takes over from the frame the greeting stopped on instead of from
  // its own poster. Over any other loop (the player's own stance, a rival's
  // stance, or a view the greeting was not rendered from) both cuts would show,
  // an athlete snapping from one stance into another or the camera flipping
  // twice, so there is no greeting there and that loop carries on.
  const endsOnLoop = greeting && Boolean(published) && idle.moveId === IDLE_CLIP.moveId && idle.performerSide === published.performerSide && loopView.camera === published.camera;
  const moment = greeting && !endsOnLoop ? null : published;
  // A moment that cannot be shown here is over before it starts. Say so after
  // the render, so whoever asked for it can stop asking.
  const momentMissing = Boolean(momentId) && !moment;
  useEffect(() => {
    if (momentMissing) onMomentDone?.(momentId);
  }, [momentMissing, momentId]);
  return <>
    {local && <label className="unreal-renderer-choice">Character graphics<select aria-label="Character graphics" value={engine} onChange={choose}><option value="unity">Unity</option><option value="unreal">Unreal · local preview</option><option value="snapshot">Position snapshots</option></select></label>}
    {moment
      ? <UnrealClipStage key={`moment:${moment.moveId}:${props.signal ?? ''}`} kind="moment" moveId={moment.moveId} moveLabel={MATCH_MOMENT_TITLES[moment.moveId]} holdLastFrame={!greeting} camera={greeting ? moment.camera : undefined} backdrop={greeting ? loopView.poster : undefined} fighter={props.fighter} opponent={props.opponent} onDone={onMomentDone} onLastFrame={endsOnLoop ? setHandover : undefined} fallback={usual} />
      : usual}
  </>;
}
