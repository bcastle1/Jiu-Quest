import { isUnityEnabled } from '../unity/bridge.js';
import { UNREAL_APP_ORIGIN } from './localTransport.js';

export function localUnrealAllowed(href, development) {
  try { return development === true && new URL(href).origin === UNREAL_APP_ORIGIN; } catch { return false; }
}

export function resolveCombatRenderer(href, { development = false, configuredEngine } = {}) {
  const url = new URL(href);
  if (url.searchParams.get('engine') === 'unreal' && localUnrealAllowed(href, development)) return 'unreal';
  return isUnityEnabled(url.search, configuredEngine) ? 'unity' : 'snapshot';
}
