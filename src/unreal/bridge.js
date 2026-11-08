import { boundedUnrealCommand, normalizeUnrealScene, parseUnrealEvent, unrealControl, unrealEnvelope } from './contract.js';

// Epic UE5.8 PixelStreaming API, injected: no SDK, socket or service is created.
export function createPixelStreamingTransport({ pixelStreaming, listenerName, onResponse, onDisconnect }) {
  for (const method of ['emitUIInteraction', 'addResponseEventListener', 'removeResponseEventListener', 'addEventListener', 'removeEventListener']) {
    if (typeof pixelStreaming?.[method] !== 'function') throw new TypeError(`Pixel Streaming requires ${method}.`);
  }
  let disposed = false;
  const response = (json) => { if (!disposed) onResponse(json); };
  const lost = () => { if (!disposed) onDisconnect(); };
  const lossEvents = ['webRtcDisconnected', 'webRtcFailed', 'streamPreDisconnect', 'streamReconnect'];
  pixelStreaming.addResponseEventListener(listenerName, response);
  for (const type of lossEvents) pixelStreaming.addEventListener(type, lost);
  return {
    send(command) {
      // Pass an object: Epic performs JSON.stringify, so a JSON string here
      // would produce a doubly encoded descriptor at the Unreal receiver.
      return !disposed && pixelStreaming.emitUIInteraction(boundedUnrealCommand(command)) === true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      pixelStreaming.removeResponseEventListener(listenerName);
      for (const type of lossEvents) pixelStreaming.removeEventListener(type, lost);
    },
  };
}

export function createUnrealBridge({ instanceId, onEvent = () => {}, onStatus = () => {},
  setTimer = setTimeout, clearTimer = clearTimeout }) {
  if (typeof instanceId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(instanceId)) throw new TypeError('Use a unique, bounded Unreal instance ID.');
  let transport = null;
  let connectionNumber = 0;
  let requestNumber = 0;
  let sessionId = null;
  let currentRequest = null;
  let scene = null;
  let phase = 'offline';
  let supportedMoves = [];
  let reason = null;
  let progress = 0;
  let playing = false;
  let handshakeTimer = null;
  const clearHandshake = () => { if (handshakeTimer !== null) clearTimer(handshakeTimer); handshakeTimer = null; };
  const ready = () => phase === 'receiver-ready';
  const canControl = () => ready() && !!scene && supportedMoves.includes(scene.moveId);
  const getState = () => ({ phase, receiverReady: ready(), controlsEnabled: canControl(), sessionId,
    moveId: scene?.moveId ?? null, progress, playing, supportedMoves: [...supportedMoves], reason });
  const notify = () => onStatus(getState());
  const offline = (message = 'stream-disconnected') => {
    if (phase === 'disposed') return;
    phase = 'offline'; reason = message; playing = false; supportedMoves = [];
    clearHandshake();
    currentRequest = null;
    // Keep the last confirmed position for a paused reconnect; never replay an
    // Arena result or award a training rep because a stream was interrupted.
    if (scene) scene = { ...scene, progress, paused: true };
    transport?.dispose(); transport = null;
    notify();
  };
  const send = (type) => {
    if (!transport) return null;
    const requestId = type === 'configure' ? `${sessionId}:setup` : `${sessionId}:${++requestNumber}`;
    if (type !== 'configure') currentRequest = requestId;
    const command = unrealEnvelope(instanceId, sessionId, requestId, type, type === 'configure' ? {} : scene);
    try {
      if (transport.send(command)) return requestId;
    } catch { /* Treat thrown and rejected sends as a lost transport. */ }
    offline('transport-unavailable');
    return null;
  };
  const receive = (response) => {
    const event = parseUnrealEvent(response);
    if (!event || !transport || phase === 'disposed' || event.instanceId !== instanceId || event.sessionId !== sessionId) return false;
    const setupId = `${sessionId}:setup`;
    if (event.type === 'ready') {
      if (phase !== 'connecting' || event.requestId !== setupId) return false;
      clearHandshake();
      phase = 'receiver-ready'; supportedMoves = [...event.capabilities.moves]; reason = null;
      if (scene && !supportedMoves.includes(scene.moveId)) reason = 'unsupported-move';
      notify(); onEvent(event);
      if (canControl()) send('play');
      return true;
    }
    if (event.requestId !== currentRequest && !(event.type === 'error' && phase === 'connecting' && event.requestId === setupId)) return false;
    if (event.moveId && event.moveId !== scene?.moveId) return false;
    if (event.type === 'error') {
      offline('receiver-error'); onEvent(event); return true;
    }
    if (!canControl()) return false;
    progress = event.progress; playing = event.playing;
    scene = { ...scene, progress, paused: !playing };
    notify(); onEvent(event);
    return true;
  };
  return {
    getState,
    setScene(values, autoplay = true) {
      if (phase === 'disposed' || typeof autoplay !== 'boolean') return null;
      const normalized = normalizeUnrealScene(values);
      if (!normalized) return null;
      // A valid but unavailable move must not leave the preceding clip running.
      if (ready() && !supportedMoves.includes(normalized.moveId) && canControl()) {
        scene = { ...scene, paused: true };
        send('pause');
      }
      scene = { ...normalized, progress: 0, paused: !autoplay };
      progress = 0; playing = false; currentRequest = null;
      reason = ready() && !supportedMoves.includes(scene.moveId) ? 'unsupported-move' : null;
      notify();
      return canControl() ? send('play') : null;
    },
    command(type, values = {}) {
      const update = unrealControl(type, values);
      if (!canControl() || update === null) return null;
      scene = { ...scene, ...update };
      return send(type);
    },
    // Call only after the caller's Epic client has a usable data channel.
    // Connection itself never marks the receiver or the displayed video ready.
    attach(pixelStreaming) {
      if (phase === 'disposed') return null;
      clearHandshake();
      transport?.dispose(); transport = null;
      if (connectionNumber && scene) scene = { ...scene, progress, paused: true };
      sessionId = `${instanceId}:${++connectionNumber}`;
      currentRequest = null; supportedMoves = []; playing = false;
      phase = 'connecting'; reason = null;
      const attachedSession = sessionId;
      try {
        transport = createPixelStreamingTransport({ pixelStreaming, listenerName: `jiuquest:${sessionId}`,
          onResponse: (json) => { if (sessionId === attachedSession) receive(json); },
          onDisconnect: () => { if (sessionId === attachedSession) offline(); },
        });
      } catch { offline('transport-unavailable'); return null; }
      handshakeTimer = setTimer(() => {
        if (sessionId === attachedSession && phase === 'connecting') offline('receiver-timeout');
      }, 15000);
      notify();
      return send('configure');
    },
    disconnect: offline,
    dispose() {
      if (phase === 'disposed') return;
      phase = 'disposed'; playing = false; supportedMoves = []; currentRequest = null; scene = null;
      clearHandshake();
      transport?.dispose(); transport = null;
      notify();
    },
  };
}
