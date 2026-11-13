import { useState } from 'react';
import UnityGrapplingStage from './UnityGrapplingStage.jsx';
import UnrealClipStage from './UnrealClipStage.jsx';
import UnrealGrapplingStage from './UnrealGrapplingStage.jsx';
import { localUnrealAllowed, resolveCombatRenderer } from '../unreal/renderer.js';
import { findUnrealClip } from '../unreal/techniqueClips.js';
import { stanceLoop } from '../unreal/stances.js';

// The one moment a pre-rendered Unreal clip is the right picture so far: both
// athletes on their feet before an exchange has settled. The player's stance
// picks the clip once Unreal has rendered that stance; until then it is the
// standard one.
const IDLE_CLIP = Object.freeze({ moveId: 'standing_stance', label: 'Standing stance' });

export default function GrapplingStage({ idleStanding = false, onRendererChange, ...props }) {
  const local = localUnrealAllowed(window.location.href, import.meta.env.DEV);
  const [engine, setEngine] = useState(() => resolveCombatRenderer(window.location.href, { development: import.meta.env.DEV, configuredEngine: import.meta.env.VITE_COMBAT_ENGINE }));
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
  return <>
    {local && <label className="unreal-renderer-choice">Character graphics<select aria-label="Character graphics" value={engine} onChange={choose}><option value="unity">Unity</option><option value="unreal">Unreal · local preview</option><option value="snapshot">Position snapshots</option></select></label>}
    {idleClip ? <UnrealClipStage moveId={idle.moveId} performerSide={idle.performerSide} moveLabel={IDLE_CLIP.label} fighter={props.fighter} opponent={props.opponent} compact={props.compact} fallback={stage} /> : stage}
  </>;
}
