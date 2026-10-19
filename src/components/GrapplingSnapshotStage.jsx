import { useEffect, useRef, useState } from 'react';
import { ImageOff, LoaderCircle, RotateCcw } from 'lucide-react';
import { getArenaPositionLabel, getArenaSnapshot } from '../arena/outcome.js';
import { getArenaAppearanceKey, renderArenaAppearance } from '../arena/appearance.js';
import './GrapplingSnapshotStage.css';

function AthleteKey({ athlete, role, player }) {
  return <div className="snapshot-athlete">
    <span className="snapshot-kit" aria-hidden="true"><i style={{ background: athlete.giTop }} /><i style={{ background: athlete.giPants }} /></span>
    <span><span>{player ? 'You' : athlete.name}</span><small>{role}</small></span>
  </div>;
}

export default function GrapplingSnapshotStage({ state, fighter, opponent, fighterBelt, opponentBelt, result, onReplay, compact = false }) {
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
  const status = renderStatus.key === renderKey ? renderStatus.status : 'loading';
  useEffect(() => {
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
  }, [renderKey]);

  const label = getArenaPositionLabel(state);
  const description = `${label}. ${snapshot.topSide ? `${snapshot.topSide === 'fighter' ? fighter.name : opponent.name} is on top.` : snapshot.controlSide ? `${snapshot.controlSide === 'fighter' ? fighter.name : opponent.name} controls the back.` : 'Both athletes are in a neutral position.'} Each athlete wears their selected gi colors, hair, skin tone, belt, emblem and aura.`;
  return <figure className={`grappling-snapshot-stage ${compact ? 'compact' : ''}`} data-position={snapshot.key} data-top-side={snapshot.topSide ?? 'neutral'} data-control-side={snapshot.controlSide ?? 'neutral'} data-ready={status}>
    <div className="snapshot-image-wrap" key={`${sceneKey}-${replay}`}>
      <canvas ref={canvasRef} className={`snapshot-canvas ${status === 'ready' ? 'is-ready' : ''}`} role="img" aria-label={description} />
      {status !== 'ready' && <div className="snapshot-loading" role="status" aria-live="polite">
        {status === 'error' ? <><ImageOff size={24} /><span>{result ? 'The position image could not load. Your match result is shown below.' : 'The position image could not load. Try loading it again.'}</span><button onClick={() => setAttempt((value) => value + 1)}><RotateCcw size={15} />Retry image</button></> : <><LoaderCircle size={22} className="snapshot-spinner" /><span>Preparing your arena…</span></>}
      </div>}
      {status === 'ready' && result && <span className="snapshot-round">Exchange {result.round} settled</span>}
    </div>
    <figcaption className="snapshot-caption">
      <div className="snapshot-position"><span>{label}</span><small>Position snapshot · your appearance</small></div>
      <div className="snapshot-identities"><AthleteKey athlete={fighter} player role={getArenaPositionLabel(state, 'fighter')} /><AthleteKey athlete={opponent} role={getArenaPositionLabel(state, 'opponent')} /></div>
      {result && <button className="snapshot-replay" aria-label="Review the settled position" disabled={status !== 'ready'} onClick={() => { setReplay((value) => value + 1); onReplay?.(); }}><RotateCcw size={16} /><span>Review</span></button>}
    </figcaption>
  </figure>;
}
