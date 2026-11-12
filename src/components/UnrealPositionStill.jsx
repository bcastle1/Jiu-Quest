import { useEffect, useState } from 'react';
import { beltColors } from '../data/curriculum.js';
import { unrealPositionTints } from '../unreal/positionStills.js';
import './UnrealPositionStill.css';

// One load per still, shared by every stage on the page. A still is only
// usable when every layer arrived: a missing layer would paint a gi black.
const loads = new Map();
function loadStill(still) {
  if (!loads.has(still.position)) {
    const load = Promise.all(Object.values(still.layers).map((url) => new Promise((resolve) => {
      const image = new Image();
      image.onload = () => resolve(true);
      image.onerror = () => resolve(false);
      image.src = url;
    }))).then((results) => {
      const complete = results.every(Boolean);
      // A failed load is not remembered, so the next stage tries again.
      if (!complete) loads.delete(still.position);
      return complete;
    });
    loads.set(still.position, load);
  }
  return loads.get(still.position);
}

// 'none' without a still, then 'loading', then 'ready' or 'error'.
export function useUnrealPositionStill(still) {
  const [state, setState] = useState({ still: null, status: 'loading' });
  useEffect(() => {
    if (!still) return undefined;
    let mounted = true;
    loadStill(still).then((complete) => { if (mounted) setState({ still, status: complete ? 'ready' : 'error' }); });
    return () => { mounted = false; };
  }, [still]);
  if (!still) return 'none';
  return state.still === still ? state.status : 'loading';
}

const beltColor = (athlete, status) => beltColors[status?.belt ?? athlete?.belt] ?? beltColors.white;

// Two Unreal athletes in a settled position, each in their own gi and belt
// colors. The browser adds the layers; see src/unreal/positionStills.js.
export default function UnrealPositionStill({ still, ready, lead, other, leadBelt, otherBelt, label }) {
  const tints = unrealPositionTints(still, { lead, other, leadBeltColor: beltColor(lead, leadBelt), otherBeltColor: beltColor(other, otherBelt) });
  return (
    <span className={`unreal-position-still ${ready ? 'is-ready' : ''}`.trim()} role="img" aria-label={label} data-position={still.position}>
      <img src={still.layers.base} alt="" width={still.width} height={still.height} draggable={false} />
      {tints.map((tint) => (
        <span key={tint.name} className="unreal-position-layer" data-layer={tint.name} style={{ backgroundImage: `url(${tint.url})`, backgroundColor: tint.color }} />
      ))}
    </span>
  );
}
