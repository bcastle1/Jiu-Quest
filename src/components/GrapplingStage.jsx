import { useState } from 'react';
import UnityGrapplingStage from './UnityGrapplingStage.jsx';
import UnrealGrapplingStage from './UnrealGrapplingStage.jsx';
import { localUnrealAllowed, resolveCombatRenderer } from '../unreal/renderer.js';

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
  return <>
    {local && <label className="unreal-renderer-choice">Character graphics<select aria-label="Character graphics" value={engine} onChange={choose}><option value="unity">Unity</option><option value="unreal">Unreal · local preview</option><option value="snapshot">Position snapshots</option></select></label>}
    {engine === 'unreal' ? <UnrealGrapplingStage {...props} moveId={idleStanding ? 'standing_stance' : props.moveId} moveLabel={idleStanding ? 'Standing stance' : props.moveLabel} /> : engine === 'unity' ? <UnityGrapplingStage {...props} /> : props.fallback}
  </>;
}
