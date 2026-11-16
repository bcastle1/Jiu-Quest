import { useEffect, useState } from 'react';
import { beltColors } from '../data/curriculum.js';
import { standingHeadPictures } from '../unreal/athleteHeads.js';
import { unrealPositionTints } from '../unreal/positionStills.js';
import './UnrealPositionStill.css';

// The files one picture of a still needs: the base for the faces of the two
// athletes, the pictures laid over their heads, and the gi layers (an athlete
// with another face has a jacket layer of its own, which fits its neck).
function filesOf(still, heads) {
  const layers = Object.entries(still.layers).filter(([name]) => name !== 'base').map(([name, url]) => heads.layers[name] ?? url);
  return [heads.base, ...heads.heads.map((head) => head.url), ...layers];
}

// One load per picture, shared by every stage on the page. A still is only
// usable when every file arrived: a missing layer would paint a gi black, and
// a missing head would show another face.
const loads = new Map();
function loadStill(still, heads) {
  const key = `${still.position}|${heads.key}`;
  if (!loads.has(key)) {
    const load = Promise.all(filesOf(still, heads).map((url) => new Promise((resolve) => {
      const image = new Image();
      image.onload = () => resolve(true);
      image.onerror = () => resolve(false);
      image.src = url;
    }))).then((results) => {
      const complete = results.every(Boolean);
      // A failed load is not remembered, so the next stage tries again.
      if (!complete) loads.delete(key);
      return complete;
    });
    loads.set(key, load);
  }
  return loads.get(key);
}

// 'none' without a still, then 'loading', then 'ready' or 'error'. `lead` and
// `other` are the two athletes: their heads decide which files the picture needs.
export function useUnrealPositionStill(still, lead, other) {
  const [state, setState] = useState({ key: null, status: 'loading' });
  const heads = still ? standingHeadPictures(still, { lead, other }) : null;
  const key = still ? `${still.position}|${heads.key}` : null;
  useEffect(() => {
    if (!still) return undefined;
    let mounted = true;
    loadStill(still, heads).then((complete) => { if (mounted) setState({ key, status: complete ? 'ready' : 'error' }); });
    return () => { mounted = false; };
    // The picture is named by its key; `heads` is a new object on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [still, key]);
  if (!still) return 'none';
  return state.key === key ? state.status : 'loading';
}

const beltColor = (athlete, status) => beltColors[status?.belt ?? athlete?.belt] ?? beltColors.white;

// Two Unreal athletes in a settled position, each with their own head and in
// their own gi and belt colors. The browser adds the gi layers; see
// src/unreal/positionStills.js, and src/unreal/athleteHeads.js for the heads.
export default function UnrealPositionStill({ still, ready, lead, other, leadBelt, otherBelt, label }) {
  const tints = unrealPositionTints(still, { lead, other, leadBeltColor: beltColor(lead, leadBelt), otherBeltColor: beltColor(other, otherBelt) });
  const heads = standingHeadPictures(still, { lead, other });
  return (
    <span className={`unreal-position-still ${ready ? 'is-ready' : ''}`.trim()} role="img" aria-label={label} data-position={still.position}>
      <img src={heads.base} alt="" width={still.width} height={still.height} draggable={false} />
      {heads.heads.map((head) => (
        <img key={head.role} className="unreal-position-head" data-head={head.role} src={head.url} alt="" style={head.style} draggable={false} />
      ))}
      {tints.map((tint) => (
        <span key={tint.name} className="unreal-position-layer" data-layer={tint.name} style={{ backgroundImage: `url(${heads.layers[tint.name] ?? tint.url})`, backgroundColor: tint.color }} />
      ))}
    </span>
  );
}
