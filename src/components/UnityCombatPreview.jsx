import { useState } from 'react';
import { createArenaState } from '../arena/outcome.js';
import { UNITY_PREVIEWS } from '../unity/bridge.js';
import GrapplingSnapshotStage from './GrapplingSnapshotStage.jsx';
import UnityGrapplingStage from './UnityGrapplingStage.jsx';

const previewFighter = { name: 'Your athlete', skinTone: '#a86b4d', hairColor: '#11131c', giTop: '#f8fbff', giPants: '#f8fbff', belt: 'blue', hairStyle: 'short fade', aura: 'void violet', emblem: 'none' };
const previewOpponent = { name: 'Training partner', skinTone: '#d99b71', hairColor: '#3b251b', giTop: '#112a58', giPants: '#112a58', belt: 'purple', hairStyle: 'short fade', aura: 'blue flame', emblem: 'none' };

// This route never mounts App, reads saved progress, or writes localStorage.
export default function UnityCombatPreview() {
  const [moveId, setMoveId] = useState('double_leg');
  const [performerSide, setPerformerSide] = useState('fighter');
  const [kit, setKit] = useState('classic');
  const selected = UNITY_PREVIEWS.find((move) => move.id === moveId);
  const fighter = kit === 'night' ? { ...previewFighter, giTop: '#151922', giPants: '#151922' } : previewFighter;
  const opponent = kit === 'night' ? { ...previewOpponent, giTop: '#7f8794', giPants: '#7f8794' } : previewOpponent;
  const settled = createArenaState(selected.position, performerSide);
  return <main className="unity-preview-page">
    <div className="unity-preview-top"><span className="unity-preview-brand">JIUQUEST</span><a href="/">Return to JiuQuest</a></div>
    <header className="unity-preview-intro"><span className="unity-eyebrow">ENGINE PREVIEW · WEBSITE FIRST</span><h1>See the movement.<br />Study the exchange.</h1><p>Explore the first Unity combat scenes. Slow down a transition, change your viewing angle, and swap the performing athlete. These draft animations are for review before integration is released.</p></header>
    <div className="unity-preview-grid">
      <UnityGrapplingStage moveId={moveId} moveLabel={selected.name} performerSide={performerSide} fighter={fighter} opponent={opponent} fallback={<GrapplingSnapshotStage state={settled} fighter={fighter} opponent={opponent} compact />} />
      <aside className="unity-preview-options" aria-label="Combat preview setup"><h2>Choose your exchange</h2>
        <label htmlFor="unity-preview-technique">Technique<select id="unity-preview-technique" value={moveId} onChange={(event) => setMoveId(event.target.value)}>{UNITY_PREVIEWS.map((move) => <option key={move.id} value={move.id}>{move.name}</option>)}</select></label>
        <label htmlFor="unity-preview-performer">Performing athlete<select id="unity-preview-performer" value={performerSide} onChange={(event) => setPerformerSide(event.target.value)}><option value="fighter">Your athlete</option><option value="opponent">Training partner</option></select></label>
        <label htmlFor="unity-preview-kit">Gi colors<select id="unity-preview-kit" value={kit} onChange={(event) => setKit(event.target.value)}><option value="classic">White / navy</option><option value="night">Black / gray</option></select></label>
        <p>Armbar shows a finish draft. Guard pass shows a generic pass. Neither is labeled as a complete, named curriculum lesson.</p>
        <p className="unity-preview-safe">Preview only. Your saved fighters, training repetitions, unlocks, and arena results stay unchanged.</p>
      </aside>
    </div>
  </main>;
}
