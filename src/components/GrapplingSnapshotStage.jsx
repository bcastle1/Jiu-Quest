import { useEffect, useRef, useState } from 'react';
import { ImageOff, LoaderCircle, RotateCcw } from 'lucide-react';
import { getArenaPositionLabel, getArenaSnapshot } from '../arena/outcome.js';
import { getArenaAppearanceKey, renderArenaAppearance } from '../arena/appearance.js';
import { usesUnrealAthlete } from '../unreal/athlete.js';
import { chooseUnrealPositionStill } from '../unreal/positionStills.js';
import UnrealPositionStill, { useUnrealPositionStill } from './UnrealPositionStill.jsx';
import './GrapplingSnapshotStage.css';

function AthleteKey({ athlete, role, player }) {
  return <div className="snapshot-athlete">
    <span className="snapshot-kit" aria-hidden="true"><i style={{ background: athlete.giTop }} /><i style={{ background: athlete.giPants }} /></span>
    <span><span>{player ? 'You' : athlete.name}</span><small>{role}</small></span>
  </div>;
}

export default function GrapplingSnapshotStage({ state, fighter, opponent, fighterBelt, opponentBelt, result, onReplay, compact = false, unrealStills = true }) {
  const canvasRef = useRef(null);
  const [renderStatus, setRenderStatus] = useState({ key: null, status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [replay, setReplay] = useState(0);
  const snapshot = getArenaSnapshot(state);
  const lead = snapshot.leadSide === 'opponent' ? opponent : fighter;
  const other = snapshot.leadSide === 'opponent' ? fighter : opponent;
  const leadBelt = snapshot.leadSide === 'opponent' ? opponentBelt : fighterBelt;
  const otherBelt = snapshot.leadSide === 'opponent' ? fighterBelt : opponentBelt;
  const appearanceKey = getArenaAppearanceKey(snapshot.key, lead, other, leadBelt, otherBelt);
  const sceneKey = `${snapshot.key}-${snapshot.leadSide}-${appearanceKey}`;
  const renderKey = `${sceneKey}-${attempt}-${replay}`;
  // A player who chose the Unreal athlete sees the Unreal still for this
  // position when one exists and is not held back
  // (HELD_UNREAL_POSITION_STILLS). The classic picture stays as the fallback
  // if any of its layers cannot load, and for every position Unreal has not
  // rendered.
  // A caller whose words describe the classic picture turns the stills off.
  const unreal = unrealStills && usesUnrealAthlete(fighter) ? chooseUnrealPositionStill(snapshot) : null;
  const stillStatus = useUnrealPositionStill(unreal?.still ?? null);
  const showStill = Boolean(unreal) && stillStatus !== 'error';
  const status = showStill ? stillStatus : renderStatus.key === renderKey ? renderStatus.status : 'loading';
  useEffect(() => {
    if (showStill) return undefined;
    let cancelled = false;
    const setStatus = (nextStatus) => setRenderStatus({ key: renderKey, status: nextStatus });
    setStatus('loading');
    const buffer = document.createElement('canvas');
    const context = buffer.getContext('2d', { willReadFrequently: true });
    const render = context ? renderArenaAppearance(context, { key: snapshot.key, primary: lead, secondary: other, primaryBelt: leadBelt, secondaryBelt: otherBelt }) : Promise.reject(new Error('Canvas unavailable'));
    render.then(() => {
      if (cancelled || !canvasRef.current) return;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas unavailable');
      canvas.width = buffer.width;
      canvas.height = buffer.height;
      ctx.drawImage(buffer, 0, 0);
      setStatus('ready');
    }).catch(() => { if (!cancelled) setStatus('error'); });
    return () => { cancelled = true; };
  }, [renderKey, showStill]);

  const label = getArenaPositionLabel(state);
  const exact = showStill ? unreal.exact : snapshot.exactPositionAvailable;
  const worn = showStill ? 'Rendered in Unreal Engine. Each athlete wears their own gi and belt colors.' : 'Each athlete wears their selected gi colors, hair, skin tone, belt, emblem and aura.';
  const description = exact
    ? `${label}. ${snapshot.topSide ? `${snapshot.topSide === 'fighter' ? fighter.name : opponent.name} is on top.` : snapshot.controlSide ? `${snapshot.controlSide === 'fighter' ? fighter.name : opponent.name} holds control.` : 'Both athletes are in a neutral position.'} ${worn}`
    : `General grappling reference. The exact ${label.toLowerCase()} setup is not pictured. Follow the technique steps and position labels.`;
  return <figure className={`grappling-snapshot-stage ${compact ? 'compact' : ''}`} data-position={snapshot.key} data-top-side={snapshot.topSide ?? 'neutral'} data-control-side={snapshot.controlSide ?? 'neutral'} data-ready={status} data-picture={showStill ? 'unreal' : 'classic'}>
    <div className="snapshot-image-wrap" key={`${sceneKey}-${replay}`}>
      {showStill
        ? <UnrealPositionStill still={unreal.still} ready={status === 'ready'} lead={lead} other={other} leadBelt={leadBelt} otherBelt={otherBelt} label={description} />
        : <canvas ref={canvasRef} className={`snapshot-canvas ${status === 'ready' ? 'is-ready' : ''}`} role="img" aria-label={description} />}
      {status !== 'ready' && <div className="snapshot-loading" role="status" aria-live="polite">
        {status === 'error' ? <><ImageOff size={24} /><span>{result ? 'The position image could not load. Your match result is shown below.' : 'The position image could not load. Try loading it again.'}</span><button onClick={() => setAttempt((value) => value + 1)}><RotateCcw size={15} />Retry image</button></> : <><LoaderCircle size={22} className="snapshot-spinner" /><span>Preparing your arena…</span></>}
      </div>}
      {status === 'ready' && result && <span className="snapshot-round">Exchange {result.round} settled</span>}
    </div>
    <figcaption className="snapshot-caption">
      <div className="snapshot-position"><span>{label}</span><small>{!exact ? 'General reference · exact setup not pictured' : showStill ? 'Unreal Engine · your gi and belt colors' : 'Position snapshot · your appearance'}</small></div>
      <div className="snapshot-identities"><AthleteKey athlete={fighter} player role={getArenaPositionLabel(state, 'fighter')} /><AthleteKey athlete={opponent} role={getArenaPositionLabel(state, 'opponent')} /></div>
      {result && <button className="snapshot-replay" aria-label="Review the settled position" disabled={status !== 'ready'} onClick={() => { setReplay((value) => value + 1); onReplay?.(); }}><RotateCcw size={16} /><span>Review</span></button>}
    </figcaption>
  </figure>;
}
