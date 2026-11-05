import { useEffect, useId, useRef, useState } from 'react';
import { AlertCircle, Camera, LoaderCircle, Pause, Play, RotateCcw } from 'lucide-react';
import { createUnityBridge, toUnityAthlete, UNITY_CAMERAS, UNITY_EVENT, UNITY_SPEEDS } from '../unity/bridge.js';
import { createUnityPlayer } from '../unity/loader.js';
import { createUnityLoadState } from '../unity/loadState.js';
import './UnityGrapplingStage.css';

let nextInstance = 0;

export default function UnityGrapplingStage({ moveId, moveLabel, performerSide = 'fighter', fighter, opponent, fighterBelt, opponentBelt, signal = '', fallback = null, unavailableReason, compact = false }) {
  const id = useId();
  const canvasRef = useRef(null);
  const bridgeRef = useRef(null);
  const loadStateRef = useRef(null);
  const sceneRef = useRef(null);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState({ phase: 'loading', loaded: 0, message: '' });
  const [playback, setPlayback] = useState({ playing: false, progress: 0 });
  const [speed, setSpeed] = useState(1);
  const [camera, setCamera] = useState('front');
  const [reducedMotion, setReducedMotion] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const scene = {
    moveId, performerSide,
    fighter: toUnityAthlete(fighter, fighterBelt),
    opponent: toUnityAthlete(opponent, opponentBelt),
  };
  const sceneKey = JSON.stringify(scene);
  sceneRef.current = { ...scene, speed, camera };
  const supported = Boolean(moveId);

  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const change = () => { setReducedMotion(Boolean(query?.matches)); if (query?.matches) bridgeRef.current?.command('pause'); };
    query?.addEventListener('change', change);
    return () => query?.removeEventListener('change', change);
  }, []);

  useEffect(() => {
    if (!supported) return undefined;
    const controller = new AbortController();
    const instanceId = `jiuquest-${++nextInstance}-${Date.now()}`;
    let player;
    let runtimeReady = false;
    const loadState = createUnityLoadState({ onChange: setStatus, onInitialTimeout: () => {
      // Aborting fetch is safe. An in-flight Unity factory is not forcibly freed;
      // the loader retains its lease until that factory returns and Quit finishes.
      controller.abort();
      bridge.dispose();
    } });
    loadStateRef.current = loadState;
    const bridge = createUnityBridge({ instanceId, onEvent: (event) => {
      if (event.type === 'error') { loadState.fail(event.message || 'The Unity move could not load.'); return; }
      if (event.type === 'ready') {
        runtimeReady = true;
        loadState.ready();
        if (document.hidden) bridge.setScene(sceneRef.current, false);
      }
      if (event.type === 'state' || event.type === 'completed') {
        if (!loadState.settled()) return;
        setPlayback((current) => ({ progress: event.progress ?? current.progress, playing: event.type !== 'completed' && event.playing === true }));
      }
    } });
    bridgeRef.current = bridge;
    const receive = (event) => bridge.receive(event.detail);
    const visibility = () => {
      if (document.hidden && runtimeReady) bridge.command('pause');
    };
    window.addEventListener(UNITY_EVENT, receive);
    document.addEventListener('visibilitychange', visibility);
    loadState.startPlayerLoad();
    setPlayback({ playing: false, progress: 0 });
    bridge.setScene(sceneRef.current, !document.hidden && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    createUnityPlayer(canvasRef.current, {
      signal: controller.signal,
      onProgress: loadState.progress,
      onError: loadState.fail,
    }).then((created) => {
      player = created;
      if (controller.signal.aborted) return player.dispose();
      loadState.playerCreated();
      bridge.attach((...args) => player.instance.SendMessage(...args));
      return undefined;
    }).catch((error) => { if (error?.name !== 'AbortError') loadState.fail(error); });
    return () => {
      controller.abort();
      loadState.dispose();
      if (loadStateRef.current === loadState) loadStateRef.current = null;
      window.removeEventListener(UNITY_EVENT, receive);
      document.removeEventListener('visibilitychange', visibility);
      bridge.dispose();
      if (bridgeRef.current === bridge) bridgeRef.current = null;
      player?.dispose().catch(() => {});
    };
  }, [supported, attempt]);

  useEffect(() => {
    if (!supported) return;
    setPlayback({ playing: false, progress: 0 });
    loadStateRef.current?.requestScene();
    bridgeRef.current?.setScene(sceneRef.current, !document.hidden && !reducedMotion);
  }, [sceneKey, signal, reducedMotion, supported]);

  const send = (type, values) => bridgeRef.current?.command(type, values);
  const ready = supported && status.phase === 'ready';
  const replay = () => { setPlayback({ progress: 0, playing: false }); loadStateRef.current?.requestScene(); bridgeRef.current?.setScene(sceneRef.current, true); };
  const name = moveLabel || 'Technique preview';

  if (!supported) return <section className="unity-unavailable" aria-label="Unity preview unavailable">
    <p><AlertCircle size={16} aria-hidden="true" />{unavailableReason || 'This technique does not have a matching Unity animation yet.'}</p>
    <small>Settled position snapshot · no animated technique is being substituted.</small>
    {fallback}
  </section>;

  return <section className={`unity-stage ${compact ? 'compact' : ''}`} data-engine="unity" data-unity-status={status.phase} aria-labelledby={`${id}-title`}>
    <div className="unity-stage-heading"><div><span className="unity-eyebrow">UNITY COMBAT PREVIEW</span><h3 id={`${id}-title`}>{name}</h3></div><span className="unity-draft">Draft choreography</span></div>
    <div className={`unity-viewport ${ready ? 'is-ready' : ''}`}>
      <canvas id={`unity-canvas-${id.replace(/[^a-zA-Z0-9_-]/g, '')}`} ref={canvasRef} className="unity-canvas" width="960" height="600" tabIndex={0} aria-label={`${name}. ${performerSide === 'opponent' ? opponent?.name : fighter?.name} performs the technique. Use the playback controls below.`} />
      {!ready && <div className="unity-load-state" role="status" aria-live="polite">
        {status.phase === 'error' ? <><AlertCircle size={27} /><strong>Unity preview unavailable</strong><p>{status.message}</p><button type="button" onClick={() => status.reloadRequired ? window.location.reload() : setAttempt((current) => current + 1)}><RotateCcw size={16} />{status.reloadRequired ? 'Reload preview' : 'Retry Unity player'}</button></> : <><LoaderCircle className="snapshot-spinner" size={26} /><strong>{status.phase === 'loading-move' ? 'Preparing the animated move' : 'Loading the Unity player'}</strong><progress value={status.loaded} max="1" aria-label="Unity player download" /><span>{Math.round(status.loaded * 100)}% · first load may take a moment</span></>}
      </div>}
      {ready && <div className="unity-athletes" aria-label="Athletes"><span><i style={{ background: fighter?.giTop }} />{fighter?.name}</span><span><i style={{ background: opponent?.giTop }} />{opponent?.name}</span></div>}
      {ready && camera === 'orbit' && <span className="unity-orbit-hint">Drag the scene to rotate the view</span>}
    </div>
    <div className="unity-controls">
      <div className="unity-transport">
        <button type="button" className="unity-play" disabled={!ready} onClick={() => playback.progress >= 1 ? replay() : send(playback.playing ? 'pause' : 'resume')} aria-label={playback.playing ? 'Pause animation' : 'Play animation'}>{playback.playing ? <Pause size={17} /> : <Play size={17} />}{playback.playing ? 'Pause' : 'Play'}</button>
        <button type="button" disabled={!ready} onClick={replay}><RotateCcw size={16} />Replay</button>
        <label htmlFor={`${id}-speed`}>Speed<select id={`${id}-speed`} disabled={!ready} value={speed} onChange={(event) => { const value = Number(event.target.value); setSpeed(value); send('setSpeed', { speed: value }); }}>{UNITY_SPEEDS.map((value) => <option key={value} value={value}>{value === 1 ? '1× normal' : `${value}× slow motion`}</option>)}</select></label>
        <label htmlFor={`${id}-camera`}><span><Camera size={14} aria-hidden="true" />Camera</span><select id={`${id}-camera`} disabled={!ready} value={camera} onChange={(event) => { setCamera(event.target.value); send('setCamera', { camera: event.target.value }); }}>{UNITY_CAMERAS.map((value) => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}</select></label>
      </div>
      <label className="unity-scrubber" htmlFor={`${id}-progress`}><span>Review movement</span><input id={`${id}-progress`} aria-label="Review movement" type="range" min="0" max="1000" value={Math.round(playback.progress * 1000)} disabled={!ready} aria-valuetext={`${Math.round(playback.progress * 100)} percent`} onChange={(event) => { const progress = Number(event.target.value) / 1000; setPlayback({ playing: false, progress }); send('seek', { progress }); }} /><output>{Math.round(playback.progress * 100)}%</output></label>
    </div>
    <p className="unity-scene-note">Animated visual reference. Choreography is a prototype and has not been coach-reviewed.{reducedMotion ? ' Reduced motion is on; press Play when ready.' : ''} Playback does not award points or training repetitions.</p>
    {status.phase === 'error' && fallback && <div className="unity-snapshot-fallback"><p>Settled position snapshot · Unity did not load</p>{fallback}</div>}
  </section>;
}
