import { boundedUnrealCommand, parseUnrealEvent } from './contract.js';

export const UNREAL_LOCAL_ORIGIN = 'http://127.0.0.1:49080';
export const UNREAL_APP_ORIGIN = 'http://127.0.0.1:5178';
export const UNREAL_PROXY_CHANNEL = 'jiuquest.unreal.local';
export const UNREAL_PROXY_LIMIT = 24576;
const noncePattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const validUnrealNonce = value => typeof value === 'string' && noncePattern.test(value);

// A string envelope bounds parsing before any nested command is inspected.
export function parseLocalMessage(value, nonce) {
  if (typeof value !== 'string' || value.length > UNREAL_PROXY_LIMIT
      || new TextEncoder().encode(value).length > UNREAL_PROXY_LIMIT) return null;
  let message;
  try { message = JSON.parse(value); } catch { return null; }
  if (!message || message.channel !== UNREAL_PROXY_CHANNEL || !validUnrealNonce(message.nonce)
      || (nonce !== undefined && message.nonce !== nonce)) return null;
  const result = { channel: UNREAL_PROXY_CHANNEL, nonce: message.nonce, type: message.type };
  if (['connect', 'disconnect', 'transport-open', 'transport-closed'].includes(message.type)) return result;
  if (message.type === 'command') {
    try { return { ...result, command: boundedUnrealCommand(message.command) }; } catch { return null; }
  }
  if (message.type === 'response' && parseUnrealEvent(message.response)) return { ...result, response: message.response };
  if (message.type === 'video-frame' && typeof message.requestId === 'string' && /^[A-Za-z0-9:_-]{1,160}$/.test(message.requestId)
      && Number.isInteger(message.frames) && message.frames >= 2 && message.frames <= 1000000
      && Number.isInteger(message.width) && message.width > 0 && message.width <= 8192
      && Number.isInteger(message.height) && message.height > 0 && message.height <= 8192) {
    return { ...result, requestId: message.requestId, frames: message.frames, width: message.width, height: message.height };
  }
  if (message.type === 'video-waiting') return result;
  if (message.type === 'error' && typeof message.message === 'string' && message.message.length > 0 && message.message.length <= 240) return { ...result, message: message.message };
  return null;
}

export function localMessage(nonce, type, values = {}) {
  const value = JSON.stringify({ ...values, channel: UNREAL_PROXY_CHANNEL, nonce, type });
  if (!parseLocalMessage(value, nonce)) throw new TypeError('Invalid local Unreal message.');
  return value;
}

// This facade owns only the isolated iframe transport. The v1 bridge still
// validates every receiver session/request and has no access to app scoring.
export function createEmbeddedUnrealClient({ iframe, nonce, hostWindow = window, onOpen = () => {}, onVideo = () => {}, onError = () => {} }) {
  if (!validUnrealNonce(nonce) || hostWindow.location.origin !== UNREAL_APP_ORIGIN) throw new TypeError('Unreal preview requires the fixed local app origin.');
  const responses = new Map(), listeners = new Map();
  let connected = false, disposed = false, playRequest = null;
  const post = (type, values) => { if (!iframe.contentWindow) return false; iframe.contentWindow.postMessage(localMessage(nonce, type, values), UNREAL_LOCAL_ORIGIN); return true; };
  const lost = () => {
    connected = false; playRequest = null; onVideo(null);
    for (const callback of [...(listeners.get('webRtcDisconnected') || [])]) callback();
  };
  const client = {
    emitUIInteraction(command) {
      if (!connected || disposed) return false;
      try {
        const safe = boundedUnrealCommand(command);
        if (safe.type === 'play') { playRequest = safe.requestId; onVideo(null); }
        return post('command', { command: safe });
      } catch { lost(); return false; }
    },
    addResponseEventListener(name, callback) { responses.set(name, callback); },
    removeResponseEventListener(name) { responses.delete(name); },
    addEventListener(type, callback) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(callback); },
    removeEventListener(type, callback) { listeners.get(type)?.delete(callback); },
  };
  const receive = event => {
    if (disposed || event.origin !== UNREAL_LOCAL_ORIGIN || event.source !== iframe.contentWindow) return;
    const message = parseLocalMessage(event.data, nonce);
    if (!message) return;
    if (message.type === 'transport-open' && !connected) { connected = true; onOpen(client); }
    else if (message.type === 'transport-closed') lost();
    else if (message.type === 'response' && connected) for (const callback of [...responses.values()]) callback(message.response);
    else if (message.type === 'video-frame' && connected && message.requestId === playRequest) onVideo(message);
    else if (message.type === 'video-waiting') onVideo(null);
    else if (message.type === 'error') { lost(); onError(message.message); }
  };
  hostWindow.addEventListener('message', receive);
  return {
    start() { if (!disposed) post('connect'); },
    dispose() {
      if (disposed) return;
      try { post('disconnect'); } catch { /* A detached frame cannot block host cleanup. */ }
      disposed = true; connected = false; hostWindow.removeEventListener('message', receive); responses.clear(); listeners.clear();
    },
  };
}
