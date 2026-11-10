import { UNITY_PROTOCOL_VERSION } from './bridge.js';

const scripts = new Map();
let runtimeTail = Promise.resolve();
let nextCanvasId = 0;

const abortError = () => new DOMException('Unity preview closed.', 'AbortError');
const checkAbort = (signal) => { if (signal?.aborted) throw abortError(); };

export function validateManifest(raw, manifestUrl, pageOrigin) {
  if (raw?.protocolVersion !== UNITY_PROTOCOL_VERSION) throw new Error('This Unity build uses an incompatible combat protocol. Rebuild the Unity preview for protocol version 1.');
  const config = {};
  for (const field of ['loaderUrl', 'dataUrl', 'frameworkUrl', 'codeUrl']) {
    if (typeof raw?.[field] !== 'string' || !raw[field].trim()) throw new Error(`Unity build manifest is missing ${field}.`);
    const url = new URL(raw[field], manifestUrl);
    if (url.origin !== pageOrigin || !['http:', 'https:'].includes(url.protocol)) throw new Error('Unity build files must be served from this website.');
    config[field] = url.href;
  }
  const streaming = new URL(raw.streamingAssetsUrl || './StreamingAssets', manifestUrl);
  if (streaming.origin !== pageOrigin) throw new Error('Unity assets must be served from this website.');
  config.streamingAssetsUrl = streaming.href;
  for (const field of ['companyName', 'productName', 'productVersion']) config[field] = String(raw[field] ?? 'JiuQuest');
  return config;
}

function loadScript(url) {
  if (!scripts.has(url)) {
    scripts.set(url, new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = url;
      script.async = true;
      script.onload = () => typeof window.createUnityInstance === 'function'
        ? resolve(window.createUnityInstance)
        : reject(new Error('The Unity loader did not initialize.'));
      script.onerror = () => { script.remove(); reject(new Error('The Unity player could not download. Check your connection and retry.')); };
      document.head.appendChild(script);
    }).catch((error) => { scripts.delete(url); throw error; }));
  }
  return scripts.get(url);
}

// React owns the host, but not this child. The runtime must retain its canvas
// selector while asynchronous startup and Quit still use the document.
export function createUnityCanvas(host, label) {
  const canvas = document.createElement('canvas');
  canvas.className = 'unity-canvas';
  canvas.width = 960;
  canvas.height = 600;
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', label);
  host.appendChild(canvas);
  return canvas;
}

// Serialize create/Quit across StrictMode mounts and route changes. Unity owns a
// WebGL context and must finish disposing before a replacement is initialized.
export async function createUnityPlayer(canvas, { signal, onProgress, onError } = {}) {
  const previous = runtimeTail;
  let release;
  const released = new Promise((resolve) => { release = resolve; });
  runtimeTail = previous.catch(() => {}).then(() => released);
  let instance;
  let factoryStarted = false;
  let retainedHost;
  let disposal;
  // A later React mount can reuse useId while an aborted factory is still
  // running. Give every acquisition a different document selector.
  canvas.id = `jiuquest-unity-canvas-${++nextCanvasId}`;
  const retainCanvas = () => {
    if (!factoryStarted || retainedHost) return;
    const { width, height } = canvas.getBoundingClientRect();
    retainedHost = document.createElement('div');
    retainedHost.setAttribute('data-unity-retained', '');
    retainedHost.setAttribute('aria-hidden', 'true');
    retainedHost.inert = true;
    Object.assign(retainedHost.style, {
      position: 'fixed', left: '-10000px', top: '0',
      width: `${width || canvas.width}px`, height: `${height || canvas.height}px`,
      visibility: 'hidden', pointerEvents: 'none',
    });
    // Retired canvases are not active preview surfaces. Keep their selector and
    // dimensions without exposing them to controls querying the current canvas.
    canvas.className = 'unity-retained-canvas';
    Object.assign(canvas.style, { width: '100%', height: '100%', display: 'block' });
    document.body.appendChild(retainedHost);
    retainedHost.appendChild(canvas);
  };
  signal?.addEventListener('abort', retainCanvas, { once: true });
  const dispose = () => disposal ??= (async () => {
    try { await instance?.Quit(); } finally {
      signal?.removeEventListener('abort', retainCanvas);
      canvas.remove();
      retainedHost?.remove();
      release();
    }
  })();
  try {
    await previous;
    checkAbort(signal);
    const manifestUrl = new URL('/unity/build-manifest.json', window.location.origin);
    const response = await fetch(manifestUrl, { signal, cache: 'no-store' });
    if (!response.ok) throw new Error(response.status === 404
      ? 'The Unity preview build is not installed on this website yet.'
      : `The Unity preview manifest could not load (${response.status}).`);
    let raw;
    try { raw = await response.json(); } catch { throw new Error('The Unity preview build manifest is not available.'); }
    const config = validateManifest(raw, manifestUrl.href, window.location.origin);
    const createInstance = await loadScript(config.loaderUrl);
    checkAbort(signal);
    const { loaderUrl: _loaderUrl, ...playerConfig } = config;
    factoryStarted = true;
    instance = await createInstance(canvas, {
      ...playerConfig,
      devicePixelRatio: Math.min(window.devicePixelRatio || 1, 1.5),
      showBanner: (message, type) => { if (type === 'error' && !signal?.aborted) onError?.(String(message)); },
    }, (progress) => { if (!signal?.aborted) onProgress?.(Math.max(0, Math.min(1, progress))); });
    if (signal?.aborted) { await dispose(); throw abortError(); }
    return { instance, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}
