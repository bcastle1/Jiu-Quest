// Loading a player and loading a move are different operations. Selection changes
// cannot repair a failed player initialization; only Retry creates another player.
export function describeUnityError(error) {
  const message = typeof error === 'string' ? error : error?.message;
  return typeof message === 'string' && message.trim() && message !== 'undefined'
    ? message.slice(0, 350)
    : 'The Unity player could not initialize. Retry the preview or reload this page.';
}

export function createUnityLoadState({ onChange, setTimer = setTimeout, clearTimer = clearTimeout, timeoutMs = 30000, initialTimeoutMs = 90000, onInitialTimeout = () => {} }) {
  let engineReady = false;
  let disposed = false;
  let generation = 0;
  let timer;
  let current = { phase: 'loading', loaded: 0, message: '' };
  const publish = (next) => {
    if (disposed) return;
    current = next;
    onChange(next);
  };
  const cancelTimer = () => {
    generation += 1;
    clearTimer(timer);
    timer = undefined;
  };
  const fail = (message, options = {}) => {
    if (disposed) return;
    cancelTimer();
    publish({ phase: 'error', loaded: 0, message: describeUnityError(message), ...options });
  };
  const watch = (message, milliseconds = timeoutMs, initial = false) => {
    cancelTimer();
    const watchedGeneration = generation;
    timer = setTimer(() => {
      // clearTimeout cannot retract a callback that has already been queued.
      if (!disposed && watchedGeneration === generation) {
        fail(message, initial ? { reloadRequired: true } : {});
        if (initial) onInitialTimeout();
      }
    }, milliseconds);
  };
  const requestScene = () => {
    if (disposed || !engineReady) return false;
    publish({ phase: 'loading-move', loaded: 1, message: '' });
    watch('The Unity move did not finish loading. Retry the preview.');
    return true;
  };
  return {
    startPlayerLoad() {
      if (disposed) return;
      publish({ phase: 'loading', loaded: 0, message: '' });
      watch('The Unity player took too long to start. Reload this page to retry. Another player will not start while the earlier startup is still running.', initialTimeoutMs, true);
    },
    progress(loaded) {
      if (current.phase === 'loading' && !engineReady) publish({ phase: 'loading', loaded, message: '' });
    },
    playerCreated() {
      if (!disposed && !engineReady && current.phase !== 'error') watch('Unity loaded, but the combat scene did not respond. Retry the preview.');
    },
    ready() {
      if (disposed) return;
      engineReady = true;
      requestScene();
    },
    requestScene,
    settled() {
      if (disposed || !engineReady) return false;
      cancelTimer();
      publish({ phase: 'ready', loaded: 1, message: '' });
      return true;
    },
    fail,
    dispose() { disposed = true; engineReady = false; cancelTimer(); },
  };
}
