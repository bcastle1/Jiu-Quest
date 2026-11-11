// Captured stills of the saved Unreal character. The files are the unedited
// native viewport captures; their size and SHA-256 are pinned so a replaced or
// re-encoded image cannot silently keep the "unedited capture" label.
// Nothing in this module starts a stream or selects the combat renderer.
export const UNREAL_PREVIEW_ASSET_ROOT = '/assets/unreal-preview';
export const UNREAL_PREVIEW_PATH = '/?preview=unreal';

export const UNREAL_CHARACTER_RENDERS = Object.freeze([
  Object.freeze({
    id: 'white-gi',
    file: 'side-idle.png',
    label: 'White gi',
    title: 'White gi, standing',
    caption: 'Full body from the side in a white gi with a black belt.',
    alt: 'Unreal Engine capture of a barefoot athlete standing side-on in a white gi and black belt on a dark mat.',
    width: 1018,
    height: 556,
    bytes: 219286,
    sha256: 'b8adb4a28120e83e7b8ecaa99173bdea8b5929e08561cdd428908d97e8ca3975',
  }),
  Object.freeze({
    id: 'close-up',
    file: 'focus-idle.png',
    label: 'Close-up',
    title: 'Face, hair and collar',
    caption: 'Head and shoulders, showing the face, the hair and the gi collar.',
    alt: 'Unreal Engine close-up capture of the face, short dark hair and white gi collar of the same athlete.',
    width: 1018,
    height: 556,
    bytes: 197274,
    sha256: 'eed2221835298b9faf82d7dbabdb79ebf44b4d7ede036ec605edef075ee0e22a',
  }),
  Object.freeze({
    id: 'navy-gi-walk',
    file: 'side-walk.png',
    label: 'Navy gi, walking',
    title: 'Navy gi, mid-stride',
    caption: 'Captured during the walk animation in a navy gi with a black belt.',
    alt: 'Unreal Engine capture of the athlete walking side-on in a navy gi and black belt on a dark mat.',
    width: 1018,
    height: 556,
    bytes: 210373,
    sha256: 'b43ccbd774426b0923e2ed2f31ab71c405bf052abf63dac1a3439fe113397b10',
  }),
]);

// What the stills themselves show, and what has not been shown anywhere yet.
export const UNREAL_PREVIEW_SHOWN = Object.freeze([
  'The new athlete, with face and hair detail',
  'White and navy gi',
  'Standing and walking poses',
]);

export const UNREAL_PREVIEW_AHEAD = Object.freeze([
  'Paired grappling movement for two fighters',
  'Video streamed to your browser',
  'Unreal characters in Arena and Training',
]);

export function unrealRenderUrl(render) {
  return `${UNREAL_PREVIEW_ASSET_ROOT}/${render.file}`;
}

export function findUnrealRender(id) {
  return UNREAL_CHARACTER_RENDERS.find((render) => render.id === id) ?? UNREAL_CHARACTER_RENDERS[0];
}

// Standalone pages that never mount the game or touch saved progress.
export function resolvePreviewPage(search = '') {
  const value = new URLSearchParams(search).get('preview');
  return value === 'unity' || value === 'unreal' ? value : null;
}
