export const UNITY_PROTOCOL_VERSION = 1;
export const UNITY_EVENT = 'jiuquest:unity';
export const UNITY_CAMERAS = ['front', 'side', 'overhead', 'orbit'];
export const UNITY_SPEEDS = [0.25, 0.5, 1];

// Explicit technique matches only. A generic armbar or pass is not a named entry.
const curriculumMoves = Object.freeze({
  'trap-roll-escape': 'trap_roll_escape',
  'double-leg-takedown': 'double_leg',
  'triangle-choke': 'triangle_choke',
  'rear-naked-choke': 'rear_naked_choke',
});

export const UNITY_PREVIEWS = Object.freeze([
  { id: 'standing_stance', name: 'Standing stance', position: 'standing' },
  { id: 'grip_fighting', name: 'Grip fighting', position: 'clinch' },
  { id: 'single_leg', name: 'Single-leg takedown', position: 'guard-top' },
  { id: 'double_leg', name: 'Double-leg takedown', position: 'guard-top' },
  { id: 'trap_roll_escape', name: 'Trap and roll escape', position: 'guard-top' },
  { id: 'guard_pull', name: 'Guard pull', position: 'guard-bottom' },
  { id: 'closed_guard', name: 'Closed guard', position: 'guard-bottom' },
  { id: 'guard_pass', name: 'Guard pass · generic draft', position: 'side-top' },
  { id: 'side_control', name: 'Side control', position: 'side-top' },
  { id: 'mount', name: 'Mount', position: 'mount-top' },
  { id: 'back_control', name: 'Back control', position: 'back-control' },
  { id: 'armbar', name: 'Armbar · finish draft', position: 'guard-bottom' },
  { id: 'triangle_choke', name: 'Triangle choke', position: 'guard-bottom' },
  { id: 'rear_naked_choke', name: 'Rear naked choke', position: 'back-control' },
  { id: 'tap_out', name: 'Tap out', position: 'guard-bottom' },
  { id: 'reset_neutral', name: 'Reset to neutral', position: 'standing' },
]);

export function resolveUnityMove(moveId, { canonical = false } = {}) {
  if (canonical) return UNITY_PREVIEWS.some((move) => move.id === moveId) ? moveId : null;
  return Object.hasOwn(curriculumMoves, moveId) ? curriculumMoves[moveId] : null;
}

export function isUnityEnabled(search = '') {
  const params = new URLSearchParams(search);
  return params.get('engine') === 'unity' || params.get('preview') === 'unity';
}

export function resolveArenaUnityPlayback(result) {
  if (result?.animationSucceeded !== true || typeof result.actorIsPlayer !== 'boolean') return null;
  const moveId = resolveUnityMove(result.move?.id);
  return moveId ? { moveId, performerSide: result.actorIsPlayer ? 'fighter' : 'opponent' } : null;
}

const beltColors = { white: '#f8fbff', blue: '#2368ff', purple: '#8b3ffc', brown: '#8b5a32', black: '#08090d' };
const safeColor = (value, fallback) => /^#[\da-f]{6}$/i.test(value ?? '') ? value : fallback;
export function toUnityAthlete(athlete = {}, belt) {
  const beltValue = typeof belt === 'object' ? belt?.belt : belt;
  const stripeValue = typeof belt === 'object' ? belt?.stripes ?? athlete.stripes : athlete.stripes;
  const stripes = Number.isFinite(stripeValue) ? Math.max(0, Math.min(4, Math.floor(stripeValue))) : 0;
  return {
    name: String(athlete.name ?? 'Athlete').slice(0, 100),
    skinTone: safeColor(athlete.skinTone, '#d99b71'),
    hairColor: safeColor(athlete.hairColor, '#11131c'),
    hairStyle: typeof athlete.hairStyle === 'string' && athlete.hairStyle.trim() ? athlete.hairStyle.trim().toLowerCase().slice(0, 40) : 'shadow spikes',
    giTop: safeColor(athlete.giTop, '#f8fbff'),
    giPants: safeColor(athlete.giPants, '#112a58'),
    belt: safeColor(beltColors[beltValue ?? athlete.belt] ?? beltValue, '#f8fbff'),
    stripes,
  };
}

export function createUnityBridge({ instanceId, onEvent = () => {} }) {
  let transport = null;
  let ready = false;
  let disposed = false;
  let requestNumber = 0;
  let currentRequest = null;
  let pending = null;
  let scene = {};
  const setupId = `${instanceId}:setup`;
  const send = (command) => transport?.('JiuQuestBridge', 'ReceiveCommand', JSON.stringify(command));
  const envelope = (type, requestId, values = {}) => ({ protocolVersion: UNITY_PROTOCOL_VERSION, instanceId, requestId, type, ...scene, ...values });
  const flush = () => {
    if (!ready || !transport || !pending || disposed) return;
    const command = pending;
    pending = null;
    send(command);
  };
  const command = (type, values = {}) => {
    if (disposed) return null;
    for (const field of ['speed', 'camera']) if (values[field] !== undefined) scene[field] = values[field];
    currentRequest = `${instanceId}:${++requestNumber}`;
    if (!ready && type !== 'play' && scene.moveId) {
      // A control during startup changes the desired scene; it must not replace
      // the pending load with a pause/seek command against the default stance.
      let paused = pending?.paused ?? false;
      let progress = pending?.progress ?? 0;
      if (type === 'pause' || type === 'seek' || type === 'reset') paused = true;
      if (type === 'resume') paused = false;
      if (type === 'reset') progress = 0;
      pending = envelope('play', currentRequest, { progress, paused, ...values });
    } else pending = envelope(type, currentRequest, values);
    flush();
    return currentRequest;
  };
  return {
    setScene(values, autoplay = true) {
      scene = { ...values };
      return command('play', { progress: 0, speed: scene.speed ?? 1, paused: !autoplay });
    },
    command,
    attach(nextTransport) {
      if (disposed) return;
      transport = nextTransport;
      ready = false;
      send(envelope('configure', setupId));
    },
    receive(detail) {
      if (disposed || !detail || detail.protocolVersion !== UNITY_PROTOCOL_VERSION || detail.instanceId !== instanceId) return false;
      if (!['ready', 'state', 'completed', 'error'].includes(detail.type)) return false;
      if (detail.type === 'ready') {
        if (detail.requestId !== setupId || ready) return false;
        ready = true;
        onEvent(detail);
        flush();
        return true;
      }
      if (detail.requestId !== currentRequest && !(detail.type === 'error' && detail.requestId === setupId && !ready)) return false;
      if (detail.moveId && scene.moveId && detail.moveId !== scene.moveId && detail.requestId !== setupId) return false;
      const progress = Number.isFinite(detail.progress) ? Math.max(0, Math.min(1, detail.progress)) : undefined;
      onEvent({ ...detail, progress });
      return true;
    },
    dispose() { disposed = true; transport = null; pending = null; ready = false; },
  };
}
