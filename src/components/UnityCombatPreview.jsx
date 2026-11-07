import { useState } from 'react';
import { createArenaState } from '../arena/outcome.js';
import { UNITY_PREVIEWS } from '../unity/bridge.js';
import GrapplingSnapshotStage from './GrapplingSnapshotStage.jsx';
import UnityGrapplingStage from './UnityGrapplingStage.jsx';

const previewFighter = { name: 'Your athlete', skinTone: '#a86b4d', hairColor: '#11131c', giTop: '#f8fbff', giPants: '#f8fbff', belt: 'blue', hairStyle: 'short fade', aura: 'void violet', emblem: 'none' };
const previewOpponent = { name: 'Training partner', skinTone: '#d99b71', hairColor: '#3b251b', giTop: '#112a58', giPants: '#112a58', belt: 'purple', hairStyle: 'short fade', aura: 'blue flame', emblem: 'none' };
const kits = {
  classic: ['#f8fbff', '#112a58'],
  night: ['#151922', '#7f8794'],
  summit: ['#315c54', '#a65135'],
};

// This route never mounts App, reads saved progress, or writes localStorage.
export default function UnityCombatPreview() {
  const [moveId, setMoveId] = useState('double_leg');
  const [performerSide, setPerformerSide] = useState('fighter');
  const [kit, setKit] = useState('classic');
  const [hairStyle, setHairStyle] = useState('shadow spikes');
  const selected = UNITY_PREVIEWS.find((move) => move.id === moveId);
  const fighter = { ...previewFighter, hairStyle, giTop: kits[kit][0], giPants: kits[kit][0] };
  const opponent = { ...previewOpponent, giTop: kits[kit][1], giPants: kits[kit][1] };
  const settled = createArenaState(selected.position, performerSide);
  return <main className="unity-preview-page">
    <div className="unity-preview-top"><span className="unity-preview-brand"><span className="unity-dojo-mark" aria-hidden="true">JQ</span>JIUQUEST</span><a href="/">Return to JiuQuest <span aria-hidden="true">↗</span></a></div>
    <header className="unity-preview-intro"><div><span className="unity-eyebrow">JIUQUEST STUDIO</span><h1>Master the exchange.</h1><p>One mat. Two athletes. Every movement matters.</p></div><span className="unity-preview-mode">COMBAT LAB<span>Explore · Replay · Refine</span></span></header>
    <div className="unity-preview-technique"><label htmlFor="unity-preview-technique">Choose a technique</label><select id="unity-preview-technique" aria-label="Technique" value={moveId} onChange={(event) => setMoveId(event.target.value)}>{UNITY_PREVIEWS.map((move) => <option key={move.id} value={move.id}>{move.name}</option>)}</select><span>{UNITY_PREVIEWS.length} animated exchanges</span></div>
    <div className="unity-preview-grid">
      <UnityGrapplingStage moveId={moveId} moveLabel={selected.name} performerSide={performerSide} fighter={fighter} opponent={opponent} fallback={<GrapplingSnapshotStage state={settled} fighter={fighter} opponent={opponent} compact />} />
      <aside className="unity-preview-options" aria-label="Combat preview setup"><div className="unity-dojo-location"><span className="unity-eyebrow">TRAINING GROUND</span><strong>JiuQuest Studio</strong><span>Train. Grapple. Grow.</span></div><details open><summary>Athletes & appearance<span>Choose your look</span></summary><div className="unity-preview-option-fields">
        <label htmlFor="unity-preview-performer">Performing athlete<select id="unity-preview-performer" value={performerSide} onChange={(event) => setPerformerSide(event.target.value)}><option value="fighter">Your athlete</option><option value="opponent">Training partner</option></select></label>
        <label htmlFor="unity-preview-kit">Gi colors<select id="unity-preview-kit" value={kit} onChange={(event) => setKit(event.target.value)}><option value="classic">White / navy</option><option value="night">Black / gray</option><option value="summit">Jade / ember</option></select></label>
        <label htmlFor="unity-preview-hair">Your hairstyle<select id="unity-preview-hair" value={hairStyle} onChange={(event) => setHairStyle(event.target.value)}><option value="shadow spikes">Swept spikes</option><option value="short fade">Short crop</option><option value="slicked back">Slicked back</option><option value="long hair">Long tied hair</option><option value="mohawk">Mohawk</option><option value="bald">Shaved</option></select></label>
        </div></details>
        <p>Armbar shows a finish draft. Guard pass shows a generic pass. Neither is labeled as a complete, named curriculum lesson.</p>
        <p className="unity-preview-safe">Preview only. Your saved fighters, training repetitions, unlocks, and arena results stay unchanged.</p>
      </aside>
    </div>
  </main>;
}
