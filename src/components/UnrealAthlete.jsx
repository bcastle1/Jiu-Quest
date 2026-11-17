import { useEffect, useState } from 'react';
import { beltColors } from '../data/curriculum.js';
import { FIGHTER_LOOKS, UNREAL_ATHLETE, unrealAthleteColors } from '../unreal/athlete.js';
import { UNREAL_ATHLETE_FLOOR, UNREAL_ATHLETE_FLOOR_STYLE } from '../unreal/athleteFloor.js';
import { PUBLISHED_ATHLETE_PICTURE as PUBLISHED_PICTURE, athleteHeadPicture } from '../unreal/athleteHeads.js';
import './UnrealAthlete.css';

const lookCopy = {
  unreal: { label: 'Unreal athlete', detail: 'Rendered in Unreal Engine. Face, hair, beard and gi colors.', isNew: true },
  classic: { label: 'Classic', detail: 'Original art. Skin tone, hairstyle, emblem and gi colors.', isNew: false },
};

// One load per file, shared by every athlete on the page. A load settles even
// if the file fails, so a missing file can never hide the athlete for good. A
// failed load is not remembered: the next athlete that needs the file tries again.
const loads = new Map();
function loadFile(url) {
  if (!loads.has(url)) {
    loads.set(url, new Promise((resolve) => {
      const image = new Image();
      image.onload = () => resolve(true);
      image.onerror = () => { loads.delete(url); resolve(false); };
      image.src = url;
    }));
  }
  return loads.get(url);
}

// The pants and belt layers are the same for every head.
const SHARED_LAYERS = [UNREAL_ATHLETE.layers.pants, UNREAL_ATHLETE.layers.belt];

// After a picture failed to load it is tried again after these delays, in
// milliseconds; then the stand-in stays until the choice changes.
const RETRY_DELAYS = [4000, 15000];

// The picture to paint for the head a fighter chose. The base, the head laid
// over it and the gi layers arrive as separate files, and nothing shows until
// all of them can be painted in the same frame, so a gi never appears without
// the person wearing it. While another choice loads, the picture painted
// before stays (`changing` says one is on its way).
//
// A head is never painted in part. If only the picture laid over the head
// cannot load, the chosen face shows as its base picture has it. If the face's
// own base or jacket layer cannot load (the jacket layer belongs to that base),
// the published athlete stands in. A layer of the published athlete that fails
// to load does not hold the others back. Whatever failed, the files are tried
// again; `attempt` counts the tries, so the page can load its own copies again
// (an element that failed keeps its broken picture while its address stays the
// same).
function useAthletePicture(wanted) {
  const [decided, setDecided] = useState({ id: null, shown: null, waiting: false, attempt: 0 });
  const [retry, setRetry] = useState({ id: null, count: 0 });
  const headUrl = wanted.head?.url ?? null;
  // A picture is named by its files; `wanted` is a new object on every render.
  const id = [wanted.base, wanted.jacket, headUrl ?? ''].join('|');
  const tries = retry.id === id ? retry.count : 0;
  useEffect(() => {
    let mounted = true;
    let timer = null;
    const body = wanted.jacket === PUBLISHED_PICTURE.jacket ? [wanted.base] : [wanted.base, wanted.jacket];
    const files = [...body, ...(headUrl ? [headUrl] : []), PUBLISHED_PICTURE.jacket, ...SHARED_LAYERS];
    Promise.all(files.map(loadFile)).then((arrived) => {
      if (!mounted) return;
      const hasBody = arrived.slice(0, body.length).every(Boolean);
      const hasHead = !headUrl || arrived[body.length];
      const shown = !hasBody ? PUBLISHED_PICTURE : hasHead ? wanted : { ...wanted, key: wanted.baseKey, head: null };
      // `attempt` only ever grows, and only after a try that followed a failure: a new choice never changes it.
      // `waiting` says another try is on its way.
      const waiting = !arrived.every(Boolean) && tries < RETRY_DELAYS.length;
      setDecided((previous) => ({ id, shown, waiting, attempt: tries > 0 ? previous.attempt + 1 : previous.attempt }));
      if (waiting) timer = setTimeout(() => setRetry({ id, count: tries + 1 }), RETRY_DELAYS[tries]);
    });
    return () => { mounted = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, tries]);
  // A choice is on its way until it is decided, and for as long as a failed file is still to be tried again: the
  // stand-in shows another head than the pressed buttons, so the athlete keeps saying that it is working on it.
  return { shown: decided.shown, changing: decided.id !== id || decided.waiting, attempt: decided.attempt };
}

// The Unreal athlete with the head and in the gi and belt colors of one
// fighter. The browser adds the gi layers to the base; see
// src/unreal/athlete.js for the arithmetic and src/unreal/athleteHeads.js for
// the head.
export default function UnrealAthlete({ fighter, belt = 'white', className = '', label }) {
  const wanted = athleteHeadPicture(fighter);
  const { shown, changing, attempt } = useAthletePicture(wanted);
  // Until the first picture is decided, the wanted one loads in place, unseen.
  const picture = shown ?? wanted;
  // The files this athlete's own <img> elements have finished with. The first
  // time the athlete shows, its base and its head must be in the page, not only
  // in the browser's cache: a cache that has to ask the server again would let
  // the gi show a moment before the person. Once shown it stays shown; a later
  // choice swaps to files that are already loaded.
  const [inPage, setInPage] = useState({ base: null, head: null });
  const [revealed, setRevealed] = useState(false);
  const whole = Boolean(shown) && inPage.base === picture.base && (!picture.head || inPage.head === picture.head.url);
  if (whole && !revealed) setRevealed(true);
  const settle = (part) => (event) => {
    const file = event.currentTarget.getAttribute('src');
    setInPage((current) => (current[part] === file ? current : { ...current, [part]: file }));
  };
  const colors = unrealAthleteColors(fighter, beltColors[belt]);
  // The jacket layer is the one that fits the neck of the face in the base.
  const layerUrl = (name) => (name === 'jacket' ? picture.jacket : UNREAL_ATHLETE.layers[name]);
  // After a try that followed a failure, every picture is a new element: one
  // that failed would keep its broken picture, since its address is unchanged.
  const layer = (name) => (
    <span
      key={`${name}-${attempt}`}
      className="unreal-athlete-layer"
      data-layer={name}
      style={{ backgroundImage: `url(${layerUrl(name)})`, backgroundColor: colors[name] }}
    />
  );
  return (
    <span
      className={`unreal-athlete ${revealed ? 'is-ready' : ''} ${changing ? 'is-changing' : ''} ${className}`.replace(/\s+/g, ' ').trim()}
      role="img"
      aria-label={label ?? `${fighter?.name || 'Fighter'}, Unreal athlete`}
      data-head={picture.key ?? 'published'}
    >
      {/* A file that fails here settles too, so nothing can hide the athlete for good. */}
      <img key={`base-${attempt}`} src={picture.base} alt="" width={UNREAL_ATHLETE.width} height={UNREAL_ATHLETE.height} draggable={false} onLoad={settle('base')} onError={settle('base')} />
      {picture.head && <img key={`head-${attempt}`} className="unreal-athlete-head" src={picture.head.url} alt="" style={picture.head.style} draggable={false} onLoad={settle('head')} onError={settle('head')} />}
      {layer('jacket')}
      {layer('pants')}
      {layer('belt')}
    </span>
  );
}

// The large stage used by the Fighter Creator and the rank path. The athlete
// stands on a tatami mat (src/unreal/athleteFloor.js): the lit floor, and the
// athlete's outline that keeps it behind him. Both files stay in the page, and
// the floor is painted only once both have loaded there: without the outline it
// would lie over his legs. If either fails, the stage is the black studio.
export function UnrealAthleteStage({ fighter, beltStatus, className = '', auraColor = '#8a5cff' }) {
  const [inPage, setInPage] = useState({ picture: false, silhouette: false });
  const settle = (part) => (event) => {
    const loaded = event.type === 'load';
    setInPage((current) => (current[part] === loaded ? current : { ...current, [part]: loaded }));
  };
  const onMat = inPage.picture && inPage.silhouette;
  return (
    <div className={`profile-art unreal-athlete-stage ${onMat ? 'has-floor' : ''} ${className}`.replace(/\s+/g, ' ').trim()} style={{ '--athlete-aura': auraColor }}>
      <UnrealAthlete fighter={fighter} belt={beltStatus.belt} className="unreal-athlete-stage-figure" />
      <span className="unreal-athlete-floor-files" hidden>
        <img src={UNREAL_ATHLETE_FLOOR.picture.url} alt="" onLoad={settle('picture')} onError={settle('picture')} />
        <img src={UNREAL_ATHLETE_FLOOR.silhouette.url} alt="" onLoad={settle('silhouette')} onError={settle('silhouette')} />
      </span>
      {onMat && (
        <span className="unreal-athlete-floor" data-floor={UNREAL_ATHLETE_FLOOR.surface.id} style={UNREAL_ATHLETE_FLOOR_STYLE} aria-hidden="true" />
      )}
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
