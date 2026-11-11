import { useEffect, useRef, useState } from 'react';
import { beltColors, beltLabels } from '../data/curriculum.js';
import { FIGHTER_LOOKS, UNREAL_ATHLETE, unrealAthleteColors } from '../unreal/athlete.js';
import './UnrealAthlete.css';

const lookCopy = {
  unreal: { label: 'Unreal athlete', detail: 'Rendered in Unreal Engine. Gi and belt colors.', isNew: true },
  classic: { label: 'Classic', detail: 'Original art. Every appearance option.', isNew: false },
};

// One load of the four layers, shared by every athlete on the page. It settles
// even if a file fails, so a missing layer can never hide the athlete for good.
let layersLoaded = null;
function loadLayers() {
  layersLoaded ??= Promise.all(Object.values(UNREAL_ATHLETE.layers).map((url) => new Promise((resolve) => {
    const image = new Image();
    image.onload = resolve;
    image.onerror = resolve;
    image.src = url;
  })));
  return layersLoaded;
}

// True once the body and every gi layer can be painted together. Until then the
// athlete stays dark, so a gi never appears without the person wearing it.
function useAthleteReady(baseRef) {
  const [layers, setLayers] = useState(false);
  const [base, setBase] = useState(false);
  useEffect(() => {
    let mounted = true;
    loadLayers().then(() => { if (mounted) setLayers(true); });
    // An image served from cache can finish before React attaches onLoad.
    if (baseRef.current?.complete) setBase(true);
    return () => { mounted = false; };
  }, [baseRef]);
  return [layers && base, () => setBase(true)];
}

// The Unreal athlete in the fighter's gi and belt colors. Four still layers are
// added together by the browser; see src/unreal/athlete.js for the arithmetic.
export default function UnrealAthlete({ fighter, belt = 'white', className = '', label }) {
  const baseRef = useRef(null);
  const [ready, baseSettled] = useAthleteReady(baseRef);
  const colors = unrealAthleteColors(fighter, beltColors[belt]);
  const layer = (name) => (
    <span
      className="unreal-athlete-layer"
      data-layer={name}
      style={{ backgroundImage: `url(${UNREAL_ATHLETE.layers[name]})`, backgroundColor: colors[name] }}
    />
  );
  return (
    <span
      className={`unreal-athlete ${ready ? 'is-ready' : ''} ${className}`.replace(/\s+/g, ' ').trim()}
      role="img"
      aria-label={label ?? `${fighter?.name || 'Fighter'}, Unreal athlete`}
    >
      <img ref={baseRef} src={UNREAL_ATHLETE.layers.base} alt="" width={UNREAL_ATHLETE.width} height={UNREAL_ATHLETE.height} draggable={false} onLoad={baseSettled} onError={baseSettled} />
      {layer('jacket')}
      {layer('pants')}
      {layer('belt')}
    </span>
  );
}

// The large stage used by the Fighter Creator and the rank path.
export function UnrealAthleteStage({ fighter, beltStatus, className = '', auraColor = '#8a5cff' }) {
  return (
    <div className={`profile-art unreal-athlete-stage ${className}`.trim()} style={{ '--athlete-aura': auraColor }}>
      <UnrealAthlete fighter={fighter} belt={beltStatus.belt} className="unreal-athlete-stage-figure" />
      <div className="profile-art-tags">
        <span>{fighter.country}</span>
        <span>{beltLabels[beltStatus.belt]}</span>
      </div>
    </div>
  );
}

// Chooses between the Unreal athlete and the classic art for one fighter.
export function FighterLookPicker({ value, onChange }) {
  return (
    <div className="fighter-look-picker" role="group" aria-label="Athlete">
      {FIGHTER_LOOKS.map((look) => (
        <button
          key={look}
          type="button"
          aria-pressed={value === look}
          className={value === look ? 'active' : ''}
          onClick={() => onChange(look)}
        >
          <strong>{lookCopy[look].label}{lookCopy[look].isNew && <em>New</em>}</strong>
          <small>{lookCopy[look].detail}</small>
        </button>
      ))}
    </div>
  );
}
