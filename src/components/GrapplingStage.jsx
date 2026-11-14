import { useState } from 'react';
import UnityGrapplingStage from './UnityGrapplingStage.jsx';
import UnrealClipStage from './UnrealClipStage.jsx';
import UnrealGrapplingStage from './UnrealGrapplingStage.jsx';
import { localUnrealAllowed, resolveCombatRenderer } from '../unreal/renderer.js';
import { findUnrealClip, unrealClipViews } from '../unreal/techniqueClips.js';
import { chooseTechniquePicture } from '../unreal/techniquePicture.js';
import { stanceLoop } from '../unreal/stances.js';

// With both athletes on their feet and no exchange result on screen, the
// picture is the pre-rendered stance loop. The player's stance picks the clip
// once Unreal has rendered that stance; until then it is the standard one.
const IDLE_CLIP = Object.freeze({ moveId: 'standing_stance', label: 'Standing stance' });

// `clipMoveId` is the technique's Unreal clip id and `clipPerformerSide` is who
// performs it in the clip. Every curriculum technique has a clip id, also one
// the engine cannot animate (no `moveId`). A caller that passes no `clipMoveId`
// gets the engine's `moveId` as the clip id; null asks for no clip.
// `onClipUnavailable` is told the clip id once a technique clip gives way to
// `stage` because none of its views can play. All three are taken out here, so
// the engine stages below receive exactly the props they always received.
export default function GrapplingStage({ idleStanding = false, onRendererChange, clipMoveId, clipPerformerSide, onClipUnavailable, ...props }) {
  const local = localUnrealAllowed(window.location.href, import.meta.env.DEV);
  const [engine, setEngine] = useState(() => resolveCombatRenderer(window.location.href, { development: import.meta.env.DEV, configuredEngine: import.meta.env.VITE_COMBAT_ENGINE }));
  // The person's choice of view and speed outlives the remount on a new move.
  const [camera, setCamera] = useState(null);
  const [rate, setRate] = useState(1);
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
  // A technique plays its Unreal clips once both performers have one; until
  // then, and if every view fails, `stage` plays as it does today.
  const picture = !idleStanding && chooseTechniquePicture({ moveId: props.moveId, clipMoveId: clipMoveId === undefined ? props.moveId : clipMoveId, performerSide: clipPerformerSide ?? props.performerSide, engine, search: window.location.search, views: unrealClipViews });
  return <>
    {local && <label className="unreal-renderer-choice">Character graphics<select aria-label="Character graphics" value={engine} onChange={choose}><option value="unity">Unity</option><option value="unreal">Unreal · local preview</option><option value="snapshot">Position snapshots</option></select></label>}
    {idleClip
      ? <UnrealClipStage key="stance" moveId={idle.moveId} performerSide={idle.performerSide} moveLabel={IDLE_CLIP.label} fighter={props.fighter} opponent={props.opponent} compact={props.compact} fallback={stage} />
      : picture && picture.kind === 'clip'
        ? <UnrealClipStage key={`technique:${picture.moveId}:${picture.performerSide}:${props.signal ?? ''}`} kind="technique" moveId={picture.moveId} performerSide={picture.performerSide} moveLabel={props.moveLabel} study={Boolean(props.compact)} camera={camera ?? picture.camera} onCameraChange={setCamera} rate={rate} onRateChange={setRate} fighter={props.fighter} opponent={props.opponent} onUnavailable={onClipUnavailable} fallback={stage} />
        : stage}
  </>;
}
