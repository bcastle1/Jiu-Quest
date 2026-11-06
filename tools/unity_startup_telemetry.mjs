// Runs only in the isolated test page via Playwright addInitScript. It observes
// the real player without sending commands or changing application state.
export function installUnityStartupTelemetry({ moveId = 'double_leg' } = {}) {
  const result = window.__unityStartupTelemetry = {
    expectedMoveId: moveId, navigationTimeOrigin: performance.timeOrigin,
    firstUnityReadyMs: null, firstMoveStateMs: null, uiReadyMs: null,
    renderedReadyMs: null, renderedFrames: 0, instanceId: null, requestId: null, error: null,
  };
  let instanceId, latestState, candidate, generation = 0;
  const qualifyingScene = () => {
    if (result.error || !instanceId || latestState?.instanceId !== instanceId || latestState.moveId !== moveId
      || latestState.type !== 'state' || latestState.playing !== false || latestState.progress !== 0) return null;
    const stage = document.querySelector('.unity-stage');
    const canvas = stage?.querySelector('.unity-canvas');
    const play = stage?.querySelector('button[aria-label="Play animation"]');
    if (stage?.dataset.unityStatus !== 'ready' || !canvas || !play || play.disabled || canvas.width <= 0 || canvas.height <= 0) return null;
    const bounds = canvas.getBoundingClientRect();
    const style = window.getComputedStyle(canvas);
    if (bounds.width <= 0 || bounds.height <= 0 || style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0
      || canvas.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) === false) return null;
    return { instanceId, requestId: latestState.requestId };
  };
  const invalidate = () => { generation += 1; candidate = null; result.renderedFrames = 0; };
  const check = () => {
    if (result.renderedReadyMs !== null) return;
    const scene = qualifyingScene();
    if (!scene) { invalidate(); return; }
    if (candidate?.instanceId === scene.instanceId && candidate.requestId === scene.requestId) return;
    invalidate(); candidate = scene;
    result.uiReadyMs ??= performance.now();
    const watchedGeneration = generation;
    const renderedFrame = () => {
      if (generation !== watchedGeneration) return;
      const current = qualifyingScene();
      if (!current || current.instanceId !== scene.instanceId || current.requestId !== scene.requestId) {
        invalidate(); check(); return;
      }
      result.renderedFrames += 1;
      if (result.renderedFrames < 2) { requestAnimationFrame(renderedFrame); return; }
      result.instanceId = scene.instanceId; result.requestId = scene.requestId;
      result.renderedReadyMs = performance.now();
      observer.disconnect(); window.removeEventListener('jiuquest:unity', receive);
    };
    requestAnimationFrame(renderedFrame);
  };
  const receive = (event) => {
    const value = event.detail;
    if (value?.protocolVersion !== 1 || typeof value.instanceId !== 'string') return;
    if (value.type === 'ready') {
      instanceId = value.instanceId; latestState = null; invalidate();
      result.firstUnityReadyMs ??= performance.now();
    } else if (value.instanceId === instanceId) {
      if (value.type === 'error') { result.error = value.message || 'Unity startup error'; latestState = null; }
      else if (value.type === 'state' || value.type === 'completed') {
        latestState = value;
        if (value.type === 'state' && value.moveId === moveId && value.playing === false && value.progress === 0) result.firstMoveStateMs ??= performance.now();
      }
    }
    check();
  };
  const observer = new MutationObserver(check);
  observer.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-unity-status', 'disabled', 'class', 'style', 'hidden', 'width', 'height'] });
  window.addEventListener('jiuquest:unity', receive);
  check();
}
