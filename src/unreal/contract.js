import { resolveUnityMove, toUnityAthlete, UNITY_CAMERAS, UNITY_PREVIEWS, UNITY_SPEEDS } from '../unity/bridge.js';

// Reuse the app's exact technique and appearance rules without changing Unity.
export const UNREAL_PROTOCOL_VERSION = 1;
export const UNREAL_CHANNEL = 'jiuquest.combat';
export const UNREAL_MAX_MESSAGE_BYTES = 8192;
export const UNREAL_MOVE_IDS = Object.freeze(UNITY_PREVIEWS.map(({ id }) => id));
export const resolveUnrealMove = resolveUnityMove;
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const identifier = (value) => typeof value === 'string' && /^[A-Za-z0-9:_-]{1,160}$/.test(value);
const progressValue = (value) => Number.isFinite(value) && value >= 0 && value <= 1;
const bounded = (json) => json.length <= UNREAL_MAX_MESSAGE_BYTES && new TextEncoder().encode(json).length <= UNREAL_MAX_MESSAGE_BYTES;

export function unrealEnvelope(instanceId, sessionId, requestId, type, values = {}) {
  return { ...values, channel: UNREAL_CHANNEL, protocolVersion: UNREAL_PROTOCOL_VERSION, instanceId, sessionId, requestId, type };
}

export function normalizeUnrealScene(value) {
  if (!isObject(value) || !UNREAL_MOVE_IDS.includes(value.moveId)) return null;
  const performerSide = value.performerSide ?? 'fighter';
  const speed = value.speed ?? 1;
  const camera = value.camera ?? 'side';
  const compactViewport = value.compactViewport ?? false;
  if (!['fighter', 'opponent'].includes(performerSide) || !UNITY_SPEEDS.includes(speed)
      || !UNITY_CAMERAS.includes(camera) || typeof compactViewport !== 'boolean') return null;
  return {
    moveId: value.moveId, performerSide, speed, camera, compactViewport,
    fighter: toUnityAthlete(isObject(value.fighter) ? value.fighter : {}, value.fighterBelt ?? value.fighter?.belt),
    opponent: toUnityAthlete(isObject(value.opponent) ? value.opponent : {}, value.opponentBelt ?? value.opponent?.belt),
  };
}

// Unreal responses arrive as strings. Never forward arbitrary renderer fields
// (scores, progress records, URLs, commands) into the host application.
export function parseUnrealEvent(response) {
  if (typeof response !== 'string' || !bounded(response)) return null;
  let value;
  try { value = JSON.parse(response); } catch { return null; }
  if (!isObject(value) || value.channel !== UNREAL_CHANNEL || value.protocolVersion !== UNREAL_PROTOCOL_VERSION
      || ![value.instanceId, value.sessionId, value.requestId].every(identifier)) return null;
  const event = unrealEnvelope(value.instanceId, value.sessionId, value.requestId, value.type);
  if (value.type === 'ready') {
    const moves = value.capabilities?.moves;
    if (!Array.isArray(moves) || moves.length > UNREAL_MOVE_IDS.length
        || new Set(moves).size !== moves.length || !moves.every((id) => UNREAL_MOVE_IDS.includes(id))) return null;
    return { ...event, capabilities: { moves: [...moves] } };
  }
  if (value.type === 'error') {
    if (typeof value.message !== 'string' || !value.message.trim() || value.message.length > 240
        || (value.moveId !== undefined && !UNREAL_MOVE_IDS.includes(value.moveId))) return null;
    return { ...event, ...(value.moveId === undefined ? {} : { moveId: value.moveId }), message: value.message };
  }
  if (!['state', 'completed'].includes(value.type) || !UNREAL_MOVE_IDS.includes(value.moveId)
      || !progressValue(value.progress) || typeof value.playing !== 'boolean'
      || (value.type === 'completed' && (value.progress !== 1 || value.playing))) return null;
  return { ...event, moveId: value.moveId, progress: value.progress, playing: value.playing };
}

export function unrealControl(type, values = {}) {
  if (!isObject(values)) return null;
  switch (type) {
    case 'pause': return { paused: true };
    case 'resume': return { paused: false };
    case 'reset': return { progress: 0, paused: true };
    case 'requestState': return {};
    case 'seek': return progressValue(values.progress) ? { progress: values.progress, paused: true } : null;
    case 'setSpeed': return UNITY_SPEEDS.includes(values.speed) ? { speed: values.speed } : null;
    case 'setCamera': return UNITY_CAMERAS.includes(values.camera) ? { camera: values.camera } : null;
    case 'setViewport': return typeof values.compactViewport === 'boolean' ? { compactViewport: values.compactViewport } : null;
    default: return null;
  }
}

export function boundedUnrealCommand(command) {
  if (!isObject(command) || command.channel !== UNREAL_CHANNEL || command.protocolVersion !== UNREAL_PROTOCOL_VERSION
      || ![command.instanceId, command.sessionId, command.requestId].every(identifier)) throw new TypeError('Invalid Unreal command envelope.');
  const { instanceId, sessionId, requestId, type } = command;
  let values = {};
  if (type !== 'configure') {
    const scene = normalizeUnrealScene(command);
    if (!scene || !progressValue(command.progress) || typeof command.paused !== 'boolean'
        || (type !== 'play' && unrealControl(type, command) === null)) throw new TypeError('Invalid Unreal scene command.');
    values = { ...scene, progress: command.progress, paused: command.paused };
  }
  const sanitized = unrealEnvelope(instanceId, sessionId, requestId, type, values);
  const json = JSON.stringify(sanitized);
  if (!bounded(json)) throw new RangeError('Unreal command exceeds the message limit.');
  return sanitized;
}
