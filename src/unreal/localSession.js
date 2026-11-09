import { createUnrealBridge } from './bridge.js';
import { createEmbeddedUnrealClient } from './localTransport.js';

// Keep playback identity alive across iframe retries. Only the transport and
// nonce are replaced; the bridge restores the last confirmed position paused.
export function createLocalUnrealSession({ instanceId, onChange = () => {}, hostWindow = window, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let active = true, surface = null, generation = 0, video = null, error = '', deadline = null;
  let state = { phase: 'offline', progress: 0, playing: false, controlsEnabled: false };
  const getState = () => ({ ...state, video, error, ready: Boolean(video) && state.controlsEnabled && !error });
  const clearDeadline = () => { if (deadline !== null) clearTimer(deadline); deadline = null; };
  const notify = () => { if (active) { if ((video && state.receiverReady) || (state.receiverReady && !state.controlsEnabled)) clearDeadline(); onChange(getState()); } };
  const bridge = createUnrealBridge({ instanceId, setTimer, clearTimer, onStatus: value => {
    if (!active) return;
    state = value;
    if (value.reason === 'receiver-timeout') error = 'The local Unreal preview did not answer. Start it and retry.';
    if (['transport-unavailable', 'stream-disconnected'].includes(value.reason)) error = 'The local Unreal preview disconnected. Retry when it is running.';
    notify();
  }, onEvent: event => { if (active && event.type === 'error') { error = event.message; notify(); } } });
  const release = () => { clearDeadline(); generation++; surface?.dispose(); surface = null; video = null; bridge.disconnect('preview-retry'); };
  return {
    getState,
    setScene(scene, autoplay) { if (active) return bridge.setScene(scene, autoplay); return null; },
    command(type, values) { return active && (getState().ready || ['pause', 'requestState', 'setViewport'].includes(type)) ? bridge.command(type, values) : null; },
    bind(iframe, nonce) {
      if (!active) return () => {};
      if (surface || state.sessionId) release(); else { clearDeadline(); generation++; }
      error = ''; const current = generation;
      deadline = setTimer(() => {
        if (!active || current !== generation) return;
        error = 'The local Unreal preview did not provide a working video stream. Start it, then retry.';
        surface?.dispose(); surface = null; video = null; bridge.disconnect('startup-timeout'); notify();
      }, 45000);
      surface = createEmbeddedUnrealClient({ iframe, nonce, hostWindow,
        onOpen: client => { if (active && current === generation) { video = null; error = ''; bridge.attach(client); } },
        onVideo: value => { if (active && current === generation) { video = value; notify(); } },
        onError: message => { if (active && current === generation) { error = message; notify(); } },
      });
      surface.start(); notify();
      return () => { if (current === generation) release(); };
    },
    start() { surface?.start(); },
    dispose() { if (!active) return; active = false; clearDeadline(); generation++; surface?.dispose(); surface = null; bridge.dispose(); },
  };
}
