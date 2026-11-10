import { useEffect, useId, useRef, useState } from 'react';
import { AlertCircle, Camera, Maximize2, Minimize2, Pause, Play, RotateCcw } from 'lucide-react';
import { createLocalUnrealSession } from '../unreal/localSession.js';
import { UNREAL_LOCAL_ORIGIN } from '../unreal/localTransport.js';
import { toUnityAthlete, UNITY_CAMERAS, UNITY_SPEEDS } from '../unity/bridge.js';
import './UnityGrapplingStage.css';
import './UnrealGrapplingStage.css';

export default function UnrealGrapplingStage({ moveId, moveLabel, performerSide = 'fighter', fighter, opponent, fighterBelt, opponentBelt, signal = '', fallback = null, compact = false }) {
  const id = useId(), stageRef = useRef(null), viewportRef = useRef(null), iframeRef = useRef(null), bridgeRef = useRef(null), sceneRef = useRef(null);
  const [attempt, setAttempt] = useState(0), [status, setStatus] = useState({ phase: 'offline', progress: 0, playing: false });
  const [speed, setSpeed] = useState(1), [camera, setCamera] = useState('side'), [fullScreen, setFullScreen] = useState(false), [message, setMessage] = useState('');
  const [reducedMotion, setReducedMotion] = useState(() => Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches));
  const compactRef = useRef(window.innerWidth < 640);
  const scene = { moveId, performerSide, fighter: toUnityAthlete(fighter, fighterBelt), opponent: toUnityAthlete(opponent, opponentBelt) };
  const sceneKey = JSON.stringify(scene);
  sceneRef.current = { ...scene, speed, camera, compactViewport: compactRef.current };
  const hasMove = Boolean(moveId), unsupported = status.receiverReady && !status.controlsEnabled;
  const { video, error } = status;
  const ready = hasMove && status.ready;
  const name = moveLabel || 'Technique preview';

  useEffect(() => {
    if (!hasMove) return undefined;
    const bridge = createLocalUnrealSession({ instanceId: `unreal-${crypto.randomUUID()}`, onChange: setStatus });
    bridgeRef.current = bridge;
    bridge.setScene(sceneRef.current, !document.hidden && !reducedMotion);
    const visibility = () => { if (document.hidden) bridge.command('pause'); };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      document.removeEventListener('visibilitychange', visibility); bridge.dispose();
      if (bridgeRef.current === bridge) bridgeRef.current = null;
    };
  }, [hasMove]);

  useEffect(() => {
    if (!hasMove) return undefined;
    return bridgeRef.current?.bind(iframeRef.current, crypto.randomUUID());
  }, [hasMove, attempt]);

  useEffect(() => { bridgeRef.current?.setScene(sceneRef.current, !document.hidden && !reducedMotion); }, [sceneKey, signal]);
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const change = () => { setReducedMotion(Boolean(query?.matches)); if (query?.matches) bridgeRef.current?.command('pause'); };
    query?.addEventListener('change', change);
    return () => query?.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    if (!hasMove || !viewportRef.current) return undefined;
    const resize = () => { const value = viewportRef.current.getBoundingClientRect().width < 640; if (value !== compactRef.current) { compactRef.current = value; sceneRef.current = { ...sceneRef.current, compactViewport: value }; bridgeRef.current?.command('setViewport', { compactViewport: value }); } };
    resize(); const observer = new ResizeObserver(resize); observer.observe(viewportRef.current); return () => observer.disconnect();
  }, [hasMove]);
  useEffect(() => { const change = () => setFullScreen(document.fullscreenElement === stageRef.current); document.addEventListener('fullscreenchange', change); return () => document.removeEventListener('fullscreenchange', change); }, []);
  const send = (type, values) => { if (ready) bridgeRef.current?.command(type, values); };
  const replay = () => { if (ready) bridgeRef.current?.setScene(sceneRef.current, !document.hidden); };
  const toggleFullScreen = async () => { try { setMessage(''); if (document.fullscreenElement === stageRef.current) await document.exitFullscreen(); else await stageRef.current.requestFullscreen(); } catch { setMessage('Full screen is unavailable in this browser.'); } };
  if (!hasMove) return <section className="unity-unavailable" data-engine="unreal"><p><AlertCircle size={16} />This technique has no exact Unreal animation in the local preview.</p>{fallback}</section>;
  return <section ref={stageRef} className={`unity-stage unreal-stage ${compact ? 'compact' : ''}`} data-engine="unreal" data-unreal-status={ready ? 'ready' : unsupported ? 'unsupported' : error ? 'error' : status.phase} data-unreal-frames={video?.frames || 0} data-unreal-video-request={video?.requestId || ''} data-unreal-session={status.sessionId || ''} data-unreal-move={status.moveId || ''} aria-labelledby={`${id}-title`}>
    <div className="unity-stage-heading"><div><span className="unity-eyebrow">LOCAL UNREAL PREVIEW</span><h3 id={`${id}-title`}>{name}</h3></div><div className="unity-stage-heading-actions"><span className="unity-draft">Draft choreography</span>{document.fullscreenEnabled && <button type="button" className="unity-fullscreen" onClick={toggleFullScreen} aria-label={fullScreen ? 'Exit full screen' : 'Enter full screen'}>{fullScreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}</button>}</div></div>
    <div ref={viewportRef} className={`unity-viewport ${ready ? 'is-ready' : ''}`}>
      <iframe key={attempt} ref={iframeRef} src={`${UNREAL_LOCAL_ORIGIN}/jiuquest/embed`} title={`${name} · Unreal character video`} className="unreal-video" allow="autoplay" sandbox="allow-scripts allow-same-origin" onLoad={() => bridgeRef.current?.start()} />
      {!ready && <div className="unity-load-state" role="status"><strong>{unsupported ? 'This exact animation is not loaded in Unreal' : error ? 'Unreal preview unavailable' : 'Connecting to the local Unreal preview'}</strong><p>{unsupported ? 'The starting position is shown below.' : error || 'Waiting for the character scene and its first video frames.'}</p><button type="button" onClick={() => setAttempt(value => value + 1)}><RotateCcw size={16} />Retry Unreal preview</button></div>}
      {ready && <div className="unity-athletes"><span><i style={{ background: fighter?.giTop }} />{fighter?.name}</span><span><i style={{ background: opponent?.giTop }} />{opponent?.name}</span></div>}
    </div>
    <div className="unity-controls">
      <div className="unity-transport"><button type="button" className="unity-play" disabled={!ready} onClick={() => status.progress >= 1 ? replay() : send(status.playing ? 'pause' : 'resume')} aria-label={status.playing ? 'Pause animation' : 'Play animation'}>{status.playing ? <Pause size={17} /> : <Play size={17} />}{status.playing ? 'Pause' : 'Play'}</button><button type="button" disabled={!ready} onClick={replay}><RotateCcw size={16} />Replay</button><button type="button" disabled={!ready} onClick={() => send('reset')}>Reset</button><label htmlFor={`${id}-speed`}>Speed<select id={`${id}-speed`} disabled={!ready} value={speed} onChange={event => { const value = Number(event.target.value); setSpeed(value); send('setSpeed', { speed: value }); }}>{UNITY_SPEEDS.map(value => <option key={value} value={value}>{value}×</option>)}</select></label></div>
      <label className="unity-scrubber" htmlFor={`${id}-progress`}><span>Review movement</span><input id={`${id}-progress`} aria-label="Review movement" type="range" min="0" max="1000" value={Math.round((status.progress || 0) * 1000)} disabled={!ready} aria-valuetext={`${Math.round((status.progress || 0) * 100)} percent`} onChange={event => send('seek', { progress: Number(event.target.value) / 1000 })} /><output>{Math.round((status.progress || 0) * 100)}%</output></label>
      <div className="unity-camera-controls"><span><Camera size={14} />View</span><div role="group" aria-label="Camera view">{UNITY_CAMERAS.map(value => <button key={value} type="button" disabled={!ready} aria-pressed={camera === value} onClick={() => { setCamera(value); send('setCamera', { camera: value }); }}>{value === 'focus' ? 'Close-up' : value[0].toUpperCase() + value.slice(1)}</button>)}</div></div>
    </div>
    {message && <p className="unity-stage-message" role="status">{message}</p>}
    <p className="unity-scene-note">Local Unreal Editor preview. The imported spiked hairstyle is shown; hairstyle selection is not yet supported. Draft movement has not been coach-reviewed. Playback does not award points or training repetitions.{reducedMotion ? ' Reduced motion is on; press Play when ready.' : ''}</p>
    {(unsupported || error) && fallback && <div className="unity-snapshot-fallback">{fallback}</div>}
  </section>;
}
