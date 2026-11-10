import { Config, PixelStreaming } from '@epicgames-ps/lib-pixelstreamingfrontend-ue5.8';
import { UNREAL_APP_ORIGIN, localMessage, parseLocalMessage } from '../src/unreal/localTransport.js';
import { parseUnrealEvent } from '../src/unreal/contract.js';

const container = document.getElementById('video'), status = document.getElementById('status');
let nonce = null, client = null, open = false, timer = null, video = null, frameHandle = null, frames = 0, lastFrame = 0, shown = false, pendingPlay = null, presentedRequest = null;
const post = (type, values) => { if (nonce) window.parent.postMessage(localMessage(nonce, type, values), UNREAL_APP_ORIGIN); };
const waiting = () => { shown = false; frames = 0; post('video-waiting'); };
const lost = () => { if (open) post('transport-closed'); open = false; pendingPlay = null; presentedRequest = null; waiting(); };
const stop = () => {
  clearInterval(timer); timer = null;
  if (video && frameHandle !== null) video.cancelVideoFrameCallback?.(frameHandle);
  frameHandle = null; video = null; lost();
  try { client?.disconnect(); } finally { client = null; nonce = null; container.replaceChildren(); }
};
const observe = () => {
  const current = container.querySelector('video');
  if (!current || current === video) return;
  if (video && frameHandle !== null) video.cancelVideoFrameCallback?.(frameHandle);
  video = current; video.muted = true; waiting();
  if (!video.requestVideoFrameCallback) { post('error', { message: 'This browser cannot verify presented Unreal video frames.' }); return; }
  const frame = () => {
    if (!client || current !== video) return;
    lastFrame = performance.now();
    if (!document.hidden && open && presentedRequest && current.videoWidth > 0 && current.videoHeight > 0) {
      frames++;
      if (frames >= 2 && !shown) { shown = true; status.textContent = ''; post('video-frame', { requestId: presentedRequest, frames, width: current.videoWidth, height: current.videoHeight }); }
    }
    frameHandle = current.requestVideoFrameCallback(frame);
  };
  frameHandle = current.requestVideoFrameCallback(frame);
};
const start = () => {
  if (client) return;
  const config = new Config({ useUrlParams: false, initialSettings: {
    ss: 'ws://127.0.0.1:49080', AutoConnect: false, AutoPlayVideo: true, StartVideoMuted: true,
    UseMic: false, UseCamera: false, KeyboardInput: false, MouseInput: false, TouchInput: false,
    GamepadInput: false, XRControllerInput: false, AutoEnterVR: false, TimeoutIfIdle: false,
    WaitForStreamer: true, MaxReconnectAttempts: 0, MatchViewportRes: false,
  } });
  client = new PixelStreaming(config, { videoElementParent: container });
  client.addResponseEventListener('jiuquest-local', response => {
    const event = parseUnrealEvent(response);
    if (!event) return;
    // Require the actual receiver to acknowledge this play, then observe new
    // presented video frames. A connected socket or old clip is insufficient.
    if (event.type === 'state' && event.requestId === pendingPlay) { presentedRequest = pendingPlay; pendingPlay = null; waiting(); }
    try { post('response', { response }); } catch { /* Reject oversized messages. */ }
  });
  for (const name of ['webRtcDisconnected', 'webRtcFailed', 'streamPreDisconnect', 'streamReconnect']) client.addEventListener(name, lost);
  timer = setInterval(() => {
    const usable = client?.webRtcController?.isDataChannelOpen() === true;
    if (usable && !open) { open = true; waiting(); post('transport-open'); }
    else if (!usable && open) lost();
    observe();
    if (!document.hidden && shown && performance.now() - lastFrame > 8000) { waiting(); status.textContent = 'Waiting for Unreal video…'; }
  }, 100);
  client.connect(); observe();
};
window.addEventListener('message', event => {
  if (window.parent === window || event.source !== window.parent || event.origin !== UNREAL_APP_ORIGIN) return;
  const message = parseLocalMessage(event.data, nonce ?? undefined);
  if (!message) return;
  if (message.type === 'connect') {
    nonce = message.nonce;
    try { start(); } catch { post('error', { message: 'The local Unreal video client could not start.' }); stop(); }
  }
  else if (message.type === 'disconnect' && nonce) stop();
  else if (message.type === 'command' && nonce) {
    if (message.command.type === 'play') { pendingPlay = message.command.requestId; presentedRequest = null; waiting(); }
    let sent = false;
    try { sent = open && client?.emitUIInteraction(message.command) === true; } catch { /* Fail closed on an SDK send race. */ }
    if (!sent) { lost(); post('error', { message: 'The Unreal data channel could not send this control.' }); }
  }
});
document.addEventListener('visibilitychange', () => { waiting(); });
window.addEventListener('pagehide', stop, { once: true });
